import { expect, it } from "vitest";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";
import { createReplica } from "../../packages/sdk/src/replica.js";

it("lists metadata by prefix and reads bytes and UTF-8 text", async () => {
  const files = new MemoryFileSystem();
  await files.writeAtomic(
    "notes/Example.md",
    new TextEncoder().encode("Пример"),
    123,
  );
  await files.writeAtomic("other.md", new Uint8Array([1]), 456);
  await files.writeAtomic(".abele-sync/credentials", new Uint8Array([2]), 789);
  const replica = createReplica(files, new MemoryStateStore(), () => {});
  expect(await replica.list("notes/")).toEqual([
    { path: "notes/Example.md", size: 12, mtime: 123 },
  ]);
  expect(await replica.list()).toHaveLength(2);
  expect(await replica.readText("notes/Example.md")).toBe("Пример");
  expect(await replica.read("other.md")).toEqual(new Uint8Array([1]));
});

it("adds known file identifiers and rejects reads after close", async () => {
  const files = new MemoryFileSystem();
  const state = new MemoryStateStore();
  await files.writeAtomic("Example.md", new Uint8Array([1]), 1);
  await state.put({
    path: "Example.md",
    wirePath: "Example.md",
    fileId: "file-id",
    versionId: "version-id",
    sha: "hash",
    size: 1,
    mtime: 1,
  });
  let closed = false;
  const replica = createReplica(files, state, () => {
    if (closed) throw new Error("closed");
  });
  expect(await replica.list()).toEqual([
    { path: "Example.md", size: 1, mtime: 1, fileId: "file-id" },
  ]);
  closed = true;
  await expect(replica.list()).rejects.toThrow("closed");
  await expect(replica.read("Example.md")).rejects.toThrow("closed");
  await expect(replica.readText("Example.md")).rejects.toThrow("closed");
});

it.each([
  "../secret",
  "a/../secret",
  "/secret",
  "C:/secret",
  "a\\secret",
  ".abele-sync/credentials",
  "nested/.abele-sync/state",
  "a/./b",
  "a//b",
  "bad\0name",
])("rejects unsafe paths before accessing adapters: %s", async (path) => {
  const replica = createReplica(
    new MemoryFileSystem(),
    new MemoryStateStore(),
    () => {},
  );
  await expect(replica.read(path)).rejects.toThrow(TypeError);
  await expect(replica.list(path)).rejects.toThrow(TypeError);
});
