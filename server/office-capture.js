"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { saveUpload, MAX_UPLOAD_BYTES } = require("./codex-session-uploads");
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const png = Buffer.from([137,80,78,71,13,10,26,10]);

class OfficeCapture {
  constructor({ stream, store, controls, directory, uploadOptions, ttl = 5 * 60000, ackTimeout = 8000 }) {
    Object.assign(this, { stream, store, controls, directory, uploadOptions, ttl, ackTimeout });
    this.epoch = crypto.randomUUID(); this.key = crypto.randomBytes(32).toString("base64url"); this.requests = new Map(); this.binding = null;
  }
  configure(port) {
    this.port = port;
    if ((fs.statSync(this.directory).mode & 0o077) !== 0) throw new Error("Capture client directory must be private (0700)");
    const file = path.join(this.directory, "capture-client.json"), temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, url: `http://127.0.0.1:${port}`, key: this.key }) + "\n", { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  emit(event, entry) {
    const b = this.binding;
    if (!b || b.generation !== entry.bindingGeneration || b.pageId !== entry.pageId || b.ws?.readyState !== 1) return;
    try { b.ws.send(JSON.stringify({ type: "event", event, payload: { requestId: entry.id, pageId: entry.pageId, bindingGeneration: entry.bindingGeneration,
      bootEpoch: this.epoch, threadId: entry.threadId, subscriptionId: entry.subscriptionId, expiresAt: entry.expiresAt,
      ...(entry.upload || {}), ...(entry.error ? { error: entry.error } : {}) } })); }
    catch { b.ws = null; return; }
    entry.notifiedAt = Date.now();
  }
  reject(entry, message) {
    if (["delivered", "failed", "cancelled"].includes(entry.state)) return;
    entry.state = "failed"; entry.error = message; clearTimeout(entry.timer); entry.reject?.(fail(message)); entry.reject = null;
    this.emit("session.capture.failed", entry);
  }
  bind(ws, p) {
    if (!UUID.test(p.pageId)) throw fail("Invalid capture page", 400);
    if (this.binding?.ws === ws && this.binding.pageId === p.pageId) return this.credentials();
    if (this.binding && p.replace !== true) return { conflict: true };
    if (this.binding) {
      for (const entry of this.requests.values()) this.reject(entry, "Screenshot recipient was replaced");
      this.binding.ws?.send(JSON.stringify({ type: "event", event: "session.capture.unbound", payload: { pageId: this.binding.pageId } }));
    }
    this.binding = { ws, pageId: p.pageId, generation: crypto.randomUUID(), proof: crypto.randomBytes(32).toString("base64url") };
    return this.credentials();
  }
  credentials() { const b = this.binding; return { pageId: b.pageId, bindingGeneration: b.generation, resumeProof: b.proof, bootEpoch: this.epoch }; }
  resume(ws, p) {
    this.prune();
    const b = this.binding;
    if (!b || p.pageId !== b.pageId || p.resumeProof !== b.proof || p.bootEpoch !== this.epoch) throw fail("Screenshot page binding expired; bind this page again");
    if (b.ws && b.ws !== ws && b.ws.readyState === 1) throw fail("Screenshot page is already connected on another socket");
    b.ws = ws;
    // Defer until the resume receipt is sent, just as stream bootstrap does.
    setImmediate(() => { for (const e of this.requests.values()) if (e.state === "uploaded") this.deliver(e); else if (e.state === "failed") this.emit("session.capture.failed", e); });
    return this.credentials();
  }
  disconnected(ws) { if (this.binding?.ws === ws) this.binding.ws = null; }
  eligible(threadId) {
    this.store.get(threadId);
    const state = this.controls.state(threadId);
    if (state.editCommit || state.editUncertain) throw fail("Conversation is editing or needs reconciliation");
  }
  prune() {
    for (const [id, entry] of this.requests) if (entry.expiresAt <= Date.now()) { this.reject(entry, "Screenshot handoff expired"); this.requests.delete(id); }
  }
  async begin(id) {
    if (!UUID.test(id)) throw fail("Invalid capture request ID", 400);
    this.prune();
    const previous = this.requests.get(id);
    if (previous) { await previous.prepared; return this.status(id); }
    if (this.requests.size >= 64) throw fail("Too many pending screenshot requests", 429);
    const b = this.binding, selected = b?.ws && this.stream.subscriptions.get(b.ws);
    if (!b || b.ws?.readyState !== 1 || !selected?.ready) throw fail("No connected screenshot page with an open conversation");
    this.eligible(selected.threadId);
    const entry = { id, pageId: b.pageId, bindingGeneration: b.generation, threadId: selected.threadId, subscriptionId: selected.subscriptionId,
      state: "preparing", expiresAt: Date.now() + this.ttl };
    entry.prepared = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    entry.timer = setTimeout(() => this.reject(entry, "The screenshot page did not reserve an attachment slot"), this.ackTimeout); entry.timer.unref?.();
    this.requests.set(id, entry); this.emit("session.capture.prepare", entry);
    await entry.prepared;
    return this.status(id);
  }
  entry(id) { this.prune(); const e = this.requests.get(id); if (!e) throw fail("Screenshot request is missing or expired", 410); return e; }
  ack(ws, p) {
    const e = this.entry(p.requestId), b = this.binding;
    if (!b || b.ws !== ws || b.pageId !== e.pageId || b.generation !== e.bindingGeneration || p.pageId !== e.pageId || p.bindingGeneration !== e.bindingGeneration || p.bootEpoch !== this.epoch || p.threadId !== e.threadId) throw fail("Screenshot receipt target mismatch");
    if (p.result === "prepared" && e.state === "preparing") {
      const selected = this.stream.subscriptions.get(ws);
      if (!selected?.ready || selected.threadId !== e.threadId || selected.subscriptionId !== e.subscriptionId || p.subscriptionId !== e.subscriptionId) { this.reject(e, "Conversation selection changed before capture"); throw fail(e.error); }
      this.eligible(e.threadId); clearTimeout(e.timer); e.state = "prepared"; e.resolve(); e.reject = null;
    } else if (p.result === "delivered" && ["uploaded", "delivered"].includes(e.state)) { this.eligible(e.threadId); e.state = "delivered"; }
    else if (["rejected", "cancelled"].includes(p.result) && e.state !== "delivered") { this.reject(e, "Screenshot attachment was cancelled or is not editable"); e.state = "cancelled"; }
    else if (!(p.result === "prepared" && e.state === "prepared")) throw fail("Screenshot receipt is no longer applicable");
    return { state: e.state };
  }
  deliver(e) { try { this.eligible(e.threadId); this.emit("session.capture.ready", e); } catch (error) { this.reject(e, error.message); } }
  status(id) { const e = this.entry(id); if (e.state === "uploaded" && Date.now() - (e.notifiedAt || 0) > 1000) this.deliver(e); return { requestId: id, bootEpoch: this.epoch, threadId: e.threadId, state: e.state, expiresAt: e.expiresAt, ...(e.error ? { error: e.error } : {}) }; }
  async image(id, req) {
    const e = this.entry(id);
    if (!["prepared", "uploaded", "delivered"].includes(e.state)) throw fail("Screenshot is not reserved or was cancelled");
    this.eligible(e.threadId);
    const hash = crypto.createHash("sha256"); let prefix = Buffer.alloc(0), size = 0;
    const body = Readable.toWeb(req).pipeThrough(new TransformStream({ transform(chunk, controller) {
      size += chunk.length; if (size > MAX_UPLOAD_BYTES) throw fail("Screenshot exceeds 20 MB", 413);
      if (prefix.length < 8) prefix = Buffer.concat([prefix, Buffer.from(chunk).subarray(0, 8 - prefix.length)]);
      if (prefix.length === 8 && !prefix.equals(png)) throw fail("Screenshot must be PNG", 400);
      hash.update(chunk); controller.enqueue(chunk);
    }, flush() { if (prefix.length < 8) throw fail("Screenshot is empty or invalid", 400); } }));
    if (!e.uploading) {
      // Claim this request before the first await; concurrent retries only hash.
      e.uploading = (async () => {
        const request = new Request("http://127.0.0.1/upload", { method: "POST", body, duplex: "half", headers: req.headers["content-length"] ? { "content-length": req.headers["content-length"] } : {} });
        e.upload = await saveUpload(request, e.threadId, `Screenshot-${id}.png`, this.uploadOptions);
        e.digest = hash.digest("hex");
        if (e.state === "prepared") { e.state = "uploaded"; this.deliver(e); }
        return e.upload;
      })();
    } else {
      const reader = body.getReader(); while (!(await reader.read()).done) { /* Validate/hash retry bytes without another save. */ }
      const digest = hash.digest("hex"); await e.uploading;
      if (digest !== e.digest) throw fail("Screenshot retry content differs", 409);
    }
    await e.uploading;
    return this.status(id);
  }
  async http(req, res) {
    const respond = (status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
    try {
      const peer = req.socket.remoteAddress;
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) || req.headers.host !== `127.0.0.1:${this.port}` || "origin" in req.headers || req.method === "OPTIONS") throw fail("Local capture endpoint unavailable", 403);
      const supplied = Buffer.from(req.headers.authorization || ""), expected = Buffer.from(`Bearer ${this.key}`);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw fail("Invalid capture credential", 401);
      const url = req.url || "";
      if (url === "/capture/begin" && req.method === "POST") {
        let bytes = ""; for await (const chunk of req) { bytes += chunk; if (Buffer.byteLength(bytes) > 1024) throw fail("Capture request too large", 413); }
        const p = JSON.parse(bytes); if (Object.keys(p).some(k => k !== "requestId")) throw fail("Unexpected capture fields", 400);
        respond(200, await this.begin(p.requestId));
      } else {
        const match = /^\/capture\/([a-f\d-]{36})(\/image|\/cancel)?$/i.exec(url);
        if (!match || !UUID.test(match[1])) throw fail("Unknown capture endpoint", 404);
        if (match[2] === "/image" && req.method === "POST") respond(200, await this.image(match[1], req));
        else if (match[2] === "/cancel" && req.method === "POST") { this.reject(this.entry(match[1]), "Native screenshot capture failed; existing draft kept"); respond(200, this.status(match[1])); }
        else if (!match[2] && req.method === "GET") respond(200, this.status(match[1]));
        else throw fail("Unsupported capture operation", 405);
      }
    } catch (error) { respond(error.status || 400, { error: error.message }); }
  }
  close() { for (const e of this.requests.values()) this.reject(e, "Office capture stopped"); this.requests.clear(); this.binding = null; }
}
module.exports = { OfficeCapture };
