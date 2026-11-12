"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { cleanScopeRecord } = require("./codex-scope-metadata");
const { components } = require("./office-usage-purpose");
const { emptyCostSummary, addCost, estimateResponseCost } = require("./office-token-pricing");
const { commandSummary, cleanSummary } = require("./office-operation-summary");
const { actionHeader } = require("./office-action-header");
const { commandHint, ordinaryHint, cleanHint, primaryEstimate } = require("./office-response-purpose");
const VERSION = "0.166.0", RULE = "response-purpose-3", DAY = 86400000;
const PURPOSES = ["execution", "coordination", "workflow", "mixed", "unknown"];
const safe = x => typeof x === "string" && /^[a-zA-Z0-9_.:/-]{1,256}$/.test(x) ? x : null;
const key = (thread, call) => `${thread}:${call}`;
const status = x => ["completed", "failed", "terminated", "running", "unknown"].includes(x) ? x : "unknown";
function toolPurpose(tool, namespace, typed = []) {
  const match = /^mcp__office_tasks__(.+)$/.exec(tool || "");
  if (match) { tool = match[1]; namespace = "office_tasks"; }
  if (namespace === "mcp__office_tasks") namespace = "office_tasks";
  if ((namespace === "clock" || !namespace) && ["curr_time", "sleep"].includes(tool)) return "workflow";
  if (namespace === "office_tasks") {
    if (["session_send", "todo_delegate", "todo_submit", "todo_review", "todo_recall"].includes(tool)) return "coordination";
    if (/^(?:todo_|schedule_)/.test(tool) || tool === "question_context") return "workflow";
  }
  if (namespace === "web" && tool === "run" || namespace === "functions" && ["FileChange", "apply_patch"].includes(tool)) return "execution";
  if ((!namespace || ["functions","web"].includes(namespace)) && ["read_file", "list_directory", "search_files", "search_query", "web_search", "image_query"].includes(tool)) return "execution";
  if (["exec_command", "shell_command"].includes(tool) && typed.length && typed.every(x => ["read", "search", "list_files"].includes(x))) return "execution";
  return "unknown";
}
function actionClassify(record, strict = false) {
  if (!record) return { purpose: "unknown", reason: "noActionIndex" };
  if (!record.linked) return { purpose: "unknown", reason: record.reason || "unlinkedBatch" };
  if (record.truncated) return { purpose: "unknown", reason: "metadataTruncated" };
  if (record.conflict) return { purpose: "unknown", reason: "identityConflict" };
  const categories = new Set(); let inferred = false;
  const add = action => { if (action?.purposeBasis === "static-inferred") { inferred = true; categories.add(strict ? "unknown" : action.category); } else categories.add(action?.category || "unknown"); };
  for (const output of record.outputs) {
    if (!output.callId) continue;
    if (output.tool === "wait") { categories.add("workflow"); continue; }
    if (output.tool === "exec") {
      if (!output.generation || !output.cellId) return { purpose: "unknown", reason: "missingParentScope" };
      if (!["completed", "failed", "terminated"].includes(output.status)) return { purpose: "unknown", reason: "pendingCell" };
      const children = record.actions.filter(a => a.parentCallId === output.callId);
      if (!children.length) return { purpose: "unknown", reason: "genericExecWithoutActions" };
      for (const child of children) add(child);
    } else {
      const action = record.actions.find(a => a.itemId === output.callId);
      if (action) add(action); else categories.add(toolPurpose(output.tool, output.namespace));
    }
  }
  if (!categories.size) return { purpose: "unknown", reason: "ordinaryOutputSemanticsUnknown" };
  if (categories.has("unknown")) return { purpose: "unknown", reason: "actionSemanticsUnknown" };
  return { purpose: categories.size > 1 ? "mixed" : [...categories][0], reason: inferred ? "staticInferredActions" : "ruleDerivedActions", purposeBasis: inferred ? "static-inferred" : "rule-derived" };
}
function classify(record, strict=false) {
  const base=actionClassify(record,strict);
  const estimate=!strict&&record?.primaryEnabled?primaryEstimate(record,base,record.priorPurpose):null;
  return estimate?{...estimate,reason:`primary:${estimate.reason}`}:{...base,confidence:base.purpose==="unknown"?null:base.purposeBasis==="static-inferred"?"medium":"high"};
}
function cleanRecord(v) {
  if (!v || !safe(v.nativeThreadId) || !safe(v.turnId) || !safe(v.responseId) || !Number.isFinite(Date.parse(v.observedAt))) return null;
  const outputs = (Array.isArray(v.outputs) ? v.outputs : []).slice(0, 32).map(o => ({ id: safe(o.id), type: safe(o.type), callId: safe(o.callId), tool: safe(o.tool), namespace: safe(o.namespace), phase: safe(o.phase), status: status(o.status), generation: safe(o.generation), cellId: safe(o.cellId) }));
  const actions = (Array.isArray(v.actions) ? v.actions : []).slice(0, 32).map(a => ({ itemId: safe(a.itemId), parentCallId: safe(a.parentCallId), tool: safe(a.tool), namespace: safe(a.namespace), status: status(a.status), category: a.category === "unknown" ? toolPurpose(a.tool,a.namespace) : PURPOSES.includes(a.category) ? a.category : "unknown", basis: ["explicitCellIdentity", "directCallId"].includes(a.basis) ? a.basis : "unknown", purposeBasis: a.purposeBasis === "static-inferred" ? "static-inferred" : "rule-derived", operations: cleanSummary(a)?.operations || [], originalCallId: safe(a.originalCallId), hint: cleanHint(a.hint) }));
  const s = v.source;
  const source = s && typeof s.file === "string" && s.file.length < 512 && !s.file.split(/[\\/]/).includes("..") && /^(sessions|archived_sessions)\//.test(s.file) ? { file: s.file, startOffset: s.startOffset, endOffset: s.endOffset, startOrdinal: s.startOrdinal, endOrdinal: s.endOrdinal } : null;
  if (source && Object.entries(source).some(([k,n]) => k !== "file" && (!Number.isSafeInteger(n) || n < 0))) return null;
  return { nativeThreadId: v.nativeThreadId, turnId: v.turnId, responseId: v.responseId, observedAt: v.observedAt, linked: !!v.linked, reason: safe(v.reason), truncated: !!v.truncated || v.outputs?.length > 32 || v.actions?.length > 32, conflict: !!v.conflict, outputs, actions, source, primaryEnabled:!!v.primaryEnabled, purposeHints:(Array.isArray(v.purposeHints)?v.purposeHints:[]).slice(0,8).map(cleanHint).filter(Boolean),hasOrdinaryText:!!v.hasOrdinaryText,analysisEpoch:Number.isSafeInteger(v.analysisEpoch)?v.analysisEpoch:0,priorPurpose:v.priorPurpose&&safe(v.priorPurpose.responseId)&&PURPOSES.includes(v.priorPurpose.purpose)&&v.priorPurpose.purpose!=="unknown"?{responseId:v.priorPurpose.responseId,purpose:v.priorPurpose.purpose}:null };
}
class ActionIndex {
  constructor(directory, now = Date.now, gap = () => {}) {
    this.directory = directory; this.now = now; this.gap = gap; this.records = new Map(); this.dirty = new Map(); this.calls = new Map(); this.blockedCalls = new Set(); this.childRefs = new Map(); this.cells = new Map(); this.cellCalls = new Map(); this.pending = new Map(); this.pendingCount = 0; this.results = new Map(); this.waitCells = new Map(); this.items = new Map(); this.processes = new Map(); this.sources = new Map(); this.dayBytes = new Map(); this.activeDayBytes = new Map(); this.bytes = 0; this.memoryBytes = 0; this.sizes = new Map(); this.recordedFrom = new Date(now()).toISOString(); this.responseRecordedFrom = this.recordedFrom; this.analysisRecordedFrom = this.recordedFrom; this.capacityLimited = false;
  }
  async init() {
    for (const file of (await fs.readdir(this.directory)).filter(x => /^actions-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) {
      const name = file.slice(8,18), handle = await fs.open(path.join(this.directory, file), require("node:fs").constants.O_RDONLY | require("node:fs").constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat(); if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || this.bytes + stat.size > 64 * 1024 * 1024) { this.capacityLimited = true; this.gap("actionStorageLimit"); continue; }
        this.bytes += stat.size; this.dayBytes.set(name, stat.size);
        const readline = require("node:readline");
        for await (const line of readline.createInterface({ input: handle.createReadStream({ autoClose: false }), crlfDelay: Infinity })) {
          if (Buffer.byteLength(line) > 32768) { this.gap("actionInvalidRow"); continue; }
          try { const v = cleanRecord(JSON.parse(line)); if (v) this.set(v, false); else this.gap("actionInvalidRow"); } catch { this.gap("actionRecoveryGap"); }
        }
      } finally { await handle.close(); }
    }
    for (const r of this.records.values()) this.index(r);
  }
  id(v) { return key(v.nativeThreadId, v.responseId); }
  set(value, dirty = true) {
    const v = cleanRecord(value); if (!v) return;
    const k = this.id(v), bytes = Buffer.byteLength(JSON.stringify(v)), previous = this.sizes.get(k) || 0;
    if (this.memoryBytes - previous + bytes > 32 * 1024 * 1024 && Date.parse(v.observedAt)<this.now()-DAY || !this.records.has(k) && this.records.size >= 50000) { this.capacityLimited = true; this.gap("actionMemoryLimit"); return; }
    if(this.memoryBytes - previous + bytes > 28*1024*1024){for(const [id,old]of this.records)if(id!==k&&Date.parse(old.observedAt)<this.now()-DAY){this.activeDayBytes.set(old.observedAt.slice(0,10),(this.activeDayBytes.get(old.observedAt.slice(0,10))||0)-(this.sizes.get(id)||0));this.memoryBytes-=this.sizes.get(id)||0;this.sizes.delete(id);this.records.delete(id);this.dirty.delete(id);this.capacityLimited=true;if(this.memoryBytes-previous+bytes<=24*1024*1024)break;}}
    if(this.memoryBytes-previous+bytes>32*1024*1024){this.capacityLimited=true;this.gap("actionMemoryLimit");return;}
    const day=v.observedAt.slice(0,10);this.activeDayBytes.set(day,(this.activeDayBytes.get(day)||0)+bytes-previous);
    this.memoryBytes += bytes - previous; this.sizes.set(k,bytes); this.records.set(k,v); if (dirty) this.dirty.set(k,v);
    this.syncContext(v);
  }
  invalidate(thread, turn=null) {
    const source=this.sources.get(thread);if(!source)return;
    for(const [id,b]of source.turns)if(!turn||id===turn){b.context=null;b.purposeHints=[];b.epoch=(b.epoch||0)+1;}
  }
  nativeSignal(thread,frame,generation) {
    const source=this.sources.get(thread);if(!source)return;
    if(safe(generation)&&source.generation!==generation){this.invalidate(thread);source.generation=generation;}
    if(frame.method==="turn/started" || frame.params?.item?.type==="userMessage"&&["item/started","item/completed"].includes(frame.method) || frame.method==="turn/completed"&&["failed","interrupted"].includes(frame.params?.turn?.status))this.invalidate(thread);
  }
  syncContext(v) {
    const b=this.sources.get(v.nativeThreadId)?.turns.get(v.turnId);
    if(!v.primaryEnabled||!b)return;
    const failed=v.outputs.some(o=>["failed","terminated"].includes(o.status))||v.actions.some(a=>["failed","terminated"].includes(a.status));
    if((failed||v.conflict||v.truncated)&&b.context?.responseId===v.responseId)b.context=null;
    if(b.context?.responseId===v.responseId&&b.latestResponseId!==v.responseId&&classify(v).purpose!==b.context.purpose)b.context=null;
    if(b.latestResponseId!==v.responseId||b.epoch!==v.analysisEpoch)return;
    if(failed||v.conflict||v.truncated){b.context=null;return;}
    const result=classify(v);
    if(result.purpose!=="unknown"&&result.confidence!=="low")b.context={responseId:v.responseId,purpose:result.purpose};
    else if(result.purpose==="unknown"&&(v.hasOrdinaryText||v.outputs.some(o=>o.callId)))b.context=null;
  }
  index(v) {
    const k = this.id(v);
    for (const o of v.outputs) if (o.callId) {
      const ck = key(v.nativeThreadId,o.callId), old = this.calls.get(ck);
      if (this.blockedCalls.has(ck) || old && old !== k) { if(old)this.edit(old,r=>({...r,conflict:true})); this.set({...v,conflict:true});this.blockedCalls.add(ck);this.calls.delete(ck);continue; }
      this.calls.set(ck,k);
      if (o.generation && o.cellId) { const creator={nativeThreadId:v.nativeThreadId,generation:o.generation,cellId:o.cellId,callId:o.callId,turnId:v.turnId}; this.cells.set(`${o.generation}:${v.nativeThreadId}:${o.cellId}`,creator); this.cellCalls.set(ck,creator); }
      if (this.results.has(ck)) this.finish(v.nativeThreadId,o.callId,this.results.get(ck));
    }
    for (const a of v.actions) this.childRefs.set(key(v.nativeThreadId,a.itemId),k);
  }
  edit(k, change) { const r=this.records.get(k); if (r) this.set(change(r)); }
  scope(value) {
    const v=cleanScopeRecord(value); if (!v) return;
    const ck=`${v.generation}:${v.nativeThreadId}:${v.cellId}`;
    if (v.kind === "create") {
      const old=this.cells.get(ck);
      if (old && (old.callId!==v.callId || old.turnId!==v.turnId)) { this.gap("actionScopeConflict"); for(const p of [old,v])this.edit(this.calls.get(key(p.nativeThreadId,p.callId)),r=>({...r,conflict:true})); return; }
      if (!old && this.cells.size>=50000) {this.gap("actionScopeLimit");return;}
      this.cells.set(ck,v); this.cellCalls.set(key(v.nativeThreadId,v.callId),v);
      this.edit(this.calls.get(key(v.nativeThreadId,v.callId)),r=>r.turnId!==v.turnId||r.outputs.some(o=>o.callId===v.callId&&o.generation&&o.generation!==v.generation)?{...r,conflict:true}:{...r,outputs:r.outputs.map(o=>o.callId===v.callId?{...o,generation:v.generation,cellId:v.cellId}:o)});
      for (const child of this.pending.get(ck)||[]) this.attach(child,v);
      if (this.calls.has(key(v.nativeThreadId,v.callId))) {this.pendingCount-=this.pending.get(ck)?.length||0;this.pending.delete(ck);}
    } else if (v.kind === "child") {
      const parent=this.cells.get(ck);
      if (parent && this.calls.has(key(parent.nativeThreadId,parent.callId))) this.attach(v,parent);
      else if (this.pending.size < 4096 && this.pendingCount < 8192) { const values=this.pending.get(ck)||[]; if (values.length<64 && !values.some(x=>x.callId===v.callId)) {this.pending.set(ck,[...values,v]);this.pendingCount++;} else this.gap("actionPendingLimit"); }
      else this.gap("actionPendingLimit");
    } else {
      const parent=this.cells.get(ck); const ref=this.records.get(this.calls.get(key(v.nativeThreadId,v.callId))); const result=this.results.get(key(v.nativeThreadId,v.callId)) || ref?.outputs.find(o=>o.callId===v.callId)?.status;
      if (parent && result) this.finish(parent.nativeThreadId,parent.callId,result);
      // Wait can close an existing cell but never creates/reassigns it.
      if(this.waitCells.size<8192)this.waitCells.set(key(v.nativeThreadId,v.callId),ck);else this.gap("actionWaitLimit");
    }
  }
  attach(child,parent) {
    const k=this.calls.get(key(parent.nativeThreadId,parent.callId)); if (!k) return;
    const prior=this.childRefs.get(key(child.nativeThreadId,child.callId));
    if (prior && prior!==k) {this.edit(prior,r=>({...r,conflict:true}));this.edit(k,r=>({...r,conflict:true}));return;}
    this.childRefs.set(key(child.nativeThreadId,child.callId),k);
    const item=this.items.get(key(child.nativeThreadId,child.callId)), previous=this.records.get(k)?.actions.find(a=>a.itemId===child.callId);
    const action={itemId:child.callId,parentCallId:parent.callId,tool:item?.tool||child.tool,namespace:item?.namespace||child.namespace,status:item?.status||previous?.status||"unknown",category:item?.summary?.category || (item?toolPurpose(item.tool,item.namespace,item.typed||[]):previous?.category||toolPurpose(child.tool,child.namespace)),purposeBasis:item?.summary?.purposeBasis || previous?.purposeBasis || "rule-derived",operations:item?.summary?.operations || previous?.operations || [],originalCallId:item?.originalCallId || previous?.originalCallId || null,hint:item?.hint || previous?.hint || null,basis:"explicitCellIdentity"};
    this.edit(k,r=>({...r,truncated:r.truncated||r.actions.length>=32&&!r.actions.some(a=>a.itemId===child.callId),actions:[...r.actions.filter(a=>a.itemId!==child.callId),action].slice(0,32)}));
  }
  finish(thread,call,s) {
    const ck=key(thread,call); if (this.results.size<8192 || this.results.has(ck)) this.results.set(ck,s); else this.gap("actionResultLimit");
    const k=this.calls.get(ck); this.edit(k,r=>({...r,outputs:r.outputs.map(o=>o.callId===call?{...o,status:s}:o)}));
    const wait=this.waitCells.get(ck), parent=wait&&this.cells.get(wait);
    if (parent) {this.edit(this.calls.get(key(thread,parent.callId)),r=>({...r,outputs:r.outputs.map(o=>o.callId===parent.callId?{...o,status:s}:o)}));if(["completed","failed","terminated"].includes(s))this.waitCells.delete(ck);}
  }
  item(thread,item,generation=null,analyze=true,infer=true) {
    const id=safe(item.id); if(!id)return;
    const ck=key(thread,id), priorAction=this.records.get(this.childRefs.get(ck) || this.calls.get(ck))?.actions.find(a=>a.itemId===id);
    const previous=this.items.get(ck) || (priorAction?.originalCallId ? {originalCallId:priorAction.originalCallId,summary:{category:priorAction.category,purposeBasis:priorAction.purposeBasis,operations:priorAction.operations},hint:priorAction.hint} : null);
    const value={status:status(item.status),tool:item.type==="McpToolCall"?safe(item.tool):item.type==="CommandExecution"?"exec_command":safe(item.type),namespace:item.type==="McpToolCall"?safe(item.server):"functions",typed:(Array.isArray(item.parsed_cmd)?item.parsed_cmd:[]).map(x=>safe(x.type)).filter(Boolean)};
    value.hint = infer && item.type === "CommandExecution" ? commandHint(item.command) : null;
    value.summary = analyze && item.type === "CommandExecution" ? commandSummary(item.command) : null;
    const interaction=["unifiedExecInteraction", "unified_exec_interaction"].includes(item.source);
    if (interaction) {value.hint=!generation && previous?.originalCallId ? previous.hint || null : null;value.summary=!generation && previous?.originalCallId ? previous.summary : null;value.typed=[];} else value.summary ||= previous?.summary || null;
    value.originalCallId = previous?.originalCallId || null;
    const processId = safe(item.process_id);
    if (safe(generation) && processId && item.type === "CommandExecution") {
      const pk = `${generation}:${thread}:${processId}`, original=this.processes.get(pk);
      if (["unifiedExecStartup", "unified_exec_startup"].includes(item.source)) {
        if (original && original.id !== id) this.processes.set(pk, {conflict:true});
        else if (this.processes.size < 8192 || original) this.processes.set(pk,{id,summary:value.summary,hint:value.hint});
        else this.gap("actionProcessLimit");
      } else if (["unifiedExecInteraction", "unified_exec_interaction"].includes(item.source)) {
        value.summary=original?.conflict?null:original?.summary||null;value.hint=original?.conflict?null:original?.hint||null;value.originalCallId=original?.conflict?null:original?.id||null;
      }
    }
    if(this.items.size<8192||this.items.has(ck))this.items.set(ck,value);else this.gap("actionItemLimit");
    for(const k of [this.childRefs.get(ck),this.calls.get(ck)].filter(Boolean)) this.edit(k,r=>({...r,actions:[...r.actions.filter(a=>a.itemId!==id),{...r.actions.find(a=>a.itemId===id),itemId:id,tool:value.tool,namespace:value.namespace,status:value.status,category:value.summary?.category || toolPurpose(value.tool,value.namespace,value.typed),purposeBasis:value.summary?.purposeBasis || "rule-derived",operations:value.summary?.operations || [],originalCallId:value.originalCallId,hint:value.hint,basis:this.childRefs.has(ck)?"explicitCellIdentity":"directCallId"}].slice(0,32)}));
  }
  consume(text,thread,state,offset,oversize=false) {
    const h=/^\{\s*"timestamp"\s*:\s*"[^"\\]+"\s*,\s*"ordinal"\s*:\s*(\d+)\s*,\s*"type"\s*:\s*"([a-z_]+)"/.exec(text.slice(0,320)); if(!h)return;
    let source=this.sources.get(thread); if(!source||source.file!==state.file||source.epoch!==(state.actionEpoch||0)){if(!source&&this.sources.size>=512){this.gap("actionSourceLimit");return;}source={file:state.file,epoch:state.actionEpoch||0,last:null,turns:new Map()};this.sources.set(thread,source);}
    const ordinal=+h[1], type=h[2]; if(source.last!==null&&ordinal!==source.last+1){this.invalidate(thread);for(const b of source.turns.values())b.valid=false;}source.last=ordinal;
    if(oversize&&/"type"\s*:\s*"(?:reasoning|Reasoning)"/.test(text.slice(0,1024)))return;
    if(oversize){const header=type==="event_msg"?actionHeader(text):null;if(header){this.item(thread,header.payload.item);return;}this.invalidate(thread);for(const b of source.turns.values())b.valid=false;this.gap("actionOversizeLine");return;}
    if(type==="event_msg"&&/"type"\s*:\s*"(?:user_message|turn_aborted|error)"/.test(text.slice(0,1024))){this.invalidate(thread);return;}
    if(type==="compacted"){this.invalidate(thread);for(const b of source.turns.values()){b.valid=false;b.outputs=[];}return;}
    if(!["response_item","event_msg","token_usage_record"].includes(type)||/"type"\s*:\s*"(?:reasoning|Reasoning)"/.test(text.slice(0,1024)))return;
    if(type==="response_item"&&/"role"\s*:\s*"(?:user|developer|system)"/.test(text.slice(0,1024))){this.invalidate(thread);return;}
    if(type==="event_msg"&&!/"type"\s*:\s*"(?:item_completed|task_started)"/.test(text.slice(0,1024)))return;
    let e;try{e=JSON.parse(text);}catch{this.invalidate(thread);for(const b of source.turns.values())b.valid=false;return;}
    const p=e.payload||{};
    if(type==="response_item"&&["custom_tool_call_output","function_call_output"].includes(p.type)&&safe(p.call_id)){
        // Only the fixed native envelope's first status line is inspected. No body retained.
        const first=Array.isArray(p.output)?p.output[0]?.text:typeof p.output==="string"?p.output:null;
        const match=typeof first==="string"&&/^(Script completed|Script failed|Script terminated|Script running with cell ID [a-zA-Z0-9-]+)\nWall time /.exec(first.slice(0,200));
        this.finish(thread,p.call_id,match?match[1]==="Script completed"?"completed":match[1]==="Script failed"?"failed":match[1]==="Script terminated"?"terminated":"running":"unknown");
      return;
    }
    const turn=safe(p.turn_id||p.internal_chat_message_metadata_passthrough?.turn_id);if(!turn)return;
    let batch=source.turns.get(turn);if(!batch){if(source.turns.size>=32){source.turns.delete(source.turns.keys().next().value);this.gap("actionTurnLimit");}batch={valid:false,outputs:[],start:offset,startOrdinal:ordinal,context:null,epoch:0,purposeHints:[],hasOrdinaryText:false};source.turns.set(turn,batch);}
    if(type==="event_msg"){
      if(p.type==="task_started"){this.invalidate(thread);batch.valid=true;batch.truncated=false;batch.outputs=[];batch.purposeHints=[];batch.hasOrdinaryText=false;batch.start=offset;batch.startOrdinal=ordinal;}
      if(p.type==="item_completed"&&["McpToolCall","CommandExecution","FileChange"].includes(p.item?.type))this.item(thread,p.item,null,Date.parse(e.timestamp)>=Date.parse(this.analysisRecordedFrom),Date.parse(e.timestamp)>=Date.parse(this.responseRecordedFrom));
      return;
    }
    if(type==="response_item"){
      if(p.type==="message"&&p.role==="assistant"&&p.channel!=="analysis"&&p.phase!=="analysis"&&Date.parse(e.timestamp)>=Date.parse(this.responseRecordedFrom)){
        const chunks=Array.isArray(p.content)?p.content.filter(x=>["output_text","text","input_text"].includes(x?.type)&&typeof x.text==="string").map(x=>x.text):[];
        const length=chunks.reduce((n,x)=>n+x.length,0);batch.hasOrdinaryText ||= length>0;
        if(length<=32768){const hint=ordinaryHint(chunks.join("\n"));if(hint&&batch.purposeHints.length<8)batch.purposeHints.push(hint);}
      }
      if(["custom_tool_call","function_call"].includes(p.type)||p.type==="message"&&p.role==="assistant") {
        if(batch.outputs.length>=32){batch.valid=false;batch.truncated=true;return;}
        batch.outputs.push({id:safe(p.id),type:p.type,callId:safe(p.call_id),tool:safe(p.name),namespace:safe(p.namespace),phase:safe(p.phase),status:"unknown"});
      }
      return;
    }
    if(p.thread_id!==thread||!safe(p.response_id))return;
    batch.latestResponseId=p.response_id;
    const v={primaryEnabled:Date.parse(e.timestamp)>=Date.parse(this.responseRecordedFrom),purposeHints:batch.purposeHints,hasOrdinaryText:batch.hasOrdinaryText,priorPurpose:batch.context,analysisEpoch:batch.epoch,nativeThreadId:thread,turnId:turn,responseId:p.response_id,observedAt:e.timestamp,truncated:!!batch.truncated,linked:batch.valid,reason:batch.valid?null:"batchBoundaryMissing",outputs:batch.outputs,actions:[],source:{file:state.file,startOffset:batch.start,endOffset:offset+Buffer.byteLength(text),startOrdinal:batch.startOrdinal,endOrdinal:ordinal}};
    const prior=this.records.get(this.id(v)); if(!prior||!prior.linked){this.set(v);this.index(v);for(const output of batch.outputs){const cell=this.cellCalls.get(key(thread,output.callId));if(cell)this.scope({...cell,kind:"create"});}}
    batch.valid=true;batch.truncated=false;batch.outputs=[];batch.purposeHints=[];batch.hasOrdinaryText=false;batch.start=offset+Buffer.byteLength(text)+1;batch.startOrdinal=ordinal+1;
  }
  view(row) {const r=this.records.get(this.id(row));return {...classify(r),strict:classify(r,true),supported:classify(r).confidence==="low"?{purpose:"unknown",reason:"lowConfidenceExcluded",confidence:null}:classify(r),basis:r?.linked?"validatedRolloutBoundary":"unlinked",ruleVersion:RULE,adapterVersion:VERSION,outputs:r?.outputs.map(x=>({...x}))||[],actions:r?.actions.map(x=>({...x}))||[],sourceRange:r?.source||null,truncated:!!r?.truncated};}
  async flush() {
    const cutoff=this.now()-3*DAY;
    for(const [k,r]of this.records)if(Date.parse(r.observedAt)<cutoff){this.activeDayBytes.set(r.observedAt.slice(0,10),(this.activeDayBytes.get(r.observedAt.slice(0,10))||0)-(this.sizes.get(k)||0));this.memoryBytes-=this.sizes.get(k)||0;this.sizes.delete(k);this.records.delete(k);this.dirty.delete(k);}
    for(const [day]of this.dayBytes)if(Date.parse(day+"T00:00:00Z")+DAY<cutoff){await fs.rm(path.join(this.directory,`actions-${day}.jsonl`),{force:true});this.bytes-=this.dayBytes.get(day);this.dayBytes.delete(day);}
    const grouped=new Map();for(const r of this.dirty.values()){const day=r.observedAt.slice(0,10);if(!grouped.has(day))grouped.set(day,[]);grouped.get(day).push(JSON.stringify(r)+"\n");}
    for(const [day,lines]of grouped){const data=lines.join("");
      for(const oldDay of [...this.dayBytes.keys()].sort())if(this.bytes+Buffer.byteLength(data)>64*1024*1024&&oldDay<new Date(this.now()-DAY).toISOString().slice(0,10)){
        await fs.rm(path.join(this.directory,`actions-${oldDay}.jsonl`),{force:true});this.bytes-=this.dayBytes.get(oldDay);this.dayBytes.delete(oldDay);
        for(const [id,r]of this.records)if(r.observedAt.slice(0,10)===oldDay){this.memoryBytes-=this.sizes.get(id)||0;this.sizes.delete(id);this.records.delete(id);}this.activeDayBytes.delete(oldDay);this.capacityLimited=true;
      }
      if(this.bytes+Buffer.byteLength(data)>64*1024*1024){this.capacityLimited=true;this.gap("actionStorageLimit");continue;}const handle=await fs.open(path.join(this.directory,`actions-${day}.jsonl`),require("node:fs").constants.O_WRONLY|require("node:fs").constants.O_CREAT|require("node:fs").constants.O_APPEND|require("node:fs").constants.O_NOFOLLOW,0o600);try{await handle.writeFile(data);}finally{await handle.close();}this.bytes+=Buffer.byteLength(data);this.dayBytes.set(day,(this.dayBytes.get(day)||0)+Buffer.byteLength(data));}
    this.dirty.clear();
    for(const [day,bytes]of this.dayBytes){
      if(bytes<=(this.activeDayBytes.get(day)||0)*2+1024*1024)continue;
      const active=[...this.records.values()].filter(r=>r.observedAt.startsWith(day));
      const data=active.map(r=>JSON.stringify(r)+"\n").join("");
      if(bytes>Buffer.byteLength(data)*2+1024*1024){const target=path.join(this.directory,`actions-${day}.jsonl`),tmp=target+".tmp";const h=await fs.open(tmp,require("node:fs").constants.O_WRONLY|require("node:fs").constants.O_CREAT|require("node:fs").constants.O_TRUNC|require("node:fs").constants.O_NOFOLLOW,0o600);try{await h.writeFile(data);}finally{await h.close();}await fs.rename(tmp,target);this.bytes+=Buffer.byteLength(data)-bytes;this.dayBytes.set(day,Buffer.byteLength(data));}
    }
    // Resolved scopes are represented by compact response outputs/actions, not raw events.
    for(const [k,v]of this.calls)if(!this.records.has(v))this.calls.delete(k);
    for(const [k,v]of this.childRefs)if(!this.records.has(v))this.childRefs.delete(k);
    for(const [k,v]of this.cells)if(this.calls.has(key(v.nativeThreadId,v.callId))){if(this.pending.has(k)){this.pendingCount-=this.pending.get(k).length;this.pending.delete(k);}}else if(this.cells.size>8192)this.cells.delete(k);
    for(const [k,v]of this.cellCalls)if(!this.cells.has(`${v.generation}:${v.nativeThreadId}:${v.cellId}`))this.cellCalls.delete(k);
    for(const [k]of this.results)if(this.calls.has(k))this.results.delete(k);
    for(const [k]of this.items)if(this.childRefs.has(k)||this.calls.has(k))this.items.delete(k);
  }
}
function actionSummary(rows, index, strict = false) {
  if (strict) rows = rows.map(row=>({...row,action:{...row.action,...(strict==="supported"?row.action.supported:row.action.strict)}}));
  const measured=rows.filter(r=>Number.isSafeInteger(r.usage.total)),linked=measured.filter(r=>r.action.basis==="validatedRolloutBoundary"),classified=measured.filter(r=>r.action.purpose!=="unknown");
  const groups=PURPOSES.map(id=>{const items=rows.filter(r=>r.action.purpose===id),cost=emptyCostSummary(),inferredCost=emptyCostSummary();const inferred=items.filter(r=>r.action.purposeBasis==="static-inferred"&&id!=="unknown");for(const row of items)addCost(cost,row,row.cost||estimateResponseCost(row));for(const row of inferred)addCost(inferredCost,row,row.cost||estimateResponseCost(row));return{id,observedResponses:items.length,components:components(items),cost,inferredResponses:inferred.length,inferredComponents:components(inferred),inferredCost};});
  const inferred = measured.filter(r=>r.action.purpose!=="unknown"&&r.action.purposeBasis==="static-inferred");
  const reasonRows={};const reasons={};for(const row of rows)if(row.action.purpose==="unknown"){reasons[row.action.reason]=(reasons[row.action.reason]||0)+1;(reasonRows[row.action.reason] ||= []).push(row);}
  const confidence=["high","medium","low"].map(id=>{const items=rows.filter(r=>r.action.purpose!=="unknown"&&r.action.confidence===id),cost=emptyCostSummary();for(const row of items)addCost(cost,row,row.cost||estimateResponseCost(row));return{id,observedResponses:items.length,components:components(items),cost};});
  return {confidence,ruleVersion:RULE,adapterVersion:VERSION,responsePurposeRecordedFrom:index.responseRecordedFrom,recordedFrom:index.recordedFrom,analysisRecordedFrom:index.analysisRecordedFrom,basis:"wholeResponsePurposeEstimate",groups,coverage:{observedResponses:rows.length,measuredResponses:measured.length,unknownUsageResponses:rows.length-measured.length,linkedResponses:linked.length,classifiedResponses:classified.length,inferredResponses:inferred.length,components:{measured:components(measured),linked:components(linked),classified:components(classified),inferred:components(inferred),ruleDerived:components(classified.filter(r=>r.action.purposeBasis!=="static-inferred"))},unknownReasons:reasons,unknownReasonComponents:Object.fromEntries(Object.entries(reasonRows).map(([reason,items])=>[reason,components(items)])),truncatedComponents:components(measured.filter(r=>r.action.truncated)),pendingComponents:components(measured.filter(r=>r.action.reason==="pendingCell")),pendingResponses:rows.filter(r=>r.action.reason==="pendingCell").length,truncatedResponses:rows.filter(r=>r.action.truncated).length,retainedFrom:[...index.records.values()].reduce((x,r)=>!x||r.observedAt<x?r.observedAt:x,null),bytes:index.bytes,memoryBytes:index.memoryBytes,capacityLimited:index.capacityLimited,pendingUnlinkedCells:index.pending.size,unmatchedActionItems:index.items.size}};
}
module.exports={ActionIndex,actionSummary,classify,toolPurpose,PURPOSES,RULE};
