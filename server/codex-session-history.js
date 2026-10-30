"use strict";
const PAGE_TURNS = 12;
const PAGE_TEXT_BYTES = 128 * 1024;
const { sessionItem, clipText } = require("./codex-session-items");

// Cap only the large entries. Proportional scaling also clips tiny messages.
function fitCaps(sizes, budget) {
  let low = 0, high = sizes.reduce((max, size) => Math.max(max, size), 0);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (sizes.reduce((sum, size) => sum + Math.min(size, middle), 0) <= budget) low = middle;
    else high = middle - 1;
  }
  return sizes.map(size => Math.min(size, low));
}

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
  // Conversation text has priority over the collapsed work log.
  const primary = item => item.role !== "tool" && item.phase !== "commentary";
  const mainCaps = fitCaps(visible.map(item => primary(item) ? Buffer.byteLength(item.content) : 0), PAGE_TEXT_BYTES);
  const remaining = PAGE_TEXT_BYTES - mainCaps.reduce((sum, size) => sum + size, 0);
  const workCaps = fitCaps(visible.map(item => primary(item) ? 0 : Math.min(Buffer.byteLength(item.content), item.role === "tool" ? 160 : 512)), remaining);
  const messages = visible.map((item, i) => ({ ...item, ...clipText(item.content, mainCaps[i] + workCaps[i]) }));
  return { threadId: row.id, messages, nextCursor: result.nextCursor || null, turnCount: result.data.length };
}

module.exports = { loadSessionHistoryPage, PAGE_TURNS, PAGE_TEXT_BYTES };
