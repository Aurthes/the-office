"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { visibleUserText } = require("../src/lib/text/codex-visible-text");
const { clipText } = require("./codex-session-items");

const sourceKey = source => `${source.threadId}:${source.turnId}:${source.itemId}`;
const controlText = text => /^(?:Office delegation submitted|Work on (?:delegated )?Office (?:task|to-do)|Finish manager acceptance for Office task)\b/.test(text)
  || /^Continue where you left off\.?$/i.test(text.trim());
const uniqueSources = sources => [...new Map(sources.filter(source => source && !controlText(source.excerpt || "")).map(source => [sourceKey(source), source])).values()];
function sourceOf(threadId, item) {
  const text = visibleUserText(item.content || "").trim();
  return text && item.turnId && !controlText(text) ? { threadId, turnId: item.turnId, itemId: item.id.slice(item.turnId.length + 1), excerpt: clipText(text, 512).content } : null;
}
function requiredText(value, name, limit = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Invalid ${name}`);
  return value.trim();
}

// Questions are semantic objects, separate from message provenance and tasks.
// The agent declares/selects them; neither the latest input nor a running task
// identifies the question an answer addresses. Full messages stay in Codex.
class OfficeReplyContext {
  constructor(directory, options = {}) {
    this.directory = path.join(directory, "reply-context"); this.questionDirectory = path.join(directory, "questions");
    this.options = options; this.cache = new Map(); this.questionCache = new Map();
  }
  read(id) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error("Invalid conversation identity");
    if (!this.cache.has(id)) {
      const file = path.join(this.directory, `${id}.json`);
      let data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
      if (data?.version !== 2) {
        const old = data;
        data = { version: 2, sources: {}, inputs: {}, turnId: null, focus: { questionIds: [] }, known: [], answers: {}, pending: {}, requests: {} };
        // Old associations prove only message provenance, never a logical Q.
        for (const context of Object.values(old?.questions || {})) for (const source of uniqueSources(context.sources || [])) {
          if (source.threadId === id) data.sources[`${source.turnId}:${source.itemId}`] = source;
        }
        for (const [answerId, inputId] of Object.entries(old?.answers || {})) {
          const context = old.questions[inputId];
          if (context) data.answers[answerId] = { ...context, questions: [], sources: uniqueSources(context.sources || []) };
        }
      }
      this.cache.set(id, data);
    }
    return this.cache.get(id);
  }
  atomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temporary, file);
  }
  save(id) { this.atomic(path.join(this.directory, `${id}.json`), this.read(id)); }
  getQuestion(id) {
    if (!/^q-[a-f0-9-]{36}$/.test(id || "")) throw new Error("Choose an existing question ID");
    if (!this.questionCache.has(id)) {
      const file = path.join(this.questionDirectory, `${id}.json`);
      if (!fs.existsSync(file)) throw new Error("Question is no longer available");
      const question = JSON.parse(fs.readFileSync(file, "utf8"));
      if (question.id !== id || !question.summary || !question.sources?.length) throw new Error("Invalid question state");
      this.questionCache.set(id, question);
    }
    return this.questionCache.get(id);
  }
  describeQuestion(id) {
    const question = this.getQuestion(id), parents = [], seen = new Set([id]); let parent = question.parentQuestionId;
    while (parent && parents.length < 8 && !seen.has(parent)) {
      seen.add(parent); const row = this.getQuestion(parent); parents.unshift({ id: row.id, summary: row.summary }); parent = row.parentQuestionId;
    }
    return { ...question, parents };
  }
  current(id, turnId) {
    const data = this.read(id);
    if (turnId !== undefined && data.turnId !== turnId) return null;
    if (!data.focus.questionIds.length) return data.legacyContext || null;
    const { questionIds, ...task } = data.focus;
    return { ...task, questions: questionIds.map(questionId => this.describeQuestion(questionId)) };
  }
  forTask(id, turnId) { const context = this.current(id, turnId); return context?.questions?.length ? context : null; }
  taskBinding(taskId, phaseId) {
    if (taskId == null) { if (phaseId) throw new Error("A phase needs a task ID"); return {}; }
    const task = this.options.task?.(requiredText(taskId, "task"));
    if (!task) throw new Error("Task is no longer available");
    const phase = phaseId ? task.phases.find(phase => phase.id === phaseId) : null;
    if (phaseId && !phase) throw new Error("Task phase is no longer available");
    return { taskId: task.id, taskTitle: task.title, ...(phase ? { phaseId: phase.id, phaseTitle: phase.title } : {}) };
  }
  bindTask(id, row, turnId) {
    const data = this.read(id);
    if (!this.forTask(id, turnId)) return;
    data.focus = { ...data.focus, taskId: row.id, taskTitle: row.title }; this.save(id);
  }
  sources(id) {
    const data = this.read(id), inputIds = data.inputs[data.turnId] || [];
    const current = inputIds.map(inputId => data.sources[inputId]).filter(Boolean);
    return uniqueSources(current.length ? current : [...Object.values(data.sources).slice(-12), ...(data.legacyContext?.sources || [])]);
  }
  async context(id, args = {}) {
    const data = this.read(id);
    if (!this.sources(id).length && this.options.recent) {
      for (const item of await this.options.recent(id)) {
        const source = item.role === "user" && sourceOf(id, item);
        if (source) data.sources[item.id] = source;
      }
      this.save(id);
    }
    const definitions = args.questions || [];
    if (!Array.isArray(definitions) || definitions.length > 8) throw new Error("Define up to eight questions");
    if (args.answering !== undefined && (!Array.isArray(args.answering) || !args.answering.length || args.answering.length > 8)) throw new Error("Select one to eight questions");
    if (!definitions.length && !args.answering) return this.state(id);
    const task = this.taskBinding(args.taskId, args.phaseId), prepared = new Map(), aliases = new Map();
    let requestId, hash;
    if (definitions.length) {
      requestId = requiredText(args.requestId, "question request ID", 160);
      if (["__proto__", "constructor", "prototype"].includes(requestId)) throw new Error("Invalid question request ID");
      hash = crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex");
      const previous = data.requests[requestId];
      if (previous) {
        if (previous.hash !== hash) throw new Error("Question request ID conflict");
        return { ...this.state(id), opened: previous.opened };
      }
    }
    for (const definition of definitions) {
      const key = requiredText(definition.key, "question key", 32), summary = requiredText(definition.summary, "question summary", 180);
      if (aliases.has(key)) throw new Error("Question keys must be unique");
      if (controlText(summary)) throw new Error("A continuation instruction is not a question summary");
      const parentId = aliases.get(definition.parentQuestionId) || definition.parentQuestionId;
      const parent = parentId ? prepared.get(parentId) || this.getQuestion(parentId) : null;
      let sources = parent?.sources || [];
      if (definition.source) {
        const source = definition.source;
        for (const field of ["threadId", "turnId", "itemId"]) requiredText(source[field], "source " + field);
        let actual = source.threadId === id ? data.sources[`${source.turnId}:${source.itemId}`] : null;
        if (!actual && this.options.source) actual = await this.options.source(source);
        if (!actual || controlText(actual.excerpt || "")) throw new Error("Choose an original user message, not a control prompt");
        sources = uniqueSources([...sources, actual]);
      } else if (!parent) {
        const candidates = this.sources(id);
        if (candidates.length !== 1) throw new Error("The original message is ambiguous. Read question_context and choose an exact source from recentSources.");
        sources = candidates;
      }
      const question = { id: `q-${crypto.randomUUID()}`, summary, sources: sources.length > 4 ? [sources[0], ...sources.slice(-3)] : sources,
        ...(parent ? { parentQuestionId: parent.id } : {}), createdBy: id, createdAt: Date.now() };
      aliases.set(key, question.id); prepared.set(question.id, question);
    }
    const selection = args.answering || [...prepared.keys()];
    const questionIds = [...new Set(selection.map(key => aliases.get(key) || key))];
    for (const questionId of questionIds) if (!prepared.has(questionId)) this.getQuestion(questionId);
    for (const question of prepared.values()) {
      this.atomic(path.join(this.questionDirectory, `${question.id}.json`), question); this.questionCache.set(question.id, question);
    }
    data.focus = { questionIds, ...task }; delete data.legacyContext;
    data.known = [...new Set([...data.known, ...prepared.keys(), ...questionIds])].slice(-64);
    const opened = Object.fromEntries(aliases);
    if (requestId) {
      data.requests[requestId] = { hash, opened };
      for (const old of Object.keys(data.requests).slice(0, -128)) delete data.requests[old];
    }
    this.save(id);
    return { ...this.state(id), opened };
  }
  state(id) {
    const data = this.read(id);
    return { answering: data.focus.questionIds, context: this.current(id),
      knownQuestions: data.known.slice(-12).map(questionId => { const question = this.getQuestion(questionId); return { id: question.id, summary: question.summary, parentQuestionId: question.parentQuestionId, sources: question.sources.map(source => ({ ...source, excerpt: clipText(source.excerpt, 160).content })) }; }),
      recentSources: this.sources(id) };
  }
  prepare(id, requestId, context, kind = "handoff") {
    if (!context && kind === "user") return;
    if (["__proto__", "constructor", "prototype"].includes(requestId)) throw new Error("Invalid send identity");
    const data = this.read(id); data.pending[requestId] = { kind, context };
    for (const old of Object.keys(data.pending).slice(0, -128)) delete data.pending[old];
    this.save(id);
  }
  record(id, item, clientId) {
    if (!item.turnId || !["user", "assistant"].includes(item.role)) return;
    const data = this.read(id);
    if (item.role === "user") {
      if (Object.values(data.inputs).some(ids => ids.includes(item.id))) return;
      const pending = clientId && data.pending[clientId];
      if (pending) delete data.pending[clientId];
      data.turnId = item.turnId; (data.inputs[item.turnId] ||= []).push(item.id);
      if (pending?.kind === "continue" || pending?.kind === "handoff") {
        const context = pending.context;
        if (context?.questions?.length) {
          data.focus = { questionIds: context.questions.map(question => this.getQuestion(question.id).id),
            ...(context.taskId ? { taskId: context.taskId, taskTitle: context.taskTitle } : {}),
            ...(context.phaseId ? { phaseId: context.phaseId, phaseTitle: context.phaseTitle } : {}) };
          data.known = [...new Set([...data.known, ...data.focus.questionIds])].slice(-64); delete data.legacyContext;
        } else if (pending.kind === "handoff") { data.focus = { questionIds: [] }; data.legacyContext = context; }
        // A continuation without metadata never becomes a new Q or source.
      } else {
        const source = sourceOf(id, item);
        if (source) { data.sources[item.id] = source; data.focus = { questionIds: [] }; delete data.legacyContext; }
      }
    } else {
      if (Object.hasOwn(data.answers, item.id)) return;
      data.answers[item.id] = this.current(id, item.turnId) || { questions: [] };
    }
    this.save(id);
  }
  decorate(id, messages) {
    const data = this.read(id);
    return messages.map(item => item.role === "assistant" && data.answers[item.id] ? { ...item, replyContext: data.answers[item.id] } : item);
  }
}

function taskReplyContext(row, candidate) {
  const original = row.replyContext || {}, roots = new Set((original.questions || []).map(question => question.id));
  const relevant = candidate?.questions?.filter(question => candidate.taskId === row.id || roots.has(question.id) || question.parents?.some(parent => roots.has(parent.id))) || [];
  const questions = relevant.length ? relevant : original.questions || [];
  return { taskId: row.id, taskTitle: row.title, questions,
    ...(candidate?.taskId === row.id && candidate.phaseId ? { phaseId: candidate.phaseId, phaseTitle: candidate.phaseTitle } : {}),
    ...(!questions.length ? { sources: uniqueSources(original.sources || []) } : {}) };
}

module.exports = { OfficeReplyContext, taskReplyContext, sourceOf };
