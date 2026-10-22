import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { stateFolder, type NodeReplica } from "@abele/sync-node";
import { HistoryError } from "./history.js";
import { disposableProjectionIndex } from "./projection-cache.js";

/** Stop the engine first. Retire the ledger while its device lock is still held. */
export function forgetNodeReplica(replica: NodeReplica): void {
  replica.fence?.assertOwner();
  // Durable state may be external; installation temps stay beside synced files.
  const folders = new Set([
    stateFolder(replica.dir, replica.stateDir),
    stateFolder(replica.dir),
  ]);
  const contents = [...folders].map((folder) => {
    const stat = lstatSync(folder);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new HistoryError("unsupported");
    return { folder, names: readdirSync(folder) };
  });
  // An external directory is not a namespace the SDK may recursively own.
  // Refuse mixed-use/ancestor layouts before closing or deleting anything.
  if (replica.stateDir) {
    const durable = realpathSync(replica.stateDir);
    const child = relative(durable, realpathSync(replica.dir));
    if (
      !child ||
      (!isAbsolute(child) && child !== ".." && !child.startsWith("../"))
    )
      throw new HistoryError("unsupported");
    // No ownership manifest covers arbitrary preexisting directory contents in
    // an external stateDir. Refuse those rather than recursively deleting them.
    for (const name of readdirSync(durable)) {
      if (
        name !== "lock.mutation" &&
        lstatSync(join(durable, name)).isDirectory()
      )
        throw new HistoryError("unsupported");
    }
  }
  const files = new Set([
    "config.json",
    "state.db",
    "state.db-wal",
    "state.db-shm",
    "lock",
  ]);
  // Reserved namespaces used by the pinned Node adapter. Any unknown entry is
  // evidence of mixed ownership, so refuse the entire cleanup, never sweep it.
  const directories = new Set([
    "lock.mutation",
    "recovery",
    "external",
    "scoped-outbox",
    "tmp",
    "code-approvals",
    "stages",
    "conditional",
    "installations",
  ]);
  for (const { folder, names } of contents)
    for (const name of names) {
      const stat = lstatSync(join(folder, name));
      // Recovery evidence can own displaced user bytes. Only empty namespaces
      // are disposable; retained approval reviews require an explicit decision.
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        const children = readdirSync(join(folder, name));
        if (
          ((name === "conditional" || name === "installations") &&
            children.length > 0) ||
          (name === "code-approvals" &&
            children.some((child) => child.startsWith("review-")))
        )
          throw new HistoryError("unsupported");
      }
      if (
        stat.isSymbolicLink() ||
        !(
          (files.has(name) && stat.isFile()) ||
          (name === "projection-index.json" &&
            stat.isFile() &&
            disposableProjectionIndex(join(folder, name))) ||
          (directories.has(name) && stat.isDirectory())
        )
      )
        throw new HistoryError("unsupported");
    }
  replica.fence?.close();
  replica.state.close();
  // The lock and its mutation guard belong to the lock owner until close().
  // Leave the containing directory in place so no second lock inode can appear.
  for (const { folder, names } of contents) {
    for (const name of names) {
      if (name === "lock" || name === "lock.mutation") continue;
      rmSync(join(folder, name), { recursive: true, force: true });
    }
  }
}
