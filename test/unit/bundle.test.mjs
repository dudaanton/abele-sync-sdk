import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteSpecifiers } from "../../scripts/bundle-internal.mjs";

test("rewrites root, deep, dynamic and declaration specifiers relative to each file", () => {
  const source =
    'import("@abele/sync-core"); export * from "@abele/sync-protocol/schema.js"; declare module "@abele/notes" {}';
  assert.equal(
    rewriteSpecifiers(
      source,
      "/pkg/dist/internal/node/nested/file.d.ts",
      "/pkg/dist",
    ),
    'import("../../core/index.js"); export * from "../../protocol/schema.js"; declare module "../../../notes/index.js" {}',
  );
});
