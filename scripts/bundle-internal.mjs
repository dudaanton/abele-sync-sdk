import {
  cpSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const targets = {
  "@abele/sync-protocol": "internal/protocol",
  "@abele/sync-core": "internal/core",
  "@abele/sync-node": "internal/node",
  "@abele/notes": "notes",
};
export function rewriteSpecifiers(source, file, dist) {
  return source.replace(
    /(["'])\x40abele\/(sync-protocol|sync-core|sync-node|notes)(\/[^"']*)?\1/g,
    (_, quote, name, deep) => {
      const target = resolve(
        dist,
        targets["@abele/" + name],
        deep ? deep.slice(1) : "index.js",
      );
      let path = relative(dirname(file), target).split("\\").join("/");
      if (!path.startsWith(".")) path = "./" + path;
      return quote + path + quote;
    },
  );
}
export function checkBundledDist(dist) {
  for (const entry of readdirSync(dist, { withFileTypes: true })) {
    const file = resolve(dist, entry.name);
    if (entry.isDirectory()) checkBundledDist(file);
    else if (
      /\.(js|d\.ts)$/.test(file) &&
      /@abele\/(?:sync-protocol|sync-core|sync-node|notes)(?=[/"'])/.test(
        readFileSync(file, "utf8"),
      )
    )
      throw Error("Unbundled specifier in " + file);
  }
}
export function bundleInternal() {
  process.chdir(fileURLToPath(new URL("../", import.meta.url)));
  const dist = resolve("packages/sdk/dist");
  for (const [name, target] of Object.entries(targets)) {
    const source =
      name === "@abele/notes" ? "packages/notes" : "node_modules/" + name;
    const destination = resolve(dist, target);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source + "/dist", destination, {
      recursive: true,
      filter: (file) => !file.endsWith(".map"),
    });
    cpSync(source + "/LICENSE", destination + "/LICENSE");
  }
  function rewrite(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) rewrite(file);
      else if (/\.(js|d\.ts)$/.test(file)) {
        const source = readFileSync(file, "utf8").replace(
          /^\/\/# sourceMappingURL=.*$/gm,
          "",
        );
        writeFileSync(file, rewriteSpecifiers(source, file, dist));
      }
    }
  }
  rewrite(dist);
  checkBundledDist(dist);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  bundleInternal();
