import { expect, it, vi } from "vitest";
import {
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  selectiveDefaults,
  sha256,
  type EngineClient,
} from "@abele/sync-core";
import { encodeAccessToken } from "@abele/sync-protocol";
import { open } from "../../packages/sdk/src/index.js";
import {
  createHistory,
  PendingHistoryOperations,
} from "../../packages/sdk/src/history.js";

it.each([
  "restore",
  "restoreDeleted",
  "applyDeferred",
  "trash",
  "history",
] as const)("tracks the complete asynchronous %s operation", async (method) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operations = new PendingHistoryOperations();
  const effects: string[] = [];
  const engine = {
    runExclusive: async <T>(job: () => Promise<T>) => {
      await blocked;
      return job();
    },
    restore: async () => {
      effects.push("restore");
      return { status: "applied" };
    },
    restoreDeleted: async () => {
      effects.push("restoreDeleted");
      return { status: "applied" };
    },
    applyDeferred: async () => {
      await blocked;
      effects.push("applyDeferred");
      return {};
    },
  };
  const state = new MemoryStateStore();
  await state.put({
    path: "Example.md",
    wirePath: "Example.md",
    fileId: "file",
    versionId: "v",
    sha: "",
    size: 0,
    mtime: 0,
  });
  const wire = {
    trash: async () => [{ path: "Example.md", file_id: "file" }],
    versions: async () => [],
  };
  const api = createHistory({
    engine,
    wire,
    state,
    operations,
    assertOpen() {},
  } as never);
  const running =
    method === "restore"
      ? api.restore("Example.md", "v")
      : method === "restoreDeleted"
        ? api.restoreDeleted("file")
        : method === "history"
          ? api.history("Example.md")
          : api[method]();
  let drained = false;
  const drain = operations.drain().then(() => {
    drained = true;
  });
  try {
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(effects).toEqual([]);
  } finally {
    release();
    await running;
    await drain;
  }
  expect(drained).toBe(true);
  if (
    method === "restore" ||
    method === "restoreDeleted" ||
    method === "applyDeferred"
  )
    expect(effects).toEqual([method]);
});

async function disconnectFixture(state = new MemoryStateStore()) {
  const key = encodeAccessToken({
    v: 1,
    address: "https://example.test",
    key: "a".repeat(43),
    scope: { kind: "folder", id: "scope", path: "/" },
  });
  const fetcher = vi.fn(async (input: string | URL | Request) =>
    Response.json(
      String(input).endsWith("/capabilities")
        ? { protocol: 2 }
        : String(input).endsWith("/v2/connection")
          ? {
              protocol: 2,
              token_id: "token",
              space_id: "space",
              scope: { kind: "folder", id: "scope", path: "/" },
              status: "active",
              limits: { max_file_bytes: 1024, quota_bytes: null },
            }
          : { items: [], cursor: 1, next: null },
    ),
  );
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state,
    transport: { fetch: fetcher },
  });
  return { client, fetcher };
}

it.each([false, true])(
  "disconnect explicitly refuses an already closing client (concurrent=%s)",
  async (concurrent) => {
    const state = new MemoryStateStore();
    await state.setMeta("sentinel", "retained");
    const { client } = await disconnectFixture(state);
    const closing = client.close();
    if (!concurrent) await closing;
    await expect(client.disconnect()).rejects.toMatchObject({ code: "closed" });
    await closing;
  },
);

it.each([false, true])(
  "drains a delayed real delete decision before forgetting state (paused=%s)",
  async (paused) => {
    let unblock!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    class DelayedState extends MemoryStateStore {
      override async setMeta(key: string, value: string | null) {
        if (key === "delete-decision" && value !== null) {
          entered();
          await blocked;
        }
        return super.setMeta(key, value);
      }
    }
    const state = new DelayedState();
    await state.setMeta(
      "held-deletes",
      JSON.stringify([{ path: "Example.md", fileId: "file" }]),
    );
    const { client, fetcher } = await disconnectFixture(state);
    if (paused) client.pause();
    const decision = client.decideDeletes({
      kind: "confirm",
      fileIds: ["file"],
    });
    await started;
    let finished = false;
    const disconnect = client.disconnect().then(() => {
      finished = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(finished).toBe(false);
      await expect(
        client.decideDeletes({ kind: "confirm", fileIds: ["file"] }),
      ).rejects.toMatchObject({ code: "closed" });
    } finally {
      unblock();
      await decision;
      await disconnect;
    }
    expect(state.metadataKeys("")).toEqual([]);
    expect(await state.getCursor()).toBe(0);
    const calls = fetcher.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.metadataKeys("")).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  },
);

it("resolves paths, delegates decisions, and sanitizes restore refusals", async () => {
  const state = new MemoryStateStore();
  await state.put({
    path: "Note.md",
    wirePath: "Note.md",
    fileId: "file",
    versionId: "v",
    sha: "",
    size: 0,
    mtime: 0,
  });
  const engine = {
    runExclusive: async <T>(job: () => Promise<T>) => job(),
    restore: vi.fn(async () => ({
      status: "rejected",
      code: "forbidden",
      message: "secret",
    })),
    restoreDeleted: vi.fn(async () => ({ status: "applied" })),
    decideDeletes: vi.fn(async () => ({ decided: 1, report: null })),
    applyDeferred: vi.fn(async () => ({})),
  };
  const wire = {
    versions: vi.fn(async () => []),
    trash: vi.fn(async () => [{ path: "Old.md", file_id: "deleted" }]),
    manifest: vi.fn(async () => ({
      items: [{ path: "Remote.md", file_id: "remote" }],
      next: null,
    })),
  };
  const api = createHistory({ engine, wire, state, assertOpen() {} } as never);
  await api.history("Note.md");
  expect(wire.versions).toHaveBeenCalledWith("file", undefined);
  await expect(api.restore("Remote.md", "v")).rejects.toMatchObject({
    code: "forbidden",
    message: "History operation refused",
  });
  expect(engine.restore).toHaveBeenCalledWith("remote", "v");
  await api.restoreDeleted("Old.md");
  await api.restoreDeleted("deleted");
  expect(engine.restoreDeleted).toHaveBeenCalledWith("deleted");
  await api.decideDeletes({ kind: "confirm", fileIds: ["shown"] });
  expect(engine.decideDeletes).toHaveBeenCalledWith("confirm", ["shown"]);
  await api.applyDeferred(["shown-version"]);
  expect(engine.applyDeferred).toHaveBeenCalledWith(["shown-version"]);
  wire.versions.mockRejectedValueOnce(
    new Error("http://user:secret@example.test/key"),
  );
  await expect(api.history("Note.md")).rejects.toMatchObject({
    code: "other",
    message: "History operation failed",
  });
});

it("holds threshold deletes in the real engine until explicitly decided", async () => {
  const state = new MemoryStateStore();
  const files = new MemoryFileSystem();
  await state.setCursor(1);
  const bytes = new TextEncoder().encode("x");
  const sha = await sha256(bytes);
  for (const path of ["One.md", "Two.md", "Three.md"]) {
    await files.writeAtomic(path, bytes, 1);
    await state.put({
      path,
      wirePath: path,
      fileId: path,
      versionId: "v",
      sha,
      size: 1,
      mtime: 1,
    });
  }
  const commitRaw = vi.fn(async (ops) => ({
    body: {
      head_seq: 2,
      results: ops.map((op: { file_id: string }) => ({
        status: "applied",
        file_id: op.file_id,
        version_id: "deleted",
        seq: 2,
        path: op.file_id,
        sha: null,
        size: 0,
        mtime: 2,
      })),
    },
    replayed: false,
  }));
  const wire = {
    state: async () => ({
      head_seq: 1,
      settings: { max_file_bytes: 10000, quota_bytes: null },
    }),
    manifest: async () => ({
      items: ["One.md", "Two.md", "Three.md"].map((path) => ({
        path,
        file_id: path,
        version_id: "v",
        sha,
        size: 1,
        mtime: 1,
        seq: 1,
        kind: "note",
      })),
      head_seq: 1,
      next: null,
    }),
    getBlob: async () => bytes,
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    commitRaw,
  };
  const engine = new SyncEngine({
    client: wire as unknown as EngineClient,
    fs: files,
    state,
    selective: selectiveDefaults(),
    deleteGuard: { count: 3, floor: 3, share: 1 },
  });
  const api = createHistory({ engine, wire, state, assertOpen() {} } as never);
  try {
    await engine.sync();
    for (const path of ["One.md", "Two.md", "Three.md"])
      await files.remove(path);
    await engine.sync();
    expect(commitRaw).not.toHaveBeenCalled();
    const held = await api.heldDeletes();
    expect(held).toHaveLength(3);
    await engine.sync();
    expect(commitRaw).not.toHaveBeenCalled();
    await api.decideDeletes({
      kind: "confirm",
      fileIds: held.map((item) => item.fileId),
    });
    expect(commitRaw).toHaveBeenCalledTimes(1);
    expect(await api.heldDeletes()).toEqual([]);
  } finally {
    await engine.stop();
  }
});

it("defers generic remote data and applies only the versions shown", async () => {
  const state = new MemoryStateStore();
  const files = new MemoryFileSystem();
  const bytes = new TextEncoder().encode("remote data");
  const change = {
    path: "Data.md",
    file_id: "file",
    version_id: "version",
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 1,
    seq: 1,
    kind: "note",
    op: "create",
    prev_path: null,
    at: new Date(0).toISOString(),
    actor: { kind: "device", id: "device", name: "device" },
  };
  const wire = {
    state: async () => ({
      head_seq: 1,
      settings: { max_file_bytes: 10000, quota_bytes: null },
    }),
    manifest: async () => ({ items: [change], head_seq: 1, next: null }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    getBlob: async () => bytes,
  };
  const engine = new SyncEngine({
    client: wire as unknown as EngineClient,
    fs: files,
    state,
    selective: selectiveDefaults(),
    defer: (path) => path === "Data.md",
  });
  const api = createHistory({ engine, wire, state, assertOpen() {} } as never);
  try {
    await engine.sync();
    expect(await files.stat("Data.md")).toBeNull();
    expect(await api.deferred()).toHaveLength(1);
    await api.applyDeferred(["unshown"]);
    expect(await files.stat("Data.md")).toBeNull();
    await api.applyDeferred(["version"]);
    expect(new TextDecoder().decode(await files.read("Data.md"))).toBe(
      "remote data",
    );
    expect(await api.deferred()).toEqual([]);
  } finally {
    await engine.stop();
  }
});

it("disconnect forgets all state, keeps files, and closes the client", async () => {
  const state = new MemoryStateStore();
  const files = new MemoryFileSystem();
  await files.writeAtomic("Note.md", new TextEncoder().encode("kept"), 1);
  await state.put({
    path: "Note.md",
    wirePath: "Note.md",
    fileId: "file",
    versionId: "v",
    sha: "",
    size: 4,
    mtime: 1,
  });
  await state.setMeta("held-deletes", "[]");
  await state.setCursor(42);
  const key = encodeAccessToken({
    v: 1,
    address: "https://example.test",
    key: "a".repeat(43),
    scope: { kind: "folder", id: "scope", path: "/" },
  });
  const client = await open({
    key,
    files,
    state,
    transport: {
      fetch: async (input) =>
        Response.json(
          String(input).endsWith("/capabilities")
            ? { protocol: 2 }
            : {
                protocol: 2,
                token_id: "token",
                space_id: "space",
                scope: { kind: "folder", id: "scope", path: "/" },
                status: "active",
                limits: { max_file_bytes: 1024, quota_bytes: null },
              },
        ),
    },
  });
  try {
    await client.disconnect();
    expect(await state.get("Note.md")).toBeNull();
    expect(await state.getCursor()).toBe(0);
    expect(state.metadataKeys("")).toEqual([]);
    expect(new TextDecoder().decode(await files.read("Note.md"))).toBe("kept");
    await expect(client.history("Note.md")).rejects.toMatchObject({
      code: "closed",
    });
  } finally {
    await client.close();
  }
});

it("self-revoke uses its connection token id and prevents later history calls", async () => {
  const key = encodeAccessToken({
    v: 1,
    address: "https://example.test",
    key: "a".repeat(43),
    scope: { kind: "folder", id: "scope", path: "/" },
  });
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === "DELETE") {
        expect(path).toBe("/v2/tokens/own-token");
        return Response.json({ revoked: true });
      }
      return Response.json(
        path === "/capabilities"
          ? { protocol: 2 }
          : {
              protocol: 2,
              token_id: "own-token",
              space_id: "space",
              scope: { kind: "folder", id: "scope", path: "/" },
              status: "active",
              limits: { max_file_bytes: 1024, quota_bytes: null },
            },
      );
    },
  );
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: { fetch: fetcher },
  });
  const revoked = vi.fn();
  client.on("revoked", revoked);
  try {
    await client.revoke();
    expect(revoked).toHaveBeenCalledTimes(1);
    const count = fetcher.mock.calls.length;
    await expect(client.trash()).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(client.syncOnce()).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(() => client.start()).toThrow();
    expect(() => client.resume()).toThrow();
    expect(fetcher).toHaveBeenCalledTimes(count);
  } finally {
    await client.close();
  }
});
