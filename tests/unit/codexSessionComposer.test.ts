import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { CodexOfficeStore } = require("../../server/codex-office-store");
const { CodexSessionComposer } = require("../../server/codex-session-composer");
const { CodexSessionWorkspace } = require("../../server/codex-session-workspace");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "office-composer-test-"))); roots.push(root);
  const call = vi.fn(async (method: string) => {
    if (method === "thread/start") return { thread: { id: "native-reader" } };
    if (method === "thread/timeline/list") return { data: [{ type: "item", turnId: "turn", item: { id: "message", type: "userMessage", content: [{ type: "text", text: "Target conversation context" }] } }], nextCursor: "older" };
    if (method === "skills/list") return { data: [{ skills: [{ name: "enabled", path: "/skills/enabled/SKILL.md", description: "Enabled skill", enabled: true }, { name: "disabled", path: "/skills/disabled/SKILL.md", description: "Disabled skill", enabled: false }] }] };
    if (method === "app/list") return { data: [{ id: "allowed", name: "Allowed", isAccessible: true, isEnabled: true }, { id: "blocked", name: "Blocked", isAccessible: true, isEnabled: true }], nextCursor: null };
    if (method === "app/installed") return { apps: [{ id: "allowed", enabled: true, callable: true }, { id: "blocked", enabled: true, callable: false }] };
    return {};
  });
  const client = { ready: true, call, respond: vi.fn() };
  const store = new CodexOfficeStore(path.join(root, "state"), client);
  const reader = await store.createSession({ name: "Reader", workspace: root, requestId: "reader" });
  const target = await store.createSession({ name: "Target", workspace: root, requestId: "target" });
  store.get(target.threadId).codexThreadId = "native-target";
  const workspace = new CodexSessionWorkspace(client, { roots: (row: { id: string }) => store.sessionFolders(row) });
  return { root, client, store, composer: new CodexSessionComposer(store, workspace), reader: reader.threadId, target: target.threadId };
}
describe("official Office composer integration", () => {
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
