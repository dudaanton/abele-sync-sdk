import { expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { forgetNodeReplica } from "../../packages/sdk/src/historyNode.js";
import { inspectProjectionInventory, SqliteStateStore } from "@abele/sync-node";

it.each(["conditional", "installations", "code-approvals"])(
  "preserves outstanding %s evidence during disconnect",
  (namespace) => {
    mkdirSync(resolve(".cache"), { recursive: true });
    const root = mkdtempSync(resolve(".cache/evidence-"));
    const local = join(root, ".abele-sync");
    const evidence = join(
      local,
      namespace,
      namespace === "code-approvals" ? "review-group-a-123" : "pending",
    );
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, "data"), "preserved bytes");
    const state = { close: vi.fn() };
    try {
      expect(() => forgetNodeReplica({ dir: root, state } as never)).toThrow();
      expect(state.close).not.toHaveBeenCalled();
      expect(readFileSync(join(evidence, "data"), "utf8")).toBe(
        "preserved bytes",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("disconnect accepts empty conditional recovery namespaces", () => {
  mkdirSync(resolve(".cache"), { recursive: true });
  const root = mkdtempSync(resolve(".cache/empty-evidence-"));
  const local = join(root, ".abele-sync");
  for (const name of ["conditional", "installations"])
    mkdirSync(join(local, name), { recursive: true });
  const state = { close: vi.fn() };
  try {
    forgetNodeReplica({ dir: root, state } as never);
    expect(state.close).toHaveBeenCalledOnce();
    expect(readdirSync(local)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "retires the real Node projection cache after a pull (external=%s)",
  async (external) => {
    mkdirSync(resolve(".cache"), { recursive: true });
    const root = mkdtempSync(resolve(".cache/post-pull-"));
    const dir = join(root, "files"),
      local = join(dir, ".abele-sync");
    const stateDir = external ? join(root, "state") : undefined;
    const durable = stateDir ?? local;
    mkdirSync(local, { recursive: true });
    mkdirSync(durable, { recursive: true });
    const state = SqliteStateStore.open(join(durable, "state.db"));
    try {
      writeFileSync(join(dir, "Example.md"), "remote example\n");
      writeFileSync(join(durable, "lock"), "owned lock");
      writeFileSync(join(root, "sibling.txt"), "untouched");
      await inspectProjectionInventory(dir, { stateDir });
      const index = JSON.parse(
        readFileSync(join(durable, "projection-index.json"), "utf8"),
      );
      expect(index.entries).toEqual([
        expect.objectContaining({ path: "Example.md", marker: false }),
      ]);
      forgetNodeReplica({
        dir,
        stateDir,
        state,
        fence: { assertOwner() {}, close() {} },
      } as never);
      expect(readdirSync(durable)).toEqual(["lock"]);
      expect(readFileSync(join(dir, "Example.md"), "utf8")).toBe(
        "remote example\n",
      );
      expect(readFileSync(join(root, "sibling.txt"), "utf8")).toBe("untouched");
    } finally {
      state.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.each(["malformed", "marker", "unrelated", "directory", "symlink"])(
  "preserves unowned projection cache evidence before mutation (%s)",
  (kind) => {
    mkdirSync(resolve(".cache"), { recursive: true });
    const root = mkdtempSync(resolve(".cache/projection-refusal-"));
    try {
      const dir = join(root, "files"),
        stateDir = join(root, "state");
      mkdirSync(join(dir, ".abele-sync"), { recursive: true });
      mkdirSync(stateDir);
      const file = join(stateDir, "projection-index.json");
      const bytes =
        kind === "malformed"
          ? "broken"
          : JSON.stringify(
              kind === "unrelated"
                ? { user: "data" }
                : {
                    schema: 1,
                    entries: [
                      { path: "Example.md", size: 1, mtime: 1, marker: true },
                    ],
                  },
            );
      if (kind === "directory") {
        mkdirSync(file);
        writeFileSync(join(file, "keep.txt"), "keep");
      } else if (kind === "symlink") {
        writeFileSync(join(root, "target.json"), bytes);
        symlinkSync(join(root, "target.json"), file);
      } else writeFileSync(file, bytes);
      writeFileSync(join(stateDir, "config.json"), "credentials");
      const close = vi.fn();
      expect(() =>
        forgetNodeReplica({
          dir,
          stateDir,
          state: { close },
          fence: { assertOwner() {}, close },
        } as never),
      ).toThrow();
      expect(close).not.toHaveBeenCalled();
      if (kind === "symlink")
        expect(lstatSync(file).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(stateDir, "config.json"), "utf8")).toBe(
        "credentials",
      );
      expect(
        readFileSync(
          kind === "directory" ? join(file, "keep.txt") : file,
          "utf8",
        ),
      ).toBe(kind === "directory" ? "keep" : bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

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
      mkdirSync(join(folder, "recovery"));
      writeFileSync(join(folder, "recovery", "intent"), "state");
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

it.each(["ancestor", "unrelated", "reserved-directory"])(
  "refuses unsafe state ownership before mutation (%s)",
  (placement) => {
    mkdirSync(resolve(".cache"), { recursive: true });
    const root = mkdtempSync(resolve(".cache/ownership-"));
    try {
      const dir = join(root, "files");
      const stateDir = placement === "ancestor" ? root : join(root, "state");
      mkdirSync(dir);
      mkdirSync(join(dir, ".abele-sync"));
      if (stateDir !== root) mkdirSync(stateDir);
      writeFileSync(join(dir, "Example.md"), "user data");
      const saved =
        placement === "reserved-directory"
          ? join(stateDir, "recovery", "keep.txt")
          : join(stateDir, "keep.txt");
      if (placement === "reserved-directory")
        mkdirSync(join(stateDir, "recovery"));
      writeFileSync(saved, "unrelated");
      writeFileSync(join(stateDir, "config.json"), "credentials");
      const close = vi.fn();
      expect(() =>
        forgetNodeReplica({
          dir,
          stateDir,
          state: { close },
          fence: { assertOwner() {}, close },
        } as never),
      ).toThrow();
      expect(close).not.toHaveBeenCalled();
      expect(readFileSync(join(dir, "Example.md"), "utf8")).toBe("user data");
      expect(readFileSync(saved, "utf8")).toBe("unrelated");
      expect(readFileSync(join(stateDir, "config.json"), "utf8")).toBe(
        "credentials",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
