"use strict";
const fs = require("node:fs"), path = require("node:path");
const { visibleUserText } = require("../src/lib/text/codex-visible-text");
const { StringDecoder } = require("node:string_decoder");
// Async question tools are not exposed by thread/items/list. Read their accepted,
// structured calls and native reply envelopes; never guess questions from prose.
class CodexSessionQuestions {
  constructor(home) { this.home = path.resolve(home); this.files = new Map(); }
  read(filename) {
    if (typeof filename !== "string") return [];
    const file = path.resolve(filename);
    if (!file.startsWith(this.home + path.sep) || !file.endsWith(".jsonl")) return [];
    let stat; try { stat = fs.statSync(file); } catch { return []; }
    let state = this.files.get(file);
    if (!state || state.ino !== stat.ino || stat.size < state.offset) {
      state = { ino: stat.ino, offset: 0, decoder: new StringDecoder("utf8"), partial: "", overflow: false, calls: new Map(), pending: new Map() };
      this.files.set(file, state);
    }
    if (stat.size === state.offset) return [...state.pending.values()].reverse();
    let fd; try { fd = fs.openSync(file, "r"); } catch { return []; }
    try {
      const buffer = Buffer.alloc(256 * 1024);
      while (state.offset < stat.size) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - state.offset), state.offset);
        if (!n) break;
        state.offset += n;
        const parts = state.decoder.write(buffer.subarray(0, n)).split("\n");
        for (let i = 0; i < parts.length; i++) {
          if (!state.overflow) {
            if (state.partial.length + parts[i].length <= 64 * 1024) state.partial += parts[i];
            else { state.partial = ""; state.overflow = true; }
          }
          if (i < parts.length - 1) { if (!state.overflow) this.record(state, state.partial); state.partial = ""; state.overflow = false; }
        }
      }
    } finally { fs.closeSync(fd); }
    return [...state.pending.values()].reverse();
  }
  record(state, line) {
    if (!line.includes('"response_item"') || !(line.includes('request_user_input_async') || line.includes('send_user_message_question_reply') || (state.calls.size && line.includes('function_call_output')) || (state.pending.size && line.includes('"user"')))) return;
    let record; try { record = JSON.parse(line); } catch { return; }
    if (record.type !== "response_item") return;
    const p = record.payload;
    if (p?.type === "function_call" && p.name === "request_user_input_async" && typeof p.call_id === "string") {
      try {
        const args = JSON.parse(p.arguments);
        if (!Array.isArray(args.questions) || !args.questions.length || args.questions.length > 3) return;
        const questions = args.questions.map((q, i) => {
          if (typeof q.title !== "string" || q.title.length > 4000 || (q.options && (!Array.isArray(q.options) || q.options.length > 20 || q.options.some(o => typeof o !== "string")))) throw new Error("Unsupported question");
          return { id: JSON.stringify([p.name, p.call_id, i]), question: q.title, isOther: true, options: (q.options || []).map(label => ({ label })) };
        });
        state.calls.set(p.call_id, { requestId: p.call_id, questions });
        if (state.calls.size > 64) state.calls.delete(state.calls.keys().next().value);
      } catch { /* Malformed calls are not interactive requests. */ }
    } else if (p?.type === "function_call_output" && state.calls.has(p.call_id)) {
      const call = state.calls.get(p.call_id); state.calls.delete(p.call_id);
      try { if (JSON.parse(p.output).accepted === true) state.pending.set(p.call_id, call); } catch { /* Only accepted native calls are shown. */ }
    } else if (p?.type === "message" && p.role === "user") {
      const text = (p.content || []).filter(c => ["input_text", "inputText", "text"].includes(c.type)).map(c => c.text).join("\n");
      const match = text.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
      if (!match) {
        // A normal chat answer/steering message supersedes earlier async prompts.
        // Ambient app context alone is not an answer.
        if (visibleUserText(text).trim() && !/^\s*<(external_codex_apps_open_page|in-app-browser-context)\b/.test(text)) state.pending.clear();
        return;
      }
      try {
        for (const answer of JSON.parse(match[1])) {
          const id = JSON.parse(answer.questionItemId), call = state.pending.get(id[1]);
          if (!call || id[0] !== "request_user_input_async") continue;
          call.questions = call.questions.filter(q => q.id !== answer.questionItemId);
          if (!call.questions.length) state.pending.delete(id[1]);
        }
      } catch { /* Unrelated user text cannot complete a question. */ }
    }
  }
}
function answerQuestions(request, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length !== request.questions.length) throw new Error("请回答每个问题");
  return request.questions.map(q => {
    const answer = answers[q.id];
    if (typeof answer !== "string" || !answer.trim() || answer.length > 8000) throw new Error("答案不能为空或过长");
    if (q.options?.length && !q.isOther && !q.options.some(option => option.label === answer)) throw new Error("请选择后台提供的选项");
    return { questionItemId: q.id, question: q.question, answer };
  });
}
module.exports = { CodexSessionQuestions, answerQuestions };
