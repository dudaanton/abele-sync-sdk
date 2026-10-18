import { expect, it, vi } from "vitest";
import { MemoryStateStore } from "@abele/sync-core";
import { createHistory } from "../../packages/sdk/src/history.js";

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
