import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls.js");
function setup(active = false) {
  const client = { ready: true, respond: vi.fn(), call: vi.fn(async (method: string) => {
    if (method === "thread/loaded/list") return { data: ["original-id", "id"] };
    if (method === "thread/turns/list") return { data: active ? [{ id: "active-turn", status: "inProgress" }] : [] };
    if (method === "turn/start") return { turn: { id: "new-turn" } };
    if (method === "turn/steer") return { turnId: "active-turn" };
    return {};
  }) };
  return { client, controls: new CodexSessionControls(client) };
}
describe("shared App session controls", () => {
  it("starts the original thread without overriding its model, permissions, or workspace, and deduplicates send retries", async () => {
    const { client, controls } = setup();
    await controls.send("original-id", "hello", "request-1");
    await controls.send("original-id", "hello", "request-1");
    expect(client.call.mock.calls.filter(([method]) => method === "turn/start")).toEqual([["turn/start", { threadId: "original-id", input: [{ type: "text", text: "hello" }] }]]);
    expect(client.call).toHaveBeenCalledWith("thread/resume", { threadId: "original-id", excludeTurns: true });
    expect(client.call.mock.calls.some(([method]) => method === "thread/start")).toBe(false);
  });
  it("steers and stops the existing active turn", async () => {
    const { client, controls } = setup(true);
    await controls.send("original-id", "follow up", "request-2");
    expect(client.call).toHaveBeenCalledWith("turn/steer", { threadId: "original-id", expectedTurnId: "active-turn", input: [{ type: "text", text: "follow up" }] });
    await controls.stop("original-id");
    expect(client.call).toHaveBeenCalledWith("turn/interrupt", { threadId: "original-id", turnId: "active-turn" });
  });
  it("does not retry an uncertain send or fall back to a different owner", async () => {
    const { client, controls } = setup();
    client.call.mockImplementation(async (method: string) => { if (method === "turn/start") throw new Error("connection lost"); return ["thread/turns/list", "thread/loaded/list"].includes(method) ? { data: method === "thread/loaded/list" ? ["id"] : [] } : {}; });
    await expect(controls.send("id", "hello", "request")).rejects.toThrow("connection lost");
    await expect(controls.send("id", "hello", "request")).rejects.toThrow("未重复发送");
    expect(client.call.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
    client.ready = false;
    await expect(controls.stop("id")).rejects.toThrow("只读");
  });
  it("matches approvals to their thread, submits once and clears only after native confirmation", () => {
    const { client, controls } = setup();
    controls.handle({ id: 17, method: "item/commandExecution/requestApproval", params: { threadId: "id", turnId: "turn", itemId: "cmd", command: "echo test" } });
    expect(() => controls.reply("other", "17", "accept")).toThrow("不属于");
    controls.reply("id", "17", "decline");
    expect(client.respond).toHaveBeenCalledWith(17, { decision: "decline" });
    expect(controls.snapshot("id").approvals[0].submitted).toBe(true);
    expect(() => controls.reply("id", "17", "accept")).toThrow("已提交");
    controls.handle({ method: "serverRequest/resolved", params: { threadId: "id", requestId: 17 } });
    expect(controls.snapshot("id").approvals).toEqual([]);
  });
  it("keeps unsupported requests for the App and requires complete file changes for web approval", () => {
    const { client, controls } = setup();
    controls.handle({ id: 1, method: "item/tool/call", params: { threadId: "id" } });
    expect(controls.snapshot("id").approvals[0].supported).toBe(false);
    expect(() => controls.reply("id", "1", "accept")).toThrow("原 App");
    controls.handle({ id: 2, method: "item/fileChange/requestApproval", params: { threadId: "id", turnId: "t", itemId: "file" } });
    expect(() => controls.reply("id", "2", "accept")).toThrow("完整文件");
    expect(client.respond).not.toHaveBeenCalled();
  });
  it("bounds streamed text and returns only changed items", () => {
    const { controls } = setup();
    controls.handle({ method: "item/agentMessage/delta", params: { threadId: "id", turnId: "t", itemId: "m", delta: "字".repeat(10000) } });
    const snapshot = controls.snapshot("id");
    expect(snapshot.items[0].content.length).toBe(2048);
    expect(snapshot.items[0].truncated).toBe(true);
    expect(controls.snapshot("id", snapshot.version).items).toEqual([]);
  });
  it("does not create a substitute runtime for a thread the App has not loaded", async () => {
    const { client, controls } = setup();
    await expect(controls.attach("unloaded-id")).rejects.toThrow("原 App 打开");
    expect(client.call.mock.calls.some(([method]) => method === "thread/resume")).toBe(false);
  });
  it("clears interrupted tool requests when their turn ends without a separate resolved event", () => {
    const { controls } = setup();
    controls.handle({ id: 5, method: "item/tool/call", params: { threadId: "id", turnId: "old" } });
    controls.handle({ method: "turn/started", params: { threadId: "id", turn: { id: "current" } } });
    controls.handle({ method: "turn/completed", params: { threadId: "id", turn: { id: "old", status: "interrupted" } } });
    expect(controls.snapshot("id").approvals).toEqual([]);
    expect(controls.snapshot("id").activeTurnId).toBe("current");
  });
});
