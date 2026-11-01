"use strict";

function answerQuestions(request, answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length !== request.questions.length) throw new Error("请回答每个问题");
  return request.questions.map(q => {
    const answer = answers[q.id];
    if (typeof answer !== "string" || !answer.trim() || answer.length > 8000) throw new Error("答案不能为空或过长");
    if (q.options?.length && !q.isOther && !q.options.some(option => option.label === answer)) throw new Error("请选择后台提供的选项");
    return { questionItemId: q.id, question: q.question, answer };
  });
}
module.exports = { answerQuestions };
