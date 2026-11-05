"use strict";
// Office-only MCP bridge. Credentials travel through the child environment,
// never through arguments, model context, or the native Codex App profile.
const readline = require("node:readline");
const { WebSocket } = require("ws");
const properties = {
  id: { type: "string", description: "To-do ID" }, revision: { type: "integer", description: "Current revision from list/get; required for changes" },
  actorId: { type: "string", description: "Your Office agent ID from the current Office context" },
  title: { type: "string", maxLength: 200 }, documentation: { type: "string", maxLength: 24000 },
  departmentId: { type: ["string", "null"] }, assigneeId: { type: ["string", "null"] },
  phases: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, notes: { type: "string" } }, required: ["title"], additionalProperties: false } },
  phaseId: { type: "string" }, requestId: { type: "string", description: "Unique stable creation request ID; reuse on retry" }, reason: { type: "string" },
  status: { type: "string", enum: ["all", "queued", "running", "paused", "done", "archived"] }, query: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer", maximum: 25 },
};
const definitions = [
  ["list", "List shared Office to-dos, department totals and available agents. Filter or paginate when needed.", ["departmentId", "assigneeId", "status", "query", "offset", "limit"], []],
  ["get", "Read a to-do, its current revision, phase IDs, documentation and history before editing.", ["id"], ["id"]],
  ["create", "Create a record only for actionable work, never casual chat or general questions. One task is one user goal; related follow-ups reuse an existing task, including a completed one. Check recent tasks first. Ask the user before splitting uncertain scope. Define phases and owner before executing; reuse requestId on retry.", ["actorId", "title", "documentation", "departmentId", "assigneeId", "phases", "requestId"], ["actorId", "title", "phases", "requestId"]],
  ["edit", "Update the plan, assignment or documentation, including completed archived tasks. Adding an unfinished phase to completed work returns it to the current board; documentation-only edits keep it archived and preserve completion time. Preserve existing phase IDs and accumulated times. New phases omit id. Fetch fresh revision after a conflict.", ["id", "revision", "actorId", "title", "documentation", "departmentId", "assigneeId", "phases"], ["id", "revision", "actorId"]],
  ["start", "Start or resume the current phase timer. This does not send a chat message.", ["id", "revision", "actorId"], ["id", "revision", "actorId"]],
  ["pause", "Pause timing when blocked or waiting for a person; include a reason.", ["id", "revision", "actorId", "reason"], ["id", "revision", "actorId"]],
  ["complete", "Check a completed phase. Automatically starts the next unfinished phase; the last check records the whole task completion time and automatically archives it. Update documentation with evidence first.", ["id", "revision", "actorId", "phaseId"], ["id", "revision", "actorId", "phaseId"]],
  ["reopen", "Reopen a phase and resume timing while preserving time already spent.", ["id", "revision", "actorId", "phaseId"], ["id", "revision", "actorId", "phaseId"]],
  ["archive", "Remove a to-do from the active board while retaining its history.", ["id", "revision", "actorId"], ["id", "revision", "actorId"]],
  ["restore", "Restore an archived unfinished to-do. Completed work stays archived: add or reopen a phase to follow up.", ["id", "revision", "actorId"], ["id", "revision", "actorId"]],
];
const tools = definitions.map(([name, description, keys, required]) => ({ name: `todo_${name}`, description, annotations: { readOnlyHint: ["list", "get"].includes(name), destructiveHint: false, openWorldHint: false }, inputSchema: { type: "object", properties: Object.fromEntries(keys.map(key => [key, properties[key]])), required, additionalProperties: false } }));
function createGatewayClient({ address = process.env.OFFICE_TASK_GATEWAY_URL, token = process.env.OFFICE_TASK_GATEWAY_TOKEN, timeoutMs = 20000 } = {}) {
  let connection, serial = 0, closed = false;
  function retire(current, error) {
    if (current.closed) return;
    current.closed = true;
    if (connection === current) connection = null;
    for (const request of current.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    current.pending.clear(); current.ws.terminate();
  }
  function send(current, frame) {
    try { current.ws.send(JSON.stringify(frame), error => { if (error) retire(current, new Error("Office task service is disconnected")); }); }
    catch { retire(current, new Error("Office task service is disconnected")); }
  }
  function dispatch(current, request) {
    if (request.sent || !current.ready || current.closed) return;
    request.sent = true; send(current, request.frame);
  }
  function connect() {
    const current = { ws: new WebSocket(address), pending: new Map(), ready: false, closed: false };
    current.ws.on("open", () => send(current, { type: "req", id: "auth", method: "connect", params: { auth: { token } } }));
    current.ws.on("message", raw => {
      let frame; try { frame = JSON.parse(String(raw)); } catch { return; }
      if (current.closed || frame.type !== "res") return;
      if (frame.id === "auth" && !current.ready) {
        if (!frame.ok) return retire(current, new Error(frame.error?.message || "Office request failed"));
        current.ready = true;
        for (const request of current.pending.values()) dispatch(current, request);
        return;
      }
      const request = current.pending.get(frame.id);
      if (!request) return;
      current.pending.delete(frame.id); clearTimeout(request.timer);
      if (frame.ok) request.resolve(frame.payload);
      else request.reject(new Error(frame.error?.message || "Office request failed"));
    });
    current.ws.on("error", () => retire(current, new Error("Office task service is disconnected")));
    current.ws.on("close", () => retire(current, new Error("Office task connection closed; read the outcome before retrying")));
    return current;
  }
  return {
    call(method, params) {
      return new Promise((resolve, reject) => {
        if (closed || !address || !token) return reject(new Error("Office task service is unavailable"));
        const current = connection || (connection = connect()), id = `call-${++serial}`;
        const request = { resolve, reject, frame: { type: "req", id, method, params } };
        request.timer = setTimeout(() => retire(current, new Error("Office task request timed out; read its outcome before retrying")), timeoutMs);
        current.pending.set(id, request); dispatch(current, request);
      });
    },
    close() { closed = true; if (connection) retire(connection, new Error("Office task service is disconnected")); },
  };
}
let bridge;
function gateway(method, params) { return (bridge ||= createGatewayClient()).call(method, params); }
async function handle(frame) {
  if (frame.method === "initialize") return { protocolVersion: frame.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "office_tasks", version: "1" } };
  if (frame.method === "ping") return {};
  if (frame.method === "tools/list") return { tools };
  if (frame.method === "tools/call") {
    const tool = tools.find(tool => tool.name === frame.params?.name);
    if (!tool) throw new Error("Unknown Office task tool");
    try { const result = await gateway(`todo.${tool.name.slice(5)}`, frame.params.arguments || {}); return { content: [{ type: "text", text: JSON.stringify(result) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text", text: error.message }] }; }
  }
  throw new Error("Method not found");
}
if (require.main === module) {
  readline.createInterface({ input: process.stdin }).on("line", line => {
    let frame; try { frame = JSON.parse(line); } catch { return; }
    if (frame.id === undefined) return;
    void handle(frame).then(result => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }) + "\n"), error => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: error.message } }) + "\n"));
  }).on("close", () => bridge?.close());
}
module.exports = { tools, handle, createGatewayClient };
