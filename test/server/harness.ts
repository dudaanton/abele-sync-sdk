import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const exec = promisify(execFile);
async function docker(...args: string[]) {
  // Never include provisioning output or environment secrets in errors.
  try {
    return (
      await exec("docker", args, { timeout: 120_000, maxBuffer: 2_000_000 })
    ).stdout.trim();
  } catch {
    throw new Error("Docker command failed: " + args[0]);
  }
}
export async function startServer() {
  const compat = JSON.parse(
    await readFile(new URL("../../compat.json", import.meta.url), "utf8"),
  );
  const imageTag = process.env.ABELE_SYNC_IMAGE_TAG ?? compat.servers[0];
  if (typeof imageTag !== "string" || !/^[\w][\w.-]{0,127}$/.test(imageTag))
    throw new Error("Invalid server image tag");
  const imageId = process.env.ABELE_SYNC_IMAGE_ID;
  if (imageId !== undefined && !/^sha256:[a-f0-9]{64}$/.test(imageId))
    throw new Error("Invalid local server image id");
  const name = "sync-sdk-test-" + randomUUID();
  let created = false;
  const close = async () => {
    if (created) {
      await docker("rm", "-f", name);
      created = false;
    }
  };
  try {
    await docker(
      "run",
      "-d",
      "--name",
      name,
      "--publish",
      "127.0.0.1::8787",
      "-e",
      "ABELE_HOST=0.0.0.0",
      "-e",
      "ABELE_PORT=8787",
      "-e",
      "ABELE_DATABASE_URL=sqlite:///data/test.db",
      "-e",
      "ABELE_BLOB_DIR=/data/blobs",
      "-e",
      "ABELE_MASTER_KEY=" + randomBytes(32).toString("hex"),
      "-e",
      "ABELE_TOKEN_PEPPER=" + randomBytes(32).toString("hex"),
      imageId ?? "ghcr.io/dudaanton/abele-sync:" + imageTag,
    );
    created = true;
    const port = await docker("port", name, "8787/tcp");
    const address = "http://" + port;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (
          (
            await fetch(address + "/capabilities", {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) throw new Error("Server did not become ready");
    const admin = async (...args: string[]) =>
      JSON.parse(
        await docker(
          "exec",
          name,
          "node",
          "/app/packages/server/dist/admin-cli/index.js",
          ...args,
          "--json",
        ),
      );
    const vault = "test-" + randomUUID();
    await admin("vaults", "create", vault, "--address", address);
    const first = await admin(
      "connections",
      "create",
      vault,
      "--label",
      "first",
      "--folder",
      "/",
    );
    const second = await admin(
      "connections",
      "create",
      vault,
      "--label",
      "second",
      "--folder",
      "/",
    );
    return {
      address,
      keys: [first.token, second.token] as [string, string],
      async revoke(index: 0 | 1) {
        const { V2EngineClient } = await import("@abele/sync-core");
        const info = await new V2EngineClient(
          index === 0 ? first.token : second.token,
          { fetch },
        ).connection();
        await admin("connections", "revoke", info.token_id, "--yes");
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
