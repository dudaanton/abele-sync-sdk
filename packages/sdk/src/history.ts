import type {
  CommitOpResult,
  VersionInfo,
  TrashItem,
} from "@abele/sync-protocol";
import type {
  SyncEngine,
  V2EngineClient,
  StateStore,
  VersionsQuery,
  HeldDelete,
  DeleteDecision,
} from "@abele/sync-core";
import { SyncCancelled, transact } from "@abele/sync-core";

export type HistoryErrorCode =
  | "closed"
  | "unauthorized"
  | "offline"
  | "forbidden"
  | "not_found"
  | "unsupported"
  | "other";
export class HistoryError extends Error {
  constructor(
    readonly code: HistoryErrorCode,
    refused = false,
  ) {
    super(refused ? "History operation refused" : "History operation failed");
    this.name = "HistoryError";
  }
}
export type DeleteDecisions = Pick<DeleteDecision, "kind" | "fileIds">;
/** Includes transport reads: the v2 adapter can durably record their effects. */
export class PendingHistoryOperations {
  private readonly pending = new Set<Promise<unknown>>();
  run<T>(job: () => Promise<T>): Promise<T> {
    // Register before running user adapters or hooks, which may reenter close().
    const result = Promise.resolve().then(job);
    this.pending.add(result);
    const remove = () => {
      this.pending.delete(result);
    };
    void result.then(remove, remove);
    return result;
  }
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
export interface HistoryApi {
  history(path: string, query?: VersionsQuery): Promise<VersionInfo[]>;
  restore(path: string, version: string): Promise<CommitOpResult>;
  trash(): Promise<TrashItem[]>;
  restoreDeleted(pathOrId: string): Promise<CommitOpResult>;
  heldDeletes(): Promise<HeldDelete[]>;
  decideDeletes(
    decisions: DeleteDecisions,
  ): ReturnType<SyncEngine["decideDeletes"]>;
  deferred(): ReturnType<SyncEngine["deferred"]>;
  applyDeferred(
    versionIds?: readonly string[],
  ): ReturnType<SyncEngine["applyDeferred"]>;
}

/** Only classifications cross the SDK boundary, never transport error text or causes. */
export async function historyOperation<T>(job: () => Promise<T>): Promise<T> {
  try {
    return await job();
  } catch (error) {
    if (error instanceof SyncCancelled) throw new SyncCancelled();
    if (error instanceof HistoryError) throw error;
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    throw new HistoryError(
      code === "unauthorized" ||
        code === "offline" ||
        code === "forbidden" ||
        code === "not_found"
        ? code
        : "other",
    );
  }
}
function accepted(result: CommitOpResult): CommitOpResult {
  if (result.status === "rejected") {
    const code = result.code;
    throw new HistoryError(
      code === "unauthorized" || code === "forbidden" || code === "not_found"
        ? code
        : "other",
      true,
    );
  }
  return result;
}
export function createHistory(options: {
  engine: SyncEngine;
  wire: V2EngineClient;
  state: StateStore;
  assertOpen(): void;
  operations?: PendingHistoryOperations;
}): HistoryApi {
  const { engine, wire, state, assertOpen } = options;
  const run = <T>(job: () => Promise<T>) =>
    historyOperation(async () => {
      assertOpen();
      return options.operations ? options.operations.run(job) : job();
    });
  const resolve = async (path: string): Promise<string> => {
    const local = await state.get(path);
    if (local) return local.fileId;
    const normalized = path.normalize("NFC");
    for await (const entry of state.all()) {
      if (entry.wirePath === normalized) return entry.fileId;
    }
    let cursor: string | null = null;
    do {
      const page = await wire.manifest(cursor);
      const item = page.items.find((item) => item.path === normalized);
      if (item) return item.file_id;
      cursor = page.next;
    } while (cursor !== null);
    // Deleted files still have readable history.
    const deleted = (await wire.trash()).find(
      (item) => item.path === normalized,
    );
    if (deleted) return deleted.file_id;
    throw new HistoryError("not_found");
  };
  return {
    history: (path, query) =>
      run(() =>
        engine.runExclusive(async () =>
          wire.versions(await resolve(path), query),
        ),
      ),
    restore: (path, version) =>
      run(async () =>
        accepted(
          await engine.restore(
            await engine.runExclusive(() => resolve(path)),
            version,
          ),
        ),
      ),
    trash: () => run(() => engine.runExclusive(() => wire.trash())),
    restoreDeleted: (pathOrId) =>
      run(async () => {
        const items = await engine.runExclusive(() => wire.trash());
        const item =
          items.find((item) => item.file_id === pathOrId) ??
          items.find((item) => item.path === pathOrId.normalize("NFC"));
        if (!item) throw new HistoryError("not_found");
        return accepted(await engine.restoreDeleted(item.file_id));
      }),
    heldDeletes: () => run(() => engine.heldDeletes()),
    decideDeletes: ({ kind, fileIds }) =>
      run(() => engine.decideDeletes(kind, fileIds)),
    deferred: () => run(() => engine.deferred()),
    applyDeferred: (versionIds) => run(() => engine.applyDeferred(versionIds)),
  };
}

/** Clear an adapter's entire portable state without changing its file system. */
export async function forgetState(state: StateStore): Promise<void> {
  if (state.getMeta && (!state.metadataKeys || !state.setMeta))
    throw new HistoryError("unsupported");
  await transact(state, async (tx) => {
    const paths: string[] = [];
    for await (const entry of tx.all()) paths.push(entry.path);
    for (const path of paths) await tx.delete(path);
    await tx.setCursor(0);
    await tx.setJournal(null);
    for (const key of (await tx.metadataKeys?.("")) ?? [])
      await tx.setMeta!(key, null);
  });
}
