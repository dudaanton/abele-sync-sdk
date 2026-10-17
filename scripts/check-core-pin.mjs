import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const names = ["@abele/sync-protocol", "@abele/sync-core", "@abele/sync-node"];
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
  console.log("Core pins and lockfile match " + compat.core);
}
