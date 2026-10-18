import { expect, it, vi } from "vitest";
import { setTimeout as realDelay } from "node:timers/promises";
import { inspect } from "node:util";
import { AbeleError } from "@abele/sync-protocol";
import { HttpError } from "@abele/sync-core";
import { MemoryFileSystem, MemoryStateStore } from "@abele/sync-core";
import { open, IncompatibleServer } from "../../packages/sdk/src/index.js";
import { fakeServer } from "./server.js";
async function until(predicate: () => boolean, tick = 0) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(tick);
    await realDelay(5);
  }
  throw new Error("Loopback operation did not settle");
}
async function io<T>(work: Promise<T>): Promise<T> {
  let settled = false;
  const observed = work.finally(() => {
    settled = true;
  });
  // Attach rejection handling while pumping I/O, then propagate the result.
  void observed.catch(() => {});
  await until(() => settled);
  return observed;
}
async function fixture() {
  const server = await fakeServer();
  let closed = 0;
  class Socket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("close", () => closed++);
    }
  }
  const files = new MemoryFileSystem();
  const logger = vi.fn();
  const client = await open({
    logger,
    transport: {
      WebSocket: Socket,
      // Avoid pooled keep-alive sockets whose internal clocks are not faked.
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: { ...init?.headers, connection: "close" },
        }),
    },
    key: server.key,
    files,
    state: new MemoryStateStore(),
    backoffMs: [10, 40],
    fallbackMs: 100_000,
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  return {
    server,
    client,
    files,
    logger,
    get closed() {
      return closed;
    },
    async close() {
      await client.close();
      vi.useRealTimers();
      await server.close();
    },
  };
}
it.each(["protocol", "token_id", "space_id", "scope", "status", "limits"])(
  "rejects missing connection field %s",
  async (field) => {
    const server = await fakeServer();
    delete server.connection[field];
    try {
      await expect(
        open({
          key: server.key,
          files: new MemoryFileSystem(),
          state: new MemoryStateStore(),
        }),
      ).rejects.toBeInstanceOf(IncompatibleServer);
    } finally {
      await server.close();
    }
  },
);
it.each([1, 3])("rejects capabilities protocol %s", async (protocol) => {
  const server = await fakeServer();
  server.control.protocol = protocol;
  try {
    await expect(
      open({
        key: server.key,
        files: new MemoryFileSystem(),
        state: new MemoryStateStore(),
      }),
    ).rejects.toBeInstanceOf(IncompatibleServer);
  } finally {
    await server.close();
  }
});
it("BUG: opening errors never expose keys or credentialed URLs", async () => {
  const server = await fakeServer();
  server.control.status = 401;
  server.control.message = server.key + " http://user:password@example.test";
  try {
    const error = await open({
      key: server.key,
      files: new MemoryFileSystem(),
      state: new MemoryStateStore(),
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(server.key);
    expect(String(error)).not.toContain("password");
    expect(error).toBeInstanceOf(AbeleError);
    expect(error).toMatchObject({
      code: "unauthorized",
      status: 401,
      details: {},
    });
  } finally {
    await server.close();
  }
});
it.each(["capabilities", "connection"])(
  "normalizes untrusted %s errors without retaining causes or details",
  async (stage) => {
    const server = await fakeServer();
    const secret = "invented-sensitive-value http://user:password@example.test";
    const hostile = new AbeleError("forbidden", secret, { credential: secret });
    try {
      const error = await open({
        key: server.key,
        files: new MemoryFileSystem(),
        state: new MemoryStateStore(),
        transport: {
          fetch: async (url, init) => {
            if (stage === "capabilities") throw hostile;
            if (String(url).endsWith("/v2/connection"))
              return Response.json(hostile.toBody(), { status: 403 });
            return fetch(url, init);
          },
        },
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AbeleError);
      expect(error).toMatchObject({
        code: "forbidden",
        status: 403,
        details: {},
      });
      expect(inspect(error, { showHidden: true })).not.toContain(secret);
    } finally {
      await server.close();
    }
  },
);
it("preserves transient HTTP status when opening", async () => {
  const server = await fakeServer();
  server.control.status = 503;
  server.control.message = "invented-sensitive-value";
  try {
    const error = await open({
      key: server.key,
      files: new MemoryFileSystem(),
      state: new MemoryStateStore(),
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ code: "offline", status: 503 });
    expect(inspect(error, { showHidden: true })).not.toContain(
      server.control.message,
    );
  } finally {
    await server.close();
  }
});
it("401 emits revoked once and waits for resume without exposing secrets", async () => {
  const f = await fixture();
  const revoked = vi.fn(),
    errors = vi.fn();
  f.client.on("revoked", revoked);
  f.client.on("error", errors);
  f.server.control.status = 401;
  f.server.control.message =
    f.server.key + " http://user:password@example.test";
  try {
    f.client.start();
    await until(() => revoked.mock.calls.length === 1);
    const count = f.server.requests.length;
    await vi.advanceTimersByTimeAsync(200_000);
    await expect(f.client.syncOnce()).rejects.toThrow();
    expect(f.server.requests).toHaveLength(count);
    expect(revoked).toHaveBeenCalledTimes(1);
    const exposed = inspect(
      [errors.mock.calls, f.client.status, f.logger.mock.calls],
      { showHidden: true },
    );
    expect(exposed).not.toContain(f.server.key);
    expect(exposed).not.toContain("password");
    f.server.control.status = 200;
    f.client.resume();
    await until(() => f.client.status.state === "idle");
    expect(f.server.requests.length).toBeGreaterThan(count);
  } finally {
    await f.close();
  }
});
it("BUG: 5xx backoff increases, caps, and resets after success", async () => {
  const f = await fixture();
  const errors = vi.fn();
  f.client.on("error", errors);
  try {
    f.server.control.status = 503;
    f.client.start();
    await until(() => errors.mock.calls.length === 1);
    expect(f.client.status.state).toBe("offline");
    for (const [i, delay] of [10, 20, 40, 40].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(errors).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      await until(() => errors.mock.calls.length === i + 2);
    }
    f.server.control.status = 200;
    await vi.advanceTimersByTimeAsync(40);
    await until(() => f.client.status.state === "idle");
    f.server.control.status = 503;
    await expect(io(f.client.syncOnce())).rejects.toThrow();
    const count = errors.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9);
    expect(errors).toHaveBeenCalledTimes(count);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => errors.mock.calls.length === count + 1);
  } finally {
    await f.close();
  }
});
it("reconnect catches missed cursors and duplicate or older frames are idempotent", async () => {
  const f = await fixture();
  const synced = vi.fn();
  f.client.on("synced", synced);
  try {
    f.client.start();
    await until(() => synced.mock.calls.length === 1 && f.server.opens === 1);
    f.server.drop();
    await until(() => f.closed === 1);
    const files = new MemoryFileSystem();
    await files.writeAtomic(
      "Example.md",
      new TextEncoder().encode("Example\n"),
      Date.now(),
    );
    const writer = await io(
      open({
        key: f.server.key,
        files,
        state: new MemoryStateStore(),
      }),
    );
    try {
      await io(writer.syncOnce());
    } finally {
      await writer.close();
    }
    const cursor = f.server.control.cursor;
    await vi.advanceTimersByTimeAsync(9);
    expect(f.server.opens).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => f.server.opens === 2, 1);
    await vi.advanceTimersByTimeAsync(5000);
    await until(() => f.client.status.cursor === cursor);
    expect(await f.client.replica.readText("Example.md")).toBe("Example\n");
    expect(
      f.server.requests.some(
        (url) =>
          url.pathname === "/v2/changes" &&
          url.searchParams.get("since") === "1",
      ),
    ).toBe(true);
    const count = synced.mock.calls.length;
    f.server.frame(cursor);
    f.server.frame(cursor - 1);
    f.server.frame(cursor);
    await realDelay(30);
    expect(synced).toHaveBeenCalledTimes(count);
    expect(f.client.status.cursor).toBe(cursor);
  } finally {
    await f.close();
  }
});

it("socket drop backoff increases, caps, and resets after a valid frame", async () => {
  const f = await fixture();
  try {
    f.client.start();
    await until(() => f.server.opens === 1 && f.client.status.state === "idle");
    for (const [i, delay] of [10, 20, 40, 40].entries()) {
      f.server.drop();
      await until(() => f.closed === i + 1);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(f.server.opens).toBe(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      await until(() => f.server.opens === i + 2, 1);
    }
    f.server.frame(1);
    await until(() => f.client.status.headSeq === 1);
    f.server.drop();
    await until(() => f.closed === 5);
    await vi.advanceTimersByTimeAsync(9);
    expect(f.server.opens).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => f.server.opens === 6, 1);
  } finally {
    await f.close();
  }
});
