import { it, expect } from "vitest";
import {
  open,
  ItemClient,
  AccessClient,
  V2EngineClient,
  AbeleError,
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
      const preview = await owner.previewTokenItem(shared.info.id, added.id, {
        limit: 1,
      });
      expect(preview.file_count).toBe(1);
      expect(preview.total_bytes).toBe(
        new TextEncoder().encode("Second.md").length,
      );
      expect(preview.files).toHaveLength(1);
      expect(preview.files[0].path).toBe("Second.md");
      // The server reports overlap details for groups only.
      expect(preview.files[0].overlap_count).toBe(0);
      expect(preview.files[0].overlaps).toEqual([]);
      expect(
        await access.previewTokenItem(shared.info.id, added.id, { limit: 1 }),
      ).toEqual(preview);
      const allPreview = await owner.previewToken(shared.info.id, { limit: 1 });
      expect(allPreview.file_count).toBe(2);
      expect(allPreview.total_bytes).toBe(17);
      expect(allPreview.items).toHaveLength(2);
      expect(await access.previewToken(shared.info.id, { limit: 1 })).toEqual(
        allPreview,
      );
      await expect(
        AccessClient.fromToken(shared.token, { fetch }).previewToken(
          shared.info.id,
        ),
      ).rejects.toThrow();
      const capped = await access.previewToken(
        (await access.connection()).token_id,
        { limit: 1 },
      );
      expect(capped.file_count).toBe(2);
      expect(capped.items[0].files).toHaveLength(1);
      expect(capped.total_bytes).toBe(17);
      const group = await access.issue({
        label: "group preview",
        scope: { kind: "group", id: first.file_id },
      });
      const groupPreview = await owner.previewTokenItem(
        group.info.id,
        `primary:${group.info.id}`,
        { limit: 1 },
      );
      expect(groupPreview.files[0].path).toBe("First.md");
      expect(groupPreview.files[0].overlap_count).toBeGreaterThan(0);
      expect(groupPreview.files[0].overlaps).toContainEqual(
        expect.objectContaining({ token_id: shared.info.id }),
      );
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

it.runIf(process.env.ABELE_SYNC_IMAGE_TAG === "0.5.0")(
  "limits issuer inventory, counts, previews and overlap disclosure to caller coverage",
  async () => {
    const server = await startServer();
    let client: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const files = new MemoryFileSystem();
      await files.writeAtomic(
        "Visible.md",
        new TextEncoder().encode("visible"),
        Date.now(),
      );
      await files.writeAtomic(
        "Private.md",
        new TextEncoder().encode("secret"),
        Date.now(),
      );
      client = await open({
        key: server.keys[0],
        files,
        state: new MemoryStateStore(),
      });
      await client.syncOnce();
      const root = AccessClient.fromToken(server.keys[0], { fetch });
      const rootItems = ItemClient.fromToken(server.keys[0], { fetch });
      const page = await new V2EngineClient(server.keys[0], { fetch }).manifest(
        null,
      );
      const visible = page.items.find((file) => file.path === "Visible.md")!;
      const privateFile = page.items.find(
        (file) => file.path === "Private.md",
      )!;
      const issuer = await root.issue({
        label: "scoped issuer",
        scope: { kind: "file", id: visible.file_id },
      });
      const scoped = AccessClient.fromToken(issuer.token, { fetch });
      const scopedItems = ItemClient.fromToken(issuer.token, { fetch });
      const child = await scoped.issue({
        label: "child",
        scope: { kind: "file", id: visible.file_id },
      });
      const group = await rootItems.addItem(child.info.id, {
        kind: "group",
        id: visible.file_id,
      });
      const hidden = await rootItems.addItem(child.info.id, {
        kind: "file",
        id: privateFile.file_id,
      });
      const sibling = await root.issue({
        label: "hidden sibling grant",
        scope: { kind: "group", id: visible.file_id },
      });

      expect((await root.tokenItems(child.info.id)).items).toHaveLength(3);
      expect(
        (await ItemClient.fromToken(child.token, { fetch }).items()).items,
      ).toHaveLength(3);
      for (const api of [scoped, scopedItems]) {
        const inventory = await api.tokenItems(child.info.id);
        expect(inventory.items).toHaveLength(2);
        expect(inventory.items.some((item) => item.id === hidden.id)).toBe(
          false,
        );
        const preview = await api.previewToken(child.info.id);
        expect(preview).toMatchObject({ file_count: 1, total_bytes: 7 });
        expect(preview.items).toHaveLength(2);
        expect(JSON.stringify(preview)).not.toContain("Private.md");
        const error = await api
          .previewTokenItem(child.info.id, hidden.id)
          .catch((error) => error);
        expect(error).toBeInstanceOf(AbeleError);
        expect(error).toMatchObject({ code: "forbidden", status: 403 });
        const groupPreview = await api.previewTokenItem(
          child.info.id,
          group.id,
        );
        const ownerPreview = await root.previewTokenItem(
          child.info.id,
          group.id,
        );
        const restricted = groupPreview.files[0];
        expect(restricted.overlap_count).toBe(
          ownerPreview.files[0].overlap_count,
        );
        expect(restricted.overlap_count).toBeGreaterThan(
          restricted.overlaps.length,
        );
        expect(ownerPreview.files[0].overlaps).toContainEqual(
          expect.objectContaining({ token_id: sibling.info.id }),
        );
        expect(JSON.stringify(restricted.overlaps)).not.toContain(
          sibling.info.id,
        );
        expect(JSON.stringify(restricted.overlaps)).not.toContain(
          `primary:${sibling.info.id}`,
        );
      }
      expect(
        (await scoped.tokens()).items.find(
          (token) => token.id === child.info.id,
        )?.item_count,
      ).toBe(2);
      expect(
        (await root.tokens()).items.find((token) => token.id === child.info.id)
          ?.item_count,
      ).toBe(3);
      expect((await root.previewToken(child.info.id)).file_count).toBe(2);
    } finally {
      try {
        await client?.close();
      } finally {
        await server.close();
      }
    }
  },
  180_000,
);
