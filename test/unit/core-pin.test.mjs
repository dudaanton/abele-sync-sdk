import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCorePins } from "../../scripts/check-core-pin.mjs";
const names = ["@abele/sync-protocol", "@abele/sync-core", "@abele/sync-node"];
const fixture = () => ({
  compat: { core: "0.3.3" },
  manifests: [
    { dependencies: Object.fromEntries(names.map((n) => [n, "0.3.3"])) },
  ],
  lock: {
    packages: Object.fromEntries(
      names.map((n) => [`node_modules/${n}`, { version: "0.3.3" }]),
    ),
  },
});
test("accepts exact pins", () =>
  assert.doesNotThrow(() => validateCorePins(fixture())));
test("rejects ranges and mismatches", () => {
  for (const v of ["^0.3.3", "~0.3.3", "0.3.4"]) {
    const f = fixture();
    f.manifests[0].dependencies[names[0]] = v;
    assert.throws(() => validateCorePins(f));
  }
});
test("rejects duplicates", () => {
  const f = fixture();
  f.lock.packages[`packages/sdk/node_modules/${names[0]}`] = {
    version: "0.3.3",
  };
  assert.throws(() => validateCorePins(f));
});
test("rejects missing resolutions", () => {
  const f = fixture();
  delete f.lock.packages[`node_modules/${names[0]}`];
  assert.throws(() => validateCorePins(f));
});
test("accepts versioned local tarballs", () => {
  const f = fixture();
  f.manifests[0].name = "@abele/sync-sdk";
  for (const name of names)
    f.manifests[0].dependencies[name] =
      `file:../../vendor/${name.slice(1).replace("/", "-")}-0.3.3.tgz`;
  assert.doesNotThrow(() => validateCorePins(f));
});
test("rejects mismatched lock versions", () => {
  const f = fixture();
  f.lock.packages[`node_modules/${names[0]}`].version = "0.3.4";
  assert.throws(() => validateCorePins(f));
});
