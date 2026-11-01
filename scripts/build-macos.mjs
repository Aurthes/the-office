#!/usr/bin/env node
// Build a self-contained browser-based Office app, without Electron or an App checkout.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const runtime = JSON.parse(fs.readFileSync(path.join(root, "desktop/node-runtime.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const out = path.resolve(option("--out") || path.join(root, "dist-macos"));
const identity = process.env.OFFICE_MAC_SIGN_IDENTITY;
const notaryProfile = process.env.OFFICE_MAC_NOTARY_PROFILE;
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`);
}
function copy(from, to) { fs.cpSync(path.join(root, from), to, { recursive: true, dereference: false }); }
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
async function nodeArchive() {
  const filename = `node-v${runtime.version}-darwin-${process.arch}.tar.gz`;
  const cache = path.join(os.homedir(), ".cache/the-office-build"); fs.mkdirSync(cache, { recursive: true });
  const file = path.join(cache, filename);
  if (fs.existsSync(file) && hash(file) === runtime.sha256[process.arch]) return file;
  const response = await fetch(`https://nodejs.org/dist/v${runtime.version}/${filename}`);
  if (!response.ok) throw new Error(`Node runtime download failed (${response.status})`);
  const temporary = file + ".tmp";
  try {
    fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
    if (hash(temporary) !== runtime.sha256[process.arch]) throw new Error("Node runtime checksum mismatch");
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
  return file;
}
function nativeFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...nativeFiles(file));
    else if (entry.isFile()) {
      const fd = fs.openSync(file, "r"), header = Buffer.alloc(4);
      try { if (fs.readSync(fd, header, 0, 4, 0) === 4 && ["cffaedfe", "cefaedfe", "cafebabe", "bebafeca"].includes(header.toString("hex"))) result.push(file); }
      finally { fs.closeSync(fd); }
    }
  }
  return result;
}
function sign(file, runtimeCode = false) {
  const options = ["--force", "--sign", identity || "-"];
  if (identity) options.push("--options", "runtime", "--timestamp");
  if (runtimeCode) options.push("--entitlements", path.join(root, "desktop/runtime-entitlements.plist"));
  run("/usr/bin/codesign", [...options, file]);
}

async function main() {
  if (process.platform !== "darwin" || !runtime.sha256[process.arch]) throw new Error("Build on an Apple Silicon or Intel Mac matching the target architecture.");
  if (notaryProfile && !identity) throw new Error("Notarization requires OFFICE_MAC_SIGN_IDENTITY as well as OFFICE_MAC_NOTARY_PROFILE.");
  fs.mkdirSync(out, { recursive: true });
  const name = `The-Office-${pkg.version}-macOS-${process.arch}`;
  const application = path.join(out, "The Office.app"), image = path.join(out, name + ".dmg");
  if (fs.existsSync(application) || fs.existsSync(image)) throw new Error("Output already exists. Choose a new --out directory; never build over a running application.");
  const scratch = fs.mkdtempSync(path.join(out, ".package-"));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NEXT_PUBLIC_")));
    Object.assign(env, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", CLAW3D_OFFICE_DESKTOP: "1", NEXT_PUBLIC_CLAW3D_SESSION_VIEW: "1", NEXT_PUBLIC_CLAW3D_WEB_ACCESS: "0" });
    run("npm", ["run", "build"], root, env);
    const contents = path.join(application, "Contents"), resources = path.join(contents, "Resources"), office = path.join(resources, "office"), executables = path.join(contents, "MacOS");
    fs.mkdirSync(executables, { recursive: true }); fs.mkdirSync(office, { recursive: true });
    for (const file of ["package.json", "package-lock.json", "server", "public", "LICENSE", "THIRD_PARTY_NOTICES.md", "licenses"]) copy(file, path.join(office, file));
    // The gateway and browser share this plain-JS message wrapper parser.
    fs.mkdirSync(path.join(office, "src/lib/text"), { recursive: true });
    copy("src/lib/text/codex-visible-text.js", path.join(office, "src/lib/text/codex-visible-text.js"));
    fs.cpSync(path.join(root, ".next"), path.join(office, ".next"), { recursive: true, filter: source => source !== path.join(root, ".next/cache") && source !== path.join(root, ".next/dev") });
    fs.mkdirSync(path.join(office, "desktop")); copy("desktop/launcher.cjs", path.join(office, "desktop/launcher.cjs"));
    // Ship executable JS configuration, so first run never installs TypeScript.
    const { transpileModule, ModuleKind } = require("typescript");
    fs.writeFileSync(path.join(office, "next.config.js"), transpileModule(fs.readFileSync(path.join(root, "next.config.ts"), "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], office, { ...process.env, NODE_ENV: "production" });
    // This is a runtime payload, not a publishable or development checkout.
    fs.rmSync(path.join(office, "package-lock.json"));
    fs.mkdirSync(path.join(resources, "node"));
    run("/usr/bin/tar", ["-xzf", await nodeArchive(), "--strip-components=1", "-C", path.join(resources, "node")]);
    // npm and headers are build tools, not required by the installed application.
    for (const entry of ["include", "share", "lib", "bin/npm", "bin/npx", "bin/corepack"]) fs.rmSync(path.join(resources, "node", entry), { recursive: true, force: true });
    run("/usr/bin/xcrun", ["swiftc", "-O", "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx13.5`, path.join(root, "desktop/Office.swift"), "-o", path.join(executables, "The Office")]);
    const plist = { CFBundleName: "The Office", CFBundleDisplayName: "The Office", CFBundleIdentifier: "com.theoffice.desktop", CFBundleExecutable: "The Office", CFBundlePackageType: "APPL", CFBundleShortVersionString: pkg.version, CFBundleVersion: pkg.version, LSMinimumSystemVersion: "13.5", NSHighResolutionCapable: true, NSMicrophoneUsageDescription: "Office opens supported voice calls in your browser, which asks for microphone access." };
    const info = path.join(contents, "Info.plist"); fs.writeFileSync(info, JSON.stringify(plist));
    run("/usr/bin/plutil", ["-convert", "xml1", info]);
    for (const file of nativeFiles(resources)) sign(file, true);
    sign(path.join(executables, "The Office")); sign(application);
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", application]);
    const imageRoot = path.join(scratch, "image"); fs.mkdirSync(imageRoot);
    // Move the finished bundle into the image source, avoiding a second runtime copy.
    fs.renameSync(application, path.join(imageRoot, "The Office.app"));
    fs.symlinkSync("/Applications", path.join(imageRoot, "Applications"));
    fs.writeFileSync(path.join(imageRoot, "Read me.txt"), "The Office\n\nDrag The Office to Applications, then open it.\nSign in with ChatGPT and choose an existing working folder.\nNode.js and Codex are included; no terminal or gateway configuration is needed.\nYour Office account and conversations stay separate from the native Codex App.\n" + (identity ? "" : "\nDeveloper preview: this build has no Developer ID signature or Apple notarization. macOS may block downloaded copies.\n"));
    try { run("/usr/bin/hdiutil", ["create", "-volname", "The Office", "-srcfolder", imageRoot, "-format", "UDZO", image]); }
    finally { fs.renameSync(path.join(imageRoot, "The Office.app"), application); }
    if (identity) run("/usr/bin/codesign", ["--force", "--sign", identity, "--timestamp", image]);
    if (notaryProfile) {
      run("/usr/bin/xcrun", ["notarytool", "submit", image, "--keychain-profile", notaryProfile, "--wait"]);
      run("/usr/bin/xcrun", ["stapler", "staple", image]);
    }
    const metadata = { version: pkg.version, architecture: process.arch, node: runtime.version, codex: pkg.dependencies["@openai/codex"], signed: Boolean(identity), notarized: Boolean(notaryProfile), image: path.basename(image), sha256: hash(image) };
    fs.writeFileSync(path.join(out, "build-info.json"), JSON.stringify(metadata, null, 2) + "\n");
    console.log(JSON.stringify({ ...metadata, application, image }));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
