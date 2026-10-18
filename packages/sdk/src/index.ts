import {
  decodeAccessToken,
  V2ConnectionSchema,
  type V2AccessToken,
} from "@abele/sync-protocol";
import {
  SyncEngine,
  V2EngineClient,
  selectiveDefaults,
  type FileSystem,
  type StateStore,
  type EngineOptions,
  type SyncReport,
  type EngineStatus,
  type AppliedChange,
} from "@abele/sync-core";

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
export interface SyncClient {
  readonly scope: V2AccessToken["scope"];
  readonly status: EngineStatus;
  readonly readOnly: boolean;
  syncOnce(): Promise<SyncReport>;
  on(event: "change", listener: (change: AppliedChange) => void): () => void;
  close(): Promise<void>;
}
export async function open(options: ConnectOptions): Promise<SyncClient> {
  const token = parseKey(options.key);
  if (
    (options.dir !== undefined) === (options.files !== undefined) ||
    (options.dir === undefined && !options.state) ||
    (options.dir !== undefined && options.state !== undefined)
  )
    throw new TypeError("Provide either dir or files and state");
  // The upstream Node replica owns its state layout and lock protocol.
  if (options.stateDir !== undefined)
    throw new TypeError(
      "Separate stateDir requires upstream openNodeReplica support",
    );
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
  if (options.dir !== undefined) {
    const { openNodeReplica } = await import("@abele/sync-node");
    const replica = await openNodeReplica({
      dir: options.dir,
      key: options.key,
      ...transport,
      defer: options.defer,
    });
    release = () => replica.close();
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
  const listeners = new Set<(change: AppliedChange) => void>();
  try {
    const engine = new SyncEngine({
      client: wire,
      fs: files!,
      state: state!,
      selective: selectiveDefaults(),
      ...nodeOptions,
      now: options.clock,
      log: options.logger,
      deleteGuard: options.deleteGuard,
      defer: options.defer,
      backoffMs: options.backoffMs,
      fallbackMs: options.fallbackMs,
      onApplied(change) {
        for (const listener of listeners) {
          try {
            listener(change);
          } catch {
            options.logger?.("Change listener failed");
          }
        }
      },
    });
    let closing: Promise<void> | undefined;
    return {
      scope: info.scope,
      readOnly: info.read_only ?? false,
      get status() {
        return engine.status;
      },
      async syncOnce() {
        if (closing) throw new Error("Sync client is closed");
        return engine.sync();
      },
      on(_event, listener) {
        if (closing) throw new Error("Sync client is closed");
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      close() {
        closing ??= (async () => {
          try {
            await engine.stop();
          } finally {
            listeners.clear();
            release();
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
export type { FileSystem, StateStore, SyncReport, AppliedChange };
