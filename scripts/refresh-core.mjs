import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const source = process.argv[2];
if (!source)
  throw Error("Usage: npm run vendor:refresh -- /path/to/abele-sync");
const { core } = JSON.parse(readFileSync("compat.json", "utf8"));
mkdirSync("vendor", { recursive: true });
for (const part of ["protocol", "core", "node"]) {
  const dir = resolve(source, "packages", part);
  const manifest = JSON.parse(
    readFileSync(resolve(dir, "package.json"), "utf8"),
  );
  if (manifest.name !== "@abele/sync-" + part || manifest.version !== core)
    throw Error("Unexpected core package: " + part);
  execFileSync("npm", ["pack", dir, "--pack-destination", resolve("vendor")], {
    stdio: "inherit",
  });
}
console.log("Run npm install and npm run check:core-pin after refreshing.");
