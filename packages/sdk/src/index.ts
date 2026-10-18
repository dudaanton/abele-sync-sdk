import {
  decodeAccessToken,
  V2ConnectionSchema,
  type V2AccessToken,
} from "@abele/sync-protocol";
import {
  SyncEngine,
  AccessClient,
  V2EngineClient,
  selectiveDefaults,
  type FileSystem,
  type StateStore,
  type EngineOptions,
  type SyncReport,
  type EngineStatus,
  type AppliedChange,
} from "@abele/sync-core";
import { createReplica, type Replica } from "./replica.js";
import { openReplica } from "./node-replica.js";
export { ReplicaConfigurationError } from "./node-replica.js";
import { conflictEvents, type ConflictEvent } from "./conflicts.js";
export type { ConflictEvent } from "./conflicts.js";
export type { Replica, ReplicaEntry } from "./replica.js";
import {
  createHistory,
  forgetState,
  HistoryError,
  historyOperation,
  type HistoryApi,
} from "./history.js";
export { HistoryError } from "./history.js";
export type {
  HistoryApi,
  HistoryErrorCode,
  DeleteDecisions,
} from "./history.js";

export class InvalidKey extends Error {
  readonly code = "INVALID_KEY";
  constructor() {
    super("Invalid connection key");
    this.name = "InvalidKey";
  }
}
export class IncompatibleServer extends Error {
  readonly code = "INCOMPATIBLE_SERVER";
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleServer";
  }
}
export function parseKey(key: string): V2AccessToken {
  try {
    return decodeAccessToken(key);
  } catch {
    throw new InvalidKey();
  }
}
type Adapters =
  | { dir: string; stateDir?: string; files?: never; state?: never }
  | { files: FileSystem; state: StateStore; dir?: never; stateDir?: never };
export type ConnectOptions = Adapters & {
  key: string;
  transport?: { fetch?: typeof fetch; WebSocket?: typeof WebSocket };
  clock?: () => number;
  logger?: (line: string) => void;
  deleteGuard?: EngineOptions["deleteGuard"];
  defer?: EngineOptions["defer"];
  backoffMs?: [number, number];
  fallbackMs?: number;
};
export interface SyncClient extends HistoryApi {
  readonly replica: Replica;
  readonly scope: V2AccessToken["scope"];
  readonly status: EngineStatus;
  readonly readOnly: boolean;
  syncOnce(): Promise<SyncReport>;
  start(): void;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  on<K extends keyof ClientEvents>(
    event: K,
    listener: (value: ClientEvents[K]) => void,
  ): () => void;
  close(): Promise<void>;
  disconnect(): Promise<void>;
  revoke(): Promise<void>;
}
export class SyncError extends Error {
  constructor(readonly code: "offline" | "unauthorized" | "other") {
    super(
      code === "unauthorized"
        ? "Connection authorization refused"
        : code === "offline"
          ? "Sync server unavailable"
          : "Sync failed",
    );
    this.name = "SyncError";
  }
}
export interface ClientEvents {
  conflict: ConflictEvent;
  change: AppliedChange;
  status: EngineStatus;
  synced: SyncReport;
  error: SyncError;
  revoked: SyncError;
  heldDeletes: Awaited<ReturnType<HistoryApi["heldDeletes"]>>;
}
export async function open(options: ConnectOptions): Promise<SyncClient> {
  const token = parseKey(options.key);
  if (
    (options.dir !== undefined) === (options.files !== undefined) ||
    (options.dir === undefined && !options.state) ||
    (options.dir !== undefined && options.state !== undefined)
  )
    throw new TypeError("Provide either dir or files and state");
  const fetcher = options.transport?.fetch ?? globalThis.fetch;
  const response = await fetcher(
    token.address.replace(/\/$/, "") + "/capabilities",
  );
  if (!response.ok)
    throw new IncompatibleServer("Server capabilities unavailable");
  let capabilities: { protocol?: unknown };
  try {
    capabilities = await response.json();
  } catch {
    throw new IncompatibleServer("Invalid server capabilities");
  }
  if (capabilities?.protocol !== 2)
    throw new IncompatibleServer("Server must support protocol 2");
  const transport = { fetch: fetcher, WebSocket: options.transport?.WebSocket };
  const wire = new V2EngineClient(options.key, transport);
  let info;
  try {
    info = V2ConnectionSchema.parse(await wire.connection());
  } catch (error) {
    // Authentication and connectivity errors retain the core's typed classification.
    if (!(
      error instanceof Error &&
      (error.name === "ZodError" ||
        ("code" in error && error.code === "protocol"))
    ))
      throw error;
    throw new IncompatibleServer("Invalid protocol 2 connection response");
  }
  if (info.status !== "active")
    throw new IncompatibleServer("Connection scope is not active");
  let release = () => {};
  let nodeOptions: Partial<EngineOptions> = {};
  let files = options.files;
  let state = options.state;
  let forget = () => forgetState(state!);
  if (options.dir !== undefined) {
    const replica = await openReplica({
      dir: options.dir,
      stateDir: options.stateDir,
      key: options.key,
      ...transport,
      defer: options.defer,
    });
    release = () => replica.close();
    const { forgetNodeReplica } = await import("./historyNode.js");
    forget = async () => forgetNodeReplica(replica);
    files = replica.fs;
    state = replica.state;
    nodeOptions = {
      client: replica.client,
      selective: replica.cfg.selective,
      ignore: replica.ignore,
      ignoreText: replica.ignoreText,
      recovery: replica.recovery,
      stillHeld: () => {
        replica.fence?.assertOwner();
        return true;
      },
    };
  }
  const listeners = new Map<keyof ClientEvents, Set<(value: never) => void>>();
  let revoked = false;
  let selfRevoked = false;
  const emit = <K extends keyof ClientEvents>(
    event: K,
    value: ClientEvents[K],
  ) => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        listener(value as never);
      } catch {
        /* Listener failures cannot interrupt syncing. */
      }
    }
  };
  const safeStatus = (status: EngineStatus): EngineStatus => ({
    ...status,
    lastError: status.lastError === null ? null : "Sync failed",
  });
  try {
    const engine = new SyncEngine({
      client: wire,
      fs: files!,
      state: state!,
      selective: selectiveDefaults(),
      ...nodeOptions,
      now: options.clock,
      log: options.logger ? () => options.logger?.("Sync activity") : undefined,
      deleteGuard: options.deleteGuard,
      defer: options.defer,
      backoffMs: options.backoffMs,
      fallbackMs: options.fallbackMs,
      onSync: (report) => {
        for (const conflict of conflictEvents(report))
          emit("conflict", conflict);
        emit("synced", report);
      },
      onFail(_error, kind) {
        const error = new SyncError(kind);
        const notifyRevoked = kind === "unauthorized" && !revoked;
        if (kind === "unauthorized") revoked = true;
        // Core calls this hook before setting its halted state. Notify after
        // that transition so a listener can safely resume the client.
        queueMicrotask(() => {
          emit("error", error);
          if (notifyRevoked) emit("revoked", error);
        });
      },
      onApplied(change) {
        emit("change", change);
      },
    });
    let closing: Promise<void> | undefined;
    let stopping: Promise<void> | undefined;
    const assertOpen = () => {
      if (closing) throw new Error("Sync client is closed");
    };
    const history = createHistory({
      engine,
      wire: (nodeOptions.client ?? wire) as V2EngineClient,
      state: state!,
      assertOpen() {
        if (closing) throw new HistoryError("closed");
        if (revoked) throw new HistoryError("unauthorized");
      },
    });
    let heldSignature = "";
    const unstatus = engine.onStatus((status) => {
      emit("status", safeStatus(status));
      if (status.heldDeletes)
        void engine
          .heldDeletes()
          .then((held) => {
            const signature = JSON.stringify(held);
            if (!closing && signature !== heldSignature) {
              heldSignature = signature;
              emit("heldDeletes", held);
            }
          })
          .catch(() => {});
      else heldSignature = "";
    });
    const close = () => {
      closing ??= (async () => {
        try {
          await engine.stop();
        } finally {
          listeners.clear();
          unstatus();
          release();
        }
      })();
      return closing;
    };
    return {
      replica: createReplica(files!, state!, assertOpen),
      ...history,
      disconnect() {
        if (closing) return closing;
        closing = historyOperation(async () => {
          try {
            await engine.stop();
            await forget();
          } finally {
            listeners.clear();
            unstatus();
            release();
          }
        });
        return closing;
      },
      revoke() {
        return historyOperation(async () => {
          assertOpen();
          if (revoked) throw new HistoryError("unauthorized");
          await engine.stop();
          await AccessClient.fromToken(options.key, transport).revoke(
            info.token_id,
          );
          revoked = true;
          selfRevoked = true;
          emit("revoked", new SyncError("unauthorized"));
        });
      },
      scope: info.scope,
      readOnly: info.read_only ?? false,
      get status() {
        return safeStatus(engine.status);
      },
      start() {
        assertOpen();
        if (selfRevoked) throw new SyncError("unauthorized");
        if (stopping) throw new Error("Sync client is stopping");
        engine.start();
      },
      stop() {
        assertOpen();
        return (stopping ??= engine.stop().finally(() => {
          stopping = undefined;
        }));
      },
      pause() {
        assertOpen();
        engine.pause();
      },
      resume() {
        assertOpen();
        if (selfRevoked) throw new SyncError("unauthorized");
        if (stopping) throw new Error("Sync client is stopping");
        revoked = false;
        engine.resume();
      },
      async syncOnce() {
        if (closing) throw new Error("Sync client is closed");
        if (revoked) throw new SyncError("unauthorized");
        if (stopping) throw new Error("Sync client is stopping");
        try {
          return await engine.sync();
        } catch {
          throw new SyncError(
            revoked
              ? "unauthorized"
              : engine.status.state === "offline"
                ? "offline"
                : "other",
          );
        }
      },
      on(event, listener) {
        if (closing) throw new Error("Sync client is closed");
        const group = listeners.get(event) ?? new Set();
        listeners.set(event, group);
        group.add(listener as (value: never) => void);
        return () => {
          group.delete(listener as (value: never) => void);
        };
      },
      close,
    };
  } catch (error) {
    release();
    throw error;
  }
}
export type { FileSystem, StateStore, SyncReport, AppliedChange };
