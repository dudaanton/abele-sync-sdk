import { it, expect } from "vitest";
import {
  open,
  ItemClient,
  AccessClient,
  V2EngineClient,
} from "../../packages/sdk/src/index.js";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";
import { startServer } from "./harness.js";

it("keeps legacy keys working and negotiates item support", async () => {
  const server = await startServer();
  let client: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const files = new MemoryFileSystem();
    await files.writeAtomic(
      "Legacy.md",
      new TextEncoder().encode("legacy"),
      Date.now(),
    );
    client = await open({
      key: server.keys[0],
      files,
      state: new MemoryStateStore(),
    });
    await client.syncOnce();
    const page = await new V2EngineClient(server.keys[1], { fetch }).manifest(
      null,
    );
    expect(page.items.some((file) => file.path === "Legacy.md")).toBe(true);
    const supported = await ItemClient.fromToken(server.keys[0], {
      fetch,
    }).supportsItems();
    expect(supported).toBe(process.env.ABELE_SYNC_IMAGE_TAG === "0.5.0");
    const tokens = await AccessClient.fromToken(server.keys[0], {
      fetch,
    }).tokens();
    expect(tokens.items.length).toBeGreaterThan(0);
    for (const token of tokens.items) {
      if (supported) expect(token.item_count).toBe(1);
      else expect(token.item_count).toBeUndefined();
    }
  } finally {
    try {
      await client?.close();
    } finally {
      await server.close();
    }
  }
}, 180_000);

// CI's compatibility matrix exercises the legacy case above on both shapes.
it.runIf(process.env.ABELE_SYNC_IMAGE_TAG === "0.5.0")(
  "adds, lists, removes and deletes one item without deleting its sibling",
  async () => {
    const server = await startServer();
    const clients: Awaited<ReturnType<typeof open>>[] = [];
    try {
      const files = new MemoryFileSystem();
      for (const path of ["First.md", "Second.md"])
        await files.writeAtomic(
          path,
          new TextEncoder().encode(path),
          Date.now(),
        );
      clients.push(
        await open({
          key: server.keys[0],
          files,
          state: new MemoryStateStore(),
        }),
      );
      await clients[0].syncOnce();
      const wire = new V2EngineClient(server.keys[0], { fetch });
      const page = await wire.manifest(null);
      const first = page.items.find((file) => file.path === "First.md")!;
      const second = page.items.find((file) => file.path === "Second.md")!;
      const access = AccessClient.fromToken(server.keys[0], { fetch });
      const shared = await access.issue({
        label: "two files",
        scope: { kind: "file", id: first.file_id },
      });
      const owner = ItemClient.fromToken(server.keys[0], { fetch });
      const recipient = ItemClient.fromToken(shared.token, { fetch });
      const added = await owner.addItem(shared.info.id, {
        kind: "file",
        id: second.file_id,
      });
      expect((await recipient.items()).items).toHaveLength(2);
      const inventory = await owner.tokenItems(shared.info.id);
      expect(inventory).toEqual(await recipient.items());
      expect(await access.tokenItems(shared.info.id)).toEqual(inventory);
      expect(
        (await access.tokens()).items.find(
          (token) => token.id === shared.info.id,
        )?.item_count,
      ).toBe(2);
      await expect(
        AccessClient.fromToken(shared.token, { fetch }).tokenItems(
          shared.info.id,
        ),
      ).rejects.toThrow();
      const target = new MemoryFileSystem();
      clients.push(
        await open({
          key: shared.token,
          item: added.id,
          files: target,
          state: new MemoryStateStore(),
        }),
      );
      await clients[1].syncOnce();
      expect(new TextDecoder().decode(await target.read("Second.md"))).toBe(
        "Second.md",
      );
      expect(await target.stat("First.md")).toBeNull();
      await clients[1].close();
      await owner.removeItem(shared.info.id, added.id);
      expect(
        (await owner.tokenItems(shared.info.id)).items.find(
          (item) => item.id === added.id,
        )?.removed_at,
      ).not.toBeNull();
      expect(
        (await access.tokens()).items.find(
          (token) => token.id === shared.info.id,
        )?.item_count,
      ).toBe(1);
      expect(
        (await recipient.items()).items.find((item) => item.id === added.id)
          ?.removed_at,
      ).not.toBeNull();
      const restored = await owner.addItem(shared.info.id, {
        kind: "file",
        id: second.file_id,
      });
      const deleted = await owner.deleteItem(restored.id, "delete-second");
      expect(deleted.files).toBe(1);
      expect(await owner.deleteItem(restored.id, "delete-second")).toEqual(
        deleted,
      );
      const remaining = await wire.manifest(null);
      expect(remaining.items.map((file) => file.path)).toContain("First.md");
      expect(remaining.items.map((file) => file.path)).not.toContain(
        "Second.md",
      );
    } finally {
      try {
        await Promise.all(clients.map((client) => client.close()));
      } finally {
        await server.close();
      }
    }
  },
  180_000,
);
