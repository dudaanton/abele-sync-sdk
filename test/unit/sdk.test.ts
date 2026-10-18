import { expect, it, vi } from "vitest";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";
import { encodeAccessToken } from "@abele/sync-protocol";
import {
  parseKey,
  open,
  InvalidKey,
  IncompatibleServer,
} from "../../packages/sdk/src/index.js";
const token = {
  v: 1 as const,
  address: "http://127.0.0.1:8787",
  key: "a".repeat(43),
  scope: { kind: "folder" as const, id: "folder-id", path: "/" },
};
const key = encodeAccessToken(token);
const connection = {
  protocol: 2,
  token_id: "token-id",
  space_id: "space-id",
  scope: token.scope,
  status: "active",
  read_only: false,
  limits: { max_file_bytes: 1024, quota_bytes: null },
};
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
  expect(wire.fetch).toHaveBeenCalledTimes(2);
  await client.close();
  await client.close();
  await expect(client.syncOnce()).rejects.toThrow("closed");
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
it.fails(
  "BUG: upstream Node opener cannot use a separate stateDir",
  async () => {
    const client = await open({
      key,
      dir: ".cache/replica",
      stateDir: ".cache/state",
      transport: transport(),
    });
    await client.close();
  },
);
