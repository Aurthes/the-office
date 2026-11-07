import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { CodexOfficeStore } = require("../../server/codex-office-store");
const { CodexSessionComposer } = require("../../server/codex-session-composer");
const { CodexSessionControls } = require("../../server/codex-session-controls");
const { CodexSessionWorkspace } = require("../../server/codex-session-workspace");
const { OfficeTodos } = require("../../server/office-todos");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "office-composer-test-"))); roots.push(root);
  const call = vi.fn(async (method: string) => {
    if (method === "thread/start") return { thread: { id: "native-reader" } };
    if (method === "thread/timeline/list") return { data: [{ type: "item", turnId: "turn", item: { id: "message", type: "userMessage", content: [{ type: "text", text: "Target conversation context" }] } }], nextCursor: "older" };
    if (method === "skills/list") return { data: [{ skills: [{ name: "enabled", path: "/skills/enabled/SKILL.md", description: "Enabled skill", enabled: true }, { name: "disabled", path: "/skills/disabled/SKILL.md", description: "Disabled skill", enabled: false }] }] };
    if (method === "app/list") throw new Error("Remote app directory unavailable");
    if (method === "app/installed") return { apps: [{ id: "allowed", runtimeName: "Allowed", enabled: true, callable: true }, { id: "blocked", enabled: true, callable: false }, { id: "disabled", enabled: false, callable: false }] };
    return {};
  });
  const client = { ready: true, call, respond: vi.fn() };
  const store = new CodexOfficeStore(path.join(root, "state"), client);
  const reader = await store.createSession({ name: "Reader", workspace: root, requestId: "reader" });
  const target = await store.createSession({ name: "Target", workspace: root, requestId: "target" });
  store.get(target.threadId).codexThreadId = "native-target";
  const workspace = new CodexSessionWorkspace(client, { roots: (row: { id: string }) => store.sessionFolders(row) });
  const todos = new OfficeTodos(path.join(root, "tasks"), { projects: () => [], agents: () => [] });
  const composer = new CodexSessionComposer(store, workspace); composer.todos = todos;
  return { root, client, store, composer, todos, reader: reader.threadId, target: target.threadId };
}
describe("official Office composer integration", () => {
  it("searches task codes and titles across the whole registry, including completed tasks and exact codes", async () => {
    const f = await fixture();
    const tasks = Array.from({ length: 80 }, (_, i) => f.todos.create({ requestId: `task-${i}`, title: i === 79 ? "Needle task" : "Same title", phases: [{ title: "Verify" }] }).todo);
    f.todos.change({ id: tasks[0].id, revision: tasks[0].revision, phaseId: tasks[0].phases[0].id }, "complete");
    expect(f.todos.list().todos).toHaveLength(25);
    expect((await f.composer.options(f.reader, "task", "Needle")).options).toEqual([expect.objectContaining({ id: tasks[79].id, name: "T80 Needle task" })]);
    expect((await f.composer.options(f.reader, "task", "t1")).options[0]).toMatchObject({ id: tasks[0].id, name: "T1 Same title" });
    const before = JSON.stringify([...f.todos.rows]);
    expect((await f.composer.prepare(f.reader, "Discuss @task T80")).text).toBe("Discuss @task T80");
    await f.composer.prepare(f.reader, "Compare", [{ kind: "task", id: tasks[79].id }]);
    expect(JSON.stringify([...f.todos.rows])).toBe(before);
    expect(f.client.call).not.toHaveBeenCalled();
  });
  it("sends the selected task UUID and concise retrieval guidance in the actual native turn without embedding the plan", async () => {
    const f = await fixture();
    const a = f.todos.create({ requestId: "a", title: "Same title", documentation: "PRIVATE TASK PLAN", phases: [{ title: "Verify" }] }).todo;
    const b = f.todos.create({ requestId: "b", title: "Same title", phases: [{ title: "Verify" }] }).todo;
    f.todos.change({ id: a.id, revision: a.revision, title: "Renamed task" }, "edit");
    f.client.call.mockImplementation(async (method: string) => method === "thread/turns/list" ? { data: [] } : method === "turn/start" ? { turn: { id: "started" } } : {});
    const controls = new CodexSessionControls(f.client, () => [], { composer: f.composer });
    try {
      await controls.send(f.reader, "Review @T1 Same title", "task-send", [], { references: [{ kind: "task", id: a.id, name: "T1 Same title", start: 7, end: 21 }] });
      const expected = `Review [@T1 Renamed task](task://${a.id})\nTask references: read office_tasks.todo_get using the UUID in each task:// link.`;
      expect(f.client.call).toHaveBeenCalledWith("turn/start", expect.objectContaining({ input: [{ type: "text", text: expected }] }));
      expect(expected).not.toContain(b.id); expect(expected).not.toContain("PRIVATE TASK PLAN");
      expect(f.todos.get({ id: a.id }).todo.title).toBe("Renamed task");
      await expect(f.composer.prepare(f.reader, "Task", [{ kind: "task", id: "T1" }])).rejects.toThrow(/no longer available/);
      await expect(f.composer.prepare(f.reader, "Task", [{ kind: "task", id: crypto.randomUUID() }])).rejects.toThrow(/no longer available/);
    } finally { controls.close(); }
  });
  it("resolves inline links in source order and preserves repeated references", async () => {
    const f = await fixture();
    const text = "Compare @Target with @Reader, then ask @Target.";
    const references = [
      { kind: "chat", id: f.target, name: "Target", start: text.lastIndexOf("@Target"), end: text.lastIndexOf("@Target") + 7 },
      { kind: "chat", id: f.target, name: "Target", start: 8, end: 15 },
      { kind: "chat", id: f.reader, name: "Reader", start: 21, end: 28 },
    ];
    expect((await f.composer.prepare(f.reader, text, references)).text).toBe(`Compare [@Target](thread://${f.target}) with [@Reader](thread://${f.reader}), then ask [@Target](thread://${f.target}).`);
    const repeated = Array(9).fill("@Target").join(" ");
    expect((await f.composer.prepare(f.reader, repeated, Array.from({ length: 9 }, (_, i) => ({ kind: "chat", id: f.target, name: "Target", start: i * 8, end: i * 8 + 7 })))).text.match(/thread:\/\//g)).toHaveLength(9);
  });
  it("rejects stale, overlapping or mixed ranges before resolving a reference", async () => {
    const f = await fixture();
    const ref = { kind: "chat", id: f.target, name: "Target", start: 0, end: 7 };
    for (const references of [[{ ...ref, end: 8 }], [{ ...ref, start: -1 }], [ref, ref], [ref, { kind: "chat", id: f.target }], [{ ...ref, name: "Someone" }]]) {
      await expect(f.composer.prepare(f.reader, "@Target", references)).rejects.toThrow("range");
    }
  });
  it("keeps repeated skills in place while activating the skill only once", async () => {
    const f = await fixture();
    const prepared = await f.composer.prepare(f.reader, "Use $enabled then $enabled", [
      { kind: "skill", id: "/skills/enabled/SKILL.md", name: "enabled", start: 4, end: 12 },
      { kind: "skill", id: "/skills/enabled/SKILL.md", name: "enabled", start: 18, end: 26 },
    ]);
    expect(prepared.text).toBe("Use $enabled then $enabled");
    expect(prepared.items).toEqual([{ type: "skill", name: "enabled", path: "/skills/enabled/SKILL.md" }]);
  });
  it("sends inline identities to Codex in the actual native turn text", async () => {
    const f = await fixture();
    f.client.call.mockImplementation(async (method: string) => method === "thread/turns/list" ? { data: [] } : method === "turn/start" ? { turn: { id: "started" } } : {});
    const controls = new CodexSessionControls(f.client, () => [], { composer: f.composer });
    await controls.send(f.reader, "Ask @Target to check", "inline-send", [], { references: [{ kind: "chat", id: f.target, name: "Target", start: 4, end: 11 }] });
    expect(f.client.call).toHaveBeenCalledWith("turn/start", expect.objectContaining({ input: [{ type: "text", text: `Ask [@Target](thread://${f.target}) to check` }] }));
    controls.close();
  });
  it("registers Office-owned tools on new native threads and keeps existing chats as reference targets", async () => {
    const f = await fixture();
    expect(f.composer.canReference(f.reader)).toBe(true);
    expect(f.composer.canReference(f.target)).toBe(false);
    await f.store.ensureThread(f.store.get(f.reader));
    expect(f.client.call).toHaveBeenCalledWith("thread/start", expect.objectContaining({ dynamicTools: [expect.objectContaining({ name: "office" })] }));
    expect(f.store.get(f.reader).composerToolsVersion).toBe(1);
    const prepared = await f.composer.prepare(f.reader, "Summarize it", [{ kind: "chat", id: f.target }]);
    expect(prepared.text).toContain(`[@Target](thread://${f.target})`);
    expect(prepared.text).not.toContain("Target conversation context");
    await expect(f.composer.prepare(f.target, "Read reader", [{ kind: "chat", id: f.reader }])).rejects.toThrow("older chat");
    expect((await f.composer.options(f.reader, "chat")).options.map((x: { id: string }) => x.id)).toEqual([f.target]);
    expect(f.client.call.mock.calls.some(([method]: [string]) => method === "thread/list")).toBe(false);
  });
  it("executes the read tool through public history RPC without resuming or sending to the target", async () => {
    const f = await fixture(); await f.store.ensureThread(f.store.get(f.reader));
    const result = await f.composer.tool({ namespace: "office", tool: "read_thread", threadId: "native-reader", arguments: { threadId: f.target } });
    expect(result.messages[0].content).toBe("Target conversation context");
    expect(result.nextCursor).toBe("older");
    expect(f.client.call).toHaveBeenCalledWith("thread/timeline/list", expect.objectContaining({ threadId: "native-target" }));
    expect(f.client.call.mock.calls.some(([method]: [string]) => method === "thread/resume" || method === "turn/start")).toBe(false);
    await expect(f.composer.tool({ tool: "read_thread", threadId: "foreign-native-thread", arguments: { threadId: f.target } })).rejects.toThrow("registered Office");
    await expect(f.composer.tool({ tool: "read_thread", threadId: "native-reader", arguments: { threadId: "foreign-target" } })).rejects.toThrow("missing or archived");
  });
  it("rejects disabled skills and apps whose effective runtime policy forbids calls", async () => {
    const f = await fixture();
    const skill = await f.composer.prepare(f.reader, "Use it", [{ kind: "skill", id: "/skills/enabled/SKILL.md" }]);
    expect(skill.items).toEqual([{ type: "skill", name: "enabled", path: "/skills/enabled/SKILL.md" }]);
    await expect(f.composer.prepare(f.reader, "Use it", [{ kind: "skill", id: "/skills/disabled/SKILL.md" }])).rejects.toThrow("no longer available");
    expect((await f.composer.options(f.reader, "app")).options.find((x: { id: string }) => x.id === "blocked").disabled).toBe(true);
    await expect(f.composer.prepare(f.reader, "Use it", [{ kind: "app", id: "blocked" }])).rejects.toThrow("no longer available");
    expect((await f.composer.prepare(f.reader, "Use it", [{ kind: "app", id: "allowed" }])).items).toEqual([{ type: "mention", name: "Allowed", path: "app://allowed" }]);
  });
  it("validates a selected skill beyond the first displayed page", async () => {
    const f = await fixture();
    f.client.call.mockImplementation(async () => ({ data: [{ skills: Array.from({ length: 80 }, (_, index) => ({ name: `skill-${index}`, path: `/skills/${index}/SKILL.md`, description: "", enabled: true })) }] }));
    expect((await f.composer.options(f.reader, "skill", "skill-79")).options[0].id).toBe("/skills/79/SKILL.md");
    expect((await f.composer.prepare(f.reader, "Run it", [{ kind: "skill", id: "/skills/79/SKILL.md" }])).items[0].name).toBe("skill-79");
  });
  it("reads installed app policy for the native thread and revalidates before sending", async () => {
    const f = await fixture(); f.store.get(f.reader).codexThreadId = "native-reader";
    const options = (await f.composer.options(f.reader, "app")).options;
    expect(options).toEqual([
      { kind: "app", id: "allowed", name: "Allowed", description: "", disabled: false },
      { kind: "app", id: "blocked", name: "blocked", description: "", disabled: true },
    ]);
    expect(f.client.call).toHaveBeenCalledWith("app/installed", { threadId: "native-reader", forceRefresh: false });
    expect(f.client.call.mock.calls.some(([method]) => method === "app/list")).toBe(false);
    f.client.call.mockResolvedValueOnce({ apps: [{ id: "allowed", runtimeName: "Allowed", enabled: true, callable: false }] });
    await expect(f.composer.prepare(f.reader, "Use it", [{ kind: "app", id: "allowed" }])).rejects.toThrow("no longer available");
    f.client.call.mockRejectedValueOnce(new Error("runtime disconnected"));
    await expect(f.composer.options(f.reader, "app")).rejects.toThrow("runtime disconnected");
    expect((await f.composer.options(f.reader, "app")).options[0].name).toBe("Allowed");
  });
  it("rejects file references escaping an attached workspace through a symlink", async () => {
    const f = await fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "office-composer-outside-")); roots.push(outside);
    fs.writeFileSync(path.join(outside, "private.txt"), "outside"); fs.symlinkSync(outside, path.join(f.root, "escape"));
    await expect(f.composer.prepare(f.reader, "Read", [{ kind: "file", id: path.join(f.root, "escape/private.txt") }])).rejects.toThrow("outside");
    fs.writeFileSync(path.join(f.root, "safe.txt"), "inside");
    expect((await f.composer.prepare(f.reader, "Read", [{ kind: "file", id: path.join(f.root, "safe.txt") }])).text).toContain("safe.txt");
  });
  it("replies to unsupported Office tool calls instead of leaving a pending approval", async () => {
    const f = await fixture(); await f.store.ensureThread(f.store.get(f.reader));
    expect(f.composer.handleToolCall({ id: 42, method: "item/tool/call", params: { namespace: "office", threadId: "native-reader", tool: "delete_thread", arguments: {} } })).toBe(true);
    await vi.waitFor(() => expect(f.client.respond).toHaveBeenCalledWith(42, expect.objectContaining({ success: false })));
  });
});
