import { parseArgs } from "node:util";

const usage =
  "Usage: node examples/folder-mirror --key <key> --dir <dir> --once";
async function main() {
  const { values } = parseArgs({
    options: {
      key: { type: "string" },
      dir: { type: "string" },
      once: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.key || !values.dir || !values.once) throw new Error(usage);
  const { open } = await import("@abele/sync-sdk");
  const client = await open({ key: values.key, dir: values.dir });
  try {
    console.log(JSON.stringify(await client.syncOnce(), null, 2));
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
