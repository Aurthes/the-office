// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
it("keeps readable and historical notices out of original-user provenance", () => {
  const { sourceOf } = createRequire(import.meta.url)("../../server/office-reply-context");
  const taskId = "00000000-0000-4000-8000-000000000100";
  const current = `**From agent: worker2**\n\n[T100 · Goal](task://${taskId})\n\nKey result`;
  const legacy = `**From agent: worker2**\n\nWork on delegated Office task ${taskId}: Goal\nTask update: {}`;
  expect(sourceOf("head", user("new", current))).toBeNull();
  expect(sourceOf("head", user("old", legacy))).toBeNull();
  expect(sourceOf("head", user("question", `[Goal](task://${taskId}) needs review`))).not.toBeNull();
});
const define = (context: InstanceType<typeof OfficeReplyContext>, actor: string, summary: string, extra = {}) => context.context(actor, { questions: [{ key: "q", summary, ...extra }], answering: ["q"], requestId: summary });

it("registers a clarified child directly with its exact unique current source and original ancestry", async () => {
  const { context } = fixture();
  context.record("head", user("original", "Reduce task context", "first"));
  const parent = (await define(context, "head", "Reduce task context")).opened.q;
  context.record("head", user("clarification", "Fix extra round trips; keep suggestions", "second"));
  const result = await define(context, "head", "Fix extra round trips while retaining suggestions", { parentQuestionId: parent });
  expect(result.context.questions[0].sources.map((s: { itemId: string }) => s.itemId)).toEqual(["original", "clarification"]);
  expect(result.context.questions[0].parents).toEqual([{ id: parent, summary: "Reduce task context" }]);
});

it("projects Q summaries and a direct selection index while keeping provenance and ancestry in full records", async () => {
  const { context } = fixture();
  context.record("head", user("original", "实现看板并验证。".repeat(50)));
  const parent = (await define(context, "head", "Markout dashboard")).opened.q;
  const child = (await define(context, "head", "Verify dashboard", { parentQuestionId: parent })).opened.q;
  const full = context.state("head"), model = context.forModel("head");
  expect(model.answering).toEqual([child]);
  expect(model.context.questions).toEqual([{ id: child, summary: "Verify dashboard" }]);
  expect(model.knownQuestions).toEqual([{ id: parent, summary: "Markout dashboard" }]);
  expect(model).not.toHaveProperty("recentSources");
  expect(JSON.stringify(model)).not.toContain("excerpt");
  expect(JSON.stringify(model)).not.toContain("parents");
  expect(Buffer.byteLength(JSON.stringify(model))).toBeLessThan(Buffer.byteLength(JSON.stringify(full)));
  expect(context.state("head")).toEqual(full);
  context.prepare("head", "resume", context.current("head"), "continue");
  context.record("head", user("continue", "Continue where you left off.", "next"), "resume");
  expect(context.forModel("head").answering).toEqual([child]);
  expect(context.current("head").questions[0].sources[0].itemId).toBe("original");
  expect(context.current("head").questions[0].parents).toEqual([{ id: parent, summary: "Markout dashboard" }]);
});

it("registers and switches Qs directly without discovery or original-message queries", async () => {
  const { context } = fixture(), recent = vi.fn(), source = vi.fn();
  Object.assign(context.options, { recent, source });
  context.record("head", user("original", "Q1 memory; Q2 capacity"));
  expect(context.forModel("head")).not.toHaveProperty("recentSources");
  const result = await context.context("head", { questions: [{ key: "q1", summary: "Memory use" }, { key: "q2", summary: "Capacity scope" }], answering: ["q1"], requestId: "direct" });
  context.record("head", answer("first"));
  context.record("head", user("followup", "Answer the capacity question", "next"));
  const candidate = context.forModel("head").knownQuestions.find((q: { summary: string }) => q.summary === "Capacity scope");
  expect(candidate).toEqual({ id: result.opened.q2, summary: "Capacity scope" });
  await context.context("head", { answering: [candidate.id] });
  context.record("head", answer("second", "next"));
  expect(recent).not.toHaveBeenCalled(); expect(source).not.toHaveBeenCalled();
  expect(context.decorate("head", [answer("first"), answer("second", "next")]).map((item: { replyContext: { questions: { sources: { itemId: string }[] }[] } }) => item.replyContext.questions[0].sources[0].itemId)).toEqual(["original", "original"]);
});

it("retains exact source candidates only when needed to disambiguate several inputs in one call", async () => {
  const { context } = fixture();
  context.record("head", user("first", "Implement A")); context.record("head", user("second", "Implement B"));
  const model = context.forModel("head");
  expect(model.recentSources.map((s: { itemId: string }) => s.itemId)).toEqual(["first", "second"]);
  const selected = await define(context, "head", "Implement B", { source: model.recentSources[1] });
  expect(selected.context.questions[0].sources[0].itemId).toBe("second");
  expect(context.forModel("head")).not.toHaveProperty("recentSources");
});

it("splits one prompt into independent semantic Qs and freezes each reply before later selection", async () => {
  const { root, context } = fixture(), save = vi.spyOn(context, "save");
  context.record("head", user("original", "Q1: How much memory? Q2: Is the capacity shared?"));
  expect(context.current("head")).toBeNull(); // A message never declares a Q.
  const selected = await context.context("head", { questions: [{ key: "q1", summary: "Memory needed for one hour of markout" }, { key: "q2", summary: "Capacity scope: global or per symbol" }], answering: ["q1"], requestId: "two-q" });
  context.record("head", answer("a"));
  await context.context("head", { answering: [selected.opened.q2] });
  const before = save.mock.calls.length;
  for (let i = 0; i < 100; i++) context.record("head", answer("a"));
  expect(save.mock.calls.length).toBe(before);
  context.record("head", answer("b"));
  const restored = new OfficeReplyContext(root);
  const replies = restored.decorate("head", [answer("a"), answer("b")]);
  expect(replies.map((item: { replyContext: { questions: { summary: string }[] } }) => item.replyContext.questions.map(q => q.summary))).toEqual([["Memory needed for one hour of markout"], ["Capacity scope: global or per symbol"]]);
  expect(replies[0].replyContext.questions[0].sources).toEqual(replies[1].replyContext.questions[0].sources);
  expect(restored.decorate("head", [answer("unrelated", "other-turn")])[0].replyContext).toBeUndefined();
});

it.each(["continue", "handoff"])("preserves Q identity, summary and source through %s and never makes the control a Q", async kind => {
  const { root, context } = fixture();
  context.record("ceo", user("original", "Explain one hour markout memory"));
  const opened = await define(context, "ceo", "One hour markout memory");
  context.prepare("head", "resume", context.current("ceo"), kind);
  context.record("head", user("control", "Continue where you left off", "resumed"), "resume");
  context.record("head", answer("a", "resumed"));
  const restored = new OfficeReplyContext(root), q = restored.decorate("head", [answer("a", "resumed")])[0].replyContext.questions[0];
  expect(q.id).toBe(opened.opened.q); expect(q.summary).toBe("One hour markout memory");
  expect(q.sources).toEqual([{ threadId: "ceo", turnId: "turn", itemId: "original", excerpt: "Explain one hour markout memory" }]);
  expect(restored.state("head").recentSources).toEqual([]);
});

it("keeps a resumed Q even when Continue arrives without saved control metadata", async () => {
  const { context } = fixture(); context.record("head", user("q", "Explain capacity"));
  await define(context, "head", "Capacity scope"); const original = context.current("head");
  context.record("head", user("continue", "Continue where you left off.", "resume"));
  expect(context.current("head")).toEqual(original);
  await expect(define(context, "head", "Continue where you left off")).rejects.toThrow(/continuation/);
});

it("represents a specific step as a child Q with the original and clarification sources", async () => {
  const { context } = fixture(); context.record("head", user("initial", "Implement and deploy markout dashboard"));
  const parent = (await define(context, "head", "Markout dashboard")).opened.q;
  context.record("head", user("followup", "First verify the code, do not deploy", "next"));
  const child = await define(context, "head", "Verify dashboard code before deployment", { parentQuestionId: parent, source: { threadId: "head", turnId: "next", itemId: "followup" } });
  const q = child.context.questions[0];
  expect(q.parentQuestionId).toBe(parent); expect(q.parents).toEqual([{ id: parent, summary: "Markout dashboard" }]);
  expect(q.sources.map((source: { itemId: string }) => source.itemId)).toEqual(["initial", "followup"]);
  expect(child.context).not.toHaveProperty("taskId");
});

it("carries the selected child step through nested handoffs and reports without borrowing unrelated work", async () => {
  const { root, context } = fixture(); context.record("ceo", user("original", "RPI and non-RPI to one hour"));
  const parent = (await define(context, "ceo", "Extend maker markout to one hour")).opened.q;
  const task = { id: "maker", title: "Maker markout", replyContext: context.current("ceo") };
  const child = await define(context, "ceo", "Verify RPI and non-RPI coverage", { parentQuestionId: parent });
  const delegated = taskReplyContext(task, child.context);
  context.prepare("head", "handoff", delegated);
  context.record("head", user("notification", "**From agent: CEO**\n\n[Maker](task://00000000-0000-4000-8000-000000000100)\n\nVerify coverage"), "handoff");
  const nested = taskReplyContext(task, context.current("head")); context.prepare("worker", "nested", nested);
  context.record("worker", user("inbox", "Do the work"), "nested"); context.record("worker", answer("report"));
  context.record("head", user("other", "Fix the department panel", "different")); await define(context, "head", "Department panel");
  expect(taskReplyContext(task, context.current("head")).questions[0].id).toBe(parent);
  context.prepare("head", "return", nested);
  context.record("head", user("returned", "Office delegation submitted for your acceptance", "return-turn"), "return"); context.record("head", answer("final", "return-turn"));
  const restored = new OfficeReplyContext(root);
  for (const [id, item] of [["worker", answer("report")], ["head", answer("final", "return-turn")]] as const) expect(restored.decorate(id, [item])[0].replyContext).toEqual(delegated);
  expect(delegated.questions[0].id).toBe(child.opened.q);
});

it("requires explicit source selection for several messages and never invents historical Qs", async () => {
  const { context } = fixture(); context.record("head", user("first", "Implement A")); context.record("head", user("second", "Implement B"));
  await expect(define(context, "head", "Implement B")).rejects.toThrow(/ambiguous/);
  expect(context.forTask("head", "turn")).toBeNull();
  const result = await define(context, "head", "Implement B", { source: { threadId: "head", turnId: "turn", itemId: "second" } });
  expect(result.context.questions[0].sources[0].itemId).toBe("second");
  expect(context.decorate("head", [user("old", "Old question"), answer("old-answer")])[1].replyContext).toBeUndefined();
});

it("validates optional task/phase links and does not bind a new task to an unselected prompt", async () => {
  const { context } = fixture(); const task = { id: "panel", title: "Panel", phases: [{ id: "test", title: "Verify" }] };
  context.options.task = (id: string) => id === task.id ? task : null;
  context.record("head", user("original", "Build a department panel")); context.bindTask("head", task, "turn");
  expect(context.current("head")).toBeNull();
  const q = await define(context, "head", "Department panel");
  await expect(context.context("head", { answering: [q.opened.q], taskId: "panel", phaseId: "bad" })).rejects.toThrow(/phase/);
  await context.context("head", { answering: [q.opened.q], taskId: "panel", phaseId: "test" });
  expect(context.current("head")).toMatchObject({ taskId: "panel", phaseTitle: "Verify" });
  expect(context.forTask("head", "other-turn")).toBeNull();
});

it("makes question registration retries idempotent and rejects partial invalid batches", async () => {
  const { context } = fixture(); context.record("head", user("q", "Explain memory"));
  const first = await define(context, "head", "Memory"); expect((await define(context, "head", "Memory")).opened).toEqual(first.opened);
  await expect(context.context("head", { questions: [{ key: "q", summary: "Different" }], requestId: "Memory" })).rejects.toThrow(/conflict/);
  await expect(context.context("head", { questions: [{ key: "a", summary: "A" }, { key: "a", summary: "B" }], requestId: "invalid" })).rejects.toThrow(/unique/);
  expect(context.state("head").knownQuestions).toHaveLength(1);
});

it("matches handoffs only by native client identity and leaves unknown Qs explicitly unknown", async () => {
  const { context } = fixture(); context.record("ceo", user("q", "Explain shared capacity")); await define(context, "ceo", "Shared capacity");
  const delegated = context.current("ceo"); context.prepare("head", "known-client", delegated);
  context.record("head", user("other", "Same request text"), "different-client");
  expect(context.current("head")).toBeNull(); context.record("head", answer("unknown"));
  expect(context.decorate("head", [answer("unknown")])[0].replyContext).toEqual({ questions: [] });
  context.record("head", user("handoff", "Same request text", "handoff-turn"), "known-client"); expect(context.current("head")).toEqual(delegated);
});

it("migrates old message associations as provenance without turning copied prompts into semantic Qs", () => {
  const { root } = fixture(), source = { threadId: "head", turnId: "t", itemId: "q", excerpt: "A long prompt with several requests" };
  mkdirSync(path.join(root, "reply-context")); writeFileSync(path.join(root, "reply-context/head.json"), JSON.stringify({ questions: { q: { taskTitle: "Legacy", sources: [source] } }, answers: { "t:a": "q" } }));
  const restored = new OfficeReplyContext(root), reply = restored.decorate("head", [answer("a", "t")])[0].replyContext;
  expect(reply.questions).toEqual([]); expect(reply.sources).toEqual([source]);
  expect(taskReplyContext({ id: "old", title: "Old task" })).toEqual({ taskId: "old", taskTitle: "Old task", questions: [], sources: [] });
});

it("attaches semantic context to the first live delta and ignores late events from a different turn", async () => {
  const { context } = fixture(), controls = new CodexSessionControls({ ready: true }, () => [], { replyContext: context });
  const input = (id: string, text: string) => controls.handle({ method: "item/completed", params: { threadId: "head", turnId: "t", item: { type: "userMessage", id, content: [{ type: "text", text }] } } });
  input("first", "First question"); await define(context, "head", "Memory capacity");
  controls.handle({ method: "item/agentMessage/delta", params: { threadId: "head", turnId: "t", itemId: "a", delta: "Answer" } });
  input("second", "Second question");
  controls.handle({ method: "item/agentMessage/delta", params: { threadId: "head", turnId: "t", itemId: "a", delta: " complete" } });
  const item = controls.snapshot("head").items.find((item: { id: string }) => item.id === "t:a");
  expect(item).toMatchObject({ content: "Answer complete", replyContext: { questions: [{ summary: "Memory capacity", sources: [{ itemId: "first" }] }] } });
  await define(context, "head", "Later Q", { source: { threadId: "head", turnId: "t", itemId: "second" } });
  context.record("head", answer("late", "older-turn")); expect(context.decorate("head", [answer("late", "older-turn")])[0].replyContext).toEqual({ questions: [] });
});

it("binds explicit self phase context and overrides a different candidate phase without changing original Q provenance", async () => {
  const { context } = fixture();
  const row = { id: "shared", title: "Shared", phases: [{ id: "a", title: "Teaser" }, { id: "b", title: "Clone" }] };
  context.options.task = (id: string) => id === row.id ? row : null;
  context.record("head", user("phase-source", "Implement both phases"));
  const selected = await context.context("head", { questions: [{ key: "q", summary: "Implement the shared goal" }], answering: ["q"], requestId: "phase-question" });
  context.bindTask("head", row, "turn", "b");
  expect(context.current("head")).toMatchObject({ taskId: "shared", phaseId: "b", phaseTitle: "Clone" });
  const root = { ...row, replyContext: context.current("head") }, projected = taskReplyContext(root, context.current("head"), "a");
  expect(projected).toMatchObject({ taskId: "shared", phaseId: "a", phaseTitle: "Teaser", questions: [{ id: selected.opened.q }] });
  expect(projected.questions[0].sources).toEqual(context.current("head").questions[0].sources);
});
