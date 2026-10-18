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

it.each([false, true])(
  "retires Node state while preserving locks and user files (external=%s)",
  (external) => {
    mkdirSync(resolve(".cache"), { recursive: true });
    const root = mkdtempSync(resolve(".cache/forget-"));
    try {
      const folder = join(root, ".abele-sync");
      const stateDir = external ? `${root}-state` : undefined;
      const durable = stateDir ?? folder;
      mkdirSync(folder);
      if (stateDir) mkdirSync(stateDir);
      writeFileSync(join(root, "Example.md"), "kept");
      for (const name of [
        "lock",
        "config.json",
        "state.db",
        "state.db-wal",
        "state.db-shm",
      ])
        writeFileSync(join(durable, name), "state");
      mkdirSync(join(durable, "lock.mutation"));
      mkdirSync(join(durable, "recovery"));
      writeFileSync(join(durable, "recovery", "intent"), "state");
      if (external) {
        writeFileSync(join(folder, "lock"), "local lock");
        mkdirSync(join(folder, "stages"));
        writeFileSync(join(folder, "stages", "pending"), "temporary bytes");
        writeFileSync(`${root}-sentinel`, "outside");
      }
      const closed = vi.fn(() =>
        expect(readFileSync(join(durable, "lock"), "utf8")).toBe("state"),
      );
      const owner = vi.fn();
      forgetNodeReplica({
        dir: root,
        stateDir,
        state: { close: closed },
        fence: { assertOwner: owner, close: vi.fn() },
      } as never);
      expect(owner).toHaveBeenCalledOnce();
      expect(closed).toHaveBeenCalledOnce();
      expect(readdirSync(durable).sort()).toEqual(["lock", "lock.mutation"]);
      if (external) {
        expect(readdirSync(folder)).toEqual(["lock"]);
        expect(readFileSync(`${root}-sentinel`, "utf8")).toBe("outside");
      }
      expect(readFileSync(join(root, "Example.md"), "utf8")).toBe("kept");
    } finally {
      rmSync(`${root}-state`, { recursive: true, force: true });
      rmSync(`${root}-sentinel`, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  },
);
