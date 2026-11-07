// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const { OfficeReplyContext, taskReplyContext } = createRequire(import.meta.url)("../../server/office-reply-context");
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls");
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "reply-context-")); directories.push(root);
  return { root, context: new OfficeReplyContext(root) };
}
const user = (itemId: string, content: string, turnId = "turn") => ({ id: `${turnId}:${itemId}`, turnId, role: "user", content });
const answer = (itemId: string, turnId = "turn") => ({ id: `${turnId}:${itemId}`, turnId, role: "assistant", content: "Answer" });

it("freezes each answer at its first event, survives restart and never writes for streaming tokens", () => {
  const { root, context } = fixture(), save = vi.spyOn(context, "save");
  context.record("head", user("first", "How much memory?"));
  context.record("head", answer("a"));
  context.record("head", user("second", "Is the capacity shared?"));
  context.record("head", user("first", "How much memory?")); // late completion
  for (let i = 0; i < 100; i++) context.record("head", answer("a"));
  context.record("head", answer("b"));
  expect(save).toHaveBeenCalledTimes(4);
  const restored = new OfficeReplyContext(root);
  const replies = restored.decorate("head", [answer("a"), answer("b")]);
  expect(replies.map((item: { replyContext: { sources: { excerpt: string }[] } }) => item.replyContext.sources[0].excerpt)).toEqual(["How much memory?", "Is the capacity shared?"]);
  expect(restored.current("head").sources[0].itemId).toBe("second");
  expect(restored.decorate("head", [answer("unrelated", "other-turn")])[0].replyContext).toBeUndefined();
});

it("carries an exact original request through nested handoffs and reports while unrelated work intervenes", () => {
  const { root, context } = fixture();
  context.record("ceo", user("original", "RPI and non-RPI to one hour"));
  const task = { id: "maker", title: "Maker markout", replyContext: context.current("ceo") };
  const delegated = taskReplyContext(task, context.current("ceo"));
  context.prepare("head", "handoff", delegated);
  context.record("head", user("notification", "Work on delegated Office task maker"), "handoff");
  const nested = taskReplyContext(task, context.current("head"));
  context.prepare("worker", "nested", nested);
  context.record("worker", user("inbox", "Do the work"), "nested");
  context.record("worker", answer("report"));
  context.record("head", user("other", "Fix the department panel", "different"));
  context.prepare("head", "return", nested);
  context.record("head", user("returned", "Office delegation submitted for your acceptance", "return-turn"), "return");
  context.record("head", answer("final", "return-turn"));
  const restored = new OfficeReplyContext(root);
  for (const [id, item] of [["worker", answer("report")], ["head", answer("final", "return-turn")]] as const) {
    expect(restored.decorate(id, [item])[0].replyContext).toEqual(delegated);
  }
  expect(delegated.sources).toHaveLength(1);
  expect(delegated.sources[0]).toMatchObject({ threadId: "ceo", turnId: "turn", itemId: "original" });
  const unrelated = { taskId: "different", sources: [{ threadId: "elsewhere", turnId: "t", itemId: "wrong", excerpt: "Wrong question" }] };
  expect(taskReplyContext(task, unrelated)).toEqual(delegated);
});

it("retains the original request and specific follow-up without manufacturing missing historical origins", () => {
  const { context } = fixture();
  context.record("head", user("initial", "Show markout"));
  const task = { id: "markout", title: "Markout", replyContext: context.current("head") };
  context.record("head", user("followup", "Make the horizon one hour", "next"));
  const next = taskReplyContext(task, context.current("head"));
  expect(next.sources.map((source: { itemId: string }) => source.itemId)).toEqual(["initial", "followup"]);
  expect(taskReplyContext({ id: "legacy", title: "Old task" })).toEqual({ taskId: "legacy", taskTitle: "Old task", sources: [] });
  context.record("head", user("legacy-notification", "Office delegation submitted for your acceptance. Task legacy: Old task", "legacy"));
  expect(context.decorate("head", [answer("legacy-answer", "legacy")])[0].replyContext).toBeUndefined();
});

it("only derives an old local reply from a preceding input in the same native turn", () => {
  const { context } = fixture();
  const page = context.decorate("head", [user("q", "The real question"), answer("a"), answer("next", "other")]);
  expect(page[1].replyContext.sources[0].itemId).toBe("q");
  expect(page[2].replyContext).toBeUndefined();
  context.record("head", user("unicode", "汉🙂".repeat(200)));
  const excerpt = context.current("head").sources[0].excerpt;
  expect(Buffer.byteLength(excerpt)).toBeLessThanOrEqual(512);
  expect(excerpt).not.toContain("�");
});

it("binds a newly created task to its actual active request and does not borrow another turn", () => {
  const { context } = fixture();
  context.record("head", user("request", "Implement the panel"));
  expect(context.current("head", "different-turn")).toBeNull();
  context.bindTask("head", { id: "panel", title: "Department panel" }, "turn");
  context.record("head", answer("done"));
  expect(context.decorate("head", [answer("done")])[0].replyContext).toMatchObject({ taskId: "panel", taskTitle: "Department panel", sources: [{ itemId: "request" }] });
  context.bindTask("head", { id: "unrelated", title: "Unrelated task" }, "turn");
  expect(context.current("head").taskId).toBe("panel");
});

it("matches handoff provenance only by its native client identity, never by identical message text", () => {
  const { context } = fixture();
  const delegated = { taskId: "delegated", taskTitle: "Delegated task", sources: [{ threadId: "ceo", turnId: "original", itemId: "q", excerpt: "Original request" }] };
  context.prepare("head", "known-client", delegated);
  context.record("head", user("other", "Same request text"), "different-client");
  expect(context.current("head")).toMatchObject({ sources: [{ threadId: "head", itemId: "other" }] });
  expect(context.current("head").taskId).toBeUndefined();
  context.record("head", user("handoff", "Same request text", "handoff-turn"), "known-client");
  expect(context.current("head")).toEqual(delegated);
});

it("does not guess a task origin from several unlinked questions steered into one turn", () => {
  const { context } = fixture();
  context.record("head", user("first", "Implement task A"));
  expect(context.forTask("head", "turn").sources[0].itemId).toBe("first");
  context.record("head", user("second", "What about task B?"));
  expect(context.forTask("head", "turn")).toBeNull();
  context.bindTask("head", { id: "a", title: "Task A" }, "turn");
  expect(context.current("head").taskId).toBeUndefined();
});

it("attaches context to the first live delta and preserves it across steering and bounded snapshots", () => {
  const { context } = fixture();
  const controls = new CodexSessionControls({ ready: true }, () => [], { replyContext: context });
  const input = (id: string, text: string) => controls.handle({ method: "item/completed", params: { threadId: "head", turnId: "t", item: { type: "userMessage", id, content: [{ type: "text", text }] } } });
  input("first", "First question");
  controls.handle({ method: "item/agentMessage/delta", params: { threadId: "head", turnId: "t", itemId: "a", delta: "Answer" } });
  input("second", "Second question");
  controls.handle({ method: "item/agentMessage/delta", params: { threadId: "head", turnId: "t", itemId: "a", delta: " complete" } });
  const item = controls.snapshot("head").items.find((item: { id: string }) => item.id === "t:a");
  expect(item).toMatchObject({ content: "Answer complete", replyContext: { sources: [{ itemId: "first", excerpt: "First question" }] } });
});
