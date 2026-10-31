import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const artifacts = path.join(repository, "build", "office-light");
const output = path.join(artifacts, "plugin");
await fs.mkdir(output, { recursive: true });
const browserOptions = {
  bundle: true, write: false, format: "iife", platform: "browser",
  target: "es2022", minify: true, legalComments: "inline",
  nodePaths: [path.join(directory, "node_modules")],
  alias: { "@": path.join(repository, "src") },
};
const browser = await build({ ...browserOptions, entryPoints: [path.join(directory, "src/app.js")] });
const template = await fs.readFile(path.join(directory, "src/panel.html"), "utf8");
// A replacement callback preserves literal dollar signs inside bundled code.
const html = template.replace("/* OFFICE_LIGHT_BUNDLE */", () => browser.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
await fs.writeFile(path.join(output, "panel.html"), html);
await build({
  entryPoints: [path.join(directory, "src/server.mjs")], bundle: true,
  outfile: path.join(output, "server.mjs"), format: "esm", platform: "node",
  target: "node20", minify: true, legalComments: "inline",
  banner: { js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
await fs.chmod(path.join(output, "server.mjs"), 0o755);
for (const name of ["plugin.json", "mcp.json"]) await fs.copyFile(path.join(directory, name), path.join(output, name));
await fs.copyFile(path.join(repository, "LICENSE"), path.join(output, "LICENSE"));
let notices = "The Office — third-party dependency licenses\n\n";
for (const name of ["three", "@modelcontextprotocol/ext-apps", "@modelcontextprotocol/sdk", "zod"]) {
  const folder = path.join(directory, "node_modules", name);
  const candidates = ["LICENSE", "LICENSE.txt", "LICENSE.md"];
  let license;
  for (const name of candidates) {
    try { license = await fs.readFile(path.join(folder, name), "utf8"); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!license) throw new Error("Missing dependency license: " + name);
  notices += name + "\n" + license + "\n\n";
}
await fs.writeFile(path.join(output, "THIRD_PARTY_LICENSES.txt"), notices);
const host = await build({ ...browserOptions, entryPoints: [path.join(directory, "scripts/preview-host.js")] });
await fs.writeFile(path.join(artifacts, "preview-host.js"), host.outputFiles[0].text);
console.log("Built standalone plugin: " + output + " (" + Buffer.byteLength(html) + " bytes of self-contained UI)");
