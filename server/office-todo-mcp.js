"use strict";
// Office-only MCP bridge. Credentials travel through the child environment,
// never through arguments, model context, or the native Codex App profile.
const readline = require("node:readline");
const { WebSocket } = require("ws");
const properties = {
  id: { type: "string", description: "To-do UUID or stable task code, for example T37" }, revision: { type: "integer", description: "Current revision from list/get or the preceding successful change; required for changes" },
  includeHistory: { type: "boolean", description: "Include task event history when explicitly needed; omitted by default" },
  actorId: { type: "string", description: "Your Office agent ID from the current Office context" },
  name: { type: "string", minLength: 1, maxLength: 120, description: "Stable employee name, not a task label" },
  templateId: { type: ["string", "null"], description: "An existing saved recruitment template. Omit for the department default; null explicitly uses fresh defaults. Creates a fresh session, never copies a conversation." },
  title: { type: "string", maxLength: 200 }, documentation: { type: "string", maxLength: 24000 },
  allDepartments: { type: "boolean", description: "Read all department responsibilities, existing Heads, members and roles; read-only, grants no additional authority" },
  departmentId: { type: ["string", "null"] }, assigneeId: { type: ["string", "null"] }, ownerId: { type: ["string", "null"], description: "Follow-up owner, independent of execution and workflow authority; null clears it. Agent creation defaults to actor when omitted." },
  phases: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, notes: { type: "string" } }, required: ["title"], additionalProperties: false } },
  phaseId: { type: "string" }, requestId: { type: "string", description: "Unique stable creation request ID; reuse on retry" }, reason: { type: "string" },
  status: { type: "string", enum: ["all", "queued", "running", "paused", "done", "archived"] }, query: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer", maximum: 25 },
  instructions: { type: "string", minLength: 1, maxLength: 6000, description: "Bounded scope and expected deliverable, including the original user's restrictions and authorization limits" },
  acceptanceCriteria: { type: "string", minLength: 1, maxLength: 3000 },
  report: { type: "string", minLength: 1, maxLength: 6000, description: "Delivered work, verification evidence, artifact locations and any remaining limitations" },
  accept: { type: "boolean" }, notes: { type: "string", minLength: 1, maxLength: 6000, description: "Manager's verification evidence when accepting, or concrete correction feedback when returning" },
};
const definitions = [
  ["organization", "Read your live role, managers and direct reports plus department responsibilities, existing Heads, members and roles. Default: all departments for CEO, own department for others. Set allDepartments=true for the full directory, or departmentId for one department (null means Open Workspace). Everyone may look up other departments; this grants no delegation or filesystem permissions. Use your own actorId.", ["actorId", "departmentId", "allDepartments"], ["actorId"]],
  ["recruit", "Department Heads may recruit one persistent employee into their own department, including Open Workspace, reporting directly to them. First use a suitable available existing employee; recruit only when none is available, for example all suitable reports are busy. Explain that need in reason (1–500 characters), choose a stable name, and reuse requestId on retry. Omitting templateId uses the configured department default, or fresh defaults when none is configured. A template ID selects that saved configuration; null explicitly uses fresh defaults. Creates a fresh conversation and keeps existing permission checks. Creates no department, sends no task and interrupts no employee; follow with the existing todo_delegate when appropriate.", ["actorId", "name", "reason", "requestId", "templateId"], ["actorId", "name", "reason", "requestId"]],
  ["delegate", "Hand the current task to an available existing direct report's real conversation. Include bounded scope, deliverables, acceptance criteria and original user restrictions. Reuse this task and requestId on retry; the delegating manager retains acceptance responsibility. Does not create an employee or interrupt other work.", ["id", "revision", "actorId", "assigneeId", "instructions", "acceptanceCriteria", "requestId"], ["id", "revision", "actorId", "assigneeId", "instructions", "acceptanceCriteria", "requestId"]],
  ["submit", "Submit the active delegated work and evidence to its delegating manager for acceptance, preserving the execution assignee. Keeps the same task open and notifies the manager's real conversation when available. Leave the final unfinished phase for acceptance. Reuse requestId on retry.", ["id", "revision", "actorId", "report", "requestId"], ["id", "revision", "actorId", "report", "requestId"]],
  ["review", "The delegating manager verifies a submitted result, then accepts it with evidence or returns specific feedback. Acceptance does not close the task or replace an upstream manager's acceptance. Reuse requestId on retry.", ["id", "revision", "actorId", "accept", "notes", "requestId"], ["id", "revision", "actorId", "accept", "notes", "requestId"]],
  ["recall", "The delegating manager takes an unfinished handoff back with a reason. Does not claim the result was accepted. Inspect the worker conversation first; an active worker must be stopped before recall. Reuse requestId on retry.", ["id", "revision", "actorId", "reason", "requestId"], ["id", "revision", "actorId", "reason", "requestId"]],
  ["list", "List compact task summaries, department totals and available agents. Use todo_get for a task's plan, documentation and handoffs. assigneeId filters the executor; ownerId filters the follow-up owner. Owner adds no permissions; handlingAgentId/reviewerId indicate workflow and acceptance. Filter or paginate when needed.", ["departmentId", "assigneeId", "ownerId", "status", "query", "offset", "limit"], []],
  ["get", "Read the current task revision, complete phase plan, documentation, open handoffs and the latest report per manager/worker route. Earlier handoff details and event history require includeHistory=true. Reuse a complete task snapshot already provided in a notification and revisions returned by successful changes; do not refetch merely to confirm them. Reread missing data or after a real conflict or task change. Report notifications arrive automatically; avoid status-only polling.", ["id", "includeHistory"], ["id"]],
  ["create", "Create a record only for actionable work, never casual chat or general questions. One task is one user goal; related follow-ups reuse an existing task, including a completed one. Check recent tasks first. Ask the user before splitting uncertain scope. Define phases and owner before executing; reuse requestId on retry.", ["actorId", "title", "documentation", "departmentId", "assigneeId", "ownerId", "phases", "requestId"], ["actorId", "title", "phases", "requestId"]],
  ["edit", "Any registered Office member can update ordinary task plans, owners and documentation, including completed archived tasks. Execution, protected reassignment and final manager acceptance keep their existing rules. Adding an unfinished phase to completed work returns it to the current board; documentation-only edits keep it archived and preserve completion time. Preserve existing phase IDs and accumulated times. New phases omit id. Fetch fresh revision after a conflict.", ["id", "revision", "actorId", "title", "documentation", "departmentId", "assigneeId", "ownerId", "phases"], ["id", "revision", "actorId"]],
  ["start", "Start or resume the current phase timer. This does not send a chat message.", ["id", "revision", "actorId"], ["id", "revision", "actorId"]],
  ["pause", "Pause timing when blocked or waiting for a person; include a reason.", ["id", "revision", "actorId", "reason"], ["id", "revision", "actorId"]],
  ["complete", "Check a completed phase. Automatically starts the next unfinished phase; the last check records the whole task completion time and automatically archives it. Update documentation with evidence first.", ["id", "revision", "actorId", "phaseId"], ["id", "revision", "actorId", "phaseId"]],
  ["reopen", "Reopen a phase and resume timing while preserving time already spent.", ["id", "revision", "actorId", "phaseId"], ["id", "revision", "actorId", "phaseId"]],
  ["archive", "Remove a to-do from the active board while retaining its history.", ["id", "revision", "actorId"], ["id", "revision", "actorId"]],
  ["restore", "Restore an archived unfinished to-do. Completed work stays archived: add or reopen a phase to follow up.", ["id", "revision", "actorId"], ["id", "revision", "actorId"]],
];
const tools = definitions.map(([name, description, keys, required]) => ({ name: `todo_${name}`, description, annotations: { readOnlyHint: ["list", "get", "organization"].includes(name), destructiveHint: false, openWorldHint: false }, inputSchema: { type: "object", properties: Object.fromEntries(keys.map(key => [key, properties[key]])), required, additionalProperties: false } }));
const sourceSchema = { type: "object", properties: Object.fromEntries(["threadId", "turnId", "itemId"].map(key => [key, { type: "string" }])), required: ["threadId", "turnId", "itemId"], additionalProperties: false };
tools.push({ name: "question_context", description: "Select the actual semantic Q/step when selection is missing or changes; new user messages clear selection. Reuse the selection for subsequent commentary/answers to that same Q; do not reselect before every response. Select/create returns selected IDs and opened aliases. For a new Q with one current user message, register directly without source; the tool resolves exact provenance. Reuse supplied known IDs. Read with actorId only when information is missing or ambiguous, not as a prerequisite to every selection. Define summaries (max 180 characters) using local keys; answering selects keys or Q IDs. A message may contain several Qs. A child uses parentQuestionId (ID or earlier key), inheriting its source. Specify exact source IDs when ambiguous. Continue/Play/retry preserves Q and source. Tasks/phases are optional; ordinary questions never require a task. Reuse requestId on definition retries.", annotations: { destructiveHint: false, openWorldHint: false }, inputSchema: { type: "object", properties: {
  actorId: properties.actorId, requestId: properties.requestId,
  questions: { type: "array", maxItems: 8, items: { type: "object", properties: { key: { type: "string", maxLength: 32 }, summary: { type: "string", minLength: 1, maxLength: 180 }, parentQuestionId: { type: "string" }, source: sourceSchema }, required: ["key", "summary"], additionalProperties: false } },
  answering: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } }, taskId: { type: "string" }, phaseId: properties.phaseId,
}, required: ["actorId"], additionalProperties: false } });
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

// Only model-facing responses are compact. Gateway/UI data and stored evidence
// stay complete; task reads retain every phase and handoff report.
function modelResult(name, args, result) {
  if (name === "question_context") return args.answering || args.questions?.length
    ? { answering: result.answering, ...(result.opened && Object.keys(result.opened).length ? { opened: result.opened } : {}) } : result;
  if (name === "todo_list") return { ...result, todos: result.todos.map(todo => {
    const summary = { ...todo, phaseCount: todo.phases.length };
    delete summary.phases; delete summary.replyContext; delete summary.delegations;
    return summary;
  }) };
  if (!result?.todo) return result;
  const todo = result.todo;
  if (name === "todo_get") {
    if (args.includeHistory) return result;
    const details = { ...todo }; delete details.events;
    // Keep open work and the latest evidence on each actual reporting route.
    // Older rounds remain addressable by ID through the explicit history read.
    const latest = new Map();
    for (const entry of todo.delegations || []) latest.set(JSON.stringify([entry.managerId, entry.workerId]), entry.id);
    if (todo.delegations) details.delegations = todo.delegations.map(entry => {
      if (!["accepted", "recalled"].includes(entry.state) || latest.get(JSON.stringify([entry.managerId, entry.workerId])) === entry.id) return entry;
      const { id, managerId, workerId, state, createdAt, submittedAt } = entry;
      return { id, managerId, workerId, state, createdAt, submittedAt, detailsOmitted: true };
    });
    return { ...result, todo: details };
  }
  const fields = ["id", "code", "revision", "status", "archived", "assigneeId", "ownerId", "handlingAgentId", "reviewerId", "progress"];
  return { ...result, todo: {
    ...Object.fromEntries(fields.filter(key => Object.hasOwn(todo, key)).map(key => [key, todo[key]])),
    phases: todo.phases.map(({ id, title, completedAt }) => ({ id, title, completedAt })),
    ...(todo.delegations ? { delegations: todo.delegations.map(({ id, managerId, workerId, state, delivery }) => ({ id, managerId, workerId, state, delivery })) } : {}),
  } };
}
async function handle(frame) {
  if (frame.method === "initialize") return { protocolVersion: frame.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "office_tasks", version: "1" } };
  if (frame.method === "ping") return {};
  if (frame.method === "tools/list") return { tools };
  if (frame.method === "tools/call") {
    const tool = tools.find(tool => tool.name === frame.params?.name);
    if (!tool) throw new Error("Unknown Office task tool");
    try {
      const args = frame.params.arguments || {}, params = { ...args };
      delete params.includeHistory;
      const result = await gateway(tool.name === "question_context" ? "question.context" : `todo.${tool.name.slice(5)}`, params);
      return { content: [{ type: "text", text: JSON.stringify(modelResult(tool.name, args, result)) }] };
    }
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
