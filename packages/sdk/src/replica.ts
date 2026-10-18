import type { FileSystem, StateStore } from "@abele/sync-core";

export interface ReplicaEntry {
  path: string;
  size: number;
  mtime: number;
  fileId?: string;
}
export interface Replica {
  list(prefix?: string): Promise<ReplicaEntry[]>;
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
}
function validate(path: string, prefix = false): void {
  const parts = (prefix && path.endsWith("/") ? path.slice(0, -1) : path).split(
    "/",
  );
  if (
    (path === "" && !prefix) ||
    /[\\:\0]/.test(path) ||
    (path !== "" &&
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.toLowerCase() === ".abele-sync",
      ))
  )
    throw new TypeError("Invalid replica path");
}
export function createReplica(
  files: FileSystem,
  state: StateStore,
  assertOpen: () => void,
): Replica {
  const read = async (path: string) => {
    assertOpen();
    validate(path);
    return files.read(path);
  };
  return {
    async list(prefix = "") {
      assertOpen();
      validate(prefix, true);
      const entries: ReplicaEntry[] = [];
      for await (const entry of files.list()) {
        try {
          validate(entry.path);
        } catch {
          continue;
        }
        if (!entry.path.startsWith(prefix)) continue;
        const known = await state.get(entry.path);
        entries.push({
          path: entry.path,
          size: entry.size,
          mtime: entry.mtime,
          ...(known ? { fileId: known.fileId } : {}),
        });
      }
      return entries.sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      );
    },
    read,
    async readText(path) {
      return new TextDecoder().decode(await read(path));
    },
  };
}
