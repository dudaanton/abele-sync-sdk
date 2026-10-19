import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/** Read local Markdown values; this does not perform synchronization. */
export async function readNotes(replica, prefix = "") {
  const { noteFromMarkdown } = await import("@abele/sync-sdk/notes");
  const notes = [];
  for (const entry of await replica.list(prefix)) {
    if (!entry.path.endsWith(".md")) continue;
    notes.push(
      noteFromMarkdown(entry.path, await replica.readText(entry.path)),
    );
  }
  return notes;
}

const usage =
  "Usage: node examples/reading-notes/index.js --key <key> --dir <dir> [--state-dir <dir>] [--prefix Notes/]";
async function main() {
  const { values } = parseArgs({
    options: {
      key: { type: "string" },
      dir: { type: "string" },
      "state-dir": { type: "string" },
      prefix: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values.key || !values.dir) throw new Error(usage);
  const { open } = await import("@abele/sync-sdk");
  const client = await open({
    key: values.key,
    dir: values.dir,
    stateDir: values["state-dir"],
  });
  const shutdown = () => {
    void client.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await client.syncOnce();
    for (const note of await readNotes(client.replica, values.prefix)) {
      console.log(
        JSON.stringify({
          path: note.path,
          body: note.body,
          task: note.task && {
            labels: note.task.labels,
            priority: note.task.priority,
            date: note.task.date?.format("YYYY-MM-DD HH:mm") ?? null,
            due: note.task.due?.format("YYYY-MM-DD HH:mm") ?? null,
            recurrence: note.task.recurrence,
          },
        }),
      );
    }
  } finally {
    try {
      await client.close();
    } finally {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error.message === usage
        ? usage
        : "Reading notes failed (" + (error.code ?? "unknown") + ")",
    );
    process.exitCode = 1;
  });
}
