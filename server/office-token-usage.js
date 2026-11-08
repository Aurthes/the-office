"use strict";
// Read-only compatibility projection for Codex 0.166.0 Office rollouts.
// This is observed response telemetry, not a billing API or a complete HTTP log.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const yieldLoop = () => new Promise(resolve => setImmediate(resolve));
const VERSION = "0.166.0", FORMAT = 1, DAY = 86400000;
const id = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value) ? value : null;
const label = value => typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,120}$/.test(value) ? value : null;
const keyOf = row => `${row.nativeThreadId}:${row.responseId}`;
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
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some(k => !["date", "timeZone", "sort", "order", "agentId", "configuredModel", "taskId", "cursor", "limit", "refresh"].includes(k))) throw new Error("Invalid usage query");
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(Date.parse(p.date + "T00:00:00Z")) || utcDay(Date.parse(p.date + "T00:00:00Z")) !== p.date) throw new Error("Invalid date");
  if (typeof p.timeZone !== "string" || p.timeZone.length > 80 || !/^[A-Za-z_+\-/0-9]+$/.test(p.timeZone)) throw new Error("Invalid time zone");
  try { localDay(now, p.timeZone); } catch { throw new Error("Invalid time zone"); }
  const sort = p.sort ?? "total", order = p.order ?? "desc", limit = p.limit ?? 50;
  if (!["total", "input", "uncachedInput", "output", "time"].includes(sort) || !["asc", "desc"].includes(order) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid usage ordering or page size");
  for (const field of ["agentId", "configuredModel", "taskId"]) if (p[field] !== undefined && !(field === "configuredModel" ? label(p[field]) : id(p[field]))) throw new Error("Invalid usage filter");
  if (p.cursor !== undefined && (typeof p.cursor !== "string" || p.cursor.length > 512)) throw new Error("Invalid usage cursor");
  if (p.refresh !== undefined && typeof p.refresh !== "boolean") throw new Error("Invalid refresh");
  return { date: p.date, timeZone: p.timeZone, sort, order, limit, agentId: p.agentId ?? null, configuredModel: p.configuredModel ?? null, taskId: p.taskId ?? null };
}

class OfficeTokenUsage {
  constructor({ directory, home, sessions, resolveSource, nativeVersion = VERSION, now = Date.now, maxBytes = 64 * 1024 * 1024, chunkBytes = 1024 * 1024, lineBytes = 64 * 1024 }) {
    this.directory = path.join(directory, "token-usage"); this.home = path.resolve(home);
    this.sessions = sessions; this.resolveSource = resolveSource; this.now = now;
    this.maxBytes = maxBytes; this.reserve = Math.min(2 * 1024 * 1024, Math.floor(maxBytes / 4));
    this.chunkBytes = chunkBytes; this.lineBytes = lineBytes;
    this.rows = new Map(); this.sources = {}; this.bindings = {}; this.shards = new Map(); this.pending = new Map(); this.deleted = new Set();
    this.dayBytes = new Map(); this.pendingBytes = 0;
    this.queue = new Set(); this.snapshots = new Map(); this.secret = crypto.randomBytes(32);
    this.bytes = 0; this.gaps = {}; this.floor = ""; this.closed = false; this.running = null;
    this.nativeVersion = nativeVersion;
    if (nativeVersion !== VERSION) { this.unavailable = true; this.gap("unsupportedRuntimeVersion"); }
  }
  gap(reason, source) { if (source) source.gaps[reason] = (source.gaps[reason] || 0) + 1; else this.gaps[reason] = (this.gaps[reason] || 0) + 1; }
  known() { return new Map(this.sessions().filter(s => id(s.codexThreadId) && id(s.id)).map(s => [s.codexThreadId, s])); }
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
      this.sources = state.sources || {}; this.bindings = { ...state.bindings, ...this.bindings }; this.gaps = { ...this.gaps, ...state.gaps }; this.floor = state.floor || "";
    } else if (state) this.gap("unsupportedIndex");
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
      while (position < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); if (!bytesRead) break;
        position += bytesRead; carry = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
        let begin = 0;
        for (let i = 0; i < carry.length; i++) if (carry[i] === 10) {
          try {
            const row = JSON.parse(carry.subarray(begin, i).toString("utf8"));
            const usage = usageOf({ input_tokens: row.usage?.input, cached_input_tokens: row.usage?.cachedInput, cache_write_input_tokens: row.usage?.cacheWriteInput, output_tokens: row.usage?.output, reasoning_output_tokens: row.usage?.reasoningOutput, total_tokens: row.usage?.total });
            if (!id(row.nativeThreadId) || !id(row.responseId) || !id(row.turnId) || !Number.isFinite(Date.parse(row.observedAt)) || utcDay(row.observedAt) !== day || row.source?.version !== VERSION || !usage) throw new Error("Invalid row");
            row.usage = usage;
            const key = keyOf(row), prior = this.rows.get(key);
            if (!prior) { this.rows.set(key, row); if (!this.shards.has(day)) this.shards.set(day, new Set()); this.shards.get(day).add(key); }
            else if (row.conflict || JSON.stringify(prior.usage) !== JSON.stringify(row.usage)) prior.conflict = true;
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
  async readJson(name, limit) {
    const handle = await fs.open(path.join(this.directory, name), require("node:fs").constants.O_RDONLY | require("node:fs").constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > limit) throw new Error("Index limit"); return JSON.parse(await handle.readFile("utf8")); }
    finally { await handle.close(); }
  }
  add(row) {
    const key = keyOf(row), prior = this.rows.get(key);
    if (prior) {
      if (JSON.stringify(prior.usage) !== JSON.stringify(row.usage) || prior.turnId !== row.turnId || prior.observedAt !== row.observedAt) {
        if (!prior.conflict) { prior.conflict = true; if (this.append(prior) === false) return false; }
        this.gap("conflictingResponse");
      }
      return true;
    }
    const day = utcDay(row.observedAt);
    if (day < this.floor || day < dateShift(utcDay(this.now()), -15)) return true;
    row.day = day;
    const appended = this.append(row);
    if (appended === null) return true;
    if (!appended) return false;
    this.rows.set(key, row);
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
    for (const key of this.shards.get(day) || []) this.rows.delete(key);
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
    const state = { format: FORMAT, sources: this.sources, bindings: this.bindings, gaps: this.gaps, floor: this.floor };
    if (Buffer.byteLength(JSON.stringify(state)) > this.reserve) { this.storageLimit = true; this.gap("metadataLimit"); return; }
    await this.atomic("state.json", state);
    // Retention floor is durable before removing old shards. A crash never
    // silently brings an evicted day back into a later snapshot.
    for (const day of this.deleted) await fs.rm(path.join(this.directory, day + ".jsonl"), { force: true });
    this.deleted.clear();
  }
  hint(nativeThreadId) {
    if (this.closed || this.unavailable || !this.known().has(nativeThreadId)) return;
    if (!this.sources[nativeThreadId] && Object.keys(this.sources).length + this.queue.size >= 2048) { this.gap("sourceLimit"); return; }
    this.queue.add(nativeThreadId);
    this.kick();
  }
  refresh() { if (this.closed || this.unavailable) return; for (const nativeId of [...this.known().keys()].slice(0, 2048)) this.queue.add(nativeId); if (this.known().size > 2048) this.gap("sourceLimit"); this.kick(); }
  kick() {
    if (this.running || this.closed || this.unavailable || this.storageLimit || !this.queue.size) return;
    this.running = this.run().finally(() => { this.running = null; this.kick(); });
  }
  async run() {
    await this.init(); if (this.unavailable) return;
    try {
      while (this.queue.size && !this.closed && !this.storageLimit) {
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
    if (!this.known().has(nativeId)) return;
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
      state.inode = inode; state.file = relative; state.status = "indexing";
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
    const owner = this.known().get(origin);
    if (!owner) { this.gap("unknownOrigin", state); return true; }
    const context = state.context?.turnId === turnId ? state.context : null;
    return this.add({ nativeThreadId: origin, officeAgentId: owner.id, responseId, turnId, rootTurnId: id(p.root_turn_id), observedAt: new Date(time).toISOString(), usage,
      configuredModel: context?.model || null, configuredEffort: context?.effort || null, modelBasis: context?.model ? "turnContext" : "unknown",
      source: { relativeFile: state.file, offset, ordinal: event.ordinal, version: VERSION }, conflict: false });
  }
  bindTurn({ nativeThreadId, turnId, taskId, phaseId, questionIds }) {
    if (this.unavailable || !this.known().has(nativeThreadId) || !id(turnId)) return;
    // Capture IDs at dispatch, never read a current task to backfill old records.
    const binding = { taskId: id(taskId), phaseId: id(phaseId), questionIds: Array.isArray(questionIds) ? questionIds.filter(id).slice(0, 32) : [], at: this.now() };
    const key = `${nativeThreadId}:${turnId}`;
    if (!this.bindings[key] && Object.keys(this.bindings).length >= 8192) { this.gap("bindingLimit"); return; }
    if (!this.bindings[key]) this.bindings[key] = binding;
    this.hint(nativeThreadId);
  }
  coverage(timeZone) {
    const known = this.known(), states = [...known.keys()].map(key => this.sources[key]).filter(Boolean), gaps = { ...this.gaps };
    for (const source of states) for (const [key, count] of Object.entries(source.gaps)) gaps[key] = (gaps[key] || 0) + count;
    let firstObservedAt = null, indexedThrough = null;
    for (const row of this.rows.values()) { if (!firstObservedAt || row.observedAt < firstObservedAt) firstObservedAt = row.observedAt; if (!indexedThrough || row.observedAt > indexedThrough) indexedThrough = row.observedAt; }
    return { source: "office-rollout-compatibility", supportedVersion: VERSION, nativeVersion: this.nativeVersion, apiStability: "internal-format", partial: true,
      indexing: Boolean(this.running), unavailable: Boolean(this.unavailable), storageLimit: Boolean(this.storageLimit),
      knownSources: known.size, scannedSources: states.length, readySources: states.filter(s => s.status === "ready").length,
      unsupportedSources: states.filter(s => s.status === "unsupported").length, partialLines: states.filter(s => s.partialLine).length,
      retainedFrom: dateShift(localDay(this.now(), timeZone), -13), retainedFromUtc: this.floor || dateShift(utcDay(this.now()), -15),
      firstObservedAt, indexedThrough, knownGaps: gaps };
  }
  cursor(snapshot, offset) {
    const payload = Buffer.from(`${snapshot}:${offset}`).toString("base64url");
    return payload + "." + crypto.createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
  async detail(p) {
    const query = parameters(p, this.now()); await this.init();
    if (p.refresh && !p.cursor) this.refresh();
    const fingerprint = JSON.stringify(query);
    for (const [key, value] of this.snapshots) if (value.expires < this.now()) this.snapshots.delete(key);
    let snapshot, snapshotId, offset = 0;
    if (p.cursor) {
      const [payload, signature] = p.cursor.split(".");
      const expected = crypto.createHmac("sha256", this.secret).update(payload).digest("base64url");
      if (signature !== expected) throw new Error("Invalid usage cursor");
      const decoded = Buffer.from(payload, "base64url").toString().split(":"); snapshotId = decoded[0]; offset = Number(decoded[1]); snapshot = this.snapshots.get(snapshotId);
      if (!snapshot || snapshot.fingerprint !== fingerprint || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Usage page expired or filters changed. Refresh the detail.");
    } else {
      const earliest = dateShift(localDay(this.now(), query.timeZone), -13), latest = localDay(this.now(), query.timeZone);
      const rows = [], observed = [...this.rows.values()], turns = new Map(), bindings = { ...this.bindings };
      const known = this.known(); let checked = 0;
      // This captured set is the snapshot's high-water mark, even when a yield
      // allows a collector to append more rows during query construction.
      for (const row of observed) {
        if (++checked % 1000 === 0) await yieldLoop();
        if (!known.has(row.nativeThreadId)) continue;
        const turnKey = `${row.nativeThreadId}:${row.turnId}`;
        if (!turns.has(turnKey)) turns.set(turnKey, []);
        turns.get(turnKey).push(row);
        if (query.date < earliest || query.date > latest || localDay(row.observedAt, query.timeZone) !== query.date) continue;
        const binding = bindings[turnKey];
        if (query.agentId && query.agentId !== row.officeAgentId || query.configuredModel && query.configuredModel !== row.configuredModel || query.taskId && (query.taskId === "unattributed" ? Boolean(binding?.taskId) : query.taskId !== binding?.taskId)) continue;
        rows.push(row);
      }
      const value = row => query.sort === "time" ? row.observedAt : row.usage[query.sort];
      rows.sort((a, b) => { const av = value(a), bv = value(b); return (av < bv ? -1 : av > bv ? 1 : 0) * (query.order === "desc" ? -1 : 1) || a.observedAt.localeCompare(b.observedAt) || keyOf(a).localeCompare(keyOf(b)); });
      for (const siblings of turns.values()) siblings.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.source.ordinal - b.source.ordinal);
      let totals = rows.length ? Object.fromEntries(Object.keys(rows[0].usage).map(k => [k, rows.reduce((sum, row) => sum + row.usage[k], 0)])) : null;
      const overflow = totals && Object.values(totals).some(value => !Number.isSafeInteger(value));
      if (overflow) totals = null;
      snapshot = { fingerprint, rows, totals, turns, bindings, overflow, expires: this.now() + 300000 };
      snapshotId = crypto.randomBytes(16).toString("hex"); this.snapshots.set(snapshotId, snapshot);
      while (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value);
    }
    const coverage = this.coverage(query.timeZone);
    if (snapshot.overflow) coverage.knownGaps.aggregateOverflow = 1;
    const publicRows = snapshot.rows.slice(offset, offset + query.limit).map(row => {
      const turnKey = `${row.nativeThreadId}:${row.turnId}`, binding = snapshot.bindings[turnKey];
      const siblings = snapshot.turns.get(turnKey);
      const index = siblings.indexOf(row), previous = siblings[index - 1];
      return { id: keyOf(row), nativeThreadId: row.nativeThreadId, officeAgentId: row.officeAgentId,
        agentName: this.known().get(row.nativeThreadId)?.name || row.officeAgentId,
        responseId: row.responseId, turnId: row.turnId, rootTurnId: row.rootTurnId, observedAt: row.observedAt, usage: row.usage,
        configuredModel: row.configuredModel, configuredEffort: row.configuredEffort, modelBasis: row.modelBasis,
        actualModel: null, status: "unknown", taskId: binding?.taskId || null, phaseId: binding?.phaseId || null, questionIds: binding?.questionIds || [], attributionBasis: binding ? "turnDispatch" : "unknown",
        conflict: row.conflict, sameTurnResponses: siblings.length,
        previousObservedInput: previous && previous.configuredModel === row.configuredModel && row.configuredModel && !previous.conflict && !row.conflict ? { responseId: previous.responseId, input: previous.usage.input, change: row.usage.input - previous.usage.input, basis: "adjacentObservedSameTurnConfiguredModel" } : null };
    });
    return { date: query.date, timeZone: query.timeZone, rows: publicRows, count: snapshot.rows.length, totals: snapshot.totals,
      nextCursor: offset + query.limit < snapshot.rows.length ? this.cursor(snapshotId, offset + query.limit) : null,
      coverage, scope: "Office observed subset", outsideRetention: query.date < coverage.retainedFrom || query.date > localDay(this.now(), query.timeZone),
      filters: { agents: [...this.known().values()].map(s => ({ id: s.id, name: s.name || s.id })), configuredModels: [...new Set([...this.rows.values()].map(r => r.configuredModel).filter(Boolean))].sort(), taskIds: [...new Set(Object.values(this.bindings).map(b => b.taskId).filter(Boolean))].sort() } };
  }
  async close() { this.closed = true; if (this.running) await this.running; }
}
module.exports = { OfficeTokenUsage, usageOf, parameters, localDay };
