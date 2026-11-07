"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { visibleUserText } = require("../src/lib/text/codex-visible-text");
const { clipText } = require("./codex-session-items");

const sourceKey = source => `${source.threadId}:${source.turnId}:${source.itemId}`;
function question(threadId, item) {
  const excerpt = clipText(visibleUserText(item.content || "").trim(), 512).content;
  if (/^(?:Office delegation submitted|Work on (?:delegated )?Office (?:task|to-do)|Finish manager acceptance for Office task)\b/.test(excerpt)) return null;
  return excerpt && item.turnId ? { sources: [{ threadId, turnId: item.turnId, itemId: item.id.slice(item.turnId.length + 1), excerpt }] } : null;
}

// Only provenance is stored here: native message identities and short quotes.
// Conversation bodies remain owned by Codex. No per-token writes or task guesses.
class OfficeReplyContext {
  constructor(directory) { this.directory = path.join(directory, "reply-context"); this.cache = new Map(); }
  read(id) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error("Invalid conversation identity");
    if (!this.cache.has(id)) {
      const file = path.join(this.directory, `${id}.json`);
      this.cache.set(id, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { questions: {}, answers: {}, turns: {}, inputCounts: {}, pending: {}, last: null });
    }
    return this.cache.get(id);
  }
  save(id) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `${id}.json`), temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.read(id)), { mode: 0o600 }); fs.renameSync(temporary, file);
  }
  current(id, turnId) { const data = this.read(id); return data.questions[turnId === undefined ? data.last : data.turns[turnId]] || null; }
  forTask(id, turnId) {
    const data = this.read(id), context = this.current(id, turnId);
    // Several unlinked steers in one running turn do not prove which request
    // an agent's task operation concerns. Retain the task's known origin.
    return context && (context.taskId || data.inputCounts?.[turnId] === 1) ? context : null;
  }
  bindTask(id, row, turnId) {
    const data = this.read(id), input = data.turns[turnId], context = this.forTask(id, turnId);
    if (!context || context.taskId && context.taskId !== row.id) return;
    data.questions[input] = { ...context, taskId: row.id, taskTitle: row.title }; this.save(id);
  }
  prepare(id, requestId, context) {
    if (!context) return;
    if (["__proto__", "constructor", "prototype"].includes(requestId)) throw new Error("Invalid send identity");
    const data = this.read(id);
    data.pending[requestId] = context;
    for (const old of Object.keys(data.pending).slice(0, -128)) delete data.pending[old];
    this.save(id);
  }
  record(id, item, clientId) {
    if (!item.turnId || !["user", "assistant"].includes(item.role)) return;
    const data = this.read(id);
    if (item.role === "user") {
      // Started and completed events describe the same input. A late completion
      // must not switch the active question back past an intervening steer.
      if (Object.hasOwn(data.questions, item.id)) return;
      const pendingId = clientId && Object.hasOwn(data.pending, clientId) ? clientId : null;
      const context = pendingId ? data.pending[pendingId] : question(id, item);
      if (!context) return;
      if (pendingId) delete data.pending[pendingId];
      data.questions[item.id] = context; data.turns[item.turnId] = item.id; data.last = item.id;
      data.inputCounts ||= {}; data.inputCounts[item.turnId] = (data.inputCounts[item.turnId] || 0) + 1;
    } else {
      // Freeze at the first event, including the first streaming delta. Later
      // steering cannot relabel an answer that already started.
      if (Object.hasOwn(data.answers, item.id)) return;
      data.answers[item.id] = data.turns[item.turnId] || null;
    }
    this.save(id);
  }
  decorate(id, messages) {
    const data = this.read(id), preceding = new Map();
    return messages.map(item => {
      if (item.role === "user" && item.turnId) preceding.set(item.turnId, data.questions[item.id] || question(id, item));
      const context = item.role === "assistant" ? Object.hasOwn(data.answers, item.id)
        ? data.questions[data.answers[item.id]] : preceding.get(item.turnId) : null;
      return context ? { ...item, replyContext: context } : item;
    });
  }
}

function taskReplyContext(row, candidate) {
  // The explicit handoff chooses the task. An unrelated inbox item does not.
  const relevant = candidate && (!candidate.taskId || candidate.taskId === row.id) ? candidate : null;
  const sources = [...(row.replyContext?.sources || []), ...(relevant?.sources || [])];
  const unique = [...new Map(sources.map(source => [sourceKey(source), source])).values()];
  return { taskId: row.id, taskTitle: row.title, sources: unique.length > 3 ? [unique[0], ...unique.slice(-2)] : unique };
}

module.exports = { OfficeReplyContext, taskReplyContext };
