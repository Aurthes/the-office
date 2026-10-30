"use strict";
const crypto = require("node:crypto");
const { WebSocket } = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");
const MAX_BYTES = 20 * 1024 * 1024;
const ENDPOINT = "wss://chatgpt.com/backend-api/dictation/stream?dictation_surface=composer&client_type=desktop";
const fail = (message, status = 502) => Object.assign(new Error(message), { status });

function readPcm(wav) {
  if (wav.length > MAX_BYTES || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw fail("录音格式无效或超过 20 MB", 400);
  let format = false, pcm;
  for (let p = 12; p + 8 <= wav.length;) {
    const size = wav.readUInt32LE(p + 4), end = p + 8 + size;
    if (end > wav.length) throw fail("录音文件不完整", 400);
    const kind = wav.toString("ascii", p, p + 4);
    if (kind === "fmt ") format = size >= 16 && wav.readUInt16LE(p + 8) === 1 && wav.readUInt16LE(p + 10) === 1 && wav.readUInt32LE(p + 12) === 16000 && wav.readUInt16LE(p + 22) === 16;
    if (kind === "data") pcm = wav.subarray(p + 8, end);
    p = end + (size % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2 || pcm.length > 16000 * 2 * 600) throw fail("请提供不超过 10 分钟的单声道 16 kHz PCM 录音", 400);
  return pcm;
}

async function openNativeSession(client, signal, { Socket = WebSocket, proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY, timeout = 690000 } = {}) {
  if (!client?.ready) throw fail("Codex 原生后台未连接", 503);
  const auth = await client.call("getAuthStatus", { includeToken: true, refreshToken: false });
  if (!["chatgpt", "chatgptAuthTokens"].includes(auth.authMethod) || !auth.authToken) throw fail("请先在 Codex 中登录 ChatGPT 账号", 503);
  let accountId;
  try { accountId = JSON.parse(Buffer.from(auth.authToken.split(".")[1], "base64url"))["https://api.openai.com/auth"]?.chatgpt_account_id; } catch {}
  if (!accountId || !client.userAgent) throw fail("Codex 原生账号路由不可用", 503);
  signal?.throwIfAborted();
  let resolveReady, rejectReady, resolveDone, rejectDone;
  const ready = new Promise((ok, no) => { resolveReady = ok; rejectReady = no; });
  const done = new Promise((ok, no) => { resolveDone = ok; rejectDone = no; }); done.catch(() => {});
  const utterances = new Map(); let settled = false, finishing = false, started = false, total = 0;
  const socket = new Socket(ENDPOINT, ["chatgpt-dictation", "codex-desktop"], {
    headers: { Authorization: "Bearer " + auth.authToken, "ChatGPT-Account-Id": accountId, originator: "the-office", "User-Agent": client.userAgent },
    agent: proxy ? new HttpsProxyAgent(proxy) : undefined, handshakeTimeout: 15000, maxPayload: 1024 * 1024,
  });
  const complete = error => {
    if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); socket.terminate();
    const text = [...utterances.values()].map(value => value.text).filter(Boolean).join(" ");
    if (!error && !text.trim()) error = fail("没有识别到文字，录音仍可重试或下载", 422);
    if (error) { rejectReady(error); rejectDone(error); } else resolveDone({ text });
  };
  const abort = () => complete(fail("听写已取消，录音已保留", 499));
  const timer = setTimeout(() => complete(fail("原生听写超时，录音已保留", 504)), timeout);
  signal?.addEventListener("abort", abort, { once: true });
  const transport = {
    done, cancel: abort,
    append(pcm) {
      if (settled || finishing || socket.readyState !== 1) throw fail("原生听写连接已结束，录音已保留");
      if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2 || pcm.length > 32768 || total + pcm.length > 19200000) throw fail("录音数据无效或超过 10 分钟", 400);
      if (socket.bufferedAmount > 512 * 1024) throw fail("听写网络拥塞，录音已保留");
      total += pcm.length;
      socket.send(JSON.stringify({ type: "audio.append", audio: pcm.toString("base64") }), error => { if (error) complete(fail("原生听写连接中断，录音已保留")); });
    },
    finish() {
      if (!settled && !finishing) { finishing = true; socket.send(JSON.stringify({ type: "session.close" }), error => { if (error) complete(fail("原生听写连接中断，录音已保留")); }); }
      return done;
    },
  };
  socket.on("open", () => socket.send(JSON.stringify({ type: "session.start", dictation_session_id: crypto.randomUUID(), attempt_id: crypto.randomUUID(), config: {
    input_audio_format: "pcm16", sample_rate_hz: 16000, num_channels: 1, max_buffer_size_bytes: 4194304, max_utterance_duration_ms: 30000,
    session_ttl_ms: 900000, provider_mode: "streaming_sse", transcript_delivery_mode: "final_only",
    vad: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
  } })));
  socket.on("message", raw => {
    let event; try { event = JSON.parse(String(raw)); } catch { return complete(fail("原生听写返回了无效响应")); }
    if (!event || typeof event !== "object") return complete(fail("原生听写返回了无效响应"));
    if (event.utterance_id && !utterances.has(event.utterance_id)) utterances.set(event.utterance_id, { revision: -1, text: "" });
    if (event.type === "transcript.final") {
      const old = utterances.get(event.utterance_id);
      if (!old || !Number.isFinite(event.revision) || typeof event.text !== "string" || event.text.length > 128000) return complete(fail("原生听写文本格式无效"));
      if (event.revision >= old.revision) utterances.set(event.utterance_id, { revision: event.revision, text: event.text });
    }
    if (["session.error", "transcript.failed", "session.stop_requested"].includes(event.type)) {
      const code = String(event.error?.code || event.reason || "unknown");
      console.warn("[native-dictation]", event.type, /^[a-z_]{1,80}$/i.test(code) ? code : "unknown");
      return complete(fail("原生听写未能完整结束，录音已保留，请重试"));
    }
    if (event.type === "session.started" && !started && !settled) { started = true; resolveReady(transport); }
  });
  socket.on("close", code => complete(code === 1000 && finishing ? null : fail("原生听写连接提前结束，录音已保留")));
  socket.on("error", () => complete(fail("无法连接 Codex 原生听写，录音已保留")));
  socket.on("unexpected-response", (_request, response) => { response.resume(); complete(fail("Codex 原生听写暂时拒绝连接，请重试")); });
  return ready;
}

async function transcribeNative(client, wav, signal, options = {}) {
  const pcm = readPcm(wav), connection = await openNativeSession(client, signal, options);
  try {
    // Recovery replays at the native audio rate, never as an accelerated burst.
    for (let p = 0; p < pcm.length; p += 16000) {
      signal?.throwIfAborted(); const chunk = pcm.subarray(p, p + 16000); connection.append(chunk);
      await new Promise(ok => setTimeout(ok, chunk.length / 32));
    }
    return await connection.finish();
  } catch (error) { connection.cancel(); throw error; }
}

class NativeDictationSessions {
  constructor(client, open = openNativeSession) { this.client = client; this.open = open; this.sessions = new Map(); }
  async start(owner, threadId, id) {
    if (typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id)) throw fail("录音编号无效", 400);
    if (this.sessions.has(id) || this.sessions.size >= 2) throw fail("已有录音连接，请先结束它", 409);
    const entry = { owner, threadId, id, next: 0, abort: new AbortController() }; this.sessions.set(id, entry);
    try {
      entry.connection = await this.open(this.client, entry.abort.signal);
      if (this.sessions.get(id) !== entry) { entry.connection.cancel(); throw fail("录音连接已取消", 499); }
      entry.connection.done.catch(error => { entry.error = error; });
      return { started: true, id };
    } catch (error) { if (this.sessions.get(id) === entry) this.sessions.delete(id); throw error; }
  }
  get(owner, p) {
    const entry = this.sessions.get(p.id);
    if (!entry || entry.owner !== owner || entry.threadId !== p.threadId) throw fail("这不是当前网页的录音", 400);
    if (entry.error) throw entry.error;
    if (!entry.connection) throw fail("原生录音连接仍在准备", 409);
    return entry;
  }
  append(owner, p) {
    const entry = this.get(owner, p);
    if (p.sequence !== entry.next || typeof p.audio !== "string" || p.audio.length > 44000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.audio)) throw fail("录音分块不完整，录音已保留", 400);
    entry.connection.append(Buffer.from(p.audio, "base64")); entry.next++; return { accepted: true };
  }
  async finish(owner, p) {
    const entry = this.get(owner, p);
    try { if (p.sequence !== entry.next) throw fail("录音分块不完整，录音已保留", 400); return await entry.connection.finish(); }
    finally { if (this.sessions.get(entry.id) === entry) this.sessions.delete(entry.id); entry.connection.cancel(); }
  }
  cancel(owner, p) {
    const entry = this.sessions.get(p.id);
    if (!entry) return { cancelled: true };
    if (entry.owner !== owner || entry.threadId !== p.threadId) throw fail("这不是当前网页的录音", 400);
    entry.abort.abort(); entry.connection?.cancel(); this.sessions.delete(entry.id); return { cancelled: true };
  }
  disconnected(owner) { for (const entry of this.sessions.values()) if (entry.owner === owner) this.cancel(owner, entry); }
  close() { for (const entry of this.sessions.values()) this.cancel(entry.owner, entry); }
}

function createDictationHandler({ client, token, findThread, transcribe = transcribeNative }) {
  let active = 0; const requests = new Set();
  const handler = async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnected);
    let admitted = false;
    try {
      const given = Buffer.from(req.headers.authorization || ""), expected = Buffer.from("Bearer " + token);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw fail("Authentication required", 401);
      if (active >= 2) throw fail("已有听写在处理中，请稍后重试", 429);
      if (!client?.ready) throw fail("Codex 原生后台未连接", 503);
      try { findThread(new URL(req.url, "http://localhost").searchParams.get("threadId")); } catch { throw fail("会话不存在或已归档，录音已保留", 404); }
      if (Number(req.headers["content-length"]) > MAX_BYTES) throw fail("录音超过 20 MB", 413);
      active++; admitted = true; requests.add(controller);
      controller.signal.addEventListener("abort", () => req.destroy(), { once: true });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) throw fail("录音超过 20 MB", 413);
        chunks.push(chunk);
      }
      const result = await transcribe(client, Buffer.concat(chunks), controller.signal);
      if (controller.signal.aborted || res.destroyed) return;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(result));
    } catch (error) {
      if (!res.destroyed) { res.writeHead(error.status || 502, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: error.status ? error.message : "原生听写失败，录音已保留" })); }
    } finally { if (admitted) { active--; requests.delete(controller); } res.removeListener("close", disconnected); }
  };
  handler.close = () => { for (const controller of requests) controller.abort(); };
  return handler;
}
module.exports = { readPcm, transcribeNative, openNativeSession, NativeDictationSessions, createDictationHandler, MAX_BYTES };
