"use strict";
// Office owns identity and a metadata-only native history directory. Content
// remains in Codex and can only be read through its public APIs.
function version(row) { const value = row.conversationVersion ?? 1; if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid Office conversation version"); return value; }
function conversations(row) {
  const previous = row.previousConversations || [];
  if (!Array.isArray(previous) || previous.length !== version(row) - 1 || previous.some(entry => !Number.isSafeInteger(entry.version) || entry.version < 1 || entry.version >= version(row)
    || typeof entry.nativeThreadId !== "string" || !entry.nativeThreadId || !Array.isArray(entry.turnIds) || entry.turnIds.some(id => typeof id !== "string" || !id))
    || new Set(previous.map(entry => entry.version)).size !== previous.length || new Set(previous.map(entry => entry.nativeThreadId)).size !== previous.length
    || previous.some(entry => entry.nativeThreadId === row.codexThreadId)) throw new Error("This employee's retained conversation directory is invalid; refresh is disabled");
  return [...(row.previousConversations || []).map(entry => ({ ...entry, current: false })),
    ...(row.codexThreadId ? [{ version: version(row), nativeThreadId: row.codexThreadId, historyEpoch: row.historyEpoch || "0", current: true }] : [])];
}
function conversation(row, selected) {
  const result = conversations(row).find(entry => entry.version === (selected ?? version(row)));
  if (!result) throw new Error("This employee's conversation version is unavailable");
  return result;
}
function forTurn(row, turnId) {
  conversations(row);
  const found = (row.previousConversations || []).filter(entry => entry.turnIds.includes(turnId));
  if (found.length > 1) throw new Error("Historical turn identity is ambiguous");
  return found[0] || conversation(row);
}
const fail = message => Object.assign(new Error(message), { code: "SESSION_VERSION_CHANGED" });
module.exports = { version, conversations, conversation, forTurn, versionChanged: fail };
