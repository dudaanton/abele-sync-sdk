import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stateFolder, type NodeReplica } from "@abele/sync-node";

/** Stop the engine first. Retire the ledger while its device lock is still held. */
export function forgetNodeReplica(replica: NodeReplica): void {
  replica.fence?.assertOwner();
  const folder = stateFolder(replica.dir);
  const names = readdirSync(folder);
  replica.fence?.close();
  replica.state.close();
  // The lock and its mutation guard belong to the lock owner until close().
  // Leave the containing directory in place so no second lock inode can appear.
  for (const name of names) {
    if (name === "lock" || name === "lock.mutation") continue;
    rmSync(join(folder, name), { recursive: true, force: true });
  }
}
