import { it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { open } from "../../packages/sdk/src/index.js";
import { startServer } from "./harness.js";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";
it("delivers live changes and emits revoked once until resumed", async () => {
  const server = await startServer();
  const clients: Awaited<ReturnType<typeof open>>[] = [];
  try {
    const first = new MemoryFileSystem(),
      second = new MemoryFileSystem();
    clients.push(
      await open({
        key: server.keys[0],
        files: first,
        state: new MemoryStateStore(),
      }),
    );
    clients.push(
      await open({
        key: server.keys[1],
        files: second,
        state: new MemoryStateStore(),
        fallbackMs: 10_000,
        backoffMs: [20, 100],
      }),
    );
    const synced = new Promise<void>((resolve) => {
      const off = clients[1].on("synced", () => {
        off();
        resolve();
      });
    });
    clients[1].start();
    await synced;
    const changed = new Promise<void>((resolve) => {
      const off = clients[1].on("change", (change) => {
        if (change.path === "Live.md") {
          off();
          resolve();
        }
      });
    });
    await first.writeAtomic(
      "Live.md",
      new TextEncoder().encode("Live\n"),
      Date.now(),
    );
    await clients[0].syncOnce();
    // This must arrive over the socket, before the fallback poll can run.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        changed,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Live change was not delivered")),
            3000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    expect(new TextDecoder().decode(await second.read("Live.md"))).toBe(
      "Live\n",
    );
    let count = 0;
    const revoked = new Promise<void>((resolve) =>
      clients[1].on("revoked", () => {
        count++;
        resolve();
      }),
    );
    await server.revoke(1);
    await revoked;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(count).toBe(1);
    expect(clients[1].status.state).toBe("error");
  } finally {
    try {
      await Promise.all(clients.map((client) => client.close()));
    } finally {
      await server.close();
    }
  }
}, 180_000);
it("two Memory clients converge against the real server", async () => {
  const server = await startServer();
  const clients: Awaited<ReturnType<typeof open>>[] = [];
  try {
    const first = new MemoryFileSystem(),
      second = new MemoryFileSystem();
    await first.writeAtomic(
      "Example.md",
      new TextEncoder().encode("Example\n"),
      Date.now(),
    );
    clients.push(
      await open({
        key: server.keys[0],
        files: first,
        state: new MemoryStateStore(),
      }),
    );
    clients.push(
      await open({
        key: server.keys[1],
        files: second,
        state: new MemoryStateStore(),
      }),
    );
    const changes: unknown[] = [];
    clients[1].on("change", (change) => changes.push(change));
    const report = await clients[0].syncOnce();
    expect(report).toHaveProperty("push");
    await clients[1].syncOnce();
    expect(new TextDecoder().decode(await second.read("Example.md"))).toBe(
      "Example\n",
    );
    expect(changes).toContainEqual(
      expect.objectContaining({
        path: "Example.md",
        kind: "upsert",
        origin: "remote",
      }),
    );
    await second.writeAtomic(
      "Reply.md",
      new TextEncoder().encode("Reply\n"),
      Date.now(),
    );
    await clients[1].syncOnce();
    await clients[0].syncOnce();
    expect(new TextDecoder().decode(await first.read("Reply.md"))).toBe(
      "Reply\n",
    );
  } finally {
    try {
      await Promise.all(clients.map((client) => client.close()));
    } finally {
      await server.close();
    }
  }
}, 180_000);
it("two Node clients converge on one folder", async () => {
  const server = await startServer();
  let root: string | undefined;
  const clients: Awaited<ReturnType<typeof open>>[] = [];
  try {
    root = await mkdtemp(resolve(".cache/server-"));
    const first = join(root, "first"),
      second = join(root, "second");
    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, "Example.md"), "# Example\n");
    clients.push(await open({ key: server.keys[0], dir: first }));
    clients.push(await open({ key: server.keys[1], dir: second }));
    const changes: unknown[] = [];
    clients[1].on("change", (change) => changes.push(change));
    await clients[0].syncOnce();
    await clients[1].syncOnce();
    expect(await readFile(join(second, "Example.md"), "utf8")).toBe(
      "# Example\n",
    );
    expect(changes).toContainEqual(
      expect.objectContaining({
        path: "Example.md",
        kind: "upsert",
        origin: "remote",
      }),
    );
    await writeFile(join(second, "Reply.md"), "Reply\n");
    await clients[1].syncOnce();
    await clients[0].syncOnce();
    expect(await readFile(join(first, "Reply.md"), "utf8")).toBe("Reply\n");
  } finally {
    try {
      await Promise.all(clients.map((client) => client.close()));
    } finally {
      try {
        await server.close();
      } finally {
        if (root) await rm(root, { recursive: true, force: true });
      }
    }
  }
}, 180_000);
