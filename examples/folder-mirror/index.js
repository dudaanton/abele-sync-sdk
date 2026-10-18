import { parseArgs } from "node:util";

const usage =
  "Usage: node examples/folder-mirror --key <key> --dir <dir> [--state-dir <dir>] (--once | --watch)";
async function main() {
  const { values } = parseArgs({
    options: {
      key: { type: "string" },
      dir: { type: "string" },
      "state-dir": { type: "string" },
      once: { type: "boolean" },
      watch: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (
    !values.key ||
    !values.dir ||
    Boolean(values.once) === Boolean(values.watch)
  )
    throw new Error(usage);
  const { open } = await import("@abele/sync-sdk");
  const client = await open({
    key: values.key,
    dir: values.dir,
    stateDir: values["state-dir"],
  });
  try {
    if (values.once)
      console.log(JSON.stringify(await client.syncOnce(), null, 2));
    else {
      client.on("status", (status) => console.log("status:", status.state));
      client.on("change", (change) => console.log(JSON.stringify(change)));
      client.on("error", (error) => console.error("Sync failed:", error.code));
      await new Promise((resolve) => {
        const done = () => {
          process.off("SIGINT", done);
          process.off("SIGTERM", done);
          resolve();
        };
        process.once("SIGINT", done);
        process.once("SIGTERM", done);
        client.start();
      });
    }
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  // Avoid printing transport errors that could contain connection credentials.
  console.error(
    error.message === usage
      ? usage
      : "Folder sync failed (" + (error.code ?? "unknown") + ")",
  );
  process.exitCode = 1;
});
