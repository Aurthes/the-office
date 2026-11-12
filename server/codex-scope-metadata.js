"use strict";
const { randomUUID } = require("node:crypto");
const SCOPE_LOG_FILTER = "warn,codex_code_mode::timing=info,codex_otel.trace_safe=info";
const field = value => typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,256}$/.test(value) ? value : null;

// Pinned 0.166.0 identity-only projection. Never read span, arguments or results.
function scopeMetadata(log, generation) {
  const f = log?.fields;
  if (!f || log.level !== "INFO" || !field(generation)) return null;
  const name = f["event.name"], parent = name === "codex.code_mode.host_timing";
  if (parent ? log.target !== "codex_code_mode::timing" : name !== "codex.tool_call_received" || log.target !== "codex_otel.trace_safe") return null;
  const nativeThreadId = field(parent ? f.conversation_id : f["conversation.id"]), cellId = field(parent ? f.cell_id : f["cell.id"]), callId = field(f.call_id), tool = field(f.tool_name);
  if (!nativeThreadId || !cellId || !callId || !tool) return null;
  if (parent) {
    const turnId = field(f.turn_id);
    if (!turnId || !["exec", "wait"].includes(tool)) return null;
    return { kind: tool === "exec" ? "create" : "wait", generation, nativeThreadId, turnId, cellId, callId };
  }
  const runtimeCallId = field(f.runtime_tool_call_id);
  if (f.tool_source !== "code_mode" || !runtimeCallId) return null;
  return { kind: "child", generation, nativeThreadId, cellId, callId, runtimeCallId, tool, namespace: field(f.tool_namespace) };
}

function cleanScopeRecord(value) {
  if (!value || !field(value.generation) || !field(value.nativeThreadId) || !field(value.cellId) || !field(value.callId)) return null;
  const base = { kind: value.kind, generation: value.generation, nativeThreadId: value.nativeThreadId, cellId: value.cellId, callId: value.callId };
  if (["create", "wait"].includes(value.kind) && field(value.turnId)) return { ...base, turnId: value.turnId };
  if (value.kind === "child" && field(value.runtimeCallId) && field(value.tool)) return { ...base, runtimeCallId: value.runtimeCallId, tool: value.tool, namespace: field(value.namespace) };
  return null;
}

// Exact identity join only. A wait observing the cell never becomes its creator.
function parentScope(records, { nativeThreadId, callId, generation }) {
  const children = records.filter(r => r.kind === "child" && r.nativeThreadId === nativeThreadId && r.callId === callId && (!generation || r.generation === generation));
  const identities = new Set(children.map(r => `${r.generation}:${r.cellId}:${r.runtimeCallId}:${r.tool}:${r.namespace}`));
  if (identities.size !== 1) return { status: "unlinked", reason: children.length ? "conflictingChildIdentity" : "missingChildIdentity" };
  const child = children[0], creators = records.filter(r => r.kind === "create" && r.generation === child.generation && r.nativeThreadId === nativeThreadId && r.cellId === child.cellId);
  const parents = new Set(creators.map(r => `${r.turnId}:${r.callId}`));
  if (parents.size !== 1) return { status: "unlinked", reason: creators.length ? "conflictingCellCreator" : "missingCellCreator" };
  return { status: "linked", basis: "nativeIdentityLogs0.166.0", child, parent: creators[0] };
}

// Drain stderr without pausing it or retaining overlong lines. INFO raw JSON is
// never forwarded; original warnings/errors retain their message, not new spans.
function nativeScopeLogReader({ onMetadata, onGap = () => {}, writeError, generation = randomUUID() }) {
  let carry = Buffer.alloc(0), discarding = false;
  const gap = reason => { try { onGap(reason); } catch { /* Diagnostics cannot fail native RPC. */ } };
  const error = text => { try { writeError(text.slice(0, 4096) + "\n"); } catch { gap("scopeErrorRelay"); } };
  const line = bytes => {
    if (!bytes.length) return;
    const text = bytes.toString("utf8"); let log;
    try { log = JSON.parse(text); }
    catch { if (text.trimStart().startsWith("{")) gap("scopeMalformedLog"); else error(text); return; }
    const value = scopeMetadata(log, generation);
    if (value) { try { onMetadata(value); } catch { gap("scopeCallbackFailure"); } }
    else if (log?.level === "INFO" && ["codex_code_mode::timing", "codex_otel.trace_safe"].includes(log.target) && ["codex.code_mode.host_timing", "codex.tool_call_received"].includes(log.fields?.["event.name"]) && log.fields?.tool_source !== "direct") gap("scopeMissingIdentity");
    else if (["WARN", "ERROR"].includes(log?.level) && typeof log.fields?.message === "string") error(`[${log.level}] ${log.fields.message}`);
  };
  return {
    feed(chunk) {
      let start = 0;
      for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) {
        const part = chunk.subarray(start, i);
        if (!discarding && carry.length + part.length <= 16384) line(Buffer.concat([carry, part]));
        else if (!discarding) gap("scopeOversizeLog");
        carry = Buffer.alloc(0); discarding = false; start = i + 1;
      }
      if (discarding) return;
      const part = chunk.subarray(start);
      if (carry.length + part.length > 16384) { carry = Buffer.alloc(0); discarding = true; gap("scopeOversizeLog"); }
      else carry = Buffer.concat([carry, part]);
    },
    end() { if (!discarding && carry.length) line(carry); carry = Buffer.alloc(0); },
  };
}
module.exports = { SCOPE_LOG_FILTER, scopeMetadata, cleanScopeRecord, parentScope, nativeScopeLogReader };
