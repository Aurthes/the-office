"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EnvHttpProxyAgent } = require("undici");

const SIGN_IN = "Sign in with ChatGPT to use dictation.";
const TEMPORARY = "Dictation is temporarily unavailable. Please try again shortly.";
const INVALID_RESPONSE = "The dictation service returned an unexpected response.";
const COOLDOWN_MS = 60000;

// Only Office's own home is supplied by the gateway. Never discover native App
// credentials. The subscription endpoint is undocumented and may stop working.
function createOfficeDictation({ token, findThread, home, refreshAuth, onStatus = () => {} }) {
  const requests = new Set();
  let status, blockedUntil = 0, blockedReason, timer, closed = false, refreshing, dispatcher;
  const failure = (message, httpStatus = 503, disable = true, retryMs = COOLDOWN_MS) => Object.assign(new Error(message), { httpStatus, disable, retryMs });
  function provider() {
    // An explicitly configured API key retains the public API path. There is no
    // automatic fallback between accounts or separately billed providers.
    if (process.env.OPENAI_API_KEY) return { apiKey: true, accessToken: process.env.OPENAI_API_KEY };
    try {
      const auth = JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8"));
      if (auth.auth_mode !== "chatgpt" || !auth.tokens?.access_token) return null;
      return { accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id };
    } catch { return null; }
  }
  function publish(available, reason = null, retryAt = null) {
    const next = { dictation: available, dictationReason: reason, dictationRetryAt: retryAt };
    if (!closed && JSON.stringify(next) !== JSON.stringify(status)) { status = next; onStatus(next); }
  }
  function refresh({ reset = false } = {}) {
    if (closed) return;
    if (reset) { blockedUntil = 0; clearTimeout(timer); }
    if (!provider()) return publish(false, SIGN_IN);
    if (blockedUntil > Date.now()) return publish(false, blockedReason, blockedUntil);
    blockedUntil = 0;
    publish(true);
  }
  function block(error) {
    if (closed) return;
    blockedUntil = Date.now() + error.retryMs; blockedReason = error.message;
    publish(false, blockedReason, blockedUntil);
    clearTimeout(timer);
    // No background audio uploads: after the cooldown, the user can try again.
    timer = setTimeout(() => refresh(), error.retryMs); timer.unref?.();
  }
  async function credentials(force = false) {
    let auth = provider();
    if (!auth) throw failure(SIGN_IN);
    let expired = false;
    if (!auth.apiKey) {
      try { const expiry = JSON.parse(Buffer.from(auth.accessToken.split(".")[1], "base64url")).exp; expired = expiry && expiry * 1000 < Date.now() + 30000; } catch { /* An opaque token is checked by the service. */ }
      if ((force || expired) && refreshAuth) {
        // Coalesce only token renewal, never serialize unrelated recordings.
        refreshing ||= Promise.resolve().then(refreshAuth).finally(() => { refreshing = null; });
        try { await refreshing; } catch { throw failure(SIGN_IN); }
        auth = provider();
        if (!auth || auth.apiKey) throw failure(SIGN_IN);
      }
    }
    return auth;
  }
  function retryDelay(response) {
    const value = response.headers.get("retry-after");
    const seconds = value && Number(value);
    const delay = Number.isFinite(seconds) && value ? seconds * 1000 : Date.parse(value || "") - Date.now();
    return Number.isFinite(delay) ? Math.max(15000, Math.min(900000, delay)) : COOLDOWN_MS;
  }
  async function transcribe(audio, signal) {
    let auth = await credentials();
    for (let attempt = 0; attempt < 2; attempt++) {
      const form = new FormData(); form.append("file", new Blob([audio], { type: "audio/wav" }), "recording.wav");
      if (auth.apiKey) form.append("model", process.env.CLAW3D_TRANSCRIPTION_MODEL || "gpt-transcribe");
      const headers = { Authorization: "Bearer " + auth.accessToken };
      if (!auth.apiKey) {
        headers.originator = "codex_dictation"; headers["User-Agent"] = "TheOffice/1 dictation";
        if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
      }
      const response = await fetch(auth.apiKey ? "https://api.openai.com/v1/audio/transcriptions" : "https://chatgpt.com/backend-api/transcribe", {
        method: "POST", headers, body: form, signal, redirect: "error",
        dispatcher: dispatcher ||= new EnvHttpProxyAgent(),
      });
      // An expired subscription token gets one renewal via the Office-owned
      // Codex client. Network/service failures never resend audio automatically.
      if (response.status === 401 && !auth.apiKey && refreshAuth && attempt === 0) {
        await response.body?.cancel(); auth = await credentials(true); continue;
      }
      if (!response.ok) await response.body?.cancel();
      if (response.status === 401) throw failure(auth.apiKey ? "Check the dictation API key on the Office server." : SIGN_IN);
      if (response.status === 429) throw failure("Dictation is rate limited. Please try again shortly.", 503, true, retryDelay(response));
      if ([400, 413, 422].includes(response.status)) throw failure("The dictation service could not read this recording. Please record again.", 422, false);
      if (!response.ok) throw failure(TEMPORARY);
      if (!/application\/json/i.test(response.headers.get("content-type") || "")) { await response.body?.cancel(); throw failure(INVALID_RESPONSE); }
      let data;
      try { const body = await response.text(); if (body.length > 200000) throw new Error(); data = JSON.parse(body); }
      catch { if (signal.aborted) throw signal.reason; throw failure(INVALID_RESPONSE); }
      if (typeof data?.text !== "string") throw failure(INVALID_RESPONSE);
      if (!data.text.trim()) throw failure("No text recognized. Retry transcription or download the recording.", 422, false);
      return data.text;
    }
  }
  const handler = async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", disconnected);
    try {
      const given = Buffer.from(req.headers.authorization || ""), expected = Buffer.from("Bearer " + token);
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw failure("Authentication required", 401, false);
      try { findThread(new URL(req.url, "http://localhost").searchParams.get("threadId")); }
      catch { throw failure("Session not found or archived.", 404, false); }
      if (closed) throw failure(TEMPORARY, 503, false);
      refresh();
      if (!status.dictation) throw failure(status.dictationReason, 503, false);
      if (requests.size >= 2) throw failure("Transcription is busy; please try again shortly.", 429, false);
      requests.add(controller);
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 20 * 1024 * 1024) throw failure("Recording exceeds 20 MB.", 413, false); chunks.push(chunk); }
      if (!size) throw failure("No audio recorded. Check the microphone and retry.", 400, false);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
      const text = await transcribe(Buffer.concat(chunks), signal);
      if (!res.destroyed) { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ text })); }
    } catch (cause) {
      if (controller.signal.aborted || closed) return;
      // Never send raw upstream errors, response bodies, auth paths or tokens to
      // the browser/logs. Capability failure is separate from a bad recording.
      const error = cause?.httpStatus ? cause : failure(TEMPORARY);
      if (error.disable) block(error);
      if (!res.destroyed) {
        res.writeHead(error.httpStatus, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: error.message + " Recording kept.", dictation: status }));
      }
    } finally { requests.delete(controller); res.removeListener("close", disconnected); }
  };
  handler.refresh = refresh;
  handler.close = () => { closed = true; clearTimeout(timer); for (const request of requests) request.abort(); void dispatcher?.destroy().catch(() => {}); };
  refresh();
  return handler;
}
module.exports = { createOfficeDictation };
