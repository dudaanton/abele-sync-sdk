import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ExternalStateError } from "@abele/sync-core";

/** Read-only refusal before Node 0.4.0 can rebuild an unrecognized cache.
 * This grants no ownership: Node must still acquire and validate its own locks,
 * directory/ledger binding and recovery evidence before doing any work.
 */
export function assertProjectionCachesSafe(
  dir: string,
  stateDir?: string,
): void {
  for (const folder of new Set([
    join(dir, ".abele-sync"),
    stateDir ?? join(dir, ".abele-sync"),
  ])) {
    const file = join(folder, "projection-index.json");
    let stat;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new ExternalStateError("recovery-required");
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !disposableProjectionIndex(file)
    )
      throw new ExternalStateError("recovery-required");
  }
}

/** Node 0.4.0's disposable scan cache; positive markers are recovery evidence. */
export function disposableProjectionIndex(file: string): boolean {
  try {
    const index = JSON.parse(readFileSync(file, "utf8"));
    return (
      index?.schema === 1 &&
      Object.keys(index).sort().join(",") === "entries,schema" &&
      Array.isArray(index.entries) &&
      index.entries.every((entry: unknown) => {
        if (entry === null || typeof entry !== "object") return false;
        const row = entry as Record<string, unknown>;
        return (
          Object.keys(row).sort().join(",") === "marker,mtime,path,size" &&
          typeof row.path === "string" &&
          row.path.length > 0 &&
          typeof row.size === "number" &&
          Number.isSafeInteger(row.size) &&
          row.size >= 0 &&
          typeof row.mtime === "number" &&
          Number.isFinite(row.mtime) &&
          row.marker === false
        );
      })
    );
  } catch {
    return false;
  }
}
