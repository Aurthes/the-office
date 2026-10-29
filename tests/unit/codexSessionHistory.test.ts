import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { loadSessionHistoryPage, PAGE_TEXT_BYTES } = require("../../server/codex-session-history.js");
const row = { id: "original-thread", updatedAt: 123 };
const item = (id: string, type: string, text: string) => ({ turnId: "turn", item: { id, type, text }, startedAtMs: 456 });

describe("bounded original-session history", () => {
  it("makes exactly one item request and follows its older cursor, without loading complete turns", async () => {
    const call = vi.fn().mockResolvedValue({ data: [item("newer", "agentMessage", "new"), item("tool", "commandExecution", "huge tool output"), item("older", "userMessage", "old")], nextCursor: "next" });
    const page = await loadSessionHistoryPage(call, row, "cursor");
    expect(call).toHaveBeenCalledExactlyOnceWith("thread/items/list", { threadId: row.id, cursor: "cursor", sortDirection: "desc", limit: 20 });
    expect(page.messages.map((m: { id: string }) => m.id)).toEqual(["turn:older", "turn:newer"]);
    expect(page.nextCursor).toBe("next");
  });
  it("bounds the whole text payload, preserves UTF-8 and marks long messages as truncated", async () => {
    const call = vi.fn().mockResolvedValue({ data: Array.from({ length: 20 }, (_, i) => item(String(i), "agentMessage", "汉🙂".repeat(10000))), nextCursor: "next" });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages.reduce((n: number, m: { content: string }) => n + Buffer.byteLength(m.content), 0)).toBeLessThanOrEqual(PAGE_TEXT_BYTES);
    expect(page.messages.every((m: { truncated: boolean; content: string }) => m.truncated && !m.content.includes("�"))).toBe(true);
  });
  it("returns an empty text page with its cursor instead of automatically reading more tool-only pages", async () => {
    const call = vi.fn().mockResolvedValue({ data: [item("tool", "reasoning", "hidden")], nextCursor: "next" });
    expect(await loadSessionHistoryPage(call, row)).toMatchObject({ messages: [], nextCursor: "next" });
    expect(call).toHaveBeenCalledTimes(1);
    await expect(loadSessionHistoryPage(call, row, {})).rejects.toThrow("Invalid history cursor");
  });
});
