import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { loadSessionHistoryPage, PAGE_TEXT_BYTES } = require("../../server/codex-session-history.js");
const { CodexSessionControls } = require("../../server/codex-session-controls.js");
const row = { id: "original-thread", updatedAt: 123 };
const item = (id: string, type: string, text: string) => ({ id, type, text, ...(type === "userMessage" ? { content: [{ type: "text", text }] } : {}) });
const entries = (items: unknown[], turnId = "turn") => items.map(item => ({ type: "item", turnId, item }));
const voice = { id: "segment", realtimeSessionId: "call", type: "transcriptSegment", role: "user", text: " Full spoken sentence " };

describe("bounded native timeline history", () => {
  it("reads one native page in canonical order with chat and voice, and uses the same IDs as live delivery", async () => {
    const call = vi.fn().mockResolvedValue({ data: [
      { type: "turnStarted", turnId: "turn", position: 1 },
      ...entries([item("old", "userMessage", "Typed question")]),
      { type: "realtime", item: { type: "realtimeSessionStarted", id: "start", realtimeSessionId: "call" } },
      { type: "realtime", item: voice },
      ...entries([item("answer", "agentMessage", "Task answer")]),
      { type: "realtime", item: { ...voice, id: "reply", role: "assistant", text: "Spoken reply" } },
    ], nextCursor: "older" });
    const page = await loadSessionHistoryPage(call, row, "cursor");
    expect(call).toHaveBeenCalledExactlyOnceWith("thread/timeline/list", { threadId: row.id, cursor: "cursor", limit: 100 });
    expect(page.messages.map((m: { content: string }) => m.content)).toEqual(["Typed question", "Full spoken sentence", "Task answer", "Spoken reply"]);
    expect(page.nextCursor).toBe("older");
    const controls = new CodexSessionControls({ ready: true });
    controls.handle({ method: "thread/realtime/item/completed", params: { threadId: row.id, item: voice } });
    controls.handle({ method: "thread/realtime/item/completed", params: { threadId: row.id, item: voice } });
    const live = controls.snapshot(row.id).items;
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(page.messages[1].id);
    expect(live[0]).toMatchObject({ source: "voice", status: "completed", content: "Full spoken sentence" });
  });
  it("bounds the whole text payload, preserves UTF-8 and marks long messages as truncated", async () => {
    const call = vi.fn().mockResolvedValue({ data: entries(Array.from({ length: 12 }, (_, i) => item(String(i), "agentMessage", "汉🙂".repeat(10000)))), nextCursor: "next" });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages.reduce((n: number, m: { content: string }) => n + Buffer.byteLength(m.content), 0)).toBeLessThanOrEqual(PAGE_TEXT_BYTES);
    expect(page.messages.every((m: { truncated: boolean; content: string }) => m.truncated && !m.content.includes("�"))).toBe(true);
  });
  it("returns an empty page with its cursor without automatically reading additional pages", async () => {
    const call = vi.fn().mockResolvedValue({ data: entries([item("tool", "reasoning", "hidden")]), nextCursor: "next" });
    expect(await loadSessionHistoryPage(call, row)).toMatchObject({ messages: [], nextCursor: "next" });
    expect(call).toHaveBeenCalledTimes(1);
    await expect(loadSessionHistoryPage(call, row, {})).rejects.toThrow("Invalid history cursor");
  });
  it("keeps ordinary conversation text unchanged when the whole page fits its budget", async () => {
    const call = vi.fn().mockResolvedValue({ data: entries(Array.from({ length: 80 }, (_, i) => item(String(i), "agentMessage", "word ".repeat(100)))), nextCursor: "next" });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages).toHaveLength(80);
    expect(page.messages.every((m: { truncated: boolean; content: string }) => !m.truncated && m.content === "word ".repeat(100))).toBe(true);
  });
  it("keeps native phases and only public tool summaries for collapsed work", async () => {
    const call = vi.fn().mockResolvedValue({ data: entries([
      item("u", "userMessage", "hello"),
      { ...item("c", "agentMessage", "working"), phase: "commentary" },
      { type: "reasoning", id: "r", summary: ["public summary"], content: ["private reasoning"] },
      { type: "commandExecution", id: "tool", command: "echo fixture", aggregatedOutput: "huge output" },
      { ...item("f", "agentMessage", "final".repeat(3000)), phase: "final_answer" },
    ]) });
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
    const call = vi.fn().mockResolvedValue({ data: entries([{ id: "u", type: "userMessage", content }]) });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages[0]).toMatchObject({ content: "Fix the layout", truncated: false });
    expect(content[0].text).toBe(original);
  });
  it("preserves user messages and final Markdown when a page has many large tool entries", async () => {
    const answer = "Final answer\n![chart](/local/chart.png)";
    const call = vi.fn().mockResolvedValue({ data: entries([
      item("user", "userMessage", "继续"),
      ...Array.from({ length: 96 }, (_, i) => ({ id: String(i), type: "commandExecution", command: "command ".repeat(1000) })),
      { ...item("final", "agentMessage", answer), phase: "final_answer" },
    ]) });
    const page = await loadSessionHistoryPage(call, row);
    expect(page.messages[0]).toMatchObject({ content: "继续", truncated: false });
    expect(page.messages.at(-1)).toMatchObject({ content: answer, truncated: false });
    expect(page.messages.reduce((sum: number, message: { content: string }) => sum + Buffer.byteLength(message.content), 0)).toBeLessThanOrEqual(PAGE_TEXT_BYTES);
  });
});

it("extracts delegated voice requests before budgeting and hides synthetic handoff text", async () => {
  const raw = '<realtime_delegation><input>Confirm the voice channel.</input><transcript_delta>' + 'user: repeated old context\n'.repeat(10000) + '</transcript_delta></realtime_delegation>';
  const flush = '<realtime_delegation><source>transcript_tail_flush</source><input>The user just ended their realtime session.</input><transcript_delta>user: Confirm the voice channel.</transcript_delta></realtime_delegation>';
  const original = [item("voice", "userMessage", raw), item("flush", "userMessage", flush)];
  const call = vi.fn().mockResolvedValue({ data: entries(original) });
  const page = await loadSessionHistoryPage(call, row);
  expect(page.messages).toHaveLength(2);
  expect(page.messages[0]).toMatchObject({ content: "Confirm the voice channel.", truncated: false });
  expect(page.messages[1].content).toBe("");
  expect(original[0].content?.[0].text).toBe(raw);
});
