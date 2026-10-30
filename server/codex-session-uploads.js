"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const uploadRoot = () => {
  const root = path.resolve(process.env.CLAW3D_UPLOAD_DIR || path.join(os.homedir(), ".local/share/claw3d/uploads"));
  try { return fs.realpathSync(root); } catch { return root; }
};
const sign = (value, key) => crypto.createHmac("sha256", key).update("upload:" + value).digest("base64url");
const filename = name => path.basename(String(name || "attachment").replace(/\\/g, "/")).replace(/[\x00-\x1f\x7f<>#?:]/g, "_").replace(/^\.+/, "_").slice(0, 160) || "attachment";

async function saveUpload(request, threadId, name, { root = uploadRoot(), key = process.env.CLAW3D_GATEWAY_TOKEN } = {}) {
  if (!UUID.test(threadId) || !key) throw new Error("无效的会话");
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_UPLOAD_BYTES) throw Object.assign(new Error("每个附件最多 20 MB"), { status: 413 });
  if (!request.body) throw new Error("附件为空");
  const metadata = { threadId, id: crypto.randomUUID(), name: filename(name), size: 0 };
  const directory = path.join(root, threadId, metadata.id);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, metadata.name);
  const file = await fsp.open(target, "wx", 0o600);
  const reader = request.body.getReader();
  let prefix = Buffer.alloc(0);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      metadata.size += value.byteLength;
      if (metadata.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error("每个附件最多 20 MB"), { status: 413 });
      if (prefix.length < 16) prefix = Buffer.concat([prefix, Buffer.from(value).subarray(0, 16 - prefix.length)]);
      // FileHandle.write may write fewer bytes than supplied.
      let offset = 0;
      while (offset < value.byteLength) offset += (await file.write(value, offset, value.byteLength - offset)).bytesWritten;
    }
    if (!metadata.size) throw new Error("附件为空");
  } catch (error) {
    await reader.cancel().catch(() => {});
    await file.close(); await fsp.rm(directory, { recursive: true, force: true }); throw error;
  }
  await file.close();
  const ext = path.extname(metadata.name).toLowerCase();
  metadata.image = (ext === ".png" && prefix.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    || ([".jpg", ".jpeg"].includes(ext) && prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
    || (ext === ".gif" && /^GIF8[79]a/.test(prefix.toString("ascii")))
    || (ext === ".webp" && prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP");
  const payload = Buffer.from(JSON.stringify(metadata)).toString("base64url");
  return { name: metadata.name, size: metadata.size, image: metadata.image, ref: payload + "." + sign(payload, key) };
}

async function resolveUpload(reference, threadId, { root = uploadRoot(), key = process.env.CLAW3D_GATEWAY_TOKEN } = {}) {
  if (!key || typeof reference !== "string" || reference.length > 2048 || !/^[A-Za-z\d_-]+\.[A-Za-z\d_-]{43}$/.test(reference)) throw new Error("附件引用无效");
  const [payload, signature] = reference.split(".");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload, key)))) throw new Error("附件引用无效");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (!UUID.test(threadId) || data.threadId !== threadId || !UUID.test(data.id) || data.name !== filename(data.name)) throw new Error("附件不属于此会话");
  const target = path.join(await fsp.realpath(root), threadId, data.id, data.name);
  if (await fsp.realpath(target) !== target) throw new Error("附件位置已改变");
  const file = await fsp.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== data.size || stat.size > MAX_UPLOAD_BYTES) throw new Error("附件已改变");
  } finally { await file.close(); }
  return { ...data, path: target };
}

async function messageInput(text, references, threadId, options) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 32000) throw new Error("请发送不超过 32 KB 的文字");
  if (!Array.isArray(references) || references.length > MAX_ATTACHMENTS) throw new Error("每次最多 8 个附件");
  if (!text.trim() && !references.length) throw new Error("请先输入消息或添加附件");
  const files = await Promise.all(references.map(ref => resolveUpload(ref, threadId, options)));
  let content = text;
  if (files.length) content = "# Files mentioned by the user:\n\n" + files.map(file => "## " + file.name + ": " + file.path).join("\n\n") + "\n\n## My request for Codex:\n\n" + (text.trim() || "请查看这些附件。");
  return [{ type: "text", text: content }, ...files.filter(file => file.image).map(file => ({ type: "localImage", path: file.path }))];
}
module.exports = { saveUpload, resolveUpload, messageInput, uploadRoot, MAX_UPLOAD_BYTES, MAX_ATTACHMENTS };
