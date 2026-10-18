# abele-sync SDK

TypeScript ESM packages for building applications on abele-sync. Requires Node.js 22 or newer.

- `@abele/sync-sdk`: connection key parsing, one-shot and continuous synchronization.
- `@abele/notes`: portable notes model (scaffold; API coming later).

## Development

Run `npm ci`, `npm run types`, `npm test`, `npm run check:core-pin`, and `npm run smoke`.
Compatibility is recorded in `compat.json`.

The npm configuration disables automatic peer installation to avoid an npm 10
resolver crash with Vitest 5. Vite and Node types are pinned explicitly at the
versions used by the upstream workspace.

Core packages are temporarily pinned to tarballs in `vendor/` because they are not on npm yet.
To refresh from a built abele-sync checkout, run
`npm run vendor:refresh -- /path/to/abele-sync`, then `npm install`.
These dependencies must switch to exact npm version pins at the first release.
The release workflow refuses to publish packages with file dependencies.

## Examples and documentation

### Mirror a folder once

After `npm ci` and `npm run build`, use a protocol 2 folder connection key:

```sh
node examples/folder-mirror --key '<key>' --dir ./mirror --once
```

This synchronizes both ways and prints the core sync report. The client closes
its database and releases its lock before exiting. State and connection credentials
live in `mirror/.abele-sync`; keep that directory private. Hidden files follow
the core's exclusion rules. This is a single sync pass; files still being written
may be held for the next run.

```ts
import { open, parseKey } from "@abele/sync-sdk";

const scope = parseKey(key).scope; // local validation; no network
const client = await open({ key, dir: "./mirror" });
try {
  client.on("change", (change) => console.log(change.path));
  const report = await client.syncOnce();
} finally {
  await client.close();
}
```

Custom hosts can supply `files` and `state` implementing the core `FileSystem`
and `StateStore` interfaces, plus `transport.fetch` and `transport.WebSocket`.
Those adapters stay owned by the caller. `clock`, `logger`, `deleteGuard`, `defer`,
`backoffMs`, and `fallbackMs` configure the engine. Logger notifications and
error messages are generic to avoid exposing transport credentials. Changes come directly
from its durable apply hook; crash replay can repeat notifications and delivery
is not a durable queue. `readOnly` reflects the server connection permission.
Pass `stateDir` alongside `dir` to keep credentials and the durable ledger outside
the mirrored folder. It must be outside `dir`; reopening the same pair resumes
from its saved state. Reusing that state directory for another folder is refused
with `ReplicaConfigurationError` (code `REPLICA_CONFIGURATION`). The default
remains `dir/.abele-sync`. Client-side read-only policy is not implemented yet.

`client.replica.list(prefix?)` returns regular files with `path`, byte `size`,
`mtime`, and `fileId` when known to the ledger. Prefix matching is literal; use
`"notes/"` to list a folder recursively. `read(path)` returns bytes and
`readText(path)` decodes UTF-8. These APIs read the local replica, including local
edits awaiting sync, and work with supplied adapters too. They exclude state
folders and reject absolute paths, traversal, and backslash paths. Call
`syncOnce()` first when current server data is needed.

Use `client.start()` for continuous sync over the core event socket, local watcher
and fallback timer. `pause()` suspends automatic triggers; `resume()` clears the
pause or authorization halt and syncs immediately. `syncOnce()` can run while
paused, but a revoked connection requires `resume()` first. `stop()` awaits active
work and releases watches, sockets and timers; await it before `start()` again.
`close()` also releases the Node replica and is idempotent. A closed client cannot
be restarted. Pauses and authorization halts survive stop/start.

`on("status", listener)` receives status objects whose `state` is
`idle | syncing | offline | paused | error`. `on("synced", listener)` receives each
successful report. `error` and `revoked` receive a `SyncError` with code
`offline | unauthorized | other` and no raw transport cause. Revocation emits once
per authorization halt and cancels automatic retries until `resume()`.
Each subscription returns an unsubscribe function; listener exceptions are isolated.
`change` notifications have at-least-once semantics for applied changes: crash
replay can repeat them, and an offline listener cannot replay a durable queue.
`conflict` reports the final push response's merged or copied outcomes as
`{ outcome, path, fileId, versionId }`, with `conflictPath`, `conflictFileId`, and
`conflictVersionId` for copies. It carries no file contents. Like sync reports,
this event can repeat on replay and is not a complete conflict history across
multiple push batches.
The folder mirror's `--watch` mode logs status and changes until Ctrl-C.

Run the disposable Docker integration tests with `npm run test:server`.
See `test/server/README.md` and `examples/folder-mirror/README.md` for details.

## Licence

GPL-3.0-only; see LICENSE. Applications that distribute these packages must be GPL-compatible.
Private server use is not distribution.
