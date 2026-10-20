import { expect, it, vi } from "vitest";
import * as sdk from "../../packages/sdk/src/index.js";
import { encodeAccessToken } from "@abele/sync-protocol";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";

const key = encodeAccessToken({
  v: 1,
  address: "http://localhost:8787",
  key: "a".repeat(43),
  scope: { kind: "folder", id: "root", path: "/" },
});
const item = {
  id: "item/one",
  scope_id: "folder",
  scope: { kind: "folder", id: "folder", path: "Folder" },
  added_at: "2026-10-20T00:00:00Z",
  removed_at: null,
};
it("exports item management with validated payloads and encoded routes", async () => {
  expect(sdk).toHaveProperty("ItemClient");
  const fetcher = vi.fn(async (input, init) => {
    const path = new URL(String(input)).pathname;
    expect(new Headers(init?.headers).get("authorization")).toContain(
      "Bearer ",
    );
    if (path === "/v2/connection/items")
      return Response.json({ items: [item] });
    if (init?.method === "DELETE") return Response.json({ removed: true });
    if (path.endsWith("/delete")) {
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(
        "retry-key",
      );
      return Response.json({ cursor: 1, files: 0, revoked_tokens: [] });
    }
    expect(JSON.parse(init?.body as string)).toEqual({
      scope: { kind: "folder", id: "folder" },
    });
    return Response.json(item);
  }) as typeof fetch;
  const client = sdk.ItemClient.fromToken(key, { fetch: fetcher });
  expect(await client.supportsItems()).toBe(true);
  expect(await client.items()).toEqual({ items: [item] });
  expect(
    await client.addItem("token/id", { kind: "folder", id: "folder" }),
  ).toEqual(item);
  await client.removeItem("token/id", item.id);
  await client.deleteItem(item.id, "retry-key");
  expect(
    fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname),
  ).toContain("/v2/tokens/token%2Fid/items/item%2Fone");
});
it.each([401, 403, 500])(
  "does not disguise HTTP %s as an old server",
  async (status) => {
    const client = sdk.ItemClient.fromToken(key, {
      fetch: async () => new Response(null, { status }),
    });
    await expect(client.supportsItems()).rejects.toThrow();
  },
);
it("detects legacy servers only on a missing inventory route", async () => {
  const client = sdk.ItemClient.fromToken(key, {
    fetch: async () => new Response(null, { status: 404 }),
  });
  expect(await client.supportsItems()).toBe(false);
});
it("refuses an item selection on a legacy server before content access", async () => {
  const paths: string[] = [];
  await expect(
    sdk.open({
      key,
      item: "unknown",
      files: new MemoryFileSystem(),
      state: new MemoryStateStore(),
      transport: {
        fetch: async (input) => {
          const path = new URL(String(input)).pathname;
          paths.push(path);
          if (path === "/capabilities") return Response.json({ protocol: 2 });
          return new Response(null, { status: 404 });
        },
      },
    }),
  ).rejects.toBeInstanceOf(sdk.IncompatibleServer);
  expect(paths).not.toContain("/v2/connection");
});
it("pins the selected item on connection and sync requests", async () => {
  const setKey = encodeAccessToken({
    v: 2,
    address: "http://localhost:8787",
    key: "a".repeat(43),
    items: [
      { id: "first", kind: "folder", scope_id: "root", path: "/" },
      { id: "second", kind: "folder", scope_id: "folder", path: "Folder" },
    ],
  });
  const seen: string[] = [];
  const client = await sdk.open({
    key: setKey,
    item: "second",
    files: new MemoryFileSystem(),
    state: new MemoryStateStore(),
    transport: {
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/capabilities") return Response.json({ protocol: 2 });
        if (path === "/v2/connection/items")
          return Response.json({ items: [{ ...item, id: "second" }] });
        expect(new Headers(init?.headers).get("abele-scope-item")).toBe(
          "second",
        );
        seen.push(path);
        return Response.json(
          path === "/v2/connection"
            ? {
                protocol: 2,
                token_id: "token",
                space_id: "space",
                scope: item.scope,
                status: "active",
                limits: { max_file_bytes: 1024, quota_bytes: null },
              }
            : { items: [], cursor: 0, next: null },
        );
      },
    },
  });
  try {
    await client.syncOnce();
    expect(seen).toContain("/v2/manifest");
  } finally {
    await client.close();
  }
});
