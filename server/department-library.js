"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { documentInfo } = require("../src/lib/office/library-document");
const { HTML_POLICY } = require("./codex-session-assets");
const WebSocket = require("ws");
const { loadUpstreamGatewaySettings } = require("./studio-settings");

const MiB = 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const departmentId = id => id === "open-workspace" || UUID.test(id);
const route = /^\/api\/office\/department-library\/([^/]+)(?:\/([^/]+))?$/;
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const missing = () => fail(404, "Library entry unavailable.");
const invalid = () => fail(400, "Invalid library entry.");
const readFlags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;

function managedDepartments() {
  return new Promise((resolve, reject) => {
    const { url, token, adapterType } = loadUpstreamGatewaySettings();
    const endpoint = new URL(url);
    if (process.env.CLAW3D_CODEX_GATEWAY !== "1" || adapterType !== "openclaw" || !token ||
        !["ws:", "wss:"].includes(endpoint.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
      reject(new Error("Managed Office Gateway unavailable")); return;
    }
    const ws = new WebSocket(endpoint, { maxPayload: 1024 * 1024, handshakeTimeout: 4000, followRedirects: false });
    const timer = setTimeout(() => finish(new Error("Department lookup timed out")), 5000);
    let settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.terminate();
      if (error) reject(error); else resolve(result);
    }
    const send = (id, method, params = {}) => ws.send(JSON.stringify({ type: "req", id, method, params }));
    ws.once("open", () => send("1", "connect", { auth: { token } }));
    ws.on("error", finish);
    ws.on("close", () => finish(new Error("Department lookup closed")));
    ws.on("message", raw => {
      try {
        const frame = JSON.parse(raw.toString());
        if (frame.type !== "res") return;
        if (!frame.ok) return finish(new Error("Department lookup failed"));
        if (frame.id === "1" && frame.payload?.server?.version === "office-codex-1") send("2", "office.snapshot");
        else if (frame.id === "2" && Array.isArray(frame.payload?.projects)) {
          finish(null, new Set(["open-workspace", ...frame.payload.projects.map(project => project.id)]));
        } else finish(new Error("Unexpected Office Gateway response"));
      } catch (error) { finish(error); }
    });
  });
}

function directory(file, create = false) {
  if (create) fs.mkdirSync(file, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(file).isDirectory()) throw new Error("Invalid library directory");
  return file;
}
function regular(file) {
  const fd = fs.openSync(file, readFlags);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("Invalid library file");
    return { fd, size: stat.size };
  } catch (error) { fs.closeSync(fd); throw error; }
}
function displayName(value) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 240 ||
      /[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(value) ||
      Buffer.from(value).toString() !== value || [".", ".."].includes(value.trim())) invalid();
  return value.trim();
}
function externalLink(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) invalid();
  let url;
  try { url = new URL(value); } catch { invalid(); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048) invalid();
  return url.href;
}
function rowAt(folder, id) {
  const { fd, size } = regular(path.join(directory(path.join(folder, id)), "entry.json"));
  try {
    if (size > 8192) throw new Error("Oversized library record");
    const entry = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (entry.id !== id || typeof entry.createdAt !== "string") throw new Error("Invalid library record");
    const fields = { id, name: displayName(entry.name), createdAt: entry.createdAt };
    if (entry.kind === "link") return { ...fields, kind: "link", url: externalLink(entry.url) };
    if (entry.kind === "file" && Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= 20 * MiB) return { ...fields, kind: "file", size: entry.size };
    throw new Error("Invalid library record");
  } finally { fs.closeSync(fd); }
}

function createDepartmentLibrary({
  root = path.resolve(process.env.CLAW3D_DATA_DIR || path.join(os.homedir(), ".local/share/claw3d"), "department-library"),
  lookupDepartments = managedDepartments, maxFile = 20 * MiB, maxTotal = 512 * MiB, maxEntries = 1024,
} = {}) {
  let initialized = false;
  let lookup;
  let writes = 0, reserved = 0;
  function authorize(id) {
    lookup ||= Promise.resolve().then(lookupDepartments).finally(() => { lookup = undefined; });
    return lookup.then(ids => { if (!ids.has(id)) fail(404, "Department unavailable."); });
  }
  function json(res, status, body) {
    res.writeHead(status, { ...noStore, "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }
  function *folders() {
    for (const item of fs.readdirSync(root, { withFileTypes: true })) {
      if (item.isDirectory() && departmentId(item.name)) yield path.join(root, item.name);
    }
  }
  function describeFile(folder, entry) {
    if(entry.kind !== 'file')return entry;
    let file;
    try { file=regular(path.join(folder,entry.id,'content'));if(file.size!==entry.size||file.size>maxFile)return entry;
      const bytes=Buffer.alloc(Math.min(file.size,65536));fs.readSync(file.fd,bytes,0,bytes.length,0);
      return {...entry,...documentInfo(entry.name,bytes.toString('utf8'))};
    }catch{return entry;}finally{if(file)fs.closeSync(file.fd);}
  }
  function initialize() {
    directory(root, true);
    if (initialized) return;
    for (const folder of folders()) {
      for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
        if (item.isDirectory() && item.name.startsWith(".pending-") && UUID.test(item.name.slice(9))) {
          fs.rmSync(path.join(folder, item.name), { recursive: true, force: true });
        }
      }
    }
    initialized = true;
  }
  function *entries(folder) {
    try { directory(folder); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (item.isDirectory() && UUID.test(item.name)) yield rowAt(folder, item.name);
    }
  }
  async function save(req, folder, url) {
    const contentType = req.headers["content-type"];
    const isFile = contentType === "application/octet-stream";
    if (!isFile && contentType !== "application/json") fail(415, "Unsupported library upload.");
    const limit = isFile ? maxFile : 8192;
    const length = req.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) fail(413, "File or link is too large.");
    const name = isFile ? displayName(url.searchParams.get("name")) : null;
    const reservation = isFile ? Number(length ?? limit) : 0;
    if (writes >= 3) fail(429, "Library uploads are busy. Try again shortly.");
    let count = 0, occupied = 0;
    for (const department of folders()) for (const entry of entries(department)) {
      count++;
      if (entry.kind === "file") occupied += entry.size;
    }
    if (count + writes >= maxEntries || occupied + reserved + reservation > maxTotal) fail(507, "Library storage is full.");
    writes++; reserved += reservation;
    const id = randomUUID(), staging = path.join(folder, ".pending-" + id);
    let handle, created = false;
    try {
      directory(folder, true);
      fs.mkdirSync(staging, { mode: 0o700 }); created = true;
      if (isFile) handle = await fs.promises.open(path.join(staging, "content"), "wx", 0o600);
      let size = 0;
      const chunks = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > limit || (isFile && size > reservation)) fail(413, "File or link is too large.");
        if (handle) await handle.writeFile(chunk); else chunks.push(chunk);
      }
      if (!req.complete) invalid();
      if (handle) { await handle.sync(); await handle.close(); handle = null; }
      const createdAt = new Date().toISOString();
      let entry;
      if (isFile) entry = { id, name, kind: "file", size, createdAt };
      else {
        let input;
        try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { invalid(); }
        const link = externalLink(input?.url);
        entry = { id, name: displayName(input?.name || new URL(link).hostname), kind: "link", url: link, createdAt };
      }
      fs.writeFileSync(path.join(staging, "entry.json"), JSON.stringify(entry), { flag: "wx", mode: 0o600, flush: true });
      fs.renameSync(staging, path.join(folder, id));
      return describeFile(folder, entry);
    } finally {
      try {
        if (handle) await handle.close();
      } finally {
        writes--; reserved -= reservation;
        if (created) fs.rmSync(staging, { recursive: true, force: true });
      }
    }
  }
  async function serve(req, res, url, department, id) {
    if (!departmentId(department) || (id && !UUID.test(id))) missing();
    if (req.method !== "GET" && (req.method !== "POST" || id)) fail(405, "Method not allowed.");
    // Studio's proxy and access gates authenticate the request before this handler.
    // Their Origin policy rejects mismatches. The write additionally requires Origin.
    if (req.method === "POST" && !req.headers.origin) fail(403, "Library writes must come from this Office.");
    await authorize(department);
    initialize();
    const folder = path.join(root, department);
    if (req.method === "POST") return json(res, 201, { entry: await save(req, folder, url) });
    if (!id) return json(res, 200, { entries: [...entries(folder)].map(entry=>describeFile(folder,entry)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    let file, entry;
    try {
      entry = rowAt(directory(folder), id);
      if (entry.kind !== "file") missing();
      file = regular(path.join(folder, id, "content"));
    } catch (error) { if (error.code === "ENOENT" || error.code === "ELOOP") missing(); throw error; }
    if (file.size !== entry.size) { fs.closeSync(file.fd); missing(); }
    const info=describeFile(folder,entry);
    if(url.searchParams.get('format')==='json') {
      try {if(!info.previewKind)fail(415,'Preview unavailable for this file. Download it instead.');
        const bytes=await new Promise((resolve,reject)=>fs.readFile(file.fd,(error,bytes)=>error?reject(error):resolve(bytes)));if(bytes.length!==entry.size)missing();
        return json(res,200,{content:bytes.toString('utf8'),assets:[],kind:info.previewKind,title:info.title||entry.name});
      }finally{fs.closeSync(file.fd);}
    }
    if(url.searchParams.get('preview')==='1') {
      if(info.previewKind!=='html'){fs.closeSync(file.fd);fail(415,'Preview unavailable for this file.');}
      res.writeHead(200,{...noStore,'Content-Type':'text/html; charset=utf-8','Content-Length':file.size,'Content-Security-Policy':HTML_POLICY});
      await pipeline(fs.createReadStream(null,{fd:file.fd}),res);return;
    }
    const name = encodeURIComponent(entry.name).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
    res.writeHead(200, { ...noStore, "Content-Type": "application/octet-stream", "Content-Length": file.size,
      "Content-Disposition": "attachment; filename*=UTF-8''" + name, "Content-Security-Policy": "sandbox" });
    await pipeline(fs.createReadStream(null, { fd: file.fd }), res);
  }
  return (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const match = route.exec(url.pathname);
    if (!match) return false;
    void serve(req, res, url, match[1], match[2]).catch(error => {
      if (res.headersSent || res.destroyed) return;
      req.resume();
      json(res, error.status || 503, { error: error.status ? error.message : "Department library unavailable. Try again." });
    });
    return true;
  };
}

module.exports = { createDepartmentLibrary };
