// @vitest-environment node
import { createRequire } from "node:module";
import { once } from "node:events";
import { spawn } from "node:child_process";
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
