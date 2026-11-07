"use strict";
const crypto = require("node:crypto");

// Read raw native input, never the clipped display text. A cursor page is
// ascending; walk backwards until this turn's actual start boundary is found.
async function interruptedInput(client, id) {
  const latest = await client.call("thread/turns/list", { threadId: id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" });
  const turn = latest.data[0];
  if (!turn || turn.status !== "interrupted") throw new Error("Wait until the latest turn has stopped before editing.");
  let cursor, entries = [], bytes = 0, complete = false;
  for (let page = 0; page < 64; page++) {
    const result = await client.call("thread/timeline/list", { threadId: id, limit: 100, ...(cursor ? { cursor } : {}) });
    bytes += Buffer.byteLength(JSON.stringify(result.data));
    if (bytes > 2 * 1024 * 1024) break;
    entries = [...result.data, ...entries];
    const start = entries.findIndex(entry => entry.type === "turnStarted" && entry.turnId === turn.id);
    if (start >= 0) { entries = entries.slice(start); complete = true; break; }
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  if (!complete) throw new Error("The full interrupted turn could not be recovered. Editing is unavailable.");
  if (entries.some(entry => entry.type === "realtime" || (entry.turnId && entry.turnId !== turn.id))) throw new Error("Voice or newer input is present. Editing this turn is unavailable.");
  const messages = entries.filter(entry => entry.type === "item" && entry.item?.type === "userMessage");
  if (!messages.length) throw new Error("No ordinary text input was found in the interrupted turn.");
  const texts = messages.map(({ item }) => {
    if (!item.content?.length || item.content.some(part => !["text", "inputText", "input_text"].includes(part.type) || typeof part.text !== "string" || part.text_elements?.length || part.textElements?.length)) throw new Error("This turn contains attachments or references. Only ordinary text can be edited.");
    const text = item.content.map(part => part.text).join("\n");
    if (/^\s*(?:# (?:Files|Applications) mentioned by the user:|<(?:realtime_delegation|in-app-browser-context|send_user_message_question_reply)\b)/.test(text)
      || /(?:thread|task|app):\/\/|@(?:"(?:\/|[A-Za-z]:)|\/)/.test(text)) throw new Error("This turn contains attachments, references or voice input. Only ordinary text can be edited.");
    return text;
  });
  const text = texts.join("\n\n");
  if (!text.trim() || Buffer.byteLength(text) > 32000) throw new Error("The full turn must contain between 1 and 32 KB of ordinary text to edit.");
  return { turnId: turn.id, text, inputCount: texts.length, clientIds: messages.map(entry => entry.item.clientId).filter(Boolean),
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}
module.exports = { interruptedInput };
