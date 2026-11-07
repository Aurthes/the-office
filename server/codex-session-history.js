"use strict";
const PAGE_ENTRIES = 100;
const PAGE_TEXT_BYTES = 128 * 1024;
const { sessionItem, realtimeSessionItem, clipText } = require("./codex-session-items");

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

// The native timeline contains ordinary chat and committed voice dialogue in
// one order. Its opaque cursor walks backwards; each page is already ascending.
async function loadSessionHistoryPage(call, row, cursor, replyContext) {
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 4096))
    throw new Error("Invalid history cursor");
  const result = await call("thread/timeline/list", {
    threadId: row.id, limit: PAGE_ENTRIES,
    ...(cursor === undefined ? {} : { cursor }),
  });
  const visible = result.data.flatMap(entry => {
    const item = entry.type === "item" ? sessionItem(entry.item, entry.turnId)
      : entry.type === "realtime" ? realtimeSessionItem(entry.item) : null;
    // Older entries may have no recorded time. A session update is not a
    // message timestamp, and must not make every historical message look new.
    return item ? [item] : [];
  });
  return { threadId: row.id, messages: boundHistoryMessages(replyContext ? replyContext.decorate(row.id, visible) : visible), nextCursor: result.nextCursor || null };
}

function boundHistoryMessages(visible) {
  // Conversation text has priority over the collapsed work log.
  const primary = item => item.role !== "tool" && item.phase !== "commentary";
  const mainCaps = fitCaps(visible.map(item => primary(item) ? Buffer.byteLength(item.content) : 0), PAGE_TEXT_BYTES);
  const remaining = PAGE_TEXT_BYTES - mainCaps.reduce((sum, size) => sum + size, 0);
  const workCaps = fitCaps(visible.map(item => primary(item) ? 0 : Math.min(Buffer.byteLength(item.content), item.role === "tool" ? 160 : 512)), remaining);
  return visible.map((item, i) => ({ ...item, ...clipText(item.content, mainCaps[i] + workCaps[i]) }));
}

module.exports = { loadSessionHistoryPage, boundHistoryMessages, PAGE_ENTRIES, PAGE_TEXT_BYTES };
