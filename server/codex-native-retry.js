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
    || typeof log.timestamp !== "string") return null;
  let kind, error, attempt = null, maxAttempts = null;
  if (f.message === "stream connection failed; waiting to retry") {
    // This branch has no retry budget/count in the native warning. Do not invent one.
    if (typeof f.error !== "string" || typeof f.retry_delay !== "string" || !/^\d+(?:\.\d+)?(?:ns|µs|us|ms|s)$/.test(f.retry_delay)
      || f.sampling_error !== undefined || f.compact_error !== undefined) return null;
    kind = "connection"; error = f.error;
  } else {
    if (!Number.isSafeInteger(f.retries) || !Number.isSafeInteger(f.max_retries) || f.retries < 1 || f.max_retries < f.retries || f.max_retries > 10000) return null;
    if (typeof f.sampling_error === "string" && f.compact_error === undefined) { kind = "sampling"; error = f.sampling_error; }
    else if (typeof f.compact_error === "string" && f.sampling_error === undefined
      && f.message === "remote compaction v2 stream failed; retrying request after delay") { kind = "compaction"; error = f.compact_error; }
    else return null;
    attempt = f.retries; maxAttempts = f.max_retries;
  }
  const emittedAt = Date.parse(log.timestamp), reason = modelErrorDetails(error);
  if (!Number.isFinite(emittedAt)) return null;
  return { generation, turnId: f.turn_id, kind, attempt, maxAttempts, emittedAt, timestamp: log.timestamp, reason: reason || "Native retry reason is unavailable", observedAt: Date.now() };
}
module.exports = { nativeRetryMetadata, modelErrorDetails, supportedNativeRetryVersion: version => supported.has(version) };
