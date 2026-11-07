"use strict";
const { sessionItem } = require("./codex-session-items");
const { boundHistoryMessages } = require("./codex-session-history");

function text(value, name, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Invalid ${name}`);
  return value;
}

// Reuse the pinned owner's public search APIs. No history mirror or second
// index; even archived reads never resume a thread or start an agent.
class CodexMessageSearch {
  constructor(store, replyContext) { this.store = store; this.replyContext = replyContext; }
  row(id) {
    const row = this.store.data.sessions.find(row => row.id === id);
    if (!row?.codexThreadId) throw new Error("This conversation is no longer available");
    return row;
  }
  metadata(row) {
    return { threadId: row.id, name: row.name, project: this.store.projects().find(project => project.id === row.projectId)?.name || "Open Workspace", archived: Boolean(row.archived) };
  }
  async occurrences(row, query, cursor, limit = 20) {
    if (cursor !== undefined && cursor !== null) text(cursor, "search cursor", 8192);
    const result = await this.store.client.call("thread/searchOccurrences", { threadId: row.codexThreadId, searchTerm: query, limit, ...(cursor ? { cursor } : {}) });
    return { ...this.metadata(row), matches: result.data.map(hit => ({ ...hit, messageId: `${hit.turnId}:${hit.itemId}` })), nextCursor: result.nextCursor || null };
  }
  async search(params) {
    const query = text(params.query, "search text", 1000).trim();
    if (params.threadId) return this.occurrences(this.row(params.threadId), query, params.cursor);
    const includeArchived = params.includeArchived !== false;
    let cursors = { active: null, archived: includeArchived ? null : false };
    if (params.cursor) {
      try {
        text(params.cursor, "search cursor", 32768);
        const parsed = JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8"));
        if (parsed.query !== query || parsed.includeArchived !== includeArchived) throw new Error();
        for (const key of ["active", "archived"]) if (parsed[key] !== false && parsed[key] !== null) text(parsed[key], "search cursor", 8192);
        cursors = { active: parsed.active, archived: includeArchived ? parsed.archived : false };
      } catch { throw new Error("Invalid search cursor"); }
    }
    const rows = new Map(this.store.data.sessions.filter(row => row.codexThreadId && (includeArchived || !row.archived)).map(row => [row.codexThreadId, row]));
    const pages = await Promise.all(["active", "archived"].map(async key => {
      if (cursors[key] === false) return [];
      const result = await this.store.client.call("thread/search", { searchTerm: query, archived: key === "archived", limit: 20,
        sortKey: "updated_at", sortDirection: "desc", sourceKinds: ["cli", "vscode", "appServer", "unknown"], ...(cursors[key] ? { cursor: cursors[key] } : {}) });
      cursors[key] = result.nextCursor || false;
      return result.data.flatMap(hit => rows.has(hit.thread.id) ? [{ row: rows.get(hit.thread.id), updatedAt: hit.thread.updatedAt }] : []);
    }));
    const candidates = [...new Map(pages.flat().map(hit => [hit.row.id, hit])).values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const groups = new Array(candidates.length); let next = 0;
    const read = async () => { while (next < candidates.length) { const index = next++; groups[index] = await this.occurrences(candidates[index].row, query, undefined, 3); } };
    await Promise.all([read(), read()]);
    const nextCursor = Object.values(cursors).some(value => value !== false) ? Buffer.from(JSON.stringify({ query, includeArchived, ...cursors })).toString("base64url") : null;
    // Native thread search can also match a title. Only message occurrences
    // belong in a message search result.
    return { groups: groups.filter(group => group.matches.length), nextCursor };
  }
  async context(params) {
    const row = this.row(params.threadId);
    const turnId = text(params.turnId, "turn", 200), itemId = text(params.itemId, "message", 200);
    if (params.turnCursor === undefined) return this.sourceContext(row, turnId, itemId);
    const cursor = text(params.turnCursor, "message position", 8192);
    const result = await this.store.client.call("thread/turns/list", { threadId: row.codexThreadId, cursor, limit: 1, sortDirection: "desc", itemsView: "summary" });
    const turn = result.data[0];
    if (turn?.id !== turnId) throw new Error("This message is no longer available");
    const visible = (turn.items || []).map(item => sessionItem(item, turnId)).filter(item => item && ["user", "assistant"].includes(item.role));
    const messages = this.replyContext ? this.replyContext.decorate(row.id, visible) : visible;
    const target = messages.findIndex(message => message.id === `${turnId}:${itemId}`);
    if (target < 0) throw new Error("This message is no longer available");
    const offset = params.offset ?? Math.max(0, target - 20);
    if (!Number.isInteger(offset) || offset < 0 || offset >= messages.length) throw new Error("Invalid message position");
    const end = Math.min(messages.length, offset + 40);
    return { ...this.metadata(row), messageId: messages[target].id, messages: boundHistoryMessages(messages.slice(offset, end)),
      olderOffset: offset ? Math.max(0, offset - 40) : null, newerOffset: end < messages.length ? end : null };
  }
  async sourceContext(row, turnId, itemId) {
    // The pinned native API reads an exact persisted item, including archived
    // chats. No search, history scan, resume, or duplicate conversation storage.
    const result = await this.store.client.call("thread/items/read", { threadId: row.codexThreadId, turnId, itemIds: [itemId] });
    const visible = result.data.filter(entry => entry.turnId === turnId).map(entry => sessionItem({ ...entry.item, startedAtMs: entry.startedAtMs, completedAtMs: entry.completedAtMs }, turnId)).filter(item => item?.role === "user" && item.id === `${turnId}:${itemId}`);
    if (!visible.length) throw new Error("This message is no longer available");
    return { ...this.metadata(row), messageId: `${turnId}:${itemId}`, messages: boundHistoryMessages(visible), olderOffset: null, newerOffset: null };
  }
}
module.exports = { CodexMessageSearch };
