import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { checkBundledDist } from "./bundle-internal.mjs";
export function validatePublishedPackage(manifest) {
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ])
    if (
      Object.keys(manifest[section] ?? {}).some((name) =>
        name.startsWith("@abele/"),
      )
    )
      throw Error("Published package must not depend on @abele packages");
}
const names = ["@abele/sync-protocol", "@abele/sync-core", "@abele/sync-node"];
export function validateCorePackages(version, packages) {
  if (packages.length !== names.length)
    throw Error("Expected three core packages");
  for (const [index, manifest] of packages.entries()) {
    if (manifest.name !== names[index] || manifest.version !== version)
      throw Error("Unexpected packed core package: " + names[index]);
    for (const name of names) {
      const pin = manifest.dependencies?.[name];
      if (pin !== undefined && pin !== version)
        throw Error("Invalid packed dependency: " + name);
    }
  }
}
export function validateCorePins({ compat, manifests, lock }) {
  if (!/^\d+\.\d+\.\d+$/.test(compat.core)) throw Error("Invalid core version");
  for (const name of names) {
    let seen = false;
    for (const manifest of manifests) {
      for (const section of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
        "overrides",
      ]) {
        const pin = manifest[section]?.[name];
        if (pin === undefined) continue;
        seen = true;
        const tarball =
          "file:" +
          (manifest.name === "@abele/sync-sdk" ? "../../" : "") +
          "vendor/" +
          name.slice(1).replace("/", "-") +
          "-" +
          compat.core +
          ".tgz";
        if (pin !== compat.core && pin !== tarball)
          throw Error("Invalid pin for " + name + ": " + pin);
      }
    }
    if (!seen) throw Error("Missing pin for " + name);
    const resolutions = Object.entries(lock.packages ?? {}).filter(([p]) =>
      p.endsWith("node_modules/" + name),
    );
    if (resolutions.length !== 1 || resolutions[0][1].version !== compat.core)
      throw Error("Expected one matching resolution for " + name);
    const entry = resolutions[0][1];
    if (
      entry.resolved?.startsWith("file:") &&
      !entry.resolved.endsWith(
        "/" + name.slice(1).replace("/", "-") + "-" + compat.core + ".tgz",
      )
    )
      throw Error("Wrong tarball for " + name);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  const compat = read("compat.json");
  const manifests = [
    "package.json",
    "packages/sdk/package.json",
    "packages/notes/package.json",
  ].map(read);
  if (manifests.slice(1).some((m) => m.version !== compat.sdk))
    throw Error("SDK versions differ from compat.json");
  validateCorePins({ compat, manifests, lock: read("package-lock.json") });
  validatePublishedPackage(manifests[1]);
  if (manifests[2].private !== true) throw Error("Notes must remain private");
  checkBundledDist("packages/sdk/dist");
  validateCorePackages(
    compat.core,
    names.map((name) =>
      JSON.parse(
        execFileSync(
          "tar",
          [
            "-xOf",
            "vendor/" +
              name.slice(1).replace("/", "-") +
              "-" +
              compat.core +
              ".tgz",
            "package/package.json",
          ],
          { encoding: "utf8" },
        ),
      ),
    ),
  );
  console.log("Core pins and lockfile match " + compat.core);
}
