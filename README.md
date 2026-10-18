# abele-sync SDK

TypeScript ESM packages for building applications on abele-sync. Requires Node.js 22 or newer.

- `@abele/sync-sdk`: connection key parsing and one-shot folder synchronization.
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
`backoffMs`, and `fallbackMs` pass through to the engine. Changes come directly
from its durable apply hook; crash replay can repeat notifications and delivery
is not a durable queue. `readOnly` reflects the server connection permission.
The current Node opener owns its `.abele-sync` state layout; separate `stateDir`
is explicitly rejected until the core supports it. Client-side read-only policy
and continuous lifecycle controls are not implemented yet.

Run the disposable Docker integration tests with `npm run test:server`.
See `test/server/README.md` and `examples/folder-mirror/README.md` for details.

## Licence

GPL-3.0-only; see LICENSE. Applications that distribute these packages must be GPL-compatible.
Private server use is not distribution.
