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
async function loadSessionHistoryPage(call, row, cursor, replyContext, conversationVersion) {
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 4096))
    throw new Error("Invalid history cursor");
  const result = await call("thread/timeline/list", {
    threadId: row.id, limit: PAGE_ENTRIES, ...(conversationVersion === undefined ? {} : { conversationVersion }),
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

async function loadConversationHistoryPage({ store, controls, replyContext, userSends, journalUnavailable }, id, cursor, epoch, selectedVersion) {
  const { conversation } = require("./codex-conversations");
  const row = store.get(id), selected = conversation(row, selectedVersion), current = selected.current ? controls.state(id).historyEpoch : selected.historyEpoch;
  let nativeCursor = cursor;
  if ((row.previousConversations || []).length && cursor) {
    try { const saved = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (saved.type !== "office-history-v1" || saved.version !== selected.version || saved.epoch !== current || typeof saved.cursor !== "string") throw new Error();
      nativeCursor = saved.cursor;
    } catch { throw new Error("History cursor belongs to another conversation version. Reload this view."); }
  }
  if (cursor && epoch !== undefined && epoch !== current) throw new Error("History changed. Reload the latest messages.");
  const result = await loadSessionHistoryPage(store.call.bind(store), row, nativeCursor, replyContext, selected.version);
  if (selected.current && (controls.state(id).historyEpoch !== current || store.get(id).codexThreadId !== selected.nativeThreadId)) throw new Error("History changed during the read. Reload the latest messages.");
  if (selected.current) try { userSends.observe(id, result.messages, current, selected.nativeThreadId); } catch { userSends.unavailable = true; journalUnavailable?.(); }
  const nextCursor = result.nextCursor && (row.previousConversations || []).length ? Buffer.from(JSON.stringify({ type: "office-history-v1", version: selected.version, epoch: current, cursor: result.nextCursor })).toString("base64url") : result.nextCursor;
  return { ...result, nextCursor, historyEpoch: current, conversationVersion: selected.version, readOnly: !selected.current };
}

module.exports = { loadConversationHistoryPage, loadSessionHistoryPage, boundHistoryMessages, PAGE_ENTRIES, PAGE_TEXT_BYTES };
