// @vitest-environment node
import { createRequire } from "node:module";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
const { createGatewayClient } = createRequire(import.meta.url)("../../server/office-todo-mcp.js");
it("exposes nullable Owner metadata independently on create/edit/list without changing delegation inputs", () => {
  const { tools } = createRequire(import.meta.url)("../../server/office-todo-mcp.js");
  for (const name of ["todo_create", "todo_edit", "todo_list"]) {
    const schema = tools.find((tool: { name: string }) => tool.name === name).inputSchema;
    expect(schema.properties.ownerId.type).toEqual(["string", "null"]);
    expect(schema.properties.assigneeId).toBeTruthy(); expect(schema.required).not.toContain("ownerId");
  }
  expect(tools.find((tool: { name: string }) => tool.name === "todo_delegate").inputSchema.properties).not.toHaveProperty("ownerId");
});
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type RequestFrame = { id: string; method: string; params: { value?: number; parallel?: boolean; fail?: boolean } };
async function fixture(onCall: (ws: WebSocket, frame: RequestFrame) => void, options: { timeoutMs?: number; failAuth?: boolean } = {}) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  cleanup.push(() => { for (const ws of server.clients) ws.terminate(); return new Promise<void>(resolve => server.close(() => resolve())); });
  await once(server, "listening");
  const address = server.address() as { port: number }, url = `ws://127.0.0.1:${address.port}`;
  const counts = { connections: 0, auth: 0, calls: 0 };
  server.on("connection", ws => {
    counts.connections++;
    ws.on("message", raw => {
      const frame = JSON.parse(String(raw));
      if (frame.method === "connect") { counts.auth++; ws.send(JSON.stringify({ type: "res", id: frame.id, ok: !options.failAuth, error: { message: "Denied" } })); }
      else { counts.calls++; onCall(ws, frame); }
    });
  });
  const client = createGatewayClient({ address: url, token: "test-only", timeoutMs: options.timeoutMs || 1000 });
  cleanup.push(() => client.close());
  return { client, counts, url };
}
function reply(ws: WebSocket, frame: RequestFrame, payload: unknown) { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload })); }
async function mcp(url: string) {
  const child = spawn(process.execPath, ["server/office-todo-mcp.js"], { env: { ...process.env, OFFICE_TASK_GATEWAY_URL: url, OFFICE_TASK_GATEWAY_TOKEN: "test-only" }, stdio: ["pipe", "pipe", "pipe"] });
  cleanup.push(() => { if (child.exitCode === null) child.kill(); });
  let serial = 0;
  const pending = new Map<number, (value: { content: Array<{ text: string }>; isError?: boolean }) => void>();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => { const frame = JSON.parse(line); pending.get(frame.id)?.(frame.result); pending.delete(frame.id); });
  return async (name: string, args: object) => {
    const id = ++serial;
    const response = new Promise<{ content: Array<{ text: string }>; isError?: boolean }>(resolve => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    const result = await response;
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
}
describe("compact model-facing Office information", () => {
  it("uses stable codes through actual MCP get/edit while returning UUIDs and keeping compact receipts", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "office-mcp-codes-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const { OfficeTodos } = createRequire(import.meta.url)("../../server/office-todos.js");
    const todos = new OfficeTodos(directory, { agents: () => ["alice", "bob"].map(id => ({ id, name: id })), projects: () => [] });
    const f = await fixture((ws, frame) => {
      try { const action = frame.method.slice(5); reply(ws, frame, ["create", "get", "list"].includes(action) ? todos[action](frame.params) : todos.change(frame.params, action)); }
      catch (error) { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: { message: String(error) } })); }
    });
    const call = await mcp(f.url);
    const created = (await call("todo_create", { actorId: "alice", assigneeId: "alice", title: "Same title", requestId: "task-code", phases: [{ title: "Verify" }] })).todo;
    expect(created.code).toBe("T1"); expect(created.id).not.toBe("T1");
    const read = (await call("todo_get", { id: "T1" })).todo;
    expect(read.id).toBe(created.id); expect(read).not.toHaveProperty("events");
    const edited = (await call("todo_edit", { actorId: "alice", id: "T1", revision: read.revision, title: "Renamed" })).todo;
    expect(edited).toMatchObject({ id: created.id, code: "T1" }); expect(edited).not.toHaveProperty("documentation");
    expect((await call("todo_list", { query: "T1" })).todos[0]).toMatchObject({ id: created.id, code: "T1", title: "Renamed" });
    const delegated = (await call("todo_delegate", { actorId: "alice", id: "T1", revision: edited.revision, phaseId: created.phases[0].id, assigneeId: "bob", instructions: "Implement", acceptanceCriteria: "Verify", requestId: "delegate-code" })).todo;
    expect((await call("todo_edit", { actorId: "alice", id: "T1", revision: delegated.revision, title: "Shared edit" })).todo).toMatchObject({ id: created.id, code: "T1" });
  });
  it("completes nested handoffs using receipt revisions while keeping full evidence and UI records available", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "office-mcp-compact-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const { OfficeTodos } = createRequire(import.meta.url)("../../server/office-todos.js");
    const todos = new OfficeTodos(directory, { agents: () => ["alice", "bob", "carol"].map(id => ({ id, name: id })), projects: () => [], now: () => 1000 });
    const fullReplies: unknown[] = [];
    const f = await fixture((ws, frame) => {
      try {
        const action = frame.method.slice(5);
        const result = ["create", "get", "list"].includes(action) ? todos[action](frame.params) : todos.change(frame.params, action);
        fullReplies.push(result); reply(ws, frame, result);
      } catch (error) { ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: { message: String(error) } })); }
    });
    const call = await mcp(f.url), documentation = "Scope and restrictions. ".repeat(500).trim();
    let result = await call("todo_create", { actorId: "alice", assigneeId: "alice", requestId: "compact-create", title: "Implement one change", documentation, phases: [{ title: "Implement", notes: "Plan detail. ".repeat(100) }, { title: "Acceptance" }] });
    const id = result.todo.id, phaseIds = result.todo.phases.map((p: { id: string }) => p.id);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(Buffer.byteLength(JSON.stringify(fullReplies[0])) * 0.15);
    expect(result.todo).not.toHaveProperty("documentation"); expect(result.todo).not.toHaveProperty("events");
    const change = async (action: string, actorId: string, extra = {}) => {
      const active = result.todo.delegations?.findLast((e: { phaseId?: string; state: string }) => e.phaseId === phaseIds[0] && !["accepted", "recalled"].includes(e.state));
      result = await call("todo_" + action, { id, revision: result.todo.revision, actorId, phaseId: phaseIds[0], ...(["submit", "review", "recall"].includes(action) ? { handoffId: active?.id } : {}), ...extra }); return result;
    };
    const scope = { instructions: "Implement only; no deployment", acceptanceCriteria: "Verify behavior and retain artifacts" };
    await change("delegate", "alice", { assigneeId: "bob", ...scope });
    await change("delegate", "bob", { assigneeId: "carol", ...scope });
    await expect(change("complete", "carol", { phaseId: phaseIds[0] })).rejects.toThrow(/acceptance/);
    await change("submit", "carol", { report: "Behavior verified; artifact: result.json" });
    expect(result.todo.phases[0]).toMatchObject({ assigneeId: "carol", reviewerId: "bob" });
    const details = await call("todo_get", { id });
    expect(details.todo.documentation).toBe(documentation); expect(details.todo).not.toHaveProperty("events");
    expect(details.todo.phases[0].notes).toContain("Plan detail");
    expect(details.todo.delegations[1]).toMatchObject({ ...scope, report: "Behavior verified; artifact: result.json" });
    await change("review", "bob", { accept: true, notes: "Independently verified result.json" });
    await change("submit", "bob", { report: "Nested result verified" });
    await change("review", "alice", { accept: true, notes: "Final behavior verified" });
    // A later round on the same route must not replay its earlier closed report.
    const oldDelegation = todos.get({ id }).todo.delegations[0];
    await change("reopen", "alice", { phaseId: phaseIds[0] });
    await change("delegate", "alice", { assigneeId: "bob", ...scope, requestId: "second-round" });
    let compact = (await call("todo_get", { id })).todo;
    expect(compact.delegations[0]).toMatchObject({ id: oldDelegation.id, state: "accepted", detailsOmitted: true });
    expect(compact.delegations[0]).not.toHaveProperty("report");
    expect(compact.delegations[1]).toMatchObject({ state: "accepted", report: "Behavior verified; artifact: result.json" });
    expect(compact.delegations[2]).toMatchObject({ state: "working", ...scope });
    await change("submit", "bob", { report: "Latest verified report", requestId: "second-report" });
    compact = (await call("todo_get", { id })).todo;
    expect(compact.delegations[2]).toMatchObject({ report: "Latest verified report" });
    await change("review", "alice", { accept: true, notes: "Verified second round", requestId: "second-review" });
    await change("complete", "alice", { phaseId: phaseIds[1] });
    expect(result.todo).toMatchObject({ status: "done", archived: true, assigneeId: "alice" });
    expect(result.todo.phases[0].assigneeId).toBe("bob");
    await expect(call("todo_edit", { id, revision: 1, actorId: "alice", documentation: "Stale" })).rejects.toThrow(/changed/);
    const history = await call("todo_get", { id, includeHistory: true });
    expect(history).toEqual(todos.get({ id }));
    expect(history.todo.delegations[0].report).toBe("Nested result verified");
    expect(history.todo.events.length).toBeGreaterThan(5);
    const list = await call("todo_list", { status: "done", limit: 1 });
    expect(list).toMatchObject({ total: 1, limit: 1, todos: [{ id, phaseCount: 2, ownerId: "alice" }] });
    expect(list.todos[0]).not.toHaveProperty("phases"); expect(list.todos[0]).not.toHaveProperty("delegations");
    expect(todos.get({ id }).todo.documentation).toBe(documentation);
  });
  it("acknowledges Q selection compactly while discovery, continued replies and original-message provenance stay intact", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "office-mcp-q-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const { OfficeReplyContext } = createRequire(import.meta.url)("../../server/office-reply-context.js");
    const context = new OfficeReplyContext(directory);
    context.record("alice", { id: "turn:original", turnId: "turn", role: "user", content: "Answer Q1 and Q2" });
    const f = await fixture((ws, frame) => { void context.context("alice", frame.params).then((result: unknown) => reply(ws, frame, result)); });
    const call = await mcp(f.url), discovery = await call("question_context", { actorId: "alice" });
    expect(discovery.recentSources[0]).toMatchObject({ itemId: "original", turnId: "turn" });
    const created = await call("question_context", { actorId: "alice", questions: [{ key: "q", summary: "Answer Q1" }], answering: ["q"], requestId: "compact-q" });
    const id = created.opened.q;
    expect(created).toEqual({ answering: [id], opened: { q: id } });
    for (const name of ["commentary", "final"]) context.record("alice", { id: "turn:" + name, turnId: "turn", role: "assistant", content: name });
    const bound = context.decorate("alice", ["commentary", "final"].map(name => ({ id: "turn:" + name, role: "assistant" })));
    expect(bound.every((item: { replyContext: { questions: Array<{ id: string }> } }) => item.replyContext.questions[0].id === id)).toBe(true);
    context.prepare("alice", "continue", context.current("alice"), "continue");
    context.record("alice", { id: "next:resume", turnId: "next", role: "user", content: "Continue where you left off." }, "continue");
    expect(await call("question_context", { actorId: "alice", answering: [id] })).toEqual({ answering: [id] });
    const state = await call("question_context", { actorId: "alice" });
    expect(state.context.questions[0]).toMatchObject({ id, summary: "Answer Q1", sources: [{ itemId: "original", turnId: "turn" }] });
    expect(state.knownQuestions[0].id).toBe(id);
  });
});
describe("Office task MCP transport", () => {
  it("routes the semantic Q tool through the existing authenticated MCP connection", async () => {
    const calls: RequestFrame[] = [];
    const f = await fixture((ws, frame) => { calls.push(frame); reply(ws, frame, { answering: ["q-fixture"] }); });
    const child = spawn(process.execPath, ["server/office-todo-mcp.js"], { env: { ...process.env, OFFICE_TASK_GATEWAY_URL: f.url, OFFICE_TASK_GATEWAY_TOKEN: "test-only" }, stdio: ["pipe", "pipe", "pipe"] });
    cleanup.push(() => { if (child.exitCode === null) child.kill(); });
    const args = { actorId: "fixture", questions: [{ key: "q", summary: "Capacity scope" }], answering: ["q"], requestId: "semantic-q" };
    child.stdin.write(JSON.stringify({ id: 1, method: "tools/call", params: { name: "question_context", arguments: args } }) + "\n");
    const [output] = await once(child.stdout, "data"); expect(JSON.parse(JSON.parse(String(output)).result.content[0].text)).toEqual({ answering: ["q-fixture"] });
    expect(calls[0]).toMatchObject({ method: "question.context", params: args });
    const exited = once(child, "exit"); child.stdin.end(); expect((await exited)[0]).toBe(0);
  });
  it("authenticates once and correlates parallel out-of-order replies", async () => {
    const waiting: RequestFrame[] = [];
    const f = await fixture((ws, frame) => {
      if (frame.params.parallel) { waiting.push(frame); if (waiting.length === 3) for (const row of waiting.reverse()) reply(ws, row, row.params.value); }
      else reply(ws, frame, frame.params.value);
    });
    for (let i = 0; i < 10; i++) expect(await f.client.call("todo.get", { value: i })).toBe(i);
    expect(await Promise.all([1, 2, 3].map(value => f.client.call("todo.get", { value, parallel: true })))).toEqual([1, 2, 3]);
    expect(f.counts).toEqual({ connections: 1, auth: 1, calls: 13 });
  });
  it("keeps a healthy connection after an individual tool error", async () => {
    const f = await fixture((ws, frame) => frame.params.fail ? ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: { message: "Stale revision" } })) : reply(ws, frame, "ok"));
    await expect(f.client.call("todo.edit", { fail: true })).rejects.toThrow("Stale revision");
    expect(await f.client.call("todo.get", {})).toBe("ok"); expect(f.counts.auth).toBe(1);
  });
  it.each(["disconnect", "timeout"])("never replays an uncertain mutation after %s; a new request reconnects", async failure => {
    const f = await fixture((ws, frame) => frame.method === "todo.edit" ? failure === "disconnect" && ws.terminate() : reply(ws, frame, "checked"), { timeoutMs: 200 });
    await expect(f.client.call("todo.edit", {})).rejects.toThrow(/outcome/);
    expect(f.counts.calls).toBe(1);
    expect(await f.client.call("todo.get", {})).toBe("checked");
    expect(f.counts).toEqual({ connections: 2, auth: 2, calls: 2 });
  });
  it("rejects all pending calls on auth failure and closes explicitly", async () => {
    const f = await fixture(() => {}, { failAuth: true });
    const outcomes = await Promise.allSettled([f.client.call("todo.get", {}), f.client.call("todo.list", {})]);
    expect(outcomes.every(value => value.status === "rejected" && value.reason.message === "Denied")).toBe(true);
    expect(f.counts.calls).toBe(0); f.client.close();
    await expect(f.client.call("todo.get", {})).rejects.toThrow("unavailable");
  });
  it("closes the persistent socket when Codex closes MCP stdin", async () => {
    const f = await fixture((ws, frame) => reply(ws, frame, "ok"));
    const child = spawn(process.execPath, ["server/office-todo-mcp.js"], { env: { ...process.env, OFFICE_TASK_GATEWAY_URL: f.url, OFFICE_TASK_GATEWAY_TOKEN: "test-only" }, stdio: ["pipe", "pipe", "pipe"] });
    cleanup.push(() => { if (child.exitCode === null) child.kill(); });
    child.stdin.write(JSON.stringify({ id: 1, method: "tools/call", params: { name: "todo_get", arguments: { id: "fixture" } } }) + "\n");
    const [output] = await once(child.stdout, "data"); expect(JSON.parse(String(output)).result.content[0].text).toBe('"ok"');
    const exited = once(child, "exit"); child.stdin.end(); expect((await exited)[0]).toBe(0);
  });
});
