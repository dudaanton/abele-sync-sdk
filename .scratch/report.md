# SDK 0.3.0 preparation

Core SHA: `f6576ceda00638805a9377e7ab523efce773ef27`, from the authorized read-only
`/Volumes/Work/worktrees/abele-sync/pause-abort-v2` checkout. Core/protocol/Node
package versions remain 0.5.0. SDK and private notes workspace are 0.3.0.
`compat.json` records `coreSha`; NOTICE and the package source link use the exact SHA.

## Commits

- `e2c580e chore: prepare SDK 0.3.0 with reliability core`
- `ed05729 fix: preserve cancellation and scoped recovery contracts`

The final documentation commit adds the migration checklist and this report.
Nothing was pushed, tagged, published, released, merged or rewritten.

## Causes and fixes

- SDK `syncOnce()` caught every rejection and erased intentional core
  cancellation. It now preserves the `SyncCancelled` classification via a fresh
  instance, keeping error sanitization. The root exports the same class as the
  bundled core. Existing error/revocation behavior is retained.
- Custom-adapter disconnect wrote through the root inside a transaction callback.
  New scoped stores correctly rejected publication after these independent writes.
  `forgetState` now uses `transact` and only its callback capability, including
  enumeration, metadata, cursor and journal. Constructor scope bookkeeping also
  wrote asynchronously outside the engine scheduler and raced immediate disconnect;
  custom-adapter open now drains serialized scope marking before returning.
- Node disconnect rejected the new empty `conditional`/`installations` namespaces
  after ordinary pulls. It now recognizes them, but refuses nonempty evidence and
  retained approval review directories before closing state/deleting anything.
  The old approval-directory cleanup would otherwise remove retained user bytes.
- Two recovery fixture expectations assumed foreign/unowned journals always
  block startup at their original location. Core round 11 deliberately archives
  them via durable rename for review and permits startup. Tests now require exactly
  one stable review directory across two reopens, byte-for-byte preserved journal
  and unchanged public file. This changes location/error expectations to the new
  contract; no preservation assertion was removed. Other actionable recovery-error
  tests remain.

Failing-first evidence: `.scratch/reliability-red.log` has all four new regressions
failing (missing export, pause/stop erasure, scoped disconnect conflict), then
`.scratch/reliability-green.log` passes all four. Existing history/sdk tests exposed
the constructor race and recovery changes. `.scratch/evidence-red.log` reproduces
unsafe review deletion and rejection of empty namespaces; the focused green run
passes 38 tests. No tests were deleted, loosened or marked expected-failure.

## Verification

- Core TypeScript dry-build/verbose reported protocol/core/Node already up to date;
  no build or source writes were needed there. Refreshed all three tarballs with
  `npm run vendor:refresh`; protocol output is byte-identical to the old vendor.
- `npm install` succeeds. Initial same-name tarballs hit the old lock's integrity
  hashes; refreshed only local vendor integrity values, retaining all third-party
  versions/dependencies. No new third-party dependency was added.
- `npm run types`: pass (`.scratch/types-final.log`).
- `npm test`: **197 Vitest tests / 17 files, 9 Node tests pass**, with the script's
  `--maxWorkers=2` (`.scratch/test-final.log`). This is the SDK test selection
  explicitly requested by the brief, not the upstream whole suite.
- Sandbox `os.uptime()` throws `uv_uptime EPERM`. The first unshimmed run exposed
  eight failures; a test-only preload copied from the core's recorded workaround
  replaces uptime only on EPERM with monotonic process time. Final command:
  `NODE_OPTIONS="--require=$PWD/.scratch/uptime.cjs" TMPDIR="$PWD/.cache/tmp" npm test`.
  Production clock/lock code and test assertions are unchanged. Native uptime and
  real watcher delivery remain unverified.
- `npm run check:core-pin`: pass (`.scratch/core-pin-final.log`).
- `npm run smoke`: pass, including isolated packed install, runtime root/core
  cancellation class identity, scoped-state exports, declaration imports of new
  filesystem/streaming/state/client ports and existing API checks
  (`.scratch/smoke-exports.log`).
- Changed-file Prettier and `git diff --check`: pass. ESLint is not installed or
  configured in this repo; no whole lint was run.

## Artifact and remaining delivery restriction

Dev tarball produced with `npm pack ./packages/sdk`:
`/Volumes/Work/worktrees/abele-sync-sdk/sdk-reliability/.scratch/release/abele-sync-sdk-0.3.0-dev/abele-sync-sdk-0.3.0.tgz`

SHA256: `55b6043f8e46db236374c81c130677241f00b15a13108b7cbf582b1288d29bbf`

The requested destination `/Volumes/Work/home/release/abele-sync-sdk-0.3.0-dev/`
is outside the session's writable roots. Creating it failed with
`Operation not permitted`; escalation is unavailable. The manager must copy the
above artifact there and verify this checksum. It is deliberately not checked into
Git. This is the one incomplete brief step.

## Migration checklist summary and limits

`docs/migration-0.3.md` records pinned core paths and report sections for conditional
file effects, durable captures/publication proof, stage allocation callback and
idempotent disposal, physical alias/directory ports, deferred local inventory,
manifest-cache rehydration, revocable transaction capabilities/native IndexedDB
publication, transitive receipt/tally callbacks, metadata/journal provenance,
operational error propagation, grouped approval/review lifecycle, cancellation/UI
and bounded checkpoint cursors. Every item states the conservative fallback or
hard requirement. Optional declarations do not make destructive host effects safe
without their contract. Later settlement/cursor decisions supersede earlier report
statements.

No Obsidian/plugin/device/vault, physical power-loss or live server verification was
performed. Server targets remain existing compatibility targets, not newly tested
claims. Install reported three dependency advisories (two moderate, one high);
dependency upgrades are outside this no-new-dependencies refresh and were not
attempted. No task note was requested or touched. All owned runners exited.

Manager action/question: copy the artifact to the requested release scratch path;
run host IndexedDB rollback-isolation tests and manual large-vault pause/restart
checks before switching the plugin. No product decision is outstanding.
