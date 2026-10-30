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
  it("keeps native phases and only public tool summaries for collapsed work", async () => {
    const call = vi.fn().mockResolvedValue({ data: [{ id: "turn", items: [
      { type: "userMessage", id: "u", content: [{ type: "text", text: "hello" }] },
      { type: "agentMessage", id: "c", phase: "commentary", text: "working" },
      { type: "reasoning", id: "r", summary: ["public summary"], content: ["private reasoning"] },
      { type: "commandExecution", id: "tool", command: "echo fixture", aggregatedOutput: "huge output" },
      { type: "agentMessage", id: "f", phase: "final_answer", text: "final".repeat(3000) },
    ] }] });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages.map((m: { phase?: string }) => m.phase)).toEqual([undefined, "commentary", undefined, undefined, "final_answer"]);
    expect(page.messages.every((m: { turnId: string }) => m.turnId === "turn")).toBe(true);
    expect(JSON.stringify(page)).not.toContain("private reasoning");
    expect(JSON.stringify(page)).not.toContain("huge output");
    expect(page.messages.at(-1)).toMatchObject({ truncated: false, content: "final".repeat(3000) });
  });
  it("removes native ambient context before budgeting while preserving the actual user request", async () => {
    const original = '# Applications mentioned by the user:\n<appshot>' + 'context'.repeat(30000) + '</appshot>\n## My request:\nFix the layout';
    const content = [{ type: "text", text: original }];
    const call = vi.fn().mockResolvedValue({ data: [{ id: "turn", items: [{ id: "u", type: "userMessage", content }] }] });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages[0]).toMatchObject({ content: "Fix the layout", truncated: false });
    expect(content[0].text).toBe(original);
  });
  it("preserves whole user messages and final Markdown when a turn has hundreds of large tool entries", async () => {
    const answer = "Final answer\n![chart](/local/chart.png)";
    const call = vi.fn().mockResolvedValue({ data: [{ id: "turn", items: [
      { id: "user", type: "userMessage", content: [{ type: "text", text: "继续" }] },
      ...Array.from({ length: 1000 }, (_, i) => ({ id: String(i), type: "commandExecution", command: "command ".repeat(1000) })),
      { id: "final", type: "agentMessage", phase: "final_answer", text: answer },
    ] }] });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages[0]).toMatchObject({ content: "继续", truncated: false });
    expect(page.messages.at(-1)).toMatchObject({ content: answer, truncated: false });
    expect(page.messages.reduce((sum: number, message: { content: string }) => sum + Buffer.byteLength(message.content), 0)).toBeLessThanOrEqual(PAGE_TEXT_BYTES);
  });
});
