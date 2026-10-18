import { expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { forgetNodeReplica } from "../../packages/sdk/src/historyNode.js";

it("retires Node state while preserving the lock inode and user files", () => {
  mkdirSync(resolve(".cache"), { recursive: true });
  const root = mkdtempSync(resolve(".cache/forget-"));
  try {
    const folder = join(root, ".abele-sync");
    mkdirSync(folder);
    writeFileSync(join(root, "Example.md"), "kept");
    for (const name of [
      "lock",
      "config.json",
      "state.db",
      "state.db-wal",
      "state.db-shm",
    ])
      writeFileSync(join(folder, name), "state");
    const closed = vi.fn(() =>
      expect(readFileSync(join(folder, "lock"), "utf8")).toBe("state"),
    );
    const owner = vi.fn();
    forgetNodeReplica({
      dir: root,
      state: { close: closed },
      fence: { assertOwner: owner, close: vi.fn() },
    } as never);
    expect(owner).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(readdirSync(folder)).toEqual(["lock"]);
    expect(readFileSync(join(root, "Example.md"), "utf8")).toBe("kept");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
