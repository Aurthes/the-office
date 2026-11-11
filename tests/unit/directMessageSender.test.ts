// @vitest-environment node
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
const { directMessage, taskNotification } = createRequire(import.meta.url)("../../server/office-delegation.js");
const { CodexSessionControls } = createRequire(import.meta.url)("../../server/codex-session-controls.js");
const actor = { id: "alice", name: "Alice *Ops*" };
const store = { get: (id: string) => { if (id !== actor.id) throw Error("Session is missing"); return actor; } };
it("uses the explicit registered actor and escapes their current name without trusting supplied names or target", () => {
  const input = { actorId: "alice", threadId: "bob", senderName: "CEO", message: "Exact body\n\nwith Markdown **kept**" };
  expect(directMessage(store, input)).toBe("**From agent: Alice \\*Ops\\***\n\n"+input.message);
  expect(input.message).toBe("Exact body\n\nwith Markdown **kept**");
  expect(directMessage(store, { threadId: "alice", senderName: "Alice", message: "Anonymous body" })).toBe("Anonymous body");
});
it.each([null, "", 123, "missing"])("refuses invalid explicit actor %j before sending", actorId => {
  expect(() => directMessage(store, { actorId, message: "Message" })).toThrow();
});
it("rejects archived actors and empty agent messages, keeps anonymous user text untouched", () => {
  expect(() => directMessage({ get: () => ({ ...actor, archived: true }) }, { actorId: "alice", message: "Hi" })).toThrow(/active/);
  expect(() => directMessage(store, { actorId: "alice", message: " " })).toThrow(/message/);
  expect(directMessage(store, { message: " " })).toBe(" ");
  const official = taskNotification({ id: "task", code: "T1", title: "Work" }, { state: "working", instructions: "Do work" }, undefined, { source: "agent", ...actor });
  expect(official.match(/From agent:/g)).toHaveLength(1);
});
it("preserves native input, request retry deduplication and retained message snapshots", async () => {
  const native = { ready: true, call: vi.fn(async (method: string) => method === "thread/turns/list" ? { data: [] } : method === "turn/start" ? { turn: { id: "new-turn" } } : {}) };
  const controls = new CodexSessionControls(native), input = { actorId: "alice", message: "Original **body**" };
  const text = directMessage(store, input);
  const first = await controls.send("bob", text, "request-one");
  expect(await controls.send("bob", text, "request-one")).toEqual(first);
  expect(native.call.mock.calls.filter(([m]) => m === "turn/start")).toHaveLength(1);
  expect(native.call).toHaveBeenCalledWith("turn/start", expect.objectContaining({ input: [expect.objectContaining({ type: "text", text })] }));
  await expect(controls.send("bob", text+" changed", "request-one")).rejects.toThrow(/冲突/);
  const userFrame = { method: "item/completed", params: { threadId: "bob", turnId: "new-turn", item: { id: "input", type: "userMessage", content: [{ type: "text", text }] } } };
  controls.handle(userFrame);
  expect(controls.snapshot("bob").items[0]).toMatchObject({ role: "user", content: text });
  const reloaded = new CodexSessionControls(native);
  reloaded.handle(JSON.parse(JSON.stringify(userFrame)));
  expect(reloaded.snapshot("bob").items[0]).toMatchObject({ role: "user", content: text });
  controls.close(); reloaded.close();
});
