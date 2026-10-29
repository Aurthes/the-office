"use strict";
const PAGE_ITEMS = 20;
const PAGE_TEXT_BYTES = 48 * 1024;

// One item page, never a complete turn (which can contain thousands of tool items).
async function loadSessionHistoryPage(call, row, cursor) {
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 4096))
    throw new Error("Invalid history cursor");
  const result = await call("thread/items/list", {
    threadId: row.id, limit: PAGE_ITEMS, sortDirection: "desc",
    ...(cursor === undefined ? {} : { cursor }),
  });
  const visible = result.data.toReversed().filter(entry => ["userMessage", "agentMessage"].includes(entry.item?.type));
  const textLimit = Math.min(8192, Math.floor(PAGE_TEXT_BYTES / Math.max(1, visible.length)));
  const messages = visible.map(entry => {
    const item = entry.item;
    const text = item.text || (item.content || [])
      .filter(part => ["text", "inputText", "input_text"].includes(part.type)).map(part => part.text).join("\n");
    const bytes = Buffer.from(text, "utf8");
    return { id: `${entry.turnId}:${item.id}`, role: item.type === "userMessage" ? "user" : "assistant",
      content: new TextDecoder().decode(bytes.subarray(0, textLimit), { stream: true }),
      truncated: bytes.length > textLimit, timestamp: entry.startedAtMs || entry.completedAtMs || row.updatedAt };
  });
  return { threadId: row.id, messages, nextCursor: result.nextCursor || null, itemCount: result.data.length };
}

module.exports = { loadSessionHistoryPage, PAGE_ITEMS, PAGE_TEXT_BYTES };
