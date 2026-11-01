"use strict";

// Public agentMessage fields emitted by request_user_input_async (Codex v0.166).
function asyncQuestionRequest(item) {
  if (item?.type !== "agentMessage" || item.delivery !== "async" || typeof item.id !== "string" || !Array.isArray(item.questions) || !item.questions.length || item.questions.length > 3) return null;
  const questions = [];
  for (const [index, q] of item.questions.entries()) {
    if (typeof q?.title !== "string" || !q.title.trim() || (q.options !== undefined && (!Array.isArray(q.options) || q.options.some(o => typeof o !== "string" || !o.trim())))) return null;
    questions.push({ id: JSON.stringify(["request_user_input_async", item.id, index]), question: q.title, isOther: true,
      ...(q.options?.length ? { options: q.options.map(label => ({ label })), defaultAnswer: q.options[0] } : {}) });
  }
  const request = { requestId: "async:" + item.id, questions };
  return Buffer.byteLength(JSON.stringify(request)) <= 16000 ? request : null;
}

function questionReplyMessage(request, answers) {
  return "<send_user_message_question_reply>\n" + JSON.stringify(answerQuestions(request, answers)).replace(/</g, "\\u003c") + "\n</send_user_message_question_reply>";
}

function pendingAfterItem(pending, item) {
  if (item?.type === "userMessage") {
    const text = (item.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    const reply = text.match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
    if (!reply) return [];
    try {
      const answered = new Set(JSON.parse(reply[1]).map(a => a.questionItemId));
      return pending.filter(request => !request.questions.every(q => answered.has(q.id)));
    } catch { return []; }
  }
  const question = asyncQuestionRequest(item);
  if (!question) return pending;
  const next = [...pending.filter(q => q.requestId !== question.requestId), question].slice(-8);
  while (Buffer.byteLength(JSON.stringify(next)) > 32000) next.shift();
  return next;
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
module.exports = { answerQuestions, asyncQuestionRequest, questionReplyMessage, pendingAfterItem };
