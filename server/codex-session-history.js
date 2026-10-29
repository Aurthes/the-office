"use strict";
const PAGE_TURNS = 12;
const PAGE_TEXT_BYTES = 48 * 1024;

// Keep conversation pages in turns. Tool items stay out of the browser payload.
async function loadSessionHistoryPage(call, row, cursor) {
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 4096))
    throw new Error("Invalid history cursor");
  const result = await call("thread/turns/list", {
    threadId: row.id, limit: PAGE_TURNS, sortDirection: "desc", itemsView: "full",
    ...(cursor === undefined ? {} : { cursor }),
  });
  const visible = result.data.toReversed().flatMap(turn => (turn.items || [])
    .filter(item => ["userMessage", "agentMessage"].includes(item.type))
    .map(item => ({ item, turnId: turn.id, startedAtMs: turn.startedAt ? turn.startedAt * (turn.startedAt < 1e12 ? 1000 : 1) : row.updatedAt })));
  const texts = visible.map(({ item }) => Buffer.from(item.text || (item.content || [])
    .filter(part => ["text", "inputText", "input_text"].includes(part.type)).map(part => part.text).join("\n"), "utf8"));
  const total = texts.reduce((sum, bytes) => sum + Math.min(bytes.length, 8192), 0);
  const textLimit = total <= PAGE_TEXT_BYTES ? 8192 : Math.min(8192, Math.floor(PAGE_TEXT_BYTES / Math.max(1, visible.length)));
  const messages = visible.map((entry, i) => {
    const item = entry.item;
    const bytes = texts[i];
    return { id: `${entry.turnId}:${item.id}`, role: item.type === "userMessage" ? "user" : "assistant",
      content: new TextDecoder().decode(bytes.subarray(0, textLimit), { stream: true }),
      truncated: bytes.length > textLimit, timestamp: entry.startedAtMs || entry.completedAtMs || row.updatedAt };
  });
  return { threadId: row.id, messages, nextCursor: result.nextCursor || null, turnCount: result.data.length };
}

module.exports = { loadSessionHistoryPage, PAGE_TURNS, PAGE_TEXT_BYTES };
