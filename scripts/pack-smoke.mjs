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
      "const { parseKey, ItemClient, AccessClient, V2EngineClient } = await import('@abele/sync-sdk'); const core = await import('@abele/sync-sdk/core'); const { taskFromFrontmatter } = await import('@abele/sync-sdk/notes'); const { encodeAccessToken, V2ScopeItemSchema, V2SetAccessTokenSchema } = await import('@abele/sync-sdk/protocol'); const token = { v: 1, address: 'http://localhost:8787', key: 'a'.repeat(43), scope: { kind: 'folder', id: 'folder-id', path: '/' } }; if (parseKey(encodeAccessToken(token)).scope.id !== 'folder-id' || taskFromFrontmatter({ groups: ['test'] }).groups[0] !== 'test' || typeof ItemClient.fromToken !== 'function' || AccessClient !== core.AccessClient || V2EngineClient !== core.V2EngineClient || !V2ScopeItemSchema || !V2SetAccessTokenSchema) throw Error('API smoke failed'); const set = { v: 2, address: token.address, key: token.key, items: [{ id: 'item-id', kind: 'file', scope_id: 'file-id', path: 'Note.md' }] }; if (parseKey(encodeAccessToken(set)).v !== 2) throw Error('v2 payload smoke failed');",
    ],
    { cwd: scratch, stdio: "inherit" },
  );
  writeFileSync(
    resolve(scratch, "check.ts"),
    "import { ItemClient, AccessClient, type ScopeItem, type ScopeItemsResponse, type V2AccessToken, type V2Scope, type V2Selector, type V2Connection, type ConnectOptions } from '@abele/sync-sdk';\nimport { V2EngineClient, type ClientOptions } from '@abele/sync-sdk/core';\nimport { V2SetAccessTokenSchema, V2ScopeItemSchema, V2TokenItemsResponseSchema, type V2TokenItemsResponse } from '@abele/sync-sdk/protocol';\nimport '@abele/sync-sdk/notes';\nconst options: Pick<ClientOptions, 'item'> = { item: 'item-id' };\nconst connect: Pick<ConnectOptions, 'item'> = options;\nconst ownerItems: (id: string) => Promise<V2TokenItemsResponse> = ItemClient.fromToken('', { fetch }).tokenItems;\nconst accessItems: (id: string) => Promise<V2TokenItemsResponse> = AccessClient.fromToken('', { fetch }).tokenItems;\nV2TokenItemsResponseSchema.parse({ items: [] });\n",
  );
  writeFileSync(
    resolve(scratch, "preview.ts"),
    `
import { ItemClient, AccessClient } from '@abele/sync-sdk';
import { V2ItemContentPreviewSchema, V2TokenContentPreviewSchema, V2ContentPreviewQuerySchema,
  V2_PREVIEW_FILE_LIMIT, V2_PREVIEW_OVERLAP_LIMIT,
  type V2ItemContentPreview, type V2TokenContentPreview } from '@abele/sync-sdk/protocol';
const item: (id: string, item: string, options?: { limit?: number }) => Promise<V2ItemContentPreview> = ItemClient.prototype.previewTokenItem;
const token: (id: string, options?: { limit?: number }) => Promise<V2TokenContentPreview> = ItemClient.prototype.previewToken;
const coreItem: typeof item = AccessClient.prototype.previewTokenItem;
const coreToken: typeof token = AccessClient.prototype.previewToken;
`,
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
      "preview.ts",
    ],
    { cwd: scratch, stdio: "inherit" },
  );
  console.log("Packed SDK installs and import successfully.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
