import { expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";
import { encodeAccessToken } from "@abele/sync-protocol";
import {
  parseKey,
  open,
  InvalidKey,
  IncompatibleServer,
  ReplicaConfigurationError,
} from "../../packages/sdk/src/index.js";
const token = {
  v: 1 as const,
  address: "http://127.0.0.1:8787",
  key: "a".repeat(43),
  scope: { kind: "folder" as const, id: "folder-id", path: "/" },
};
const key = encodeAccessToken(token);
class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  constructor(_url: string | URL) {
    super();
    FakeSocket.instances.push(this);
  }
  send() {}
  close() {
    this.dispatchEvent(new Event("close"));
  }
}
it("supports lifecycle events and restart without leaking timers", async () => {
  vi.useFakeTimers();
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: {
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      fetch: vi.fn(async (input) => {
        const path = new URL(String(input)).pathname;
        return Response.json(
          path === "/capabilities"
            ? { protocol: 2 }
            : path === "/v2/connection"
              ? connection
              : { items: [], cursor: 1, next: null },
        );
      }) as typeof fetch,
    },
    fallbackMs: 100,
  });
  const synced = vi.fn();
  client.on("synced", synced);
  try {
    client.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(synced).toHaveBeenCalledTimes(1);
    client.pause();
    expect(client.status.state).toBe("paused");
    await vi.advanceTimersByTimeAsync(500);
    expect(synced).toHaveBeenCalledTimes(1);
    client.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(synced).toHaveBeenCalledTimes(2);
    await client.stop();
    client.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(synced).toHaveBeenCalledTimes(3);
  } finally {
    await client.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});
it("sanitizes failures and retries revoked connections only after resume", async () => {
  vi.useFakeTimers();
  let refused = true;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/capabilities") return Response.json({ protocol: 2 });
    if (path === "/v2/connection") return Response.json(connection);
    if (refused)
      return Response.json(
        { error: { code: "unauthorized", message: key } },
        { status: 401 },
      );
    return Response.json({ items: [], cursor: 1, next: null });
  });
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: {
      fetch: fetcher as typeof fetch,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    },
    fallbackMs: 100,
  });
  const revoked = vi.fn(),
    errors = vi.fn();
  client.on("revoked", revoked);
  client.on("error", errors);
  try {
    client.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0].code).toBe("unauthorized");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(key);
    expect(client.status.lastError).not.toContain(key);
    const calls = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    await expect(client.syncOnce()).rejects.toThrow();
    expect(fetcher.mock.calls.length).toBe(calls);
    client.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoked).toHaveBeenCalledTimes(2);
    refused = false;
    client.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.status.state).toBe("idle");
  } finally {
    await client.close();
    vi.useRealTimers();
  }
});
const connection = {
  protocol: 2,
  token_id: "token-id",
  space_id: "space-id",
  scope: token.scope,
  status: "active",
  read_only: false,
  limits: { max_file_bytes: 1024, quota_bytes: null },
};
it("uses core offline backoff, reconnects sockets, and isolates listeners", async () => {
  vi.useFakeTimers();
  let offline = true;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/capabilities") return Response.json({ protocol: 2 });
    if (path === "/v2/connection") return Response.json(connection);
    if (offline) throw new Error("http://user:secret@example.test/" + key);
    return Response.json({ items: [], cursor: 1, next: null });
  });
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: {
      fetch: fetcher as typeof fetch,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    },
    backoffMs: [10, 40],
    fallbackMs: 1000,
  });
  const status = vi.fn(),
    errors = vi.fn(),
    synced = vi.fn();
  client.on("status", () => {
    throw new Error("listener failed");
  });
  const off = client.on("status", status);
  client.on("error", errors);
  client.on("synced", synced);
  try {
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status.state).toBe("offline");
    expect(errors.mock.calls[0][0].code).toBe("offline");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
    const calls = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9);
    expect(fetcher.mock.calls.length).toBe(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(errors).toHaveBeenCalledTimes(2);
    offline = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(synced).toHaveBeenCalledTimes(1);
    const sockets = FakeSocket.instances.length;
    FakeSocket.instances.at(-1)!.close();
    await vi.advanceTimersByTimeAsync(9);
    expect(FakeSocket.instances.length).toBe(sockets);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances.length).toBe(sockets + 1);
    off();
    const statuses = status.mock.calls.length;
    client.pause();
    expect(status.mock.calls.length).toBe(statuses);
  } finally {
    await client.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
});
function transport(info: unknown = connection, protocol = 2) {
  return {
    fetch: vi.fn(async (url: string | URL | Request) =>
      Response.json(
        String(url).endsWith("/capabilities") ? { protocol } : info,
      ),
    ) as unknown as typeof fetch,
  };
}
it("sdk loads as an ESM module", async () => {
  expect(await import("../../packages/sdk/src/index.js")).toHaveProperty(
    "open",
  );
});
it("decodes protocol keys locally and throws typed errors", () => {
  expect(parseKey(key)).toEqual(token);
  for (const invalid of ["", "bad", "abele://bad", key.slice(0, -8)])
    expect(() => parseKey(invalid)).toThrow(InvalidKey);
});
it("opens Memory adapters and closes idempotently", async () => {
  const wire = transport();
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: wire,
  });
  expect(client.scope).toEqual(token.scope);
  expect(client.readOnly).toBe(false);
  expect(client.status.state).toBe("idle");
  expect(await client.replica.list()).toEqual([]);
  expect(wire.fetch).toHaveBeenCalledTimes(2);
  await client.close();
  await client.close();
  await expect(client.syncOnce()).rejects.toThrow("closed");
  await expect(client.replica.list()).rejects.toThrow("closed");
});
it.each([
  transport(connection, 1),
  transport({ ...connection, protocol: 3 }),
  transport({ ...connection, status: "broken" }),
  transport({ ...connection, limits: {} }),
])("rejects incompatible servers", async (wire) => {
  await expect(
    open({
      key,
      files: new MemoryFileSystem(),
      state: new MemoryStateStore(),
      transport: wire,
    }),
  ).rejects.toThrow(IncompatibleServer);
});
it("rejects ambiguous adapters before network", async () => {
  const wire = transport();
  await expect(
    open({
      key,
      dir: "x",
      files: new MemoryFileSystem(),
      state: new MemoryStateStore(),
      transport: wire,
    } as never),
  ).rejects.toThrow();
  expect(wire.fetch).not.toHaveBeenCalled();
});
it("syncOnce returns the core report on Memory adapters", async () => {
  const wire = {
    fetch: vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === "/capabilities") return Response.json({ protocol: 2 });
      if (path === "/v2/connection") return Response.json(connection);
      if (path === "/v2/manifest" || path === "/v2/changes")
        return Response.json({ items: [], cursor: 1, next: null });
      throw new Error("Unexpected route " + path);
    }) as unknown as typeof fetch,
  };
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: wire,
  });
  try {
    const report = await client.syncOnce();
    expect(report).toHaveProperty("pull");
    expect(report).toHaveProperty("push");
    expect(client.status.lastSyncAt).not.toBeNull();
  } finally {
    await client.close();
  }
});
it("reports server read-only access", async () => {
  const client = await open({
    key,
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: transport({ ...connection, read_only: true }),
  });
  expect(client.readOnly).toBe(true);
  await client.close();
});
it("opens a Node replica with a separate stateDir", async () => {
  await mkdir(".cache", { recursive: true });
  const root = await mkdtemp(resolve(".cache/stateDir-"));
  const dir = join(root, "replica"),
    stateDir = join(root, "state");
  try {
    const client = await open({ key, dir, stateDir, transport: transport() });
    await client.close();
    const reopened = await open({ key, dir, stateDir, transport: transport() });
    await reopened.close();
    await expect(
      open({
        key,
        dir: join(root, "second"),
        stateDir,
        transport: transport(),
      }),
    ).rejects.toBeInstanceOf(ReplicaConfigurationError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
