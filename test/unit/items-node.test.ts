import { expect, it, vi } from "vitest";
import {
  MemoryFileSystem,
  MemoryStateStore,
  V2EngineClient,
  selectiveDefaults,
} from "@abele/sync-core";
import { decodeAccessToken, encodeAccessToken } from "@abele/sync-protocol";

const opened = vi.hoisted(() => ({ key: "" }));
vi.mock("../../packages/sdk/src/node-replica.js", async (original) => ({
  ...(await original<object>()),
  openReplica: async (options) => {
    opened.key = options.key;
    return {
      cfg: { selective: selectiveDefaults() },
      fs: new MemoryFileSystem(),
      state: new MemoryStateStore(),
      client: new V2EngineClient(options.key, {
        fetch: options.fetch,
        WebSocket: options.WebSocket,
      }),
      close() {},
    };
  },
}));
import { open, type ConnectOptions } from "../../packages/sdk/src/index.js";

it("keeps a Node adapter's socket on its selected item", async () => {
  const messages: unknown[] = [];
  class Socket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(data: string) {
      messages.push(JSON.parse(data));
    }
    close() {}
  }
  const key = encodeAccessToken({
    v: 1,
    address: "http://localhost:8787",
    key: "a".repeat(43),
    scope: { kind: "folder", id: "root", path: "/" },
  });
  const scope = { kind: "folder", id: "folder", path: "Folder" };
  const options: ConnectOptions = {
    key,
    item: "second",
    dir: "unused",
    transport: {
      WebSocket: Socket as unknown as typeof WebSocket,
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        return Response.json(
          path === "/capabilities"
            ? { protocol: 2 }
            : path === "/v2/connection/items"
              ? { items: [] }
              : path === "/v2/connection"
                ? {
                    protocol: 2,
                    token_id: "token",
                    space_id: "space",
                    scope,
                    status: "active",
                    limits: { max_file_bytes: 1024, quota_bytes: null },
                  }
                : { items: [], cursor: 0, next: null },
        );
      },
    },
  };
  const client = await open(options);
  const binding = opened.key;
  try {
    const stored = decodeAccessToken(opened.key);
    expect(stored.v).toBe(2);
    if (stored.v === 2)
      expect(stored.items.map((item) => item.id)).toEqual(["second"]);
    client.start();
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        token: "a".repeat(43),
        item: "second",
      }),
    );
  } finally {
    await client.close();
  }
  scope.path = "Renamed";
  const reopened = await open(options);
  try {
    expect(opened.key).toBe(binding);
  } finally {
    await reopened.close();
  }
});
