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
it("folder-mirror advertises watch and rejects conflicting modes", () => {
  expect(
    execFileSync(process.execPath, ["examples/folder-mirror", "--help"], {
      encoding: "utf8",
    }),
  ).toContain("--watch");
  const result = spawnSync(
    process.execPath,
    [
      "examples/folder-mirror",
      "--key",
      "invalid",
      "--dir",
      ".",
      "--once",
      "--watch",
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Usage:");
});
