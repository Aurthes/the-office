// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { answerQuestions } = createRequire(import.meta.url)("../../server/codex-session-questions");
const request = { questions: [{ id: "choice", question: "Which option?", options: [{ label: "A" }, { label: "B" }] }] };

describe("session question answers", () => {
  it("preserves question identity and accepts a provided option", () => {
    expect(answerQuestions(request, { choice: "A" })).toEqual([
      { questionItemId: "choice", question: "Which option?", answer: "A" },
    ]);
  });

  it("rejects forged, missing, extra, empty and overlong answers", () => {
    for (const answers of [null, [], {}, { unrelated: "A" }, { choice: "A", extra: "B" }, { choice: " " }, { choice: "x".repeat(8001) }]) {
      expect(() => answerQuestions(request, answers)).toThrow();
    }
  });

  it("requires a listed choice unless the question permits free text", () => {
    expect(() => answerQuestions(request, { choice: "C" })).toThrow();
    const freeText = { questions: [{ ...request.questions[0], isOther: true }] };
    expect(answerQuestions(freeText, { choice: "C" })[0].answer).toBe("C");
  });
});
