import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { loadSessionHistoryPage, PAGE_TEXT_BYTES } = require("../../server/codex-session-history.js");
const row = { id: "original-thread", updatedAt: 123 };
const item = (id: string, type: string, text: string) => ({ turnId: "turn", item: { id, type, text }, startedAtMs: 456 });
const turn = (id: string, items: ReturnType<typeof item>[]) => ({ id, startedAt: 456, items: items.map(entry => entry.item) });

describe("bounded original-session history", () => {
  it("requests 12 turns once and follows the older cursor while omitting tool output from the page", async () => {
    const call = vi.fn().mockResolvedValue({ data: [turn("turn-newer", [item("newer", "agentMessage", "new"), item("tool", "commandExecution", "huge tool output")]), turn("turn-older", [item("older", "userMessage", "old")])], nextCursor: "next" });
    const page = await loadSessionHistoryPage(call, row, "cursor");
    expect(call).toHaveBeenCalledExactlyOnceWith("thread/turns/list", { threadId: row.id, cursor: "cursor", sortDirection: "desc", limit: 12, itemsView: "full" });
    expect(page.messages.map((m: { id: string }) => m.id)).toEqual(["turn-older:older", "turn-newer:newer"]);
    expect(page.turnCount).toBe(2);
    expect(page.nextCursor).toBe("next");
  });
  it("bounds the whole text payload, preserves UTF-8 and marks long messages as truncated", async () => {
    const call = vi.fn().mockResolvedValue({ data: Array.from({ length: 12 }, (_, i) => turn(String(i), [item(String(i), "agentMessage", "汉🙂".repeat(10000))])), nextCursor: "next" });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages.reduce((n: number, m: { content: string }) => n + Buffer.byteLength(m.content), 0)).toBeLessThanOrEqual(PAGE_TEXT_BYTES);
    expect(page.messages.every((m: { truncated: boolean; content: string }) => m.truncated && !m.content.includes("�"))).toBe(true);
  });
  it("returns an empty text page with its cursor instead of automatically reading more tool-only pages", async () => {
    const call = vi.fn().mockResolvedValue({ data: [turn("turn", [item("tool", "reasoning", "hidden")])], nextCursor: "next" });
    expect(await loadSessionHistoryPage(call, row)).toMatchObject({ messages: [], nextCursor: "next" });
    expect(call).toHaveBeenCalledTimes(1);
    await expect(loadSessionHistoryPage(call, row, {})).rejects.toThrow("Invalid history cursor");
  });
  it("keeps ordinary conversation text unchanged when the whole page fits its budget", async () => {
    const call = vi.fn().mockResolvedValue({ data: [turn("turn", Array.from({ length: 80 }, (_, i) => item(String(i), "agentMessage", "word ".repeat(100))))], nextCursor: "next" });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages).toHaveLength(80);
    expect(page.messages.every((m: { truncated: boolean; content: string }) => !m.truncated && m.content === "word ".repeat(100))).toBe(true);
  });
});
