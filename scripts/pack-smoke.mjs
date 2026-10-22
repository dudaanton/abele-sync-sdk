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
      `
const sdk = await import('@abele/sync-sdk');
const core = await import('@abele/sync-sdk/core');
if (sdk.SyncCancelled !== core.SyncCancelled || !(new sdk.SyncCancelled() instanceof core.EngineError))
  throw Error('Cancellation class identity lost in packaged exports');
for (const name of ['StateTransaction', 'transact'])
  if (typeof core[name] !== 'function') throw Error('Missing scoped state export: ' + name);
`,
    ],
    { cwd: scratch, stdio: "inherit" },
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
    "import { ItemClient, AccessClient, SyncCancelled, type ScopeItem, type ScopeItemsResponse, type V2AccessToken, type V2Scope, type V2Selector, type V2Connection, type ConnectOptions } from '@abele/sync-sdk';\nimport { V2EngineClient, StateTransaction, transact, type ConditionalFileOperation, type FileVersion, type AtomicStage, type StreamingFileSystem, type StateStore, type EngineClient, type ClientOptions } from '@abele/sync-sdk/core';\nimport { V2SetAccessTokenSchema, V2ScopeItemSchema, V2TokenItemsResponseSchema, type V2TokenItemsResponse } from '@abele/sync-sdk/protocol';\nimport '@abele/sync-sdk/notes';\nconst options: Pick<ClientOptions, 'item'> = { item: 'item-id' };\nconst connect: Pick<ConnectOptions, 'item'> = options;\nconst ownerItems: (id: string) => Promise<V2TokenItemsResponse> = ItemClient.fromToken('', { fetch }).tokenItems;\nconst accessItems: (id: string) => Promise<V2TokenItemsResponse> = AccessClient.fromToken('', { fetch }).tokenItems;\nV2TokenItemsResponseSchema.parse({ items: [] });\n",
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
const { ItemClient, AbeleError, HttpError } = await import('@abele/sync-sdk');
const { encodeAccessToken, V2ItemContentPreviewSchema } = await import('@abele/sync-sdk/protocol');
if (typeof HttpError !== 'function') throw Error('Missing typed HTTP error');
const key = encodeAccessToken({ v: 1, address: 'http://localhost:8787', key: 'a'.repeat(43), scope: { kind: 'folder', id: 'root', path: '/' } });
const client = ItemClient.fromToken(key, { fetch: async () => new Response(null, { status: 403 }) });
try { await client.previewTokenItem('token', 'hidden'); throw Error('Expected refusal'); }
catch (error) { if (!(error instanceof AbeleError) || error.code !== 'forbidden' || error.status !== 403) throw error; }
const preview = V2ItemContentPreviewSchema.parse({ id: 'item', scope_id: 'scope', scope: { kind: 'group', id: 'group', path: 'G.md' }, added_at: '2026-10-21T00:00:00Z', removed_at: null, status: 'active', file_count: 1, total_bytes: 1, files: [{ file_id: 'file', path: 'G.md', bytes: 1, overlap_count: 3, overlaps: [] }] });
if (preview.files[0].overlap_count !== 3 || preview.files[0].overlaps.length !== 0) throw Error('Invalid overlap disclosure');
`,
    ],
    { cwd: scratch, stdio: "inherit" },
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
