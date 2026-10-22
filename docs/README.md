# SDK API and operations

See the [0.3.0 host migration checklist](migration-0.3.md) before upgrading custom adapters.

Requires Node.js 22+ and ESM. SDK 0.3.0 pairs with core, node and protocol
**0.5.0**, with server targets **0.3.3** and **0.5.0** (`compat.json`). Protocol 2
is required; its number alone does not guarantee compatibility with every server
build. The matching core, Node adapters and protocol are bundled inside this package.

## Opening and adapters

`parseKey(key)` validates and decodes locally without network access. Its result
contains the token address and either a legacy scope or v2 item previews; treat it as a credential.
`open(options)` checks capabilities and the active connection, then opens local
state and completes recovery. Call `syncOnce()` explicitly for current server data.

`client.scope` reports the server connection's folder, group or file scope. Paths are
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

## Item sets (server 0.5.0)

```ts
import { ItemClient, AccessClient, open } from "@abele/sync-sdk";

const owner = ItemClient.fromToken(ownerKey, { fetch });
if (await owner.supportsItems()) {
  const added = await owner.addItem(targetTokenId, {
    kind: "file",
    id: fileId,
  });
  const recipient = ItemClient.fromToken(recipientKey, { fetch });
  const inventory = await recipient.items();
  const client = await open({
    key: recipientKey,
    item: added.id,
    files,
    state,
  });
  try {
    await client.syncOnce();
  } finally {
    await client.close();
  }
  await owner.removeItem(targetTokenId, added.id); // detach access, keep content
}
```

`items()` lists the calling key's items, including removed entries.
`ItemClient.tokenItems(tokenId)` and `AccessClient.tokenItems(tokenId)` list an
owned key's items without its recipient secret. `AccessClient.tokens()` includes
optional `item_count` values when supported; older servers omit them.
`./protocol` exports `V2TokenItemsResponseSchema` and `V2TokenItemsResponse`
for owner inventory responses.

Item inventory, previews, totals and item counts are filtered to caller coverage.
Hidden child items are omitted; directly previewing one returns HTTP 403.
Group `overlap_count` includes undisclosed shares, so it may exceed
`overlaps.length` even below the response cap. Undisclosed overlaps have no
array entry, path or identifier; do not infer absence from an empty array.
The overlap-detail schema is unchanged: disclosed entries still have all fields.
`ItemClient` surfaces 403 as `AbeleError` with `code: "forbidden"` and
`status: 403`, matching server error envelopes from `AccessClient`. Both
`AbeleError` and `HttpError` are exported at the SDK root (a non-envelope
AccessClient refusal can be `HttpError` with `status: 403`).
This changes ItemClient 403 handling from HttpError/protocol to AbeleError/forbidden.
Consumers must handle omitted items and partial totals without treating them
as complete key inventory or vault-wide deletion impact.

Both clients expose `previewTokenItem(tokenId, itemId, { limit? })` and
`previewToken(tokenId, { limit? })` for owner-authorized deletion impact previews.
They return full file/byte totals, capped file paths and group cross-token overlaps;
file/folder previews have empty overlap lists. Key totals deduplicate files across items. The optional file limit defaults to
100 and is capped at 500; overlap lists are capped at 20. These are read-only
previews, not deletion authorization or a snapshot guarantee. `./protocol` exports
`V2ContentPreviewQuerySchema`, `V2ItemContentPreviewSchema`,
`V2TokenContentPreviewSchema`, their response types `V2ItemContentPreview` and
`V2TokenContentPreview`, and the `V2_PREVIEW_FILE_LIMIT` and
`V2_PREVIEW_OVERLAP_LIMIT` constants. The issuer or
whole-vault owner uses `addItem(tokenId, selector)` and
`removeItem(tokenId, itemId)` to manage a target key. Selectors support `folder`,
`group` and `file`; their ids identify server objects, not paths. Use
`AccessClient.fromToken(key, { fetch })` to issue/list/revoke keys and
`V2EngineClient` from the root or `./core` for lower-level engine operations.

`deleteItem(itemId, idempotencyKey)` deletes the selected item's server content
under server ownership checks. It can target an owned recipient key's item.
Persist and reuse the same idempotency key when retrying this destructive operation.
Removing access and deleting content are separate operations.

`supportsItems()` probes the authenticated inventory route because the server
does not advertise an item capability flag. It returns false on 404 and throws
on authentication, connectivity, malformed-response and other server errors.
Server 0.3.3 supports legacy keys only. `open({ item })` checks item support
before opening a content connection; omitting `item` preserves primary-scope behavior.
Each item needs separate files and state. Node replicas persist selection in their
connection identity and refuse switching items in an existing state directory.

`parseKey` accepts legacy payload v1 (`scope`) and payload v2 (`items` previews).
Use the union's `v` field to narrow it. Previews are hints; the server connection
and inventory provide current authority. `./protocol` exports the v2 token,
item, selector, connection and deletion schemas and existing payload types;
the root also exports `ScopeItem`, `ScopeItemsResponse`, `V2AccessToken`,
`V2Scope`, `V2Selector`, `V2Connection` and the core `ClientOptions` type.

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

`start()` enables watch, event-socket and fallback triggers. `pause()` interrupts
the active run and suspends automatic triggers; manual sync still works unless
authorization has halted. Interrupted `syncOnce()` rejects with `SyncCancelled`,
without an error event or offline retry.
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
| SyncCancelled             | offline (intentional interruption; check class first)                   |
| SyncError                 | offline, unauthorized, other                                            |
| HistoryError              | closed, unauthorized, offline, forbidden, not_found, unsupported, other |

Invalid adapters/paths can throw TypeError; lifecycle misuse can throw ordinary
errors. Some `open()` transport and native filesystem/SQLite/lock failures retain
upstream error shapes at this version. Do not log arbitrary errors/causes or
connection credentials. SDK event/history errors and sync failures are sanitized.
