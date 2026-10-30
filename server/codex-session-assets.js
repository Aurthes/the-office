"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { fileURLToPath } = require("node:url");

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".md": "text/markdown", ".markdown": "text/markdown", ".html": "text/html", ".htm": "text/html" };
const MAX_BYTES = 20 * 1024 * 1024;
const HTML_POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts";
const sign = (value, key) => crypto.createHmac("sha256", key).update(value).digest("base64url");

function localPath(source, baseDir) {
  try {
    if (typeof source !== "string" || source.length > 4096 || /[\0\r\n]/.test(source)) return null;
    let value = source;
    if (value.startsWith("file://")) value = fileURLToPath(new URL(value));
    else if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
    else { try { value = decodeURIComponent(value); } catch {} }
    value = value.replace(/#.*$/, "").replace(/:\d+(?:-\d+)?$/, "");
    if (value.startsWith("~/")) value = path.join(os.homedir(), value.slice(2));
    if (!path.isAbsolute(value) && !baseDir) return null;
    return path.resolve(baseDir || "/", value);
  } catch { return null; }
}

function referenceForPath(source, { key = process.env.CLAW3D_GATEWAY_TOKEN, baseDir, label } = {}) {
  if (!key) return null;
  const requested = localPath(source, baseDir);
  if (!requested) return null;
  // Pin symlink resolution when the reference is issued, not when it is opened.
  let resolved; try { resolved = fs.realpathSync(requested); } catch { resolved = requested; }
  const mime = TYPES[path.extname(resolved).toLowerCase()];
  if (!mime) return null;
  const payload = Buffer.from(JSON.stringify({ path: resolved, mime })).toString("base64url");
  return { source, name: label || path.basename(requested), kind: mime.startsWith("image/") ? "image" : mime === "text/html" ? "html" : "markdown", url: `/api/session-assets?ref=${payload}.${sign(payload, key)}` };
}

function describeSessionAssets(text, inputs = [], options = {}) {
  const key = options.key || process.env.CLAW3D_GATEWAY_TOKEN;
  if (!key) return [];
  const assets = [], seen = new Set();
  const add = (source, extra = {}) => {
    if (seen.has(source)) return;
    const asset = referenceForPath(source, { ...options, key });
    if (asset) { seen.add(source); assets.push({ ...asset, ...extra }); }
  };
  // Both angle-bracket paths with spaces and ordinary Markdown destinations.
  for (const match of text.matchAll(/!?\[[^\[\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)) add(match[1] || match[2]);
  if (/^\s*# Files mentioned by the user:/.test(text)) {
    const nativeImages = inputs.some(input => input.type === "image" || input.type === "localImage");
    for (const match of text.matchAll(/^## [^\n]+: (\/[^\n]+)$/gm)) {
      if (nativeImages && /\.(?:png|jpe?g|gif|webp)$/i.test(match[1].trim())) continue;
      add(match[1].trim(), { attached: true });
    }
  }
  for (const [index, input] of inputs.entries()) {
    if (input.type === "localImage" && input.path) add(input.path, { inline: true });
    if (input.type !== "image" || typeof input.url !== "string") continue;
    const data = input.url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z\d+/=\r\n]+)$/);
    if (!data || data[2].length > Math.ceil(MAX_BYTES * 4 / 3) + 4) continue;
    const bytes = Buffer.from(data[2], "base64");
    if (bytes.length > MAX_BYTES) continue;
    const directory = options.cacheDir || path.join(os.homedir(), ".cache/claw3d/session-images");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const ext = data[1] === "image/jpeg" ? "jpg" : data[1].slice(6);
    const filename = path.join(directory, crypto.createHash("sha256").update(bytes).digest("hex") + "." + ext);
    try { fs.writeFileSync(filename, bytes, { mode: 0o600, flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const asset = referenceForPath(filename, { key, label: `附件 ${index + 1}.${ext}` });
    if (asset) assets.push({ ...asset, source: `attachment:${index}`, inline: true });
  }
  const bounded = []; let bytes = 0;
  for (const asset of assets.slice(0, 40)) {
    const size = Buffer.byteLength(JSON.stringify(asset));
    if (bytes + size > 32 * 1024) break;
    bounded.push(asset); bytes += size;
  }
  return bounded;
}

async function readSessionAsset(reference, key = process.env.CLAW3D_GATEWAY_TOKEN) {
  if (!key || typeof reference !== "string" || reference.length > 8192 || !/^[A-Za-z\d_-]+\.[A-Za-z\d_-]{43}$/.test(reference)) throw new Error("Invalid file reference");
  const [payload, signature] = reference.split(".");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload, key)))) throw new Error("Invalid file reference");
  const asset = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (!path.isAbsolute(asset.path) || TYPES[path.extname(asset.path).toLowerCase()] !== asset.mime) throw new Error("Unsupported file");
  if (await fsp.realpath(asset.path) !== asset.path) throw new Error("File location changed");
  const file = await fsp.open(asset.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > (asset.mime === "text/markdown" ? 1024 * 1024 : MAX_BYTES)) throw new Error("File is too large to preview");
    return { ...asset, bytes: await file.readFile() };
  } finally { await file.close(); }
}
module.exports = { referenceForPath, describeSessionAssets, readSessionAsset, HTML_POLICY };
