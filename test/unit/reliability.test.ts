import { expect, it, vi } from "vitest";
import {
  MemoryFileSystem,
  MemoryStateStore,
  SyncCancelled,
} from "@abele/sync-core";
import { encodeAccessToken } from "@abele/sync-protocol";
import * as sdk from "../../packages/sdk/src/index.js";
import { forgetState } from "../../packages/sdk/src/history.js";

it("exports the core cancellation class", () => {
  expect(sdk).toHaveProperty("SyncCancelled", SyncCancelled);
});

it.each(["pause", "stop"] as const)(
  "preserves intentional %s cancellation without failure events",
  async (action) => {
    const scope = { kind: "folder" as const, id: "folder", path: "/" };
    const key = encodeAccessToken({
      v: 1,
      address: "http://localhost:8787",
      key: "a".repeat(43),
      scope,
    });
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let block = true;
    const client = await sdk.open({
      key,
      files: new MemoryFileSystem(),
      state: new MemoryStateStore(),
      transport: {
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/capabilities") return Response.json({ protocol: 2 });
          if (path === "/v2/connection")
            return Response.json({
              protocol: 2,
              token_id: "token",
              space_id: "space",
              scope,
              status: "active",
              read_only: false,
              limits: { max_file_bytes: 1024, quota_bytes: null },
            });
          if (block) {
            entered();
            await new Promise((_, reject) =>
              init!.signal!.addEventListener(
                "abort",
                () => reject(init!.signal!.reason),
                { once: true },
              ),
            );
          }
          return Response.json({ items: [], cursor: 1, next: null });
        },
      },
    });
    const error = vi.fn(),
      synced = vi.fn();
    client.on("error", error);
    client.on("synced", synced);
    try {
      const running = client.syncOnce();
      const rejected = expect(running).rejects.toBeInstanceOf(SyncCancelled);
      await reading;
      await client[action]();
      await rejected;
      expect(client.status.state).toBe("paused");
      expect(error).not.toHaveBeenCalled();
      expect(synced).not.toHaveBeenCalled();
      block = false;
      await client.syncOnce();
      expect(synced).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  },
);

it("forgets entries and metadata atomically through the scoped store", async () => {
  const state = new MemoryStateStore();
  await state.put({
    path: "a.md",
    fileId: "file",
    versionId: "version",
    sha: "sha",
    size: 1,
    mtime: 1,
  });
  await state.setMeta("pull-held:file", "held");
  await state.setCursor(42);
  await state.setJournal({
    batchId: "batch",
    ops: [],
    idempotencyKey: "key",
    startedAt: "now",
  });
  await forgetState(state);
  expect(await state.get("a.md")).toBeNull();
  expect(await state.getCursor()).toBe(0);
  expect(await state.getJournal()).toBeNull();
  expect(state.metadataKeys("")).toEqual([]);
});
