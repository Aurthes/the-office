#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { Writable } = require("node:stream");

function normalizeAppId(appId) {
  appId = appId.trim();
  if (!appId) throw new Error("App ID is empty. Paste the App ID value, then press Enter.");
  if (/\s/.test(appId)) throw new Error("App ID contains spaces. Paste only the App ID value, without a label.");
  return appId;
}

function normalizeCredentials(appId, privateKey) {
  appId = normalizeAppId(appId);
  const text = privateKey.trim().replace(/\\r\\n|\\n/g, "\n");
  let key;
  try {
    if (text.startsWith("-----BEGIN")) {
      key = crypto.createPrivateKey(text);
    } else {
      const base64 = text.replace(/\s/g, "");
      if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error();
      const der = Buffer.from(base64, "base64");
      try {
        key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      } catch {
        key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs1" });
      }
    }
    if (key.asymmetricKeyType !== "rsa") throw new Error();
  } catch {
    // Crypto errors may include input details. Only show a fixed message.
    throw new Error("Invalid RSA privateKey. Use the private key, not the public key.");
  }
  return { appId, privateKey: key.export({ format: "pem", type: "pkcs8" }).toString() };
}

function credentialsPath(configRoot) {
  return path.join(configRoot, "the-office", "netease", "credentials.json");
}

function ensureDirectory(directory, restrictPermissions) {
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.uid !== process.getuid()) {
    throw new Error("Credential directories must be real directories owned by your account.");
  }
  if (restrictPermissions) fs.chmodSync(directory, 0o700);
}

function saveCredentials(configRoot, appId, privateKey) {
  const credentials = normalizeCredentials(appId, privateKey);
  ensureDirectory(configRoot, false);
  ensureDirectory(path.join(configRoot, "the-office"), true);
  const directory = path.dirname(credentialsPath(configRoot));
  ensureDirectory(directory, true);
  const temporary = path.join(directory, `.credentials-${crypto.randomUUID()}.tmp`);
  const file = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.fchmodSync(file, 0o600);
    fs.writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`);
    fs.fsyncSync(file);
    // Linking publishes the complete file atomically and never replaces an existing path.
    fs.linkSync(temporary, credentialsPath(configRoot));
  } finally {
    fs.closeSync(file);
    fs.unlinkSync(temporary);
  }
  return credentialsPath(configRoot);
}

async function main(configRoot = path.join(os.homedir(), ".config")) {
  if (process.platform === "win32") throw new Error("Run this script on macOS or Linux.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run in an interactive terminal so the private key can be entered without echo.");
  }
  try {
    fs.lstatSync(credentialsPath(configRoot));
    throw new Error("Credentials already exist. Nothing was changed; do not delete them to retry.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  process.stdout.write("Save NetEase app credentials locally. App ID is visible; privateKey is hidden. Ctrl+C cancels.\n");
  process.stdout.write("For privateKey, paste the single-line value or the complete PEM, then press Enter.\n");
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  } });
  const reader = readline.createInterface({
    input: process.stdin, output, terminal: true, historySize: 0,
  });
  // Hide immediately after Enter, even if the same paste includes more lines.
  reader.on("line", () => { hidden = true; });
  reader.on("SIGINT", () => reader.close());
  const lines = reader[Symbol.asyncIterator]();
  async function readLine(prompt, hide = true) {
    hidden = hide;
    reader.setPrompt(hide ? "" : prompt);
    if (hide) process.stdout.write(prompt); else reader.prompt();
    const { value, done } = await lines.next();
    if (hide) process.stdout.write("\n");
    if (done) throw new Error("Cancelled. No credentials were saved.");
    return value.trim();
  }
  let credentials;
  try {
    let appId;
    while (!appId) {
      const value = await readLine("appId: ", false);
      try { appId = normalizeAppId(value); }
      catch (error) { process.stdout.write(`${error.message}\nPlease try again.\n`); }
    }
    process.stdout.write(`Using App ID: ${appId}\n`);
    let privateKey = await readLine("privateKey: ");
    if (privateKey.startsWith("-----BEGIN")) {
      while (!privateKey.includes("-----END")) {
        privateKey += `\n${await readLine("")}`;
      }
    }
    credentials = { appId, privateKey };
  } finally {
    reader.close();
  }
  const saved = saveCredentials(configRoot, credentials.appId, credentials.privateKey);
  process.stdout.write(`Saved: ${saved}\nDirectory permissions: 700; file permissions: 600.\n`);
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log("Usage: node scripts/setup-netease-credentials.js\nApp ID is visible; privateKey is hidden. Do not put secrets in command arguments.");
  } else if (process.argv.length !== 2) {
    console.error("Unexpected arguments. Run with --help for usage.");
    process.exitCode = 1;
  } else {
    main().catch((error) => {
      const message = error.code === "EEXIST"
        ? "Credentials already exist. Nothing was overwritten."
        : error.code ? "Could not save credentials. Check directory ownership and write permissions."
          : error.message;
      console.error(message);
      process.exitCode = 1;
    });
  }
}

module.exports = { normalizeAppId, normalizeCredentials, saveCredentials, main };
