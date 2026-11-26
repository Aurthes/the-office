"use strict";
const invalid = message => Object.assign(new Error(message), { code: "SESSION_REFRESH_INVALID" });
function refreshIntent(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["checkpointId", "independentNewTopic", "nextScope"].includes(k))
    || typeof value.checkpointId !== "string" || !value.checkpointId || value.checkpointId.length > 100 || value.independentNewTopic !== true) throw invalid("A new-topic intent needs an exact checkpoint and an explicit independent-topic declaration");
  const next = value.nextScope;
  if (next !== undefined && (!next || typeof next !== "object" || Array.isArray(next) || Object.keys(next).some(k => !["taskId", "phaseId"].includes(k)) || typeof next.taskId !== "string" || !next.taskId || next.taskId.length > 100 || next.phaseId !== undefined && (typeof next.phaseId !== "string" || !next.phaseId || next.phaseId.length > 100))) throw invalid("Choose the exact next task/phase scope");
  return { checkpointId: value.checkpointId, independentNewTopic: true, ...(next ? { nextScope: { taskId: next.taskId, ...(next.phaseId ? { phaseId: next.phaseId } : {}) } } : {}) };
}
module.exports = { refreshIntent };
