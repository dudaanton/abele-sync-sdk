# @abele/sync-sdk

Installation target: `npm install @abele/sync-sdk`.

```js
import { open, parseKey } from "@abele/sync-sdk";
const key = process.env.SYNC_KEY;
parseKey(key); // local validation
const client = await open({ key, dir: "./mirror" });
try {
  await client.syncOnce();
  console.log(await client.replica.list());
} finally {
  await client.close();
}
```

## API and operations

Requires Node.js 22+ and ESM. SDK 0.1.1 pairs with core, node and protocol
**0.4.0**, and server **0.3.3** in the tested matrix (`compat.json`). Protocol 2
is required; its number alone does not guarantee compatibility with every server
build. The matching core, Node adapters and protocol are bundled inside this package.

## Opening and adapters

`parseKey(key)` validates and decodes locally without network access. Its result
contains the token address and scope; treat it as a credential.
`open(options)` checks capabilities and the active connection, then opens local
state and completes recovery. Call `syncOnce()` explicitly for current server data.

`client.scope` reports the server connection's folder or group scope. Paths are
relative to that projected replica. There is no SDK group management API.
`client.readOnly` reports server permission; there is no local read-only option.
Incoming sync can still write local files. Use server permissions to prevent uploads.

Choose either `{ key, dir, stateDir? }` for SDK-owned Node adapters, or
`{ key, files, state }` for caller-owned adapters. `FileSystem` and `StateStore`
are exported core interfaces, not constructors. Supply both custom adapters and
do not combine them with directory options. Their durability, watching and final
disposal belong to the caller; closing the SDK does not dispose them.

Optional `transport.fetch` and `transport.WebSocket` replace Node globals.
`clock: () => number` supplies engine time in milliseconds, not the filesystem
lock/recovery clocks. `logger: (line: string) => void` receives generic activity
notices. `backoffMs: [min, max]` and `fallbackMs` configure retry and periodic
sync delays in milliseconds. `deleteGuard` and `defer` control decisions below.

## State, locks and recovery

The default `dir/.abele-sync` stores configuration (including credentials),
SQLite state and recovery evidence. Keep it private and out of other sync tools.
`stateDir` can name an external directory, or exactly the default state path;
other paths inside the replica, including symlink aliases, are rejected.

External state moves credentials and the ledger outside the replica, but local
installation staging and transient directory locks still use `dir/.abele-sync`
for atomic filesystem operations. Do not remove it while active.

Reopen the same directory, key and state directory to resume. The ledger is
bound to its connection; external state is also bound to the canonical replica
directory. Reusing it for another directory or key is refused. Use a fresh pair
for a different replica; do not edit configuration to bypass binding checks.

The Node adapter uses native `better-sqlite3`: installation needs a binary for
the Node ABI/platform, or a native build toolchain if no prebuilt binary exists.
An installation/import failure does not imply server incompatibility.

Only one process may own a replica. Lock acquisition can wait to check a
previous owner; do not delete a lock to force another writer. Await `close()` to
release SQLite and locks. After interruption reopen the same state to recover
journals and pending writes before normal syncing. `RecoveryRequiredError` (code
`RECOVERY_REQUIRED`) means recovery needs attention; its message contains no local
paths or underlying error details. Reopen with the original state directory. If
recovery refuses, preserve files and state for investigation. Back up both together
while the client is closed.

## Synchronization and delivery

`syncOnce()` returns the core `SyncReport`: `pull`, `push`, `secondPull`,
`collisions`, `deferred`, `joined`. Success need not mean every file transferred:
settling files, held deletes and deferred changes may require another pass/action.
Sync is bidirectional.

`start()` enables watch, event-socket and fallback triggers. `pause()` suspends
automatic triggers; manual sync still works unless authorization has halted.
`resume()` clears pause/authorization halt and prompts sync. `stop()` awaits
active work and releases automatic resources; await it before restarting.
Pause and authorization halt survive stop/start. `close()` also releases owned
adapters, is idempotent, and permanently closes the client. Use `finally` and
handle SIGINT/SIGTERM, as the folder-mirror example does.

`on(event, listener)` returns an unsubscribe function. Listeners run synchronously;
thrown exceptions are isolated. Handle rejections from your own async work.

| Event         | Value                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| `status`      | Core status; state idle, syncing, offline, paused or error; sanitized error text     |
| `synced`      | Successful core report                                                               |
| `change`      | Core AppliedChange after durable apply                                               |
| `conflict`    | Final push merged/copied outcome, path and IDs; copies include conflict path and IDs |
| `error`       | Sanitized SyncError                                                                  |
| `revoked`     | Once per authorization halt, or successful self-revocation                           |
| `heldDeletes` | Changed nonempty held-delete list                                                    |

Applied change notifications can repeat during crash replay. Events are live,
not a durable queue or exactly-once subscription. Conflict events cover the
final push response, not all historical batches. Build an idempotent consumer
by re-reading the replica and upserting derived records by path, rather than
appending an action per notification. Reconcile with `list()` at startup to
cover missed notifications. External side effects need their own persistent,
atomic deduplication; an in-memory set does not survive crashes.

## Reading, history and decisions

`replica.list(prefix?)`, `read(path)` and `readText(path)` read local data,
including unsynced edits. Listing is sorted, recursive and literal-prefix based:
`Notes/` selects descendants; `Notes` also matches `Notes-old.md`. Entries have
`path`, byte `size`, `mtime`, and optional ledger `fileId`. Text is UTF-8.
State paths are excluded; absolute, traversal and backslash paths are rejected.

`history(path, { limit?, before? }?)` reads server versions.
`restore(path, versionId)` uses the engine's serialized restore operation.
`trash()` lists deleted files; `restoreDeleted(pathOrId)` restores a listed path
or file ID. Restore returns a core commit result; rejection throws HistoryError.
Sync afterwards to fetch restored content. Server retention and permissions apply.

The default delete guard holds 50 deletions, or at least 10 making up a quarter
of synced entries. Recent deletes count for a default 15-minute window.
`deleteGuard: { count, floor, share, windowMs? }` overrides thresholds;
`deleteGuard: false` disables protection. `heldDeletes()` lists path/fileId pairs.
Pass reviewed IDs to `decideDeletes({ kind: "confirm" | "restore", fileIds })`.
Confirm sends deletes; restore retrieves missing local files from live server
copies, not trash. The result is `{ decided, report }`. A decision starts sync
unless paused/halted, when it waits for syncing to resume.

`defer: (wirePath) => boolean` stages matching remote changes instead of writing
them locally. `deferred()` lists staged changes; `applyDeferred(versionIds?)`
applies selected versions through the engine. Omit IDs to apply all current
staged changes; pass reviewed IDs to avoid unseen replacements. This is data
deferral, not a code approval/execution facility.

`disconnect()` stops, forgets local connection state/credentials and closes,
keeping user files. Custom metadata stores require `metadataKeys` and `setMeta`
for complete forgetting, otherwise HistoryError("unsupported") is thrown.
`revoke()` revokes this connection's server token and stops syncing, retaining
local state. A self-revoked client cannot start/resume; close or disconnect it
separately.

## Errors

Branch on exported classes and codes, not message text.

| Class                     | Code                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| InvalidKey                | INVALID_KEY                                                             |
| IncompatibleServer        | INCOMPATIBLE_SERVER                                                     |
| ReplicaConfigurationError | REPLICA_CONFIGURATION                                                   |
| SyncError                 | offline, unauthorized, other                                            |
| HistoryError              | closed, unauthorized, offline, forbidden, not_found, unsupported, other |

Invalid adapters/paths can throw TypeError; lifecycle misuse can throw ordinary
errors. Some `open()` transport and native filesystem/SQLite/lock failures retain
upstream error shapes at this version. Do not log arbitrary errors/causes or
connection credentials. SDK event/history errors and sync failures are sanitized.

## Licence

GPL-3.0-only; see LICENSE. Conveying this package or a combined derivative
application requires GPLv3 compliance, including applicable source, notice and
licence obligations. Private modification and use do not require publication;
network access alone creates no AGPL-style source offer. Distribution to others
still carries GPL obligations, even when private or commercial.

## Included notes parser and types

The task and note parser is included:

```js
import { taskFromFrontmatter, noteFromMarkdown } from "@abele/sync-sdk/notes";
const task = taskFromFrontmatter({ groups: ["work"] });
```

Use `@abele/sync-sdk/core` and `@abele/sync-sdk/protocol` for the core and
protocol types referenced by the public SDK API, including adapter contracts
and decoded connection tokens. No separate Abele packages are needed.

The core, protocol and Node adapter code comes from
[abele-sync v0.4.0](https://github.com/dudaanton/abele-sync/tree/v0.4.0).
See NOTICE and the included upstream licences. The notes parser is built from
this repository. Public YAML helper declarations require `@types/js-yaml`,
which is included as a dependency.
