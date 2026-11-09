"use strict";
// Read-only compatibility projection for Codex 0.166.0 Office rollouts.
// This is observed response telemetry, not a billing API or a complete HTTP log.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { PURPOSES, userUsage, sampleUsageOf, isSample, purposeOf, purposeSummary, totalsOf } = require("./office-usage-purpose");
const { dictationUsageOf, nativeMetadata } = require("./office-usage-adapters");
const isDictation = row => row.source?.kind === "dictation";
const responseKeys = row => isDictation(row) ? [`dictation:${row.providerKind}:attempt:${row.attemptId}`, ...(row.providerRequestId ? [`dictation:${row.providerKind}:request:${row.providerRequestId}`] : [])] : [`codex:${row.responseId}`];
const yieldLoop = () => new Promise(resolve => setImmediate(resolve));
const VERSION = "0.166.0", FORMAT = 1, DAY = 86400000;
const id = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value) ? value : null;
const label = value => typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,120}$/.test(value) ? value : null;
const keyOf = row => isDictation(row) ? `dictation:${row.providerKind}:${row.attemptId}` : `${row.nativeThreadId || "sample"}:${row.responseId}`;
const utcDay = time => new Date(time).toISOString().slice(0, 10);
const dateShift = (date, days) => utcDay(Date.parse(date + "T12:00:00Z") + days * DAY);
const formatters = new Map();
function localDay(time, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }));
    if (formatters.size > 32) formatters.delete(formatters.keys().next().value);
  }
  return formatters.get(timeZone).format(new Date(time));
}
// session_meta may contain very large instructions. Project only the two leading
// metadata fields; skip workspace arrays, stop before the instructions body.
function sessionMetadata(prefix) {
  const match = /^\{\s*"timestamp"\s*:\s*"[^"\\]+"\s*,\s*(?:"ordinal"\s*:\s*\d+\s*,\s*)?"type"\s*:\s*"session_meta"\s*,\s*"payload"\s*:\s*\{/.exec(prefix);
  if (!match) return null;
  let tail = prefix.slice(match[0].length); const result = {};
  for (let i = 0; i < 32; i++) {
    const field = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*/.exec(tail);
    if (!field) break;
    const key = JSON.parse(field[1]); tail = tail.slice(field[0].length);
    let depth = 0, quoted = false, escaped = false, end = 0;
    for (; end < tail.length; end++) {
      const ch = tail[end];
      if (quoted) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; }
      else if (ch === '"') quoted = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") { if (!depth) break; depth--; }
      else if (ch === "," && !depth) break;
    }
    if (end === tail.length || quoted || depth) break;
    if (["id", "cli_version"].includes(key)) { try { result[key] = JSON.parse(tail.slice(0, end)); } catch { return null; } }
    if (result.id && result.cli_version) break;
    tail = tail.slice(end + 1);
  }
  return result;
}
function usageOf(value) {
  if (!value || typeof value !== "object") return null;
  const fields = { input: "input_tokens", cachedInput: "cached_input_tokens", cacheWriteInput: "cache_write_input_tokens", output: "output_tokens", reasoningOutput: "reasoning_output_tokens", total: "total_tokens" };
  const result = {};
  for (const [field, source] of Object.entries(fields)) {
    if (!Number.isSafeInteger(value[source]) || value[source] < 0) return null;
    result[field] = value[source];
  }
  if (result.cachedInput > result.input || result.reasoningOutput > result.output || result.total !== result.input + result.output) return null;
  return { ...result, uncachedInput: result.input - result.cachedInput, otherOutput: result.output - result.reasoningOutput };
}
function parameters(p, now) {
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some(k => !["schemaVersion", "window", "end", "date", "timeZone", "sort", "order", "agentId", "configuredModel", "taskId", "cursor", "snapshot", "purpose", "includeRecords", "limit", "refresh"].includes(k))) throw new Error("Invalid usage query");
  if (p.schemaVersion !== undefined && p.schemaVersion !== 2) throw new Error("Invalid usage schema");
  let window = null;
  if (p.window !== undefined) {
    if (p.window !== "rolling24h" || p.date !== undefined) throw new Error("Invalid usage window");
    const end = p.end === undefined ? Math.floor(now / 3600000) * 3600000 : Date.parse(p.end);
    if (!Number.isFinite(end) || end % 3600000 || end > Math.floor(now / 3600000) * 3600000 || p.end !== undefined && new Date(end).toISOString() !== p.end) throw new Error("Invalid window end");
    if (p.timeZone !== undefined && p.timeZone !== "UTC") throw new Error("Rolling windows use UTC");
    window = { kind: "rolling24h", start: new Date(end - DAY).toISOString(), end: new Date(end).toISOString(), timeZone: "UTC" };
  } else {
    if (p.end !== undefined || typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(Date.parse(p.date + "T00:00:00Z")) || utcDay(Date.parse(p.date + "T00:00:00Z")) !== p.date) throw new Error("Invalid date");
    if (typeof p.timeZone !== "string" || p.timeZone.length > 80 || !/^[A-Za-z_+\-/0-9]+$/.test(p.timeZone)) throw new Error("Invalid time zone");
    try { localDay(now, p.timeZone); } catch { throw new Error("Invalid time zone"); }
  }
  const sort = p.sort ?? "total", order = p.order ?? "desc", limit = p.limit ?? 50;
  if (!["total", "input", "uncachedInput", "output", "time"].includes(sort) || !["asc", "desc"].includes(order) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid usage ordering or page size");
  for (const field of ["agentId", "configuredModel", "taskId"]) if (p[field] !== undefined && !(field === "configuredModel" ? label(p[field]) : id(p[field]))) throw new Error("Invalid usage filter");
  for (const field of ["cursor", "snapshot"]) if (p[field] !== undefined && (typeof p[field] !== "string" || !p[field] || p[field].length > 512)) throw new Error("Invalid usage cursor");
  if (p.cursor !== undefined && p.snapshot !== undefined) throw new Error("Invalid usage cursor");
  if (p.purpose !== undefined && !PURPOSES.includes(p.purpose)) throw new Error("Invalid usage purpose");
  if (p.includeRecords !== undefined && typeof p.includeRecords !== "boolean") throw new Error("Invalid record selection");
  if (p.refresh !== undefined && typeof p.refresh !== "boolean") throw new Error("Invalid refresh");
  return { schemaVersion: window || p.schemaVersion === 2 ? 2 : 1, date: window ? null : p.date, timeZone: window ? "UTC" : p.timeZone, window, sort, order, limit, agentId: p.agentId ?? null, configuredModel: p.configuredModel ?? null, taskId: p.taskId ?? null, purpose: p.purpose ?? null, includeRecords: p.includeRecords !== false };
}

class OfficeTokenUsage {
  constructor({ directory, home, sessions, resolveSource, listSources, tasks = () => new Map(), nativeVersion = VERSION, now = Date.now, maxBytes = 64 * 1024 * 1024, chunkBytes = 1024 * 1024, lineBytes = 64 * 1024 }) {
    this.directory = path.join(directory, "token-usage"); this.home = path.resolve(home);
    this.sessions = sessions; this.resolveSource = resolveSource; this.listSources = listSources; this.tasks = tasks; this.now = now;
    this.maxBytes = maxBytes; this.reserve = Math.min(2 * 1024 * 1024, Math.floor(maxBytes / 4));
    this.chunkBytes = chunkBytes; this.lineBytes = lineBytes;
    this.rows = new Map(); this.sources = {}; this.bindings = {}; this.shards = new Map(); this.pending = new Map(); this.deleted = new Set();
    this.responses = new Map(); this.sourceQueue = []; this.dictationQueue = []; this.discoveryPending = false; this.lastDiscovery = -Infinity; this.bindingQueue = []; this.sampleQueue = []; this.bindingCount = 0; this.purposesRecordedFrom = new Date(now()).toISOString();
    this.adaptersEnabledAt = new Date(now()).toISOString();
    this.dayBytes = new Map(); this.pendingBytes = 0;
    this.queue = new Set(); this.snapshots = new Map(); this.secret = crypto.randomBytes(32);
    this.bytes = 0; this.gaps = {}; this.floor = ""; this.closed = false; this.running = null;
    this.nativeVersion = nativeVersion;
    if (nativeVersion !== VERSION) { this.unavailable = true; this.gap("unsupportedRuntimeVersion"); }
  }
  gap(reason, source) { if (source) source.gaps[reason] = (source.gaps[reason] || 0) + 1; else this.gaps[reason] = (this.gaps[reason] || 0) + 1; }
  known() {
    const roots = new Map(this.sessions().filter(s => id(s.codexThreadId) && id(s.id)).map(s => [s.codexThreadId, s]));
    const visit = (nativeId, seen = new Set()) => {
      if (roots.has(nativeId)) return roots.get(nativeId);
      const source = this.sources[nativeId];
      if (!source || seen.has(nativeId) || seen.size >= 32) return null;
      seen.add(nativeId);
      const parent = source.parentNativeThreadId && visit(source.parentNativeThreadId, seen);
      if (parent) { roots.set(nativeId, parent); return parent; }
      if (!source.parentNativeThreadId && source.helperKind && source.trusted && source.version === VERSION && source.ownershipBasis === "officeRuntimeHelper") {
        const helper = { id: null, name: "Unattributed native helper" }; roots.set(nativeId, helper); return helper;
      }
      return null;
    };
    for (const key of Object.keys(this.sources)) visit(key);
    return roots;
  }
  observeNative(frame) {
    if (this.closed || this.unavailable) return;
    const put = value => { if (!id(value?.nativeThreadId)) return; if (this.sourceQueue.length >= 1024) { this.gap("sourceBackpressure"); return; } this.sourceQueue.push({ nativeThreadId: id(value.nativeThreadId), parentNativeThreadId: id(value.parentNativeThreadId), helperKind: ["review", "compact", "memory_consolidation", "other", "thread_spawn"].includes(value.helperKind) ? value.helperKind : null }); };
    if (frame.method === "thread/started") put(nativeMetadata(frame.params?.thread));
    const item = frame.params?.item;
    if (["item/started", "item/completed"].includes(frame.method) && item?.type === "collabAgentToolCall")
      for (const receiver of (Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []).slice(0, 32)) put({ nativeThreadId: receiver, parentNativeThreadId: item.senderThreadId || frame.params?.threadId, helperKind: "thread_spawn" });
    if (this.sourceQueue.length) this.kick();
  }
  registerSource(value) {
    if (!value?.nativeThreadId) return;
    const previous = this.sources[value.nativeThreadId];
    if (!previous && Object.keys(this.sources).length >= 2048) { this.gap("sourceLimit"); return; }
    if (!value.parentNativeThreadId && !value.helperKind) return;
    const source = previous || { offset: 0, gaps: {} };
    if (source.parentNativeThreadId && value.parentNativeThreadId && source.parentNativeThreadId !== value.parentNativeThreadId) { this.gap("conflictingSourceParent", source); return; }
    source.parentNativeThreadId ||= value.parentNativeThreadId;
    source.helperKind ||= value.helperKind;
    source.ownershipBasis = source.parentNativeThreadId ? "parentThread" : "officeRuntimeHelper";
    this.sources[value.nativeThreadId] = source; this.queue.add(value.nativeThreadId);
  }
  async discover() {
    this.discoveryPending = false;
    if (!this.listSources || this.now() - this.lastDiscovery < 60000) return;
    this.lastDiscovery = this.now();
    try {
      for (const archived of [false, true]) {
        let cursor = null;
        for (let page = 0; page < 21; page++) {
          const result = await this.listSources({ archived, limit: 100, cursor, useStateDbOnly: true, sourceKinds: ["subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"] });
          if (!Array.isArray(result?.data)) { this.gap("sourceDiscoveryUnavailable"); break; }
          for (const thread of result.data.slice(0, 100)) this.registerSource(nativeMetadata(thread));
          cursor = result.nextCursor;
          if (!cursor) break;
          if (page === 20 || Object.keys(this.sources).length >= 2048) { this.gap("sourceLimit"); break; }
          await yieldLoop();
        }
      }
    } catch { this.gap("sourceDiscoveryUnavailable"); }
  }
  async init() {
    if (!this.initializing) this.initializing = this.load().catch(() => { this.unavailable = true; this.gap("indexUnavailable"); });
    await this.initializing;
  }
  async load() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.directory)).isSymbolicLink()) throw new Error("Unsafe derived directory");
    await fs.chmod(this.directory, 0o700);
    let state;
    try { state = await this.readJson("state.json", this.reserve); } catch (error) { if (error.code !== "ENOENT") this.gap("stateRecovery"); }
    if (state?.format === FORMAT) {
      this.sources = state.sources || {}; this.bindings = { ...state.bindings, ...this.bindings }; this.gaps = { ...state.gaps, ...this.gaps }; this.floor = state.floor || "";
      this.purposesRecordedFrom = state.purposesRecordedFrom || this.purposesRecordedFrom;
      this.adaptersEnabledAt = state.adaptersEnabledAt || this.adaptersEnabledAt;
    } else if (state) this.gap("unsupportedIndex");
    this.bindingCount = Object.keys(this.bindings).length;
    const files = (await fs.readdir(this.directory)).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
    for (const file of files) {
      try {
        if (file.slice(0, 10) < this.floor) this.deleted.add(file.slice(0, 10));
        else await this.loadShard(file);
      } catch { this.gap("shardRecovery"); }
      await yieldLoop();
    }
    await this.prune();
  }
  async loadShard(file) {
    const handle = await fs.open(path.join(this.directory, file), require("node:fs").constants.O_RDWR | require("node:fs").constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat(); if (!stat.isFile() || stat.size + this.bytes > this.maxBytes - this.reserve) throw new Error("Index limit");
      let position = 0, complete = 0, carry = Buffer.alloc(0), lines = 0;
      const buffer = Buffer.alloc(64 * 1024), day = file.slice(0, 10);
      if (!this.shards.has(day)) this.shards.set(day, new Set());
      while (position < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); if (!bytesRead) break;
        position += bytesRead; carry = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
        let begin = 0;
        for (let i = 0; i < carry.length; i++) if (carry[i] === 10) {
          try {
            const row = JSON.parse(carry.subarray(begin, i).toString("utf8"));
            const sample = row.source?.kind === "threadSample", dictation = isDictation(row);
            const enrichedSample = sample && row.sourceKinds?.includes("nativeRollout") ? usageOf({ input_tokens: row.usage?.input, cached_input_tokens: row.usage?.cachedInput, cache_write_input_tokens: row.usage?.cacheWriteInput, output_tokens: row.usage?.output, reasoning_output_tokens: row.usage?.reasoningOutput, total_tokens: row.usage?.total }) : null;
            const usage = dictation ? dictationUsageOf(row) : sample ? enrichedSample || sampleUsageOf({ inputTokens: row.usage?.input, cachedInputTokens: row.usage?.cachedInput, outputTokens: row.usage?.output })
              : usageOf({ input_tokens: row.usage?.input, cached_input_tokens: row.usage?.cachedInput, cache_write_input_tokens: row.usage?.cacheWriteInput, output_tokens: row.usage?.output, reasoning_output_tokens: row.usage?.reasoningOutput, total_tokens: row.usage?.total });
            if ((!dictation && !id(row.responseId)) || (!id(row.officeAgentId) && !(row.officeAgentId === null && ["parentThread", "officeRuntimeHelper"].includes(row.ownershipBasis))) || !Number.isFinite(Date.parse(row.observedAt)) || utcDay(row.observedAt) !== day || row.source?.version !== VERSION || !usage
              || (dictation ? !id(row.attemptId) || row.providerRequestId != null && !id(row.providerRequestId) || !["openaiApi", "chatgptSubscription"].includes(row.providerKind) || !id(row.officeAgentId) || row.nativeThreadId !== null || row.turnId !== null : sample ? row.nativeThreadId !== null || row.turnId !== null || !id(row.contextNativeThreadId) || !id(row.sourceTurnId)
                : !id(row.nativeThreadId) || !id(row.turnId) || ![undefined, "nativeRollout"].includes(row.source?.kind))) throw new Error("Invalid row");
            row.usage = usage;
            row.sourceKinds = Array.isArray(row.sourceKinds) ? [...new Set(row.sourceKinds.filter(kind => ["nativeRollout", "threadSample", "dictation"].includes(kind)))] : [row.source?.kind || "nativeRollout"];
            row.totalBasis = dictation ? row.usage.total === null ? "unknown" : "reported" : sample ? "derivedInputOutput" : "reported";
            row.configuredModel = label(row.configuredModel); row.configuredEffort = label(row.configuredEffort);
            row.modelBasis = row.modelBasis === "turnContext" ? "turnContext" : "unknown"; row.conflict = Boolean(row.conflict);
            const key = this.existingKey(row), prior = this.rows.get(key);
            if (!prior) { this.rows.set(key, row); for (const alias of responseKeys(row)) this.responses.set(alias, key); this.shards.get(day).add(key); }
            else this.rows.set(key, this.combined(prior, row));
            for (const alias of responseKeys(row)) this.responses.set(alias, key);
          } catch { this.gap("invalidIndexRow"); }
          complete = position - carry.length + i + 1; begin = i + 1;
          if (++lines % 256 === 0) await yieldLoop();
        }
        carry = carry.subarray(begin);
        if (carry.length > this.lineBytes) throw new Error("Invalid derived line");
        await yieldLoop();
      }
      if (complete < stat.size) { await handle.truncate(complete); this.gap("partialIndexRecovery"); }
      this.dayBytes.set(day, complete); this.bytes += complete;
    } finally { await handle.close(); }
  }
  existingKey(row) {
    for (const alias of responseKeys(row)) { const key = this.responses.get(alias); if (this.rows.has(key)) return key; }
    return keyOf(row);
  }
  combined(prior, row) {
    const compatible = Object.keys(prior.usage).every(field => prior.usage[field] == null || row.usage[field] == null || prior.usage[field] === row.usage[field]);
    if (!compatible || isDictation(prior) !== isDictation(row) || !isSample(prior) && !isSample(row) && !isDictation(row) && prior.nativeThreadId === row.nativeThreadId && prior.turnId !== row.turnId || isDictation(row) && prior.attemptId === row.attemptId && prior.officeAgentId !== row.officeAgentId) { this.gap("conflictingResponse"); return { ...prior, conflict: true }; }
    const kinds = [...new Set([...(prior.sourceKinds || [prior.source?.kind || "nativeRollout"]), ...(row.sourceKinds || [row.source?.kind || "nativeRollout"])])];
    return { ...prior, officeAgentId: prior.officeAgentId ?? row.officeAgentId, usage: Object.fromEntries(Object.keys(prior.usage).map(field => [field, prior.usage[field] ?? row.usage[field]])), sourceKinds: kinds,
      contextNativeThreadId: prior.contextNativeThreadId || row.contextNativeThreadId || null, sourceTurnId: prior.sourceTurnId || row.sourceTurnId || null,
      ...(isDictation(prior) ? { unit: row.usage.total !== null ? row.unit : prior.unit, durationSeconds: prior.durationSeconds ?? row.durationSeconds,
        providerRequestId: prior.providerRequestId || row.providerRequestId || null, usageReason: row.usage.total !== null ? null : prior.usageReason, status: row.status } : {}), conflict: prior.conflict || row.conflict };
  }
  async readJson(name, limit) {
    const handle = await fs.open(path.join(this.directory, name), require("node:fs").constants.O_RDONLY | require("node:fs").constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > limit) throw new Error("Index limit"); return JSON.parse(await handle.readFile("utf8")); }
    finally { await handle.close(); }
  }
  add(row) {
    const key = this.existingKey(row), prior = this.rows.get(key);
    if (prior) {
      const next = this.combined(prior, row);
      for (const alias of responseKeys(row)) this.responses.set(alias, key);
      if (JSON.stringify(next) !== JSON.stringify(prior)) { if (this.append(next) === false) return false; this.rows.set(key, next); }
      return true;
    }
    const day = utcDay(row.observedAt);
    if (day < this.floor || day < dateShift(utcDay(this.now()), -15)) return true;
    row.day = day;
    const appended = this.append(row);
    if (appended === null) return true;
    if (!appended) return false;
    this.rows.set(key, row);
    for (const alias of responseKeys(row)) this.responses.set(alias, key);
    if (!this.shards.has(day)) this.shards.set(day, new Set());
    this.shards.get(day).add(key);
    return true;
  }
  append(row) {
    const day = row.day, text = JSON.stringify(row) + "\n", size = Buffer.byteLength(text);
    while (this.bytes + size > this.maxBytes - this.reserve) {
      const oldest = [...new Set([...this.shards.keys(), day])].sort().find(d => d < utcDay(this.now()));
      if (!oldest) { this.storageLimit = true; return false; }
      this.evict(oldest); this.floor = [this.floor, dateShift(oldest, 1)].sort().at(-1);
      if (day < this.floor) return null;
    }
    this.bytes += size; this.dayBytes.set(day, (this.dayBytes.get(day) || 0) + size);
    if (!this.pending.has(day)) this.pending.set(day, []);
    this.pending.get(day).push(text); this.pendingBytes += size;
    return true;
  }
  evict(day) {
    for (const key of this.shards.get(day) || []) { const row = this.rows.get(key); for (const alias of responseKeys(row)) if (this.responses.get(alias) === key) this.responses.delete(alias); this.rows.delete(key); }
    for (const [alias, key] of this.responses) if (!this.rows.has(key)) this.responses.delete(alias);
    this.bytes -= this.dayBytes.get(day) || 0; this.dayBytes.delete(day);
    for (const text of this.pending.get(day) || []) this.pendingBytes -= Buffer.byteLength(text);
    this.pending.delete(day); this.shards.delete(day); this.deleted.add(day);
  }
  async prune() {
    // Keep extra UTC boundary shards: a displayed IANA day can span two UTC days,
    // including DST. The public view still exposes exactly 14 local dates.
    const cutoff = dateShift(utcDay(this.now()), -15);
    for (const day of this.shards.keys()) if (day < cutoff) this.evict(day);
    for (const [key, binding] of Object.entries(this.bindings)) if (binding.at < this.now() - 16 * DAY) delete this.bindings[key];
    this.bindingCount = Object.keys(this.bindings).length;
    await this.flush();
  }
  async atomic(name, value) {
    const target = path.join(this.directory, name), temporary = target + ".tmp";
    const handle = await fs.open(temporary, require("node:fs").constants.O_WRONLY | require("node:fs").constants.O_CREAT | require("node:fs").constants.O_TRUNC | require("node:fs").constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, target);
  }
  async flush() {
    // Durably write rows BEFORE offsets; a crash can reread, never lose a row.
    for (const [day, lines] of this.pending) {
      const handle = await fs.open(path.join(this.directory, day + ".jsonl"), require("node:fs").constants.O_WRONLY | require("node:fs").constants.O_CREAT | require("node:fs").constants.O_APPEND | require("node:fs").constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(lines.join("")); await handle.sync(); } finally { await handle.close(); }
    }
    this.pending.clear(); this.pendingBytes = 0;
    const state = { format: FORMAT, sources: this.sources, bindings: this.bindings, gaps: this.gaps, floor: this.floor, purposesRecordedFrom: this.purposesRecordedFrom, adaptersEnabledAt: this.adaptersEnabledAt };
    if (Buffer.byteLength(JSON.stringify(state)) > this.reserve) { this.storageLimit = true; this.gap("metadataLimit"); return; }
    await this.atomic("state.json", state);
    // Retention floor is durable before removing old shards. A crash never
    // silently brings an evicted day back into a later snapshot.
    for (const day of this.deleted) await fs.rm(path.join(this.directory, day + ".jsonl"), { force: true });
    this.deleted.clear();
  }
  hint(nativeThreadId) {
    if (this.closed || this.unavailable || !id(nativeThreadId)) return;
    if (!this.queue.has(nativeThreadId) && this.queue.size >= 2048) { this.gap("sourceLimit"); return; }
    this.queue.add(nativeThreadId);
    this.kick();
  }
  refresh() { if (this.closed || this.unavailable) return; for (const nativeId of [...this.known().keys()].slice(0, 2048)) this.queue.add(nativeId); if (this.known().size > 2048) this.gap("sourceLimit"); this.discoveryPending = true; this.kick(); }
  kick() {
    if (this.running || this.closed || this.unavailable || this.storageLimit || !(this.queue.size || this.bindingQueue.length || this.sampleQueue.length || this.dictationQueue.length || this.sourceQueue.length || this.discoveryPending || this.gapPending)) return;
    this.running = this.run().finally(() => { this.running = null; this.kick(); });
  }
  async run() {
    await this.init(); if (this.unavailable) return;
    try {
      while ((this.queue.size || this.bindingQueue.length || this.sampleQueue.length || this.dictationQueue.length || this.sourceQueue.length || this.discoveryPending || this.gapPending) && !this.closed && !this.storageLimit) {
        this.gapPending = false;
        if (this.discoveryPending) await this.discover();
        await this.drainMetadata();
        if (!this.queue.size) { await this.flush(); continue; }
        const nativeId = this.queue.values().next().value; this.queue.delete(nativeId);
        try { await this.collect(nativeId); } catch { this.gap("readerFailure"); this.unavailable = true; break; }
        await yieldLoop();
      }
      if (!this.unavailable) await this.prune();
    } catch { this.unavailable = true; this.gap("indexUnavailable"); }
  }
  async sourceFile(nativeId, state) {
    let candidate = state.file ? path.join(this.home, state.file) : null;
    if (candidate) {
      try { await fs.access(candidate); } catch { candidate = path.join(this.home, "archived_sessions", path.basename(candidate)); }
    }
    if (!candidate || !await fs.access(candidate).then(() => true, () => false)) candidate = await this.resolveSource(nativeId);
    if (!candidate || !path.isAbsolute(candidate)) throw new Error("Source missing");
    const realHome = await fs.realpath(this.home), real = await fs.realpath(candidate);
    const relative = path.relative(realHome, real);
    if (!["sessions", "archived_sessions"].includes(relative.split(path.sep)[0]) || relative.split(path.sep).includes("..") || !path.basename(real).endsWith(`-${nativeId}.jsonl`)) throw new Error("Source outside Office allowlist");
    // Do not follow a swapped symlink between validation and opening.
    const handle = await fs.open(real, require("node:fs").constants.O_RDONLY | require("node:fs").constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) { await handle.close(); throw new Error("Invalid source"); }
    return { handle, stat, relative };
  }
  async collect(nativeId) {
    if (this.sources[nativeId]?.parentNativeThreadId && !this.known().has(this.sources[nativeId].parentNativeThreadId) || !this.known().has(nativeId) && !this.sources[nativeId]?.helperKind) { this.gap("unmappedNativeSource"); return; }
    if (!this.sources[nativeId] && Object.keys(this.sources).length >= 2048) { this.gap("sourceLimit"); return; }
    const state = this.sources[nativeId] ||= { offset: 0, gaps: {} };
    let source;
    try { source = await this.sourceFile(nativeId, state); } catch { state.status = "unavailable"; this.gap("sourceUnavailable", state); return; }
    const { handle, stat, relative } = source;
    try {
      const inode = `${stat.dev}:${stat.ino}`;
      let rewritten = false;
      if (state.anchor && stat.size >= state.offset) {
        const bytes = Buffer.alloc(Math.min(64, state.offset)); await handle.read(bytes, 0, bytes.length, state.offset - bytes.length);
        rewritten = crypto.createHash("sha256").update(bytes).digest("hex") !== state.anchor;
      }
      if (state.inode && (state.inode !== inode || stat.size < state.offset || rewritten)) {
        this.gap(state.inode !== inode ? "sourceReplaced" : "sourceTruncatedOrRewritten", state);
        state.offset = 0; state.version = null; state.context = null;
      }
      state.trusted = true; this.readOwners = this.known(); state.inode = inode; state.file = relative; state.status = "indexing";
      let position = state.offset, start = position, pieces = [], length = 0, oversize = false, slice = 0, sliceStart = performance.now();
      const buffer = Buffer.alloc(Math.min(64 * 1024, this.chunkBytes));
      while (position < stat.size && !this.closed && !this.storageLimit) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - position), position);
        if (!bytesRead) break;
        let begin = 0;
        for (let i = 0; i < bytesRead; i++) if (buffer[i] === 10) {
          const part = buffer.subarray(begin, i); length += part.length;
          if (!oversize && length <= this.lineBytes) pieces.push(Buffer.from(part)); else { if (!oversize) pieces.push(Buffer.from(part.subarray(0, Math.max(0, this.lineBytes - length + part.length)))); oversize = true; }
          if (oversize) {
            const prefix = Buffer.concat(pieces).toString("utf8");
            if (!this.meta(prefix, nativeId, state) && /"type"\s*:\s*"(turn_context|token_usage_record)"/.test(prefix.slice(0, 320))) this.gap("oversizeMetadataLine", state);
          }
          else if (!this.line(Buffer.concat(pieces).toString("utf8"), nativeId, state, start)) break;
          if (this.storageLimit) break;
          state.offset = position + i + 1; start = state.offset; begin = i + 1; pieces = []; length = 0; oversize = false;
        }
        if (this.storageLimit) break;
        const rest = buffer.subarray(begin, bytesRead); length += rest.length;
        if (!oversize && length <= this.lineBytes) pieces.push(Buffer.from(rest)); else { if (!oversize) pieces.push(Buffer.from(rest.subarray(0, Math.max(0, this.lineBytes - length + rest.length)))); oversize = true; }
        position += bytesRead; slice += bytesRead;
        if (slice >= this.chunkBytes || performance.now() - sliceStart >= 8) {
          if (this.pendingBytes >= 256 * 1024) { await this.anchor(handle, state); await this.flush(); }
          await yieldLoop(); slice = 0; sliceStart = performance.now();
        }
      }
      await this.anchor(handle, state);
      state.partialLine = position > state.offset; state.indexedAt = this.now(); state.size = stat.size;
      state.status = this.storageLimit ? "storageLimit" : state.version === VERSION ? "ready" : "unsupported";
      await this.flush();
    } finally { await handle.close(); }
  }
  async anchor(handle, state) {
    const bytes = Buffer.alloc(Math.min(64, state.offset)); await handle.read(bytes, 0, bytes.length, state.offset - bytes.length);
    state.anchor = crypto.createHash("sha256").update(bytes).digest("hex");
  }
  meta(prefix, nativeId, state) {
    let metadata;
    try { metadata = sessionMetadata(prefix); } catch { this.gap("malformedLine", state); return true; }
    if (!metadata) return false;
    if (metadata.id !== nativeId) { this.gap("sourceIdentity", state); state.version = "unknown"; return true; }
    state.version = metadata.cli_version === VERSION ? VERSION : "unsupported";
    if (state.version !== VERSION) this.gap("unsupportedVersion", state);
    else this.readOwners = this.known();
    return true;
  }
  line(text, nativeId, state, offset) {
    if (!text.trim()) return true;
    if (this.meta(text, nativeId, state)) return true;
    // Ordinary prompt/tool/reasoning lines never go through JSON.parse or storage.
    const header = /^\{\s*"timestamp"\s*:\s*"[^"\\]+"\s*,\s*(?:"ordinal"\s*:\s*\d+\s*,\s*)?"type"\s*:\s*"([a-z_]+)"/.exec(text.slice(0, 320));
    if (!header) { this.gap("malformedLine", state); return true; }
    if (!["turn_context", "token_usage_record"].includes(header[1])) return true;
    let event; try { event = JSON.parse(text); } catch { this.gap("malformedLine", state); return true; }
    const p = event.payload;
    if (state.version !== VERSION) { if (event.type === "token_usage_record") this.gap("unsupportedVersion", state); return true; }
    if (event.type === "turn_context") {
      state.context = { turnId: id(p?.turn_id), model: label(p?.model), effort: label(p?.effort) }; return true;
    }
    if (event.type !== "token_usage_record") return true;
    const usage = usageOf(p?.usage), origin = id(p?.thread_id), responseId = id(p?.response_id), turnId = id(p?.turn_id), time = Date.parse(event.timestamp);
    if (!usage || !origin || !responseId || !turnId || !Number.isFinite(time) || time > this.now() + DAY || !Number.isSafeInteger(event.ordinal) || event.ordinal < 0) { this.gap("invalidRecord", state); return true; }
    const owner = (this.readOwners || this.known()).get(origin);
    if (!owner) { this.gap("unknownOrigin", state); return true; }
    const context = state.context?.turnId === turnId ? state.context : null;
    return this.add({ nativeThreadId: origin, officeAgentId: owner.id, ownershipBasis: this.sources[origin]?.ownershipBasis || "officeRoot", responseId, turnId, rootTurnId: id(p.root_turn_id), observedAt: new Date(time).toISOString(), usage,
      configuredModel: context?.model || null, configuredEffort: context?.effort || null, modelBasis: context?.model ? "turnContext" : "unknown",
      source: { relativeFile: state.file, offset, ordinal: event.ordinal, version: VERSION, kind: "nativeRollout" }, totalBasis: "reported", conflict: false });
  }
  bindTurn(value) {
    if (this.closed || this.unavailable || this.storageLimit || !id(value.nativeThreadId) || !id(value.turnId)) return;
    if (this.bindingQueue.length >= 8192) { this.gap("bindingBackpressure"); return; }
    // O(1) local metadata only. Source validation, inheritance and persistence
    // happen on the existing async reader, never in send's acknowledgement path.
    const u = value.usage;
    this.bindingQueue.push({ nativeThreadId: value.nativeThreadId, turnId: value.turnId, taskId: id(value.taskId), phaseId: id(value.phaseId),
      questionIds: Array.isArray(value.questionIds) ? value.questionIds.slice(0, 32).filter(id) : [], mode: value.mode === "steer" ? "steer" : "start",
      usage: u ? { purpose: PURPOSES.includes(u.purpose) && u.purpose !== "suggestion" ? u.purpose : "unknown",
        trigger: ["userMessage", "questionReply", "edit", "continue", "automaticRetry", "schedule", "delegate", "managerReview", "returned", "todoRun", "firefighter"].includes(u.trigger) ? u.trigger : "unknown",
        entryId: id(u.entryId), originId: id(u.originId), deliveryId: id(u.deliveryId), inheritTurnId: id(u.inheritTurnId), entryAt: Number.isSafeInteger(u.entryAt) ? u.entryAt : this.now() } : null });
    this.kick();
  }
  recordSample(value) {
    if (this.closed || this.unavailable || this.storageLimit) return;
    if (this.sampleQueue.length >= 1024) { this.gap("sampleBackpressure"); return; }
    const counter = v => v == null ? null : typeof v === "number" ? v : NaN;
    this.sampleQueue.push({ officeAgentId: id(value.officeAgentId), contextNativeThreadId: id(value.contextNativeThreadId), responseId: id(value.responseId), sourceTurnId: id(value.sourceTurnId),
      inputTokens: counter(value.inputTokens), cachedInputTokens: counter(value.cachedInputTokens), outputTokens: counter(value.outputTokens), observedAt: new Date(this.now()).toISOString() });
    this.kick();
  }
  recordDictation(value) {
    if (this.closed || this.unavailable || this.storageLimit) return;
    if (this.dictationQueue.length >= 1024) { this.gap("dictationBackpressure"); return; }
    const counter = v => v === null ? null : typeof v === "number" ? v : NaN;
    this.dictationQueue.push({ officeAgentId: id(value.officeAgentId), contextNativeThreadId: id(value.contextNativeThreadId), attemptId: id(value.attemptId), providerRequestId: id(value.providerRequestId),
      providerKind: value.providerKind, usage: Object.fromEntries(["input", "output", "total", "cachedInput", "uncachedInput", "cacheWriteInput", "reasoningOutput", "otherOutput"].map(f => [f, counter(value.usage?.[f])])),
      unit: value.unit, durationSeconds: Number.isFinite(value.durationSeconds) && value.durationSeconds >= 0 ? value.durationSeconds : null, usageReason: ["usageUnavailable", "durationOnly", "invalidUsage", "upstreamUnavailable"].includes(value.usageReason) ? value.usageReason : null,
      status: ["completed", "failed", "interrupted"].includes(value.status) ? value.status : "unknown", configuredModel: label(value.configuredModel), observedAt: new Date(this.now()).toISOString() });
    this.kick();
  }
  sampleUnavailable() { if (this.closed || this.unavailable) return; this.gap("sampleUsageUnavailable"); this.gapPending = true; this.kick(); }
  async drainMetadata() {
    for (const value of this.sourceQueue.splice(0)) this.registerSource(value);
    const known = this.known();
    let count = 0;
    for (const value of this.bindingQueue.splice(0)) {
      if (!known.has(value.nativeThreadId)) continue;
      const key = `${value.nativeThreadId}:${value.turnId}`, previous = this.bindings[key];
      if (!previous && this.bindingCount >= 8192) { this.gap("bindingLimit"); continue; }
      const u = value.usage, inherited = u?.inheritTurnId ? this.bindings[`${value.nativeThreadId}:${u.inheritTurnId}`]?.purpose : null;
      let purpose = { id: u?.inheritTurnId ? inherited?.id || "unknown" : u?.purpose || "unknown", basis: u?.inheritTurnId ? "inherited" : u ? "businessEntry" : "unknown",
        trigger: u?.trigger || "unknown", entryId: u?.entryId || null, originId: u?.originId || null, deliveryId: u?.deliveryId || null, inheritedFromTurnId: u?.inheritTurnId || null, at: u?.entryAt || this.now() };
      if (previous) {
        const previousPurpose = previous.purpose?.id || "unknown";
        if (previousPurpose !== purpose.id) purpose = { ...purpose, id: "mixed", basis: "mixedEntries" };
        else if (previous.purpose) purpose = { ...previous.purpose, trigger: purpose.trigger };
      } else if (value.mode === "steer" && purpose.id !== "unknown") purpose = { ...purpose, id: "mixed", basis: "mixedEntries" };
      // Replace objects so already-issued snapshots never change attribution.
      this.bindings[key] = { ...(previous || { taskId: value.taskId, phaseId: value.phaseId, questionIds: value.questionIds, at: this.now() }), purpose };
      if (!previous) this.bindingCount++;
      if (value.mode !== "steer") this.queue.add(value.nativeThreadId);
      if (++count % 256 === 0) await yieldLoop();
    }
    for (const value of this.dictationQueue.splice(0)) {
      if (!this.sessions().some(s => s.id === value.officeAgentId) || !value.attemptId || !["openaiApi", "chatgptSubscription"].includes(value.providerKind) || !dictationUsageOf(value)) { this.gap("invalidDictationUsage"); continue; }
      if (!this.add({ ...value, nativeThreadId: null, turnId: null, rootTurnId: null, responseId: null, sourceTurnId: null,
        configuredEffort: null, modelBasis: "requestConfiguration", totalBasis: value.usage.total === null ? "unknown" : "reported", source: { kind: "dictation", version: VERSION }, conflict: false })) this.gap("dictationStorageLimit");
    }
    for (const value of this.sampleQueue.splice(0)) {
      const owner = known.get(value.contextNativeThreadId), usage = sampleUsageOf(value);
      if (!owner || owner.id !== value.officeAgentId || !value.responseId || !value.sourceTurnId || !usage) { this.gap("invalidSampleUsage"); continue; }
      if (!this.add({ nativeThreadId: null, turnId: null, rootTurnId: null, officeAgentId: owner.id, contextNativeThreadId: value.contextNativeThreadId, sourceTurnId: value.sourceTurnId,
        responseId: value.responseId, observedAt: value.observedAt, usage, configuredModel: null, configuredEffort: "low", modelBasis: "unknown", totalBasis: "derivedInputOutput",
        source: { kind: "threadSample", version: VERSION }, conflict: false })) { this.gap("sampleStorageLimit"); break; }
      if (++count % 256 === 0) await yieldLoop();
    }
  }
  retention(timeZone) {
    const nominal = dateShift(localDay(this.now(), timeZone), -13);
    const retainedFromUtc = [this.floor, dateShift(utcDay(this.now()), -15)].sort().at(-1);
    const boundary = Date.parse(retainedFromUtc + "T00:00:00Z"), boundaryDate = localDay(boundary, timeZone);
    const retainedFrom = [nominal, boundaryDate].sort().at(-1);
    // A UTC eviction boundary can cut through a local day. Comparing the
    // previous instant also handles IANA days whose midnight is skipped by DST.
    const retainedFromPartial = boundaryDate === retainedFrom && localDay(boundary - 1, timeZone) === boundaryDate;
    return { retainedFrom, retainedFromUtc, retainedFromPartial, capacityLimited: Boolean(this.floor) && (retainedFrom > nominal || retainedFromPartial) };
  }
  coverage(timeZone) {
    const known = this.known(), states = [...known.keys()].map(key => this.sources[key]).filter(Boolean), gaps = { ...this.gaps };
    for (const source of Object.values(this.sources)) for (const [key, count] of Object.entries(source.gaps)) gaps[key] = (gaps[key] || 0) + count;
    let firstObservedAt = null, indexedThrough = null;
    for (const row of this.rows.values()) { if (!firstObservedAt || row.observedAt < firstObservedAt) firstObservedAt = row.observedAt; if (!indexedThrough || row.observedAt > indexedThrough) indexedThrough = row.observedAt; }
    return { source: "office-rollout-compatibility", supportedVersion: VERSION, nativeVersion: this.nativeVersion, apiStability: "internal-format", partial: true,
      indexing: Boolean(this.running), unavailable: Boolean(this.unavailable), storageLimit: Boolean(this.storageLimit),
      knownSources: known.size, scannedSources: states.length, readySources: states.filter(s => s.status === "ready").length,
      unsupportedSources: states.filter(s => s.status === "unsupported").length, partialLines: states.filter(s => s.partialLine).length,
      ...this.retention(timeZone),
      firstObservedAt, indexedThrough, adaptersEnabledAt: this.adaptersEnabledAt, producerDurability: "HTTP/sample receipts are queued in memory; a hard crash can lose an unflushed result.", knownGaps: gaps };
  }
  cursor(snapshot, offset, fingerprint = "base") {
    const query = crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
    const payload = Buffer.from(`${snapshot}:${offset}:${query}`).toString("base64url");
    return payload + "." + crypto.createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
  decodeCursor(value) {
    if (typeof value !== "string" || !value || value.length > 512) throw new Error("Invalid usage cursor");
    const [payload, signature] = value.split(".");
    const expected = crypto.createHmac("sha256", this.secret).update(payload).digest("base64url");
    if (signature !== expected) throw new Error("Invalid usage cursor");
    const match = /^([a-f0-9]{32}):(\d+):([a-f0-9]{16})$/.exec(Buffer.from(payload, "base64url").toString());
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error("Invalid usage cursor");
    return { id: match[1], offset: Number(match[2]), query: match[3] };
  }
  async detail(p) {
    const saved = p?.cursor || p?.snapshot ? this.snapshots.get(this.decodeCursor(p.cursor || p.snapshot).id) : null;
    const query = parameters(p?.window === "rolling24h" && p.end === undefined && saved?.window ? { ...p, end: saved.window.end } : p, this.now()); await this.init();
    if (p.refresh && !p.cursor && !p.snapshot) this.refresh();
    const fingerprint = JSON.stringify(query), baseFingerprint = JSON.stringify({ schemaVersion: query.schemaVersion, date: query.date, timeZone: query.timeZone, window: query.window, agentId: query.agentId, configuredModel: query.configuredModel, taskId: query.taskId });
    for (const [key, value] of this.snapshots) if (value.expires < this.now()) this.snapshots.delete(key);
    let snapshot, snapshotId, offset = 0;
    if (p.cursor || p.snapshot) {
      const decoded = this.decodeCursor(p.cursor || p.snapshot);
      snapshotId = decoded.id; snapshot = this.snapshots.get(snapshotId); offset = p.cursor ? decoded.offset : 0;
      const hash = crypto.createHash("sha256").update(p.cursor ? fingerprint : "base").digest("hex").slice(0, 16);
      if (!snapshot || snapshot.baseFingerprint !== baseFingerprint || decoded.query !== hash) throw new Error("Usage page expired or filters changed. Refresh the detail.");
    } else {
      const earliest = this.retention(query.timeZone).retainedFrom, latest = localDay(this.now(), query.timeZone);
      const rows = [], filterRows = [], observed = [...this.rows.values()], turns = new Map(), bindings = { ...this.bindings };
      const known = this.known(); let checked = 0;
      for (const row of observed) {
        if (++checked % 1000 === 0) await yieldLoop();
        if (isDictation(row) ? !this.sessions().some(s => s.id === row.officeAgentId) : !known.has(row.nativeThreadId || row.contextNativeThreadId)) continue;
        const turnKey = `${row.nativeThreadId}:${row.turnId}`;
        if (!isSample(row) && !isDictation(row)) { if (!turns.has(turnKey)) turns.set(turnKey, []); turns.get(turnKey).push(row); }
        if (query.window ? Date.parse(row.observedAt) < Date.parse(query.window.start) || Date.parse(row.observedAt) >= Date.parse(query.window.end) : query.date < earliest || query.date > latest || localDay(row.observedAt, query.timeZone) !== query.date) continue;
        filterRows.push(row);
        const binding = isSample(row) ? null : bindings[turnKey];
        if (query.agentId && (query.agentId === "unattributed" ? row.officeAgentId !== null : query.agentId !== row.officeAgentId) || query.configuredModel && query.configuredModel !== row.configuredModel || query.taskId && (query.taskId === "unattributed" ? Boolean(binding?.taskId) : query.taskId !== binding?.taskId)) continue;
        const recordedPurpose = purposeOf(row, bindings);
        rows.push({ ...row, recordedPurpose, purpose: query.schemaVersion === 1 && recordedPurpose === "dictation" ? "unknown" : recordedPurpose });
      }
      for (const siblings of turns.values()) siblings.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.source.ordinal - b.source.ordinal);
      snapshot = { baseFingerprint, window: query.window, filterRows, rows, turns, bindings, summary: purposeSummary(rows, this.purposesRecordedFrom), expires: this.now() + 300000 };
      if (query.schemaVersion === 1) snapshot.summary.purposes = snapshot.summary.purposes.filter(bucket => bucket.id !== "dictation");
      snapshotId = crypto.randomBytes(16).toString("hex"); this.snapshots.set(snapshotId, snapshot);
      while (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value);
    }
    const rows = snapshot.rows.filter(row => !query.purpose || row.purpose === query.purpose);
    const value = row => query.sort === "time" ? row.observedAt : row.usage[query.sort];
    rows.sort((a, b) => { const av = value(a), bv = value(b); return av == null && bv != null ? 1 : bv == null && av != null ? -1
      : (av < bv ? -1 : av > bv ? 1 : 0) * (query.order === "desc" ? -1 : 1) || a.observedAt.localeCompare(b.observedAt) || keyOf(a).localeCompare(keyOf(b)); });
    const coverage = this.coverage(query.timeZone);
    if (snapshot.summary.measuredResponses && snapshot.summary.denominatorTokens === null) coverage.knownGaps.aggregateOverflow = 1;
    const taskRows = this.tasks(), taskLabels = new Map();
    for (const binding of (query.window ? snapshot.filterRows.map(row => snapshot.bindings[`${row.nativeThreadId}:${row.turnId}`]).filter(Boolean) : Object.values(snapshot.bindings))) if (binding.taskId && !taskLabels.has(binding.taskId)) {
      const row = taskRows.get(binding.taskId);
      taskLabels.set(binding.taskId, { id: binding.taskId, code: typeof row?.code === "string" && /^T[1-9]\d{0,17}$/.test(row.code) ? row.code : null,
        title: typeof row?.title === "string" ? row.title.trim().slice(0, 200) || null : null });
    }
    const queryOwners = this.known(), staff = new Map(this.sessions().map(s => [s.id, s]));
    const publicRows = (query.includeRecords ? rows.slice(offset, offset + query.limit) : []).map(row => {
      const sample = isSample(row) || isDictation(row), turnKey = `${row.nativeThreadId}:${row.turnId}`, binding = sample ? null : snapshot.bindings[turnKey];
      const siblings = sample ? [] : snapshot.turns.get(turnKey) || [];
      const index = siblings.findIndex(s => keyOf(s) === keyOf(row)), previous = siblings[index - 1];
      return { id: keyOf(row), nativeThreadId: row.nativeThreadId, officeAgentId: row.officeAgentId,
        agentName: staff.get(row.officeAgentId)?.name || queryOwners.get(row.nativeThreadId || row.contextNativeThreadId)?.name || row.officeAgentId || "Unattributed native helper",
        responseId: row.responseId, turnId: row.turnId, rootTurnId: row.rootTurnId, observedAt: row.observedAt, usage: row.usage,
        sourceKind: row.source?.kind || "nativeRollout", sourceKinds: row.sourceKinds || [row.source?.kind || "nativeRollout"],
        contextNativeThreadId: row.contextNativeThreadId || null, sourceTurnId: row.sourceTurnId || null, totalBasis: row.totalBasis || "reported",
        purpose: row.purpose, recordedPurpose: row.recordedPurpose, purposeBasis: row.recordedPurpose !== row.purpose ? "unsupportedLegacyCategory" : isDictation(row) ? "providerRequest" : sample ? "sampleResponse" : binding?.purpose?.basis || "unknown", trigger: isDictation(row) ? "dictation" : sample ? "threadSample" : binding?.purpose?.trigger || "unknown",
        configuredModel: row.configuredModel, configuredEffort: row.configuredEffort, modelBasis: row.modelBasis,
        actualModel: null, status: row.status || "unknown", unit: row.unit || "tokens", durationSeconds: row.durationSeconds ?? null, usageReason: row.usageReason || null, providerKind: row.providerKind || null, providerRequestId: row.providerRequestId || null, attemptId: row.attemptId || null, ownershipBasis: row.ownershipBasis || "officeRoot", taskId: binding?.taskId || null, task: binding?.taskId ? taskLabels.get(binding.taskId) || null : null,
        phaseId: binding?.phaseId || null, questionIds: binding?.questionIds || [], attributionBasis: binding ? "turnDispatch" : "unknown",
        conflict: row.conflict, sameTurnResponses: sample ? null : siblings.length,
        previousObservedInput: previous && row.usage.input !== null && previous.usage.input !== null && previous.configuredModel === row.configuredModel && row.configuredModel && !previous.conflict && !row.conflict ? { responseId: previous.responseId, input: previous.usage.input, change: row.usage.input - previous.usage.input, basis: "adjacentObservedSameTurnConfiguredModel" } : null };
    });
    return { date: query.date, timeZone: query.timeZone, window: snapshot.window, serverNow: new Date(this.now()).toISOString(), rows: publicRows, count: rows.length, totals: totalsOf(rows),
      snapshot: this.cursor(snapshotId, 0), purposeSummary: snapshot.summary, selectedPurpose: query.purpose,
      nextCursor: query.includeRecords && offset + query.limit < rows.length ? this.cursor(snapshotId, offset + query.limit, fingerprint) : null,
      coverage, scope: "Office observed subset", outsideRetention: query.window ? Date.parse(query.window.end) <= Date.parse(coverage.retainedFrom + "T00:00:00Z") : query.date < coverage.retainedFrom || query.date > localDay(this.now(), query.timeZone),
      windowPartial: Boolean(query.window && Date.parse(query.window.start) < Date.parse(coverage.retainedFrom + "T00:00:00Z")),
      filters: { agents: [...new Map((query.window ? snapshot.filterRows.map(row => staff.get(row.officeAgentId) || { id: "unattributed", name: "Unattributed native helper" }) : [...this.known().values()]).map(s => [s.id || "unattributed", { id: s.id || "unattributed", name: s.name || s.id }])).values()], configuredModels: [...new Set((query.window ? snapshot.filterRows : [...this.rows.values()]).map(r => r.configuredModel).filter(Boolean))].sort(), taskIds: [...taskLabels.keys()].sort(), tasks: [...taskLabels.values()].sort((a, b) => a.id.localeCompare(b.id)) } };
  }
  async close() {
    this.closed = true; if (this.running) await this.running;
    // The sampler has no replayable rollout. Preserve already-returned numeric
    // results on a graceful stop without making its UI await persistence.
    if (!this.unavailable && (this.bindingQueue.length || this.sampleQueue.length || this.dictationQueue.length || this.sourceQueue.length || this.discoveryPending || this.gapPending)) {
      try { await this.init(); await this.drainMetadata(); await this.prune(); } catch { this.gap("shutdownMeteringFailure"); }
    }
  }
}
module.exports = { OfficeTokenUsage, usageOf, sampleUsageOf, parameters, localDay, userUsage };
