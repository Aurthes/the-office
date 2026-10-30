// @vitest-environment node
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
const { CodexSessionQuestions, answerQuestions } = createRequire(import.meta.url)("../../server/codex-session-questions");
let root: string, file: string, index: InstanceType<typeof CodexSessionQuestions>;
const row = (payload: unknown) => JSON.stringify({ timestamp: "2026-10-30T10:00:00Z", type: "response_item", payload }) + "\n";
const call = (id = "call-1") => row({ type: "function_call", call_id: id, name: "request_user_input_async", arguments: JSON.stringify({ questions: [{ title: "选哪个？", options: ["甲", "乙"] }] }) });
const accepted = (id = "call-1") => row({ type: "function_call_output", call_id: id, output: '{"accepted":true}' });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "office-questions-")); file = path.join(root, "t.jsonl"); fs.writeFileSync(file, ""); index = new CodexSessionQuestions(root); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
describe("original async question index", () => {
  it("shows accepted structured calls and resolves the exact native reply envelope", () => {
    fs.appendFileSync(file, call()); expect(index.read(file)).toEqual([]);
    fs.appendFileSync(file, accepted()); const q = index.read(file)[0];
    expect(q.questions[0].question).toBe("选哪个？");
    const answers = answerQuestions(q, { [q.questions[0].id]: "甲" });
    fs.appendFileSync(file, row({ type: "message", role: "user", content: [{ type: "input_text", text: '<send_user_message_question_reply>\n' + JSON.stringify(answers) + '\n</send_user_message_question_reply>' }] }));
    expect(index.read(file)).toEqual([]); expect(new CodexSessionQuestions(root).read(file)).toEqual([]);
  });
  it("handles partial records, large unrelated output, and ordinary chat replies", () => {
    fs.appendFileSync(file, call() + accepted()); expect(index.read(file)).toHaveLength(1);
    fs.appendFileSync(file, row({ type: "function_call_output", call_id: "other", output: "x".repeat(500000) }));
    const next = call("call-2"); fs.appendFileSync(file, next.slice(0, -3)); expect(index.read(file)).toHaveLength(1);
    fs.appendFileSync(file, next.slice(-3) + accepted("call-2")); expect(index.read(file)).toHaveLength(2);
    fs.appendFileSync(file, row({ type: "message", role: "user", content: [{ type: "input_text", text: "就用甲，继续" }] }));
    expect(index.read(file)).toEqual([]);
  });
  it("does not turn quoted tool calls into prompts and rejects forged or incomplete answers", () => {
    fs.appendFileSync(file, row({ type: "message", role: "assistant", content: [{ type: "output_text", text: call() + accepted() }] }));
    expect(index.read(file)).toEqual([]);
    fs.appendFileSync(file, call() + accepted()); const q = index.read(file)[0];
    expect(() => answerQuestions(q, { unrelated: "甲" })).toThrow();
    expect(() => answerQuestions(q, {})).toThrow();
    expect(index.read(path.join(root, "../outside.jsonl"))).toEqual([]);
  });
});
