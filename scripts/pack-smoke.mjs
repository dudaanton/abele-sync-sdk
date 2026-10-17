import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
mkdirSync(".cache", { recursive: true });
const scratch = mkdtempSync(resolve(".cache/smoke-"));
const run = (args, cwd = process.cwd()) =>
  execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: resolve(".cache/npm") },
  });
try {
  const dependencies = {};
  for (const part of ["sdk", "notes"]) {
    const result = JSON.parse(
      run([
        "pack",
        "./packages/" + part,
        "--json",
        "--pack-destination",
        scratch,
      ]),
    )[0];
    if (
      !result.files.some((f) => f.path === "dist/index.d.ts") ||
      !result.files.some((f) => f.path === "LICENSE")
    )
      throw Error("Missing package artifacts");
    dependencies[part === "sdk" ? "@abele/sync-sdk" : "@abele/notes"] =
      "file:" + resolve(scratch, result.filename);
  }
  const overrides = {};
  const { core } = JSON.parse(readFileSync("compat.json", "utf8"));
  for (const part of ["protocol", "core", "node"]) {
    const name = "@abele/sync-" + part;
    overrides[name] =
      "file:" + resolve("vendor/abele-sync-" + part + "-" + core + ".tgz");
    dependencies[name] = overrides[name];
  }
  writeFileSync(
    resolve(scratch, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies, overrides }),
  );
  run(["install", "--no-audit", "--no-fund"], scratch);
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('@abele/sync-sdk'); await import('@abele/notes'); await import('@abele/sync-core'); await import('@abele/sync-node');",
    ],
    { cwd: scratch, stdio: "inherit" },
  );
  writeFileSync(
    resolve(scratch, "check.ts"),
    "import '@abele/sync-sdk';\nimport '@abele/notes';\n",
  );
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--module",
      "NodeNext",
      "--target",
      "ES2022",
      "check.ts",
    ],
    { cwd: scratch, stdio: "inherit" },
  );
  console.log("Packed packages install and import successfully.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
