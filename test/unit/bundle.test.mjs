import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteSpecifiers } from "../../scripts/bundle-internal.mjs";
import { validatePublishedPackage } from "../../scripts/check-core-pin.mjs";

test("rejects internal dependencies in every published dependency section", () => {
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ])
    assert.throws(() =>
      validatePublishedPackage({ [section]: { "@abele/notes": "0.1.0" } }),
    );
  assert.doesNotThrow(() =>
    validatePublishedPackage({ dependencies: { zod: "3.25.76" } }),
  );
});

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
