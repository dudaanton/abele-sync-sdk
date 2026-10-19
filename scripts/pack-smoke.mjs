import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  cpSync,
} from "node:fs";
import { validatePublishedPackage } from "./check-core-pin.mjs";
import { checkBundledDist } from "./bundle-internal.mjs";
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
  const result = JSON.parse(
    run(["pack", "./packages/sdk", "--json", "--pack-destination", scratch]),
  )[0];
  for (const path of [
    "dist/index.d.ts",
    "dist/notes/index.d.ts",
    "dist/internal/core/index.js",
    "LICENSE",
    "NOTICE",
    "README.md",
  ])
    if (!result.files.some((f) => f.path === path))
      throw Error("Missing package artifact: " + path);
  writeFileSync(
    resolve(scratch, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "@abele/sync-sdk": "file:" + resolve(scratch, result.filename),
      },
    }),
  );
  run(["install", "--ignore-scripts", "--no-audit", "--no-fund"], scratch);
  const installed = resolve(scratch, "node_modules/@abele/sync-sdk");
  validatePublishedPackage(
    JSON.parse(readFileSync(resolve(installed, "package.json"), "utf8")),
  );
  checkBundledDist(resolve(installed, "dist"));
  mkdirSync(resolve(scratch, "node_modules/better-sqlite3/build/Release"), {
    recursive: true,
  });
  cpSync(
    resolve("node_modules/better-sqlite3/build/Release/better_sqlite3.node"),
    resolve(
      scratch,
      "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ),
  );
  console.log(
    "Tarball: " +
      result.entryCount +
      " files, " +
      result.size +
      " bytes packed, " +
      result.unpackedSize +
      " bytes unpacked",
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const { parseKey } = await import('@abele/sync-sdk'); const { taskFromFrontmatter } = await import('@abele/sync-sdk/notes'); const { encodeAccessToken } = await import('@abele/sync-sdk/protocol'); const token = { v: 1, address: 'http://localhost:8787', key: 'a'.repeat(43), scope: { kind: 'folder', id: 'folder-id', path: '/' } }; if (parseKey(encodeAccessToken(token)).scope.id !== 'folder-id' || taskFromFrontmatter({ groups: ['test'] }).groups[0] !== 'test') throw Error('API smoke failed');",
    ],
    { cwd: scratch, stdio: "inherit" },
  );
  writeFileSync(
    resolve(scratch, "check.ts"),
    "import '@abele/sync-sdk';\nimport '@abele/sync-sdk/notes';\n",
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
  console.log("Packed SDK installs and import successfully.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
