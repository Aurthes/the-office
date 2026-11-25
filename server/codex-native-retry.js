"use strict";
const supported = new Set(["0.166.0", "0.172.0"]);
const id = value => typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,256}$/.test(value);
// Error metadata, not a request/response body. Never retain structured payloads,
// credentials, URLs, terminal escapes or an arbitrary JSON envelope.
function modelErrorDetails(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\b(?:request|response)[ _-]?(?:body|payload)\s*:|[\[{]\s*["{\[]/i)[0]
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, "[redacted]").replace(/https?:\/\/[^\s]+/gi, "[URL]").replace(/[\r\n\t]+/g, " ").trim();
  return text ? text.slice(0, 2000) : null;
}
function nativeRetryMetadata(log, generation) {
  const f = log?.fields;
  if (!id(generation) || log?.level !== "WARN" || log.target !== "codex_core::responses_retry" || !f || !id(f.turn_id)
    || !Number.isSafeInteger(f.retries) || !Number.isSafeInteger(f.max_retries) || f.retries < 1 || f.max_retries < f.retries || f.max_retries > 10000
    || typeof f.sampling_error !== "string" || typeof log.timestamp !== "string") return null;
  const emittedAt = Date.parse(log.timestamp), reason = modelErrorDetails(f.sampling_error);
  if (!Number.isFinite(emittedAt)) return null;
  return { generation, turnId: f.turn_id, attempt: f.retries, maxAttempts: f.max_retries, emittedAt, timestamp: log.timestamp, reason: reason || "Native retry reason is unavailable", observedAt: Date.now() };
}
module.exports = { nativeRetryMetadata, modelErrorDetails, supportedNativeRetryVersion: version => supported.has(version) };
