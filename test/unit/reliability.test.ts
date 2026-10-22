import { expect, it, vi } from "vitest";
import {
  MemoryFileSystem,
  MemoryStateStore,
  EngineError,
  SyncCancelled,
} from "@abele/sync-core";
import { encodeAccessToken } from "@abele/sync-protocol";
import * as sdk from "../../packages/sdk/src/index.js";
import {
  forgetState,
  historyOperation,
  HistoryError,
} from "../../packages/sdk/src/history.js";
import { safeError } from "../../packages/sdk/src/errors.js";

it("exports the core cancellation class", () => {
  expect(sdk).toHaveProperty("SyncCancelled", SyncCancelled);
});

it.each(
  (["pause", "stop"] as const).flatMap((action) =>
    (["syncOnce", "decideDeletes"] as const).map((operation) => ({
      action,
      operation,
    })),
  ),
)(
  "preserves intentional $action cancellation through $operation without failure events",
  async ({ action, operation }) => {
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
    const state = new MemoryStateStore();
    if (operation === "decideDeletes")
      await state.setMeta(
        "held-deletes",
        JSON.stringify([{ path: "a.md", fileId: "file" }]),
      );
    const client = await sdk.open({
      key,
      files: new MemoryFileSystem(),
      state,
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
      const running =
        operation === "syncOnce"
          ? client.syncOnce()
          : client.decideDeletes({ kind: "confirm", fileIds: ["file"] });
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

it("preserves cancellation in shared error sanitization without copying untrusted details", () => {
  const error = new SyncCancelled();
  error.message = "secret transport text";
  const sanitized = safeError(error);
  expect(sanitized).toBeInstanceOf(SyncCancelled);
  expect(sanitized).not.toBe(error);
  expect(sanitized.message).toBe("sync stopped");
  expect(sanitized.cause).toBeUndefined();
});

it("keeps genuine offline errors distinct from intentional cancellation", async () => {
  const error = new EngineError("offline", "private transport details");
  expect(safeError(error)).not.toBeInstanceOf(SyncCancelled);
  await expect(
    historyOperation(async () => {
      throw error;
    }),
  ).rejects.toEqual(new HistoryError("offline"));
});

it("sanitizes intentional cancellation through the history boundary", async () => {
  const error = new SyncCancelled();
  error.message = "private transport details";
  const result = await historyOperation(async () => {
    throw error;
  }).catch((failure) => failure);
  expect(result).toBeInstanceOf(SyncCancelled);
  expect(result).not.toBe(error);
  expect(result.message).toBe("sync stopped");
  expect(result.cause).toBeUndefined();
});

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
