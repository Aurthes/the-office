"use strict";
const { EnvHttpProxyAgent } = require("undici");
const { readOfficeChatGPTLogin } = require("./office-chatgpt-auth");
// Explicit aliases from the official voice picker; never infer other mappings.
const ALIASES = { fathom: "arbor", glimmer: "sol", orbit: "spruce" };
function previewURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "persistent.oaistatic.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/voice\/previews\/[a-z0-9._-]+\.m4a$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
function createOfficeVoicePreviews({ home, readVoices, refreshAuth, fetchImpl = fetch, dispatcherFactory = () => new EnvHttpProxyAgent() }) {
  let dispatcher, closed = false;
  const requests = new Set();
  async function read({ language = "en" } = {}) {
    if (!["en", "zh"].includes(language)) throw new Error("Unsupported voice preview language.");
    if (closed) throw new Error("Voice previews are unavailable.");
    const controller = new AbortController(); requests.add(controller);
    try {
      const voices = await readVoices();
      let auth = readOfficeChatGPTLogin(home);
      if (!auth) throw new Error("Sign in with ChatGPT to load voice previews.");
      for (let attempt = 0; attempt < 2; attempt++) {
        const headers = { Authorization: "Bearer " + auth.accessToken, "User-Agent": "TheOffice/1 voice-preview-catalog" };
        if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;
        const response = await fetchImpl("https://chatgpt.com/backend-api/settings/voices?voice_mode=wingman&spoken_language=" + language, {
          method: "GET", headers, redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), dispatcher: dispatcher ||= dispatcherFactory(),
        });
        if (response.status === 401 && refreshAuth && attempt === 0) {
          await response.body?.cancel(); await refreshAuth(); auth = readOfficeChatGPTLogin(home);
          if (!auth) throw new Error("Sign in with ChatGPT to load voice previews.");
          continue;
        }
        if (!response.ok || !/application\/json/i.test(response.headers.get("content-type") || "")) {
          await response.body?.cancel();
          throw new Error("Official voice previews are temporarily unavailable. Retry.");
        }
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            bytes += value.length; if (bytes > 512 * 1024) throw new Error("Oversized catalog");
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!Array.isArray(data.voices) || data.voices.length > 200) throw new Error("Invalid catalog");
        const mapped = new Map(), conflicts = new Set();
        for (const entry of data.voices) {
          if (typeof entry.voice !== "string") continue;
          const voice = ALIASES[entry.voice] || entry.voice, url = previewURL(entry.preview_url);
          if (!voices.includes(voice) || !url) continue;
          if (mapped.has(voice) && mapped.get(voice).url !== url) conflicts.add(voice);
          else mapped.set(voice, { url, language: new URL(url).pathname.match(/\.([a-z]{2}(?:-[A-Za-z]{2})?)\./)?.[1] || null });
        }
        if (closed || controller.signal.aborted) throw new Error("Closed catalog request");
        return { source: "openai-prerecorded", language,
          previews: voices.flatMap(voice => mapped.has(voice) && !conflicts.has(voice) ? [{ voice, ...mapped.get(voice) }] : []),
          unavailable: voices.filter(voice => !mapped.has(voice) || conflicts.has(voice)),
        };
      }
    } catch (error) {
      // Never expose upstream bodies, credential paths or token-bearing errors.
      if (error.message === "Sign in with ChatGPT to load voice previews.") throw error;
      throw new Error("Official voice previews are temporarily unavailable. Retry.");
    } finally { requests.delete(controller); }
  }
  return { read, close: async () => { closed = true; for (const request of requests) request.abort(); await dispatcher?.close(); } };
}
module.exports = { createOfficeVoicePreviews, previewURL };
