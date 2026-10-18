import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import { encodeAccessToken } from "@abele/sync-protocol";

export async function fakeServer() {
  const scope = { kind: "folder" as const, id: "folder", path: "/" };
  const connection: Record<string, unknown> = {
    protocol: 2,
    token_id: "token",
    space_id: "space",
    scope,
    status: "active",
    limits: { max_file_bytes: 1024, quota_bytes: null },
  };
  const sockets = new Set<Duplex>();
  const requests: URL[] = [];
  let opens = 0;
  const blobs = new Map<string, Buffer>();
  const items: {
    file_id: string;
    version_id: string;
    path: string;
    kind: "note";
    sha: string;
    size: number;
    mtime: number;
  }[] = [];
  const changes: unknown[] = [];
  const control = {
    protocol: 2,
    status: 200,
    message: "unavailable",
    cursor: 1,
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    requests.push(url);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/capabilities")
      res.end(JSON.stringify({ protocol: control.protocol }));
    else if (control.status !== 200) {
      res.statusCode = control.status;
      res.end(
        JSON.stringify({
          error: {
            code:
              control.status === 401
                ? "unauthorized"
                : control.status === 503
                  ? "scoped_unavailable"
                  : "internal",
            message: control.message,
          },
        }),
      );
    } else if (url.pathname === "/v2/connection")
      res.end(JSON.stringify(connection));
    else if (["/v2/manifest", "/v2/changes"].includes(url.pathname))
      res.end(
        JSON.stringify({
          items: url.pathname.endsWith("manifest")
            ? items
            : changes.filter(
                (event) =>
                  (event as { cursor: number }).cursor >
                  Number(url.searchParams.get("since")),
              ),
          cursor: control.cursor,
          next: null,
        }),
      );
    else if (url.pathname.startsWith("/v2/uploads/") && req.method === "PUT") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      blobs.set(url.pathname.split("/").pop()!, Buffer.concat(chunks));
      res.end("{}");
    } else if (url.pathname.endsWith("/content")) {
      const item = items.find((item) =>
        url.pathname.includes("/" + item.file_id + "/"),
      );
      const bytes = item && blobs.get(item.sha);
      if (!bytes) {
        res.statusCode = 404;
        res.end("{}");
        return;
      }
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
      res.setHeader("content-type", "application/octet-stream");
      if (range) {
        res.statusCode = 206;
        res.setHeader(
          "content-range",
          `bytes ${range[1]}-${range[2]}/${bytes.length}`,
        );
        res.end(bytes.subarray(Number(range[1]), Number(range[2]) + 1));
      } else res.end(bytes);
    } else if (url.pathname === "/v2/commit" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { ops } = JSON.parse(body);
      const results = ops.map(
        (op: {
          op: string;
          path: string;
          sha: string;
          size: number;
          mtime: number;
        }) => {
          if (op.op !== "create" || !blobs.has(op.sha))
            return {
              status: "rejected",
              code: "invalid_request",
              message: "Only uploaded creates supported",
            };
          const item = {
            file_id: `file-${++control.cursor}`,
            version_id: `version-${control.cursor}`,
            path: op.path,
            kind: "note" as const,
            sha: op.sha,
            size: op.size,
            mtime: op.mtime,
          };
          items.push(item);
          changes.push({
            type: "content",
            cursor: control.cursor,
            file_id: item.file_id,
            path: item.path,
            at: new Date().toISOString(),
            item,
            prev_path: null,
          });
          return { ...item, status: "applied", seq: control.cursor };
        },
      );
      res.end(JSON.stringify({ cursor: control.cursor, results }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  server.on("upgrade", (req, socket) => {
    if (req.url !== "/v2/events") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
    sockets.add(socket);
    opens++;
    socket.on("data", () => {});
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listen address");
  const key = encodeAccessToken({
    v: 1,
    address: `http://127.0.0.1:${address.port}`,
    key: "a".repeat(43),
    scope,
  });
  return {
    key,
    connection,
    control,
    requests,
    get opens() {
      return opens;
    },
    frame(cursor: number) {
      const body = Buffer.from(JSON.stringify({ type: "changes", cursor }));
      for (const socket of sockets)
        socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]));
    },
    drop() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
