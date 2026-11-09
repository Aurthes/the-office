"use strict";
const FIELDS = ["input", "cachedInput", "uncachedInput", "cacheWriteInput", "output", "reasoningOutput", "otherOutput", "total"];
const count = n => Number.isSafeInteger(n) && n >= 0;
const emptyUsage = () => Object.fromEntries(FIELDS.map(f => [f, null]));
function transcriptionUsage(value) {
  const unknown = { usage: emptyUsage(), unit: "unknown", durationSeconds: null, usageReason: "usageUnavailable" };
  if (value?.type === "duration" && Number.isFinite(value.seconds) && value.seconds >= 0)
    return { ...unknown, unit: "seconds", durationSeconds: value.seconds, usageReason: "durationOnly" };
  if (value?.type !== "tokens") return unknown;
  const { input_tokens: input, output_tokens: output, total_tokens: total } = value;
  const details = value.input_token_details;
  if (![input, output, total].every(count) || total !== input + output || details && (typeof details !== "object" || Array.isArray(details) ||
      [details.audio_tokens, details.text_tokens].some(n => n !== undefined && (!count(n) || n > input)) ||
      (details.audio_tokens ?? 0) + (details.text_tokens ?? 0) > input)) return { ...unknown, usageReason: "invalidUsage" };
  return { usage: { ...emptyUsage(), input, output, total }, unit: "tokens", durationSeconds: null, usageReason: null };
}
function dictationUsageOf(row) {
  const u = row.usage;
  if (!u || FIELDS.some(f => u[f] !== null && !count(u[f]))) return null;
  if (["cachedInput", "uncachedInput", "cacheWriteInput", "reasoningOutput", "otherOutput"].some(f => u[f] !== null)) return null;
  if (row.unit === "tokens") return [u.input, u.output, u.total].every(count) && u.total === u.input + u.output ? { ...u } : null;
  return FIELDS.every(f => u[f] === null) && (row.unit === "unknown" || row.unit === "seconds" && Number.isFinite(row.durationSeconds) && row.durationSeconds >= 0) ? { ...u } : null;
}
function nativeMetadata(thread) {
  if (!thread || typeof thread !== "object") return null;
  const sub = thread.source?.subAgent;
  return { nativeThreadId: thread.id, parentNativeThreadId: thread.parentThreadId || sub?.thread_spawn?.parent_thread_id || null,
    helperKind: ["review", "compact", "memory_consolidation"].includes(sub) ? sub : sub?.other ? "other" : sub?.thread_spawn ? "thread_spawn" : null };
}
module.exports = { transcriptionUsage, dictationUsageOf, nativeMetadata, emptyUsage };
