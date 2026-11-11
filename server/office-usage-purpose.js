"use strict";
const PURPOSES = ["chat_work", "suggestion", "dictation", "automation", "operational_task", "collaboration_mixed", "mixed", "unknown"];
const FIELDS = ["input", "cachedInput", "uncachedInput", "cacheWriteInput", "output", "reasoningOutput", "otherOutput", "total"];
const number = value => Number.isSafeInteger(value) && value >= 0;
const isSample = row => row.source?.kind === "threadSample" || row.sourceKinds?.includes("threadSample");
function userUsage(source) {
  if (source !== undefined && source !== "firefighter") throw new Error("Invalid message usage source");
  return source === "firefighter" ? { purpose: "operational_task", trigger: "firefighter" } : { purpose: "chat_work", trigger: "userMessage" };
}
function sampleUsageOf(value) {
  const input = value?.inputTokens ?? null, cachedInput = value?.cachedInputTokens ?? null, output = value?.outputTokens ?? null;
  if ([input, cachedInput, output].some(v => v !== null && !number(v)) || input !== null && cachedInput !== null && cachedInput > input) return null;
  return { input, cachedInput, output, uncachedInput: input !== null && cachedInput !== null ? input - cachedInput : null,
    cacheWriteInput: null, reasoningOutput: null, otherOutput: null, total: input !== null && output !== null && number(input + output) ? input + output : null };
}
function purposeOf(row, bindings) {
  if (row.source?.kind === "dictation") return "dictation";
  if (isSample(row)) return "suggestion";
  const value = bindings[`${row.nativeThreadId}:${row.turnId}`]?.purpose?.id;
  return PURPOSES.includes(value) ? value : "unknown";
}
function components(rows) {
  return Object.fromEntries(FIELDS.map(field => {
    let sum = 0, reportedRows = 0;
    for (const row of rows) if (number(row.usage[field])) { sum += row.usage[field]; reportedRows++; }
    return [field, { knownSubtotal: reportedRows && number(sum) ? sum : null, reportedRows, unknownRows: rows.length - reportedRows }];
  }));
}
function totalsOf(rows) {
  if (!rows.length) return null;
  const values = components(rows);
  if (Object.values(values).some(value => value.reportedRows && value.knownSubtotal === null)) return null;
  return Object.fromEntries(FIELDS.map(field => [field, values[field].unknownRows ? null : values[field].knownSubtotal]));
}
function purposeSummary(rows, purposesRecordedFrom) {
  const measured = rows.filter(row => number(row.usage.total)), sum = measured.reduce((total, row) => total + row.usage.total, 0);
  const denominatorTokens = measured.length && number(sum) ? sum : null;
  return { basis: "businessEntryObservedResponses", denominatorTokens, measuredResponses: measured.length, observedResponses: rows.length,
    unknownUsageResults: rows.length - measured.length, unknownPurposeResponses: rows.filter(row => row.purpose === "unknown").length, purposesRecordedFrom,
    components: components(rows), purposes: PURPOSES.map(id => {
      const bucket = rows.filter(row => row.purpose === id), counted = bucket.filter(row => number(row.usage.total));
      const total = counted.reduce((sum, row) => sum + row.usage.total, 0), knownTokens = counted.length && number(total) ? total : null;
      return { id, knownTokens, share: denominatorTokens > 0 && knownTokens !== null ? knownTokens / denominatorTokens : null,
        observedResponses: bucket.length, measuredResponses: counted.length, meanTokens: knownTokens !== null ? knownTokens / counted.length : null,
        unknownUsageResults: bucket.length - counted.length, components: components(bucket) };
    }),
    unmeasured: [
      { id: "origin", status: "embedded", tokens: null, share: null },
      { id: "context_management", status: "partial", tokens: null, share: null },
      { id: "dictation", status: "partial", tokens: null, share: null },
      { id: "realtime_voice", status: "upstreamUnavailable", tokens: null, share: null },
      { id: "external_native", status: "partial", tokens: null, share: null },
      { id: "company_planning", status: "backendUnsupported", tokens: null, share: null },
    ].map(value => ({ ...value, measuredResponses: null })) };
}
module.exports = { PURPOSES, FIELDS, userUsage, sampleUsageOf, isSample, purposeOf, purposeSummary, totalsOf, components };
