# Migrating a host from SDK 0.2.0 to 0.3.0

SDK 0.3.0 bundles protocol/core/Node 0.5.0 from core commit
`486568bf10a6033052b7b56a478b8edf41dc95a9`. The package version of core has
not changed; use `compat.json`'s `coreSha` to identify this revision. Node 22+,
ESM and protocol 2 remain required. Server targets remain 0.3.3 and 0.5.0;
they were not retested against a live server for this refresh.

This checklist is for a custom host such as the Obsidian plugin. Installing the
new dependency alone is insufficient for its filesystem and IndexedDB adapters.
SDK-owned Node adapters already implement the core ports. Import advanced ports
and helpers from `@abele/sync-sdk/core`; `SyncCancelled` is also exported by the
SDK root. The package remains a Node SDK; a browser host should retain its
existing browser-compatible core import/bundling strategy.

All quoted paths below are relative to the **core checkout at the pinned SHA**.
The source of the requirements is `.scratch/report.md`: cancellation integration;
D-013, D-016, D-018, D-021, D-031, D-032; review rounds 4–15; durable checkpoint
rounds 19–22; scoped-store rounds 24–26. Later rounds supersede earlier quarantine
retention and zero-cursor statements. Round 27 (D-132) adds no public port or API:
it fixes Node's settling wrapper. All host wrappers must preserve the entire
`removeDirectory(path, expectedIdentity)` tuple, every streaming/conditional safety
argument (including callbacks and signals), and the underlying receiver. Expose
optional capabilities only when the wrapped adapter implements them, including
`listChildren`; never advertise an unsupported operation through a no-op wrapper.
Source: `packages/node/src/growing.ts` and core report round 27. Without this
forwarding, identity protection can be bypassed or capability fallback disabled;
there is no safe fallback for a wrapper that silently drops safety arguments.

## Changes since the d256b13 refresh

This refresh is built from a clean archive of `486568b`, the exact revision reported
green in upstream CI run `39854950736`. It excludes later worker changes, including
the retry-scheduler/waiting-files and additional pause-fencing work described after
this commit in the live core report. Relevant report sections are D-134,
D-136/D-137/D-138, A3, A2+A1, broad-run follow-ups, D-140/D-141 and directory
tombstones after D-141. The following supersedes earlier descriptions of equality
adoption and refusal/cursor behavior in this checklist.

- [ ] Render directory rows in `report.push.rejected`: `op` now includes
      `{ op: 'mkdir', path }` as well as file operations. Check the discriminator
      before looking up file IDs, SHA or size. Render optional `pull.rejected` and
      `secondPull?.rejected`, whose rows are `{ change, code, message }`. A refused
      directory suppresses its whole subtree, while unrelated files continue;
      refused changes emit no `onApplied`. Without UI changes, refusals remain
      durable but can be invisible, and file-only result assumptions may fail.
      Sources: `packages/core/src/pusher.ts`, `packages/core/src/puller.ts`,
      `packages/core/src/cycle.ts`, report D-134.
- [ ] Custom EngineClient wrappers must forward optional **synchronous**
      `directoryRefusals(): readonly DirectoryRefusal[]` and
      `pathRefusal(path): Refusal | undefined`, plus **asynchronous**
      `retryRefusedDirectories(): Promise<void>`. Do not turn the synchronous
      queries into promises. Call `SyncEngine.rescan()` for explicit retry after
      the user fixes policy/quota/scope: it durably rewinds before clearing
      refusals. Ordinary sync, restart and changed limits do not automatically
      retry them. Low-level callers must perform the same durable rewind before
      clearing. Clients with no directory refusal feature may omit these ports;
      wrappers that hide them lose subtree suppression/reporting or explicit
      retry. These are core-engine APIs; the curated SDK `SyncClient` does not
      expose a rescan method. Sources: `packages/core/src/engineClient.ts`,
      `packages/core/src/engine.ts`, `packages/core/src/v2Directories.ts`.
- [ ] Intentional host policy refusal of an explicit `FileSystem.mkdir` must use
      shared protocol `AbeleError` and the appropriate item code/message.
      Supported item refusals are quota_exceeded, leaves_scope, invalid_path,
      too_large, scripts_forbidden, path_taken, case_collision and per-item/host
      forbidden. Keep raw EACCES/I/O, lost ownership, network/server/rate-limit
      errors and temporary quota_waiting as failures. HTTP token forbidden remains
      fatal. Do not infer mkdir policy from writeAtomic/conditionalFile errors.
      No new filesystem port or safety argument was added. Without typed policy
      errors, ordinary failures continue to abort instead of being skipped.
      Sources: `packages/core/src/fs.ts`, `packages/core/src/v2Directories.ts`.
- [ ] Preserve arbitrary scoped metadata, now including `pull-refused-progress`
      and `pull-refused:<encoded file id>`. Refused feed events retain their full
      ChangeItem and observed base atomically with cursor publication. The ordered
      completion barrier prevents the cursor passing earlier unapplied accepted
      work; retained refusals, including deletes, replay after restart/rescan.
      Generation retirement includes this index even without enumeration. Without
      durable metadata, refusals pin the cursor conservatively; do not discard
      unfamiliar metadata or treat a refusal as applied. No additional StateStore
      port is required. Sources: `packages/core/src/pullHolds.ts`,
      `packages/core/src/pullRun.ts`, `packages/core/src/restoreGeneration.ts`,
      report D-136/D-137/D-138.
- [ ] Allow push progress to settle in batches of at most **100 operations or
      8 MiB of submitted content**. An indivisible file or move+modify pair may
      exceed the byte cap and travels alone; pairs are not split. Each batch's
      ledger settles before the next starts and uncertain requests retain their
      original keys. Streaming budgets still apply. No port or server protocol
      change is required; update any UI/test assumption of 1000-operation batches.
      Source: `packages/core/src/pushBatches.ts`, report A3.
- [ ] Treat feed coalescing as **per-file identity**, never just per destination
      path. Metadata is collected across pages before placement; inventory checks
      its tail, and rename chains skip intermediate destinations. Each candidate
      retains its earliest covered sequence for the cursor barrier. Different
      identities sharing a path remain separate obligations until safe settlement;
      tombstones resolve only their own identity and cannot clear another file's
      hold. Unknown file tombstones remain visible even before local creation is
      recorded. Known installed/incoming directory tombstones run directory cleanup
      and refusal retirement but never enter file staging. No host port changed;
      custom feed adapters must retain unknown file tombstones and preserve IDs.
      Sources: `packages/core/src/pullHolds.ts`, `packages/core/src/pullRun.ts`,
      `packages/core/src/v2Client.ts`, `packages/core/src/v2Directories.ts`,
      report D-140/D-141 and `486568b`.
- [ ] After collecting the complete newest metadata snapshot, core may adopt
      stat-validated local bytes equal to its **newest** content as the base,
      without download, write, quarantine or redundant publication. Historical
      equal content beneath a different newer version remains protected/held;
      different bytes remain held and destructive effects remain conditional.
      Arbitrary staged versions and pending-write recovery retain their stricter
      installation-proof rules. Do not assume every adoption means a content GET
      or upload, and do not implement a separate historical-equality shortcut.
      Interrupted metadata collection can repeat from its durable frontier; this
      is not a general durable incoming-work queue. Sources:
      `packages/core/src/pullPlace.ts`, `packages/core/src/pullRun.ts`,
      report A2+A1 and f3f72b6.

Crash-matrix, simulator publication, bounded replay/fixture, and heartbeat test
changes in this interval add no host contract. They isolate durability flushes
between replays, preserve synchronous refusal queries and keep the existing
rollback/cursor/content guarantees; they do not relax production durability.
Sources: `packages/node/tests/unit/groupCrashRecovery.test.ts`,
`packages/core/tests/sim/durableState.ts`, report rounds 28–34 and Studio triage.

## Filesystem: required before enabling writes

- [ ] Implement and forward `FileSystem.conditionalFile({ path, expected, effect })`.
      `expected` is `{ sha, size, mtime }` or `null` for absence. Support remove,
      exclusive-destination move, buffered write (including optional receipt), and
      sealed-stage installation by opaque stage ID. Compare the actual displaced
      regular file's bytes and stat at the mutation boundary; an awaited
      stat/hash followed by write/remove/rename is insufficient. Absence-only
      publication must never replace a newly created file. Preserve case-only rename
      behavior. Route push receipt cleanup, merged bytes and conflict copies through
      this gate too. **Without it:** buffered pull effects and V2 departure deletion
      fail closed; its optional TypeScript declaration is compatibility only.
      Sources: `packages/core/src/fs.ts`, `packages/core/src/pullPlace.ts`,
      `packages/core/src/pushDisk.ts`, `packages/core/src/v2Client.ts`.
- [ ] Journal intent durably **before capture**. Refuse directories and symlinks
      at the capture operation itself, including substitution races; the Node
      implementation uses an exclusively allocated regular-file sentinel. Restore
      mismatches without replacing an occupied name; put displaced user bytes in a
      visible conflict copy if necessary. Persist restoration progress so recovery
      does not resurrect a name intentionally deleted later. Distinguish allocation
      sentinels from real empty user files. Re-fingerprint a victim immediately
      before retirement, including legacy completed records. Drop verified victims
      after settlement; do not retain a successful-operation victim history.
      **Without these semantics:** there is no safe compatibility fallback; do not
      enable destructive sync. Sources: `packages/node/src/nodeConditional.ts`,
      `packages/node/src/nodeStages.ts` and report rounds 5–10.
- [ ] Implement `installedFile(receipt, path, sha)` and `AtomicStage.installed()`
      for crash adoption. They must prove that this operation installed the current
      inode/object and that its content still matches. Equal bytes, intent, or a
      sealed stage alone are insufficient; an independently replaced file must fail
      proof even if its bytes match. Make the public destination directory durable
      before returning proof, retiring a displaced base, acknowledging the ledger,
      or discarding receipt/stage evidence. **Without proof:** pending buffered or
      streamed publication cannot be adopted as a clean base; recovery is conservative.
      Sources: `packages/core/src/pullPlace.ts`, `packages/core/src/pullRecovery.ts`,
      `packages/core/src/streaming.ts`, report rounds 4 and 7.
- [ ] Implement/forward `discardInstallation(receipt)` and
      `recoverConditionalFiles()`. Keep requested, caller-owned publication receipts
      separate from active captures until ledger completion, then discard them.
      Receiptless operations retire private evidence after settlement. Recover
      outstanding captures/publications before pull recovery, scanning **and group
      rollback's public-image comparison**. Recovery never overwrites a later save.
      **Without these optional hooks:** core cannot clean/recover custom host artifacts;
      a journalling host must provide equivalent startup and cleanup guarantees.
      Sources: `packages/core/src/pullRecovery.ts`,
      `packages/node/src/nodeConditional.ts`, report rounds 5–9.

## Streaming, inventory and transport ports

- [ ] Update `beginAtomicWrite(path, mtime, expectedBase, beforeCreate?)`.
      Choose the opaque stage ID, **await `beforeCreate(id)`**, then create/journal
      the artifact. Preserve expected base mtime when supplied. Implement idempotent
      `discardStage(id)` even for interrupted allocation or missing stage metadata.
      If using reopen/discard fallback, expose missing stages as ENOENT; propagate
      other errors. **Legacy fallback:** core saves intent before allocation and
      attaches the returned ID afterwards, but cannot close the allocation crash
      window without the callback. Missing discard uses `reopenStage(id).discard()`;
      this cannot repair an incomplete host allocation without intact metadata.
      Sources: `packages/core/src/streaming.ts`, `packages/core/src/pullStages.ts`,
      `packages/core/src/pullWrite.ts`, report D-016/D-034.
- [ ] Forward cancellation through `fingerprint(path, signal?)`, chunk reads,
      stage append/commit and content/multipart requests. Close acquired sources on
      cancellation even if transport entry is refused. Preserve owned intents and
      uncertain upload journals; do not dispose recovery evidence as ordinary temp
      files. **Fallback:** a non-cancellable whole-file fingerprint/current host
      operation may finish; shutdown has no wall-clock bound if it never settles.
      Sources: `packages/core/src/streaming.ts`, `packages/core/src/guard.ts`,
      `packages/core/src/v2Client.ts`, cancellation report.
- [ ] Forward optional directory ports: `listDirectories()` supplies stable
      identities, `listChildren(parent)` returns raw immediate spellings and identity,
      plus `mkdir`, `moveDirectory`, `removeDirectory(path, expectedIdentity?)`.
      Never collapse case/Unicode aliases; remove only empty directories, never
      recursively sweep user bytes. Resolve physical names using normalization/case
      **and identity**, not inode alone. Supply bounded `listChildren` for alias
      checks. **Without these ports:** directory identity/rename features are limited
      and inventory fallback can be expensive; do not claim directory support.
      Sources: `packages/core/src/fs.ts`, `packages/core/src/localPaths.ts`,
      `packages/core/src/v2Directories.ts`, report D-031 and round 11.
- [ ] Remove the plugin's own blocking pre-engine projection inventory. Forward
      `EngineClient.prepare(..., signal?, deferLocalScan?)` and optional
      `scanLocal(fs, signal?, changed?)` through custom client wrappers. Incoming work
      can then precede full inventory and a newly announced head can interrupt it.
      **Fallback:** clients without the hook retain eager preparation; existing
      prepare callers default to eager scans. Core cannot speed up a host's separate
      startup walk. Sources: `packages/core/src/engineClient.ts`,
      `packages/core/src/v2Client.ts`, report D-031.
- [ ] Implement/forward optional `rememberManifest(items)` if a custom transport
      maintains membership/content lookup caches. Restore those caches from durable
      manifest pages before resumed filtering. Built-in V2 does this.
      **Without it:** stateless clients need no change; cached custom clients can lose
      group attachment eligibility on restart. Preserve `readEffects` when wrapping
      transports whose decoding mutates state; do not trigger root-store manifest
      decoding inside a receipt transaction. Sources: `packages/core/src/engineClient.ts`,
      `packages/core/src/pullRun.ts`, `packages/core/src/pushVerdicts.ts`, D-032/round 25.

## StateStore and callbacks: required for concurrent IndexedDB hosts

- [ ] Change to `transaction<T>(fn: (tx: StateStore) => Promise<T>): Promise<T>`.
      Set `transactionScoped = true` only when each callback gets a distinct revocable
      handle. All callback reads/writes and transitive helpers, including after awaits,
      use `tx`; root methods remain independent. Handle reads see their own private
      changes to entries, indexes, metadata, cursor and journal. Nested transactions
      use the handle and merge only successful child patches. Revoke on callback
      completion. **Compatibility:** exported `transact` supplies an expiring
      forwarding capability for old no-argument stores and serializes engine
      transactions. This is safe only with host-enforced exclusive root-store access
      for the entire callback; it cannot isolate unrelated direct writes. Falsely
      advertising scoped support with a root/missing handle fails closed.
      Sources: `packages/core/STATE_STORE.md`, `packages/core/src/state.ts`,
      `packages/core/src/stateTransaction.ts`, report round 24.
- [ ] Collect private patches across awaits, then validate revision and publish
      patch/indexes/cursor/journal/metadata atomically in one short IndexedDB native
      readwrite transaction. Include unrelated root writes, across tabs, in revision
      tracking. Resolve only on native `oncomplete`; abort discards only the private
      patch, never another task's committed writes, including same-key writes. Reject
      stale publication conservatively (`EngineError('conflict')` can include disjoint
      changes). Never publish a stale full snapshot or use an ambient current-overlay
      field. `StateTransaction` can supply the overlay; the host owns publication and
      indexed clash lookup for unique file IDs/wire paths. **Without isolation or
      exclusive legacy gating:** concurrent use is unsafe and must remain disabled.
      Sources: `packages/core/STATE_STORE.md`, report rounds 24–25.
- [ ] Convert `onCommitted(ops, tx)`, startup journal recovery and delete tally
      helpers to use/forward the supplied capability. Construct an engine inside an
      outer transaction with `state: tx`, including its stateful host closures.
      Do not auto-replay failed callbacks: filesystem/network effects may have happened;
      retry through immutable intent/journal reconciliation. Preserve effect-owner
      attribution and native publication ownership checks. `onApplied` runs after
      ledger publication; `onDefer` runs outside the transaction and must not receive
      an expired handle. Logging/hash/filter predicates must not mutate a captured
      root inside the callback. **Ignoring tx:** violates isolation and can cause
      publication conflict/repeated recovery. Sources: `packages/core/src/pusher.ts`,
      `packages/node/src/replica.ts`, `packages/core/STATE_STORE.md`, rounds 24–25.
- [ ] Persist arbitrary `getMeta`/`setMeta` keys and cursor changes atomically with
      ledger transactions, including checkpoint headers, indexed `pull-held:*` records
      and generation/reconciliation records. Do not filter unknown core metadata keys.
      Preserve journal `origin: { generation, cursor }`, receipt IDs and opaque stage
      identities in codecs. **Without metadata:** legacy stores lose durable restart
      progress; production V2 requires it, and expired-journal archival fails closed.
      Lost optional origin uses conservative restored-profile handling. No new
      metadata enumeration API is required by held-change migration; existing
      `metadataKeys(prefix)` remains needed for SDK disconnect when storing metadata
      and for complete generation retirement. Sources: `packages/core/src/state.ts`,
      `packages/core/src/pullHolds.ts`, `packages/core/src/pullRun.ts`,
      `packages/core/src/restoreGeneration.ts`, D-013/D-018 and rounds 20–22.
- [ ] Run `packages/core/tests/helpers/stateTransactionContract.ts` against
      IndexedDB: unrelated same-key root writes survive rollback, plus nested/revoked
      handles and native abort/reopen tests. Inject failures into scoped mutations or
      actual native publication, not root-method spies. The optional Node-only
      `packages/core/tests/helpers/rootWriteGuard.ts` can detect transitive root
      writes in host tests; it is not a browser production dependency.

## Recovery, approval and operational errors

- [ ] Throw operational I/O/DB/network failures from reads, stat/list, stage
      verification and conditional publication. Null/false/empty represent successful
      absence/mismatch observations only. Preserve the cause when wrapping database
      busy/errors as `EngineError('conflict')`; cause-bearing conflicts are retryable
      failures, not logical obstructions. Keep intents/receipts and retry the same
      immutable operation/key after uncertain effects. Distinguish missing ignore or
      recovery files from unreadable files. **Without this contract:** the host can
      misclassify unreadability as deletion/approval and lose recovery evidence.
      Sources: `packages/core/src/errors.ts`, report rounds 12–15.
- [ ] If implementing speculative approval/group disks, record conditional effects
      without touching the live vault. Allocate an owned durable empty recovery journal
      before draft material; only proven initial-save allocation debris is disposable.
      Journal move destinations, actual physical spellings and durable ownership
      evidence before publication; retain an inode reference through settlement.
      Recognize own installed moves by identity, flush destination before retiring
      evidence, preserve edits through that inode, and never recreate the source as
      an alias. Missing proof preserves before bytes visibly without touching unrelated
      occupants. Recover conditional operations before public-image comparisons.
      Retire resolved groups by atomic whole-directory rename to owned trash before
      recursive deletion; recover leftover trash separately. Preserve new optional
      journal fields; old records take conservative recovery. **No automatic fallback
      can make an incomplete custom approval implementation safe.** Sources:
      `packages/node/src/codeGroupDisk.ts`, report rounds 6–11.
- [ ] Expose retained group reviews (`CodeGroupDisk.reviews()` or equivalent),
      backup location and archived directory/expired-journal reviews once. Keep review
      directories until explicit decision; retention uses durable whole-directory
      rename and reconstructs a missing review record after restart. **Without UI:**
      preservation still occurs, but the user cannot discover/resolve retained data.
      Sources: `packages/node/src/codeGroupDisk.ts`, D-018/D-021, round 11.
- [ ] If adopting `EngineOptions.recovery`, complete the host readiness barrier
      before mutating entry points. Omitting this optional port retains legacy
      lifecycle behavior; it does not remove the filesystem startup recovery duties
      above. Source: `packages/core/src/engineTypes.ts`.

## Runtime and UI behavior

- [ ] Treat `SyncCancelled` as intentional interruption **before** classifying its
      inherited `offline` code. SDK `syncOnce()` and history operations (including
      `decideDeletes()` awaiting its automatic sync) preserve the class; ordinary failures
      remain sanitized `SyncError`. Pause is synchronous, aborts the active run and
      cancels queued syncs; stop awaits settlement and releases triggers. Core suppresses
      failure hooks/offline retry for cancellation. Show engine status so paused means
      the run has settled; remove the old statement that pause finishes the entire pass.
      Manual sync while paused remains allowed; resume starts fresh after draining.
      Pauses/authorization halts survive stop/start. **Without handling:** the host may
      display a false failure; forwarding `engine.pause()` needs no new controller.
      Sources: `packages/core/src/engine.ts`, `packages/core/src/cancellation.ts`.
- [ ] Preserve durable progress and retry journals on cancellation. Completed file
      mutations finish ledger recording; incomplete bootstrap resumes from checkpoints
      and completed files are not redownloaded. Do not assume cursor remains zero
      whenever bootstrap has holds: approved policy is
      `min(reached, first unresolved sequence - 1)`. Metadata migration can fetch
      bounded feed metadata for earliest sequence-only checkpoints; failures retain
      evidence and retry. Source: `packages/core/src/pullRun.ts`,
      `packages/core/src/pullHolds.ts`, report rounds 19–24.
- [ ] Do not infer downloaded bytes from `onApplied`/SDK `change`: verified local
      reuse/adoption also emits it. Offline edits, missing-source baselines and
      same-stat changes remain protected when they differ from the collected newest
      content; equality with a historical version cannot authorize adoption beneath
      a newer version. Newest-content adoption follows the rule above. Held changes
      pin progress without repeatedly walking clean
      manifest entries. Generation changes retire/archive old checkpoints; expired
      destructive journals request neutral reconciliation instead of minting fresh
      destructive keys. Partial receipts preserve earlier successful ledgers and
      uncertain journals. These are built-in behavior changes requiring the SDK bump,
      not extra plugin ports. Sources: report D-012/D-015/D-017/D-019/D-020/D-022,
      D-033/D-035, R2/D-001 and rounds 2–3, 19–24.

Before rollout, manually test pause/resume during a large vault scan, pull and
multipart upload; restart after interrupted stage creation/publication; race a
same-stat local save with remote replacement/deletion; exercise approval recovery
and IndexedDB concurrent writes. Native watcher delivery, physical power-loss
durability and actual Obsidian integration require host verification.

SDK Node `disconnect()` accepts empty conditional/installation namespaces but
refuses outstanding evidence and retained approval reviews with
`HistoryError('unsupported')`. Resolve those records explicitly before forgetting
the replica; disconnect must not delete the only preserved user bytes.
