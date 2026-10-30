"use strict";
const PAGE_TURNS = 12;
const PAGE_TEXT_BYTES = 128 * 1024;
const { sessionItem, clipText } = require("./codex-session-items");

// Keep conversation pages in turns. Tool items stay out of the browser payload.
async function loadSessionHistoryPage(call, row, cursor) {
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 4096))
    throw new Error("Invalid history cursor");
  const result = await call("thread/turns/list", {
    threadId: row.id, limit: PAGE_TURNS, sortDirection: "desc", itemsView: "full",
    ...(cursor === undefined ? {} : { cursor }),
  });
  const visible = result.data.toReversed().flatMap(turn => (turn.items || [])
    .map(item => sessionItem(item, turn.id)).filter(Boolean)
    .map(item => ({ ...item, timestamp: turn.startedAt ? turn.startedAt * (turn.startedAt < 1e12 ? 1000 : 1) : row.updatedAt })));
  // Tool summaries are short; never transfer raw reasoning or command output.
  const sizes = visible.map(item => Math.min(Buffer.byteLength(item.content), item.role === "tool" ? 1000 : PAGE_TEXT_BYTES));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const messages = visible.map((item, i) => ({ ...item, ...clipText(item.content,
    total <= PAGE_TEXT_BYTES ? sizes[i] : Math.floor(PAGE_TEXT_BYTES * sizes[i] / total)) }));
  return { threadId: row.id, messages, nextCursor: result.nextCursor || null, turnCount: result.data.length };
}

module.exports = { loadSessionHistoryPage, PAGE_TURNS, PAGE_TEXT_BYTES };
