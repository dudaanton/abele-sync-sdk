import { readFileSync } from "node:fs";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const compat = read("compat.json");
if (process.env.GITHUB_REF_NAME !== "v" + compat.sdk)
  throw Error("Tag must match compat.sdk");
for (const part of ["sdk", "notes"]) {
  const manifest = read("packages/" + part + "/package.json");
  if (manifest.version !== compat.sdk) throw Error("Package version mismatch");
  for (const pin of Object.values(manifest.dependencies ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(pin))
      throw Error(
        "Release requires exact registry versions; replace temporary file pins first",
      );
  }
}
