import { expect, it } from "vitest";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";
import { open } from "../../packages/sdk/src/index.js";
import { startServer } from "./harness.js";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";

it("disconnects a Node replica, keeping local files and removing credentials and state", async () => {
  const server = await startServer();
  let root: string | undefined;
  let client: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(resolve(".cache"), { recursive: true });
    root = await mkdtemp(resolve(".cache/disconnect-"));
    await writeFile(join(root, "Example.md"), "kept\n");
    client = await open({ key: server.keys[0], dir: root });
    await client.syncOnce();
    await client.disconnect();
    expect(await readFile(join(root, "Example.md"), "utf8")).toBe("kept\n");
    expect(await readdir(join(root, ".abele-sync"))).toEqual([]);
    await expect(client.trash()).rejects.toMatchObject({ code: "closed" });
    await client.close();
    client = await open({ key: server.keys[0], dir: root });
    await client.syncOnce();
  } finally {
    try {
      await client?.close();
    } finally {
      try {
        if (root) await rm(root, { recursive: true, force: true });
      } finally {
        await server.close();
      }
    }
  }
}, 180_000);

it("restores an earlier version and a deleted file", async () => {
  const server = await startServer();
  let client: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const files = new MemoryFileSystem();
    client = await open({
      key: server.keys[0],
      files,
      state: new MemoryStateStore(),
      deleteGuard: false,
    });
    await files.writeAtomic(
      "Example.md",
      new TextEncoder().encode("first\n"),
      1000,
    );
    await client.syncOnce();
    const first = (await client.history("Example.md"))[0];
    await files.writeAtomic(
      "Example.md",
      new TextEncoder().encode("second\n"),
      2000,
    );
    await client.syncOnce();
    expect((await client.history("Example.md")).length).toBeGreaterThan(1);
    await client.restore("Example.md", first.version_id);
    await client.syncOnce();
    expect(new TextDecoder().decode(await files.read("Example.md"))).toBe(
      "first\n",
    );
    await files.remove("Example.md");
    await client.syncOnce();
    const deleted = (await client.trash()).find(
      (item) => item.path === "Example.md",
    );
    expect(deleted).toBeDefined();
    await client.restoreDeleted(deleted!.file_id);
    await client.syncOnce();
    expect(new TextDecoder().decode(await files.read("Example.md"))).toBe(
      "first\n",
    );
    expect(await client.trash()).toEqual([]);
  } finally {
    try {
      await client?.close();
    } finally {
      await server.close();
    }
  }
}, 180_000);

it("holds deletes at the threshold until the shown ids are confirmed", async () => {
  const server = await startServer();
  let client: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const files = new MemoryFileSystem();
    client = await open({
      key: server.keys[0],
      files,
      state: new MemoryStateStore(),
      deleteGuard: { count: 3, floor: 3, share: 1 },
    });
    const names = ["One.md", "Two.md", "Three.md"];
    for (const name of names)
      await files.writeAtomic(name, new TextEncoder().encode(name), 1000);
    await client.syncOnce();
    const events: unknown[] = [];
    client.on("heldDeletes", (held) => events.push(held));
    for (const name of names) await files.remove(name);
    await client.syncOnce();
    const held = await client.heldDeletes();
    expect(held).toHaveLength(3);
    expect(events).toContainEqual(held);
    expect(await client.trash()).toEqual([]);
    await client.syncOnce();
    expect(await client.trash()).toEqual([]);
    await client.decideDeletes({
      kind: "confirm",
      fileIds: held.map((item) => item.fileId),
    });
    expect(await client.heldDeletes()).toEqual([]);
    expect(await client.trash()).toHaveLength(3);
  } finally {
    try {
      await client?.close();
    } finally {
      await server.close();
    }
  }
}, 180_000);

it("revokes its own connection and refuses subsequent operations", async () => {
  const server = await startServer();
  let client: Awaited<ReturnType<typeof open>> | undefined;
  try {
    client = await open({
      key: server.keys[0],
      files: new MemoryFileSystem(),
      state: new MemoryStateStore(),
    });
    const events: unknown[] = [];
    client.on("revoked", (event) => events.push(event));
    await client.revoke();
    expect(events).toHaveLength(1);
    await expect(client.syncOnce()).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(client.trash()).rejects.toMatchObject({
      code: "unauthorized",
    });
    // A fresh instance must also be refused by the server, not just by a local flag.
    await expect(
      open({
        key: server.keys[0],
        files: new MemoryFileSystem(),
        state: new MemoryStateStore(),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  } finally {
    try {
      await client?.close();
    } finally {
      await server.close();
    }
  }
}, 180_000);
