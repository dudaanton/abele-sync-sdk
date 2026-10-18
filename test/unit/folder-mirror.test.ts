import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";
it("folder-mirror documents its one-shot invocation", () => {
  expect(
    execFileSync(process.execPath, ["examples/folder-mirror", "--help"], {
      encoding: "utf8",
    }),
  ).toContain("--once");
});
it("folder-mirror requires all arguments before opening a client", () => {
  const result = spawnSync(
    process.execPath,
    ["examples/folder-mirror", "--once"],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--key");
});
