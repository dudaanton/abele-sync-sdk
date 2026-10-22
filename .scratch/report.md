# SDK 0.3.0 preparation

## Latest refresh: clean 486568b snapshot

Commit: `5e2aadc chore(sdk): vendor clean 486568b core snapshot`.
Current core pin is **`486568bf10a6033052b7b56a478b8edf41dc95a9`**. This section
supersedes all earlier pin/checksum entries below. The manager identifies upstream
GitHub CI run `39854950736` as green on this exact commit; that remote run was not
independently rerun here.

### Source isolation and dependencies

Exported the exact Git object with `git archive` into the fresh worktree-local
`.scratch/core-486568b` directory. Installed the export's locked dependencies with
`npm ci --ignore-scripts --no-audit --no-fund`, then built protocol/core/Node there
with `tsc -b` (all compiled from scratch). Logs:
`.scratch/486568b-install-core.log`, `.scratch/486568b-build-core.log`.
No source, build output, index or commit was written in the other worker's core
checkout. Its live files were read only for the requested report; vendor refresh
packed exclusively from the clean export. Later retry-scheduler/waiting-files and
extra pause-fencing work is deliberately excluded.

Ran vendor refresh and `npm install`; only local core/Node tarball integrity hashes
changed in the SDK lockfile. Protocol tarball is unchanged. No third-party
dependencies/versions were added or changed. SDK remains 0.3.0 and upstream
packages remain 0.5.0. Compat coreSha, NOTICE and packaged source URL match the pin.

### Host migration since d256b13

Read the entire commit interval and the corresponding report sections through
486568b, distinguishing later live report entries. The migration guide now covers:

- Directory policy refusal skips a subtree while other paths continue. Report
  push rejection ops now also include mkdir (no file ID/SHA/size); incoming refusal
  rows appear in optional pull/secondPull rejection lists. Forward synchronous
  directoryRefusals/pathRefusal queries and asynchronous retryRefusedDirectories.
  Explicit engine rescan durably rewinds before clearing refusal policy; routine
  sync/restart does not retry. Typed host mkdir AbeleError policy refusal remains
  distinct from operational/ownership/network errors.
- Refused changes, including tombstones, survive restart in transactional
  pull-refused metadata behind the ordered cursor barrier. Metadata-less hosts
  conservatively pin instead of acknowledging an undurable refusal.
- Push batches settle at 100 ops or 8 MiB submitted content, with indivisible
  file/move-modify exceptions; existing streaming budgets and journal keys remain.
- Feed metadata coalesces newest heads per file identity, preserving earliest
  publication barriers and distinct identities sharing a path. Complete newest
  equal-content snapshots can be adopted without download/write/republishing;
  historical equality beneath a different newer version is not authorization.
  Pending-write/staged installation proof requirements remain stricter.
- Unknown file tombstones remain visible before creation settles; tombstones
  resolve only their own identities. Known installed/incoming directory tombstones
  perform directory cleanup/refusal retirement without entering file staging.
- Crash-matrix durability-flush isolation, simulator fences and fixture/clock
  changes add no public host API and do not weaken production durability.

No SDK logic breakage was found by the requested checks, and no SDK test needed
deletion or changed expectations. Upstream red-first evidence is in the core
report; this refresh adds no product fix requiring a new red test.

### SDK verification

- `npm run types`: pass (`.scratch/486568b-types.log`).
- `npm test`: **202 Vitest tests / 17 files and 9 Node tests pass**
  (`.scratch/486568b-test.log`). Script uses `--maxWorkers=2`; same test-only uptime
  EPERM preload and worktree-owned temp path as previous rounds. Production clock
  code and test assertions are unchanged.
- `npm run check:core-pin`: pass (`.scratch/486568b-pin.log`).
- `npm run smoke`: packed install/import/declaration checks pass
  (`.scratch/486568b-smoke.log`).
- Changed-file Prettier, every quoted core source path in the migration guide,
  and `git diff --check`: pass. ESLint remains unavailable; no whole lint or
  upstream full suite was run.

### Artifacts and blocked external copy

New dev tarball:
`/Volumes/Work/worktrees/abele-sync-sdk/sdk-reliability/.scratch/release/abele-sync-sdk-0.3.0-dev/abele-sync-sdk-0.3.0.tgz`

**Current SHA256:** `262bfac22d1b4013f93f374f2f1dcdcb4253b5b504ecd5c506883775754f122b`.

Preserved old d256b13 artifact beside it as
`.scratch/release/abele-sync-sdk-0.3.0-dev/abele-sync-sdk-0.3.0.d256b13.tgz`, SHA256
`07eecd2a505877560a6449f37238db80c1a2f96490af84f44cb531de88e9b5de`.

Both requested external copy operations were attempted: preserving the external
old artifact with the .d256b13.tgz suffix and replacing the main artifact under
`/Volumes/Work/home/release/abele-sync-sdk-0.3.0-dev/`. Each failed with
`Operation not permitted`; that path is outside writable roots and escalation is
disabled. The external main artifact remains unchanged, verified by its old
d256b13 SHA256 above. **Manager action:** copy the two prepared local files to that
directory and verify their checksums. This is the sole incomplete brief step.

No publication, release staging, push, tag, other-branch operation or live
plugin/device/vault/server test. All owned runners exited. No product question;
actual host integration and external artifact placement remain with the manager.

## Latest refresh: d256b13 / D-132

Commit: `a7410e8 chore(sdk): vendor d256b13 filesystem safety fix`.
Current core pin is **`d256b130e46e57bd856cc2636dd96f5273b55c05`** from the
authorized `work/pause-abort-v2` checkout. This section supersedes older core pins,
tarball checksums and the pending-D-132 statement below.

Ran `tsc -b packages/protocol packages/core packages/node --verbose` in the core
checkout: success, all three packages already up to date. No source changes or
commits there. Refreshed all three vendor packages and ran `npm install` after
removing only their generated installed copies and corresponding local lock
resolutions, so npm could recalculate integrity for same-version tarballs. Only
the Node tarball changed; protocol and core are byte-identical. No third-party
dependency or version changed. SDK stays 0.3.0 and upstream packages stay 0.5.0.
Updated compat coreSha, NOTICE and the packaged source link.

Checked the core log/diff and report after f6576ce. The only new commit is
d256b13 (report round 27); D-123 and the earlier test-only fixes were already
included at the previous pin. D-132's cause was SettlingFileSystem dropping
removeDirectory's expectedIdentity, hiding listChildren, and advertising directory
ports that the underlying disk did not implement. The new vendor binds these
optional methods to the disk only when present, preserving safety arguments and
receiver. No public host API changed. The migration guide records round 27 and
explicitly requires complete argument forwarding and accurate optional capability
presence in every host wrapper. This update required no SDK logic or test changes;
upstream red-first coverage is recorded in core report round 27.

Verification:

- `npm run types`: pass (`.scratch/d132-types.log`).
- `npm test`: **202 Vitest tests / 17 files and 9 Node tests pass**, script uses
  `--maxWorkers=2` (`.scratch/d132-test.log`). Same test-only EPERM uptime preload
  and worktree temp path as earlier runs; no production clock change.
- `npm run check:core-pin`: pass (`.scratch/d132-pin.log`).
- `npm run smoke`: packed install/import/declaration checks pass
  (`.scratch/d132-smoke.log`).
- Additional artifact check: installed and bundled SettlingFileSystem forward
  removeDirectory's path/identity and receiver, expose listChildren, and leave
  unsupported directory capabilities absent; packed growing.js equals bundled
  growing.js (`.scratch/d132-artifact.log`). An initial source-text probe expected
  optional-chaining syntax rather than the actual conditional binding; corrected
  the probe to check runtime behavior. No product code changed for that probe.
- Changed-file Prettier and `git diff --check`: pass. ESLint remains unavailable;
  no whole lint/upstream suite/live server was run.

Repacked dev tarball:
`/Volumes/Work/worktrees/abele-sync-sdk/sdk-reliability/.scratch/release/abele-sync-sdk-0.3.0-dev/abele-sync-sdk-0.3.0.tgz`

**Current SHA256:** `07eecd2a505877560a6449f37238db80c1a2f96490af84f44cb531de88e9b5de`.

No remaining SDK breakage found or task question. Actual plugin integration,
IndexedDB contracts, native watcher delivery and physical power loss remain host
verification work. All owned runners exited. Nothing pushed, published or tagged.

## Review follow-up: D-131

Commit: `e295969 fix(sdk): preserve cancellation through history operations`.
Core remains pinned to `f6576ceda00638805a9377e7ab523efce773ef27`; no re-vendor
was performed. D-132 (`SettlingFileSystem` dropping `expectedIdentity`) is assigned
to the core developer and remains pending that fix and a later SDK refresh.

Cause: `historyOperation` classified errors by code before distinguishing
`SyncCancelled`, whose inherited code is `offline`. Thus `decideDeletes()` awaiting
its automatic sync converted pause/stop into a false connectivity failure.
It now checks the class first and throws a fresh `SyncCancelled`. The shared
`safeError` sanitizer had the same subclass-erasure defect and now reconstructs
cancellation before its general EngineError branch. Fresh instances retain no
untrusted message, cause or extra details. Ordinary offline failures retain their
existing classifications. The migration guide now covers history cancellation.

Red-first: `.scratch/d131-red.log` records three failures: pause and stop during
the real `decideDeletes` automatic sync (fake HTTP held until signal abort), plus
shared sanitizer erasure. Existing syncOnce cases passed. After the fix the seven
focused cases pass (`.scratch/d131-green.log`). Two additional regressions verify
genuine offline classification and history-boundary sanitization. No tests or
expectations were deleted, loosened or marked expected-failure.

### Complete SDK error-wrapper audit

| Wrapper / catch                                                                                | Cancellation outcome                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `history.ts`: `historyOperation`, all `createHistory` methods, and index `disconnect`/`revoke` | Fixed shared classification before code mapping. Covers history, restore, trash, restoreDeleted, heldDeletes, decideDeletes, deferred and applyDeferred. `accepted` handles server result objects, not exceptions. |
| `errors.ts`: `safeError`                                                                       | Fixed subclass erasure; callers `open` and `ItemClient.request` inherit preservation.                                                                                                                              |
| `index.ts`: `syncOnce`                                                                         | Already reconstructs `SyncCancelled` before SyncError mapping; existing regression retained for pause and stop.                                                                                                    |
| `index.ts`: outer `openClient` cleanup; `node-replica.ts`: `openReplica`                       | Release/rethrow unchanged errors; node wrapper only converts NodeReplicaConfigError. Cancellation already passes through.                                                                                          |
| `items.ts`: `request` / `supportsItems`                                                        | Request uses corrected safeError; capability fallback catches only typed HTTP 404, rethrows other errors.                                                                                                          |
| `errors.ts`: `safeFetch`; `items.ts`: response body cleanup                                    | Fetch rejections propagate; only actual HTTP 5xx responses become offline HttpError. Body-cancel rejection catches are best-effort cleanup, not operation results.                                                 |
| `index.ts`: parseKey, capabilities JSON, connection-response validation                        | Key/JSON/schema parsing catches are not engine sync wrappers; typed cancellation from connection fetching is rethrown by the connection catch and preserved by outer safeError.                                    |
| `index.ts`: listener isolation and held-delete status notification lookup                      | Deliberately isolate observer errors/background notification failure; do not translate public operation rejections into connectivity failures.                                                                     |
| `replica.ts`: list path validation                                                             | Catches only synchronous validation of inventory names. Adapter list/get/read rejections propagate.                                                                                                                |
| `projection-cache.ts`: stat/read/JSON guards                                                   | Synchronous cache safety checks, no sync/cancellation source. Stat ENOENT is absence; other failures refuse recovery; disposable-cache parse failure returns false.                                                |
| `historyNode.ts`                                                                               | No catch/error translation.                                                                                                                                                                                        |

No further cancellation-erasing SDK sync wrapper was found.

### Verification and refreshed artifact

- `npm run types`: pass (`.scratch/d131-types.log`).
- `npm test`: **202 Vitest tests, 17 files; 9 Node tests pass**
  (`.scratch/d131-test-final.log`). Used `--maxWorkers=2` from the script and the
  existing test-only EPERM uptime preload described below; production code unchanged.
- `npm run check:core-pin`: pass (`.scratch/d131-pin.log`).
- `npm run smoke`: isolated package install/import/types checks pass
  (`.scratch/d131-smoke.log`).
- Changed-file Prettier and `git diff --check`: pass. ESLint remains unavailable;
  no whole lint or upstream suite was run. No dependency changes.

Repacked the local dev artifact at
`/Volumes/Work/worktrees/abele-sync-sdk/sdk-reliability/.scratch/release/abele-sync-sdk-0.3.0-dev/abele-sync-sdk-0.3.0.tgz`.
**Current SHA256:** `2659d9839567eceacea0228f698624a4f744c14a4527fbb772121b7d879c49cc`.
This supersedes the original preparation checksum below. The external release
destination is still outside writable roots. No live server/plugin/device tests,
push or publication; all owned runners exited. No new question for the manager.

## Original preparation report

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
