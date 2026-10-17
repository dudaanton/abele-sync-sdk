# abele-sync SDK

TypeScript ESM packages for building applications on abele-sync. Requires Node.js 22 or newer.

- `@abele/sync-sdk`: synchronization facade (scaffold; API coming later).
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

See `examples/` and `docs/`. Public APIs and server integration tests will follow in later tasks.

## Licence

GPL-3.0-only; see LICENSE. Applications that distribute these packages must be GPL-compatible.
Private server use is not distribution.
