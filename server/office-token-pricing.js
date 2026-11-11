"use strict";
// Standard/global API equivalence for the recorded configured model, not a bill.
const PRICING = {
  version: "standard-global-2026-11-11", checkedAt: "2026-11-11", currency: "USD",
  basis: "Standard API/global; configured model, not served model or subscription charges",
  sources: ["https://developers.openai.com/api/docs/models/gpt-6.1-sol", "https://developers.openai.com/api/docs/guides/prompt-caching", "https://developers.openai.com/api/docs/pricing"],
  models: [{ id: "gpt-6.1-sol", input: 2, cachedInput: 0.1, write30m: 2.5, write12h: 5, output: 10,
    longContextThreshold: 272000, longInputMultiplier: 2, longOutputMultiplier: 1.5 }],
};
const count = value => Number.isSafeInteger(value) && value >= 0;
function estimateResponseCost(row, evidence = {}) {
  const base = { pricingVersion: PRICING.version, priceModelId: null, configuredModelBasis: row.modelBasis || "unknown", longContext: null };
  const unpriced = reason => ({ ...base, status: "unpriced", minUsd: null, maxUsd: null, reasons: [reason], components: null });
  const price = PRICING.models.find(value => value.id === row.configuredModel);
  if (!price) return unpriced("unknownModelOrPrice");
  base.priceModelId = price.id;
  const u = row.usage || {}, I = u.input, C = u.cachedInput, O = u.output, W = u.cacheWriteInput;
  if (![I, C, O].every(count)) return unpriced("missingOrInvalidInputCachedOutput");
  if (!count(I + O) || C > I || u.total != null && u.total !== I + O || W != null && (!count(W) || C + W > I)) return unpriced("inconsistentQuantities");
  const long = I > price.longContextThreshold, inputFactor = long ? price.longInputMultiplier : 1, outputFactor = long ? price.longOutputMultiplier : 1;
  base.longContext = long;
  const R = price.input * inputFactor, R30 = price.write30m * inputFactor, R12 = price.write12h * inputFactor;
  const cacheReadUsd = C * price.cachedInput * inputFactor / 1e6, outputUsd = O * price.output * outputFactor / 1e6, U = I - C;
  let minInput, maxInput, reasons = [];
  // Native serde(default) can synthesize a zero. Existing zero rows have no
  // provenance, so they cannot prove no writes. Positive values are not default.
  if (U === 0) minInput = maxInput = 0;
  else if (W === null || W === undefined || W === 0 && evidence.writeReported !== true) {
    minInput = U * R / 1e6; maxInput = U * Math.max(R30, R12) / 1e6; reasons = ["cacheWriteQuantityNotRecorded"];
  } else if (evidence.write30m !== undefined || evidence.write12h !== undefined) {
    if (![evidence.write30m, evidence.write12h].every(count) || evidence.write30m + evidence.write12h !== W) return unpriced("invalidCacheRetentionPartition");
    minInput = maxInput = ((U - W) * R + evidence.write30m * R30 + evidence.write12h * R12) / 1e6;
  } else {
    minInput = ((U - W) * R + W * Math.min(R30, R12)) / 1e6;
    maxInput = ((U - W) * R + W * Math.max(R30, R12)) / 1e6;
    if (W) reasons = ["cacheRetentionNotRecorded"];
  }
  const minUsd = minInput + cacheReadUsd + outputUsd, maxUsd = maxInput + cacheReadUsd + outputUsd;
  if (![minUsd, maxUsd].every(Number.isFinite)) return unpriced("costOverflow");
  return { ...base, status: minUsd === maxUsd ? "point" : "range", minUsd, maxUsd, reasons,
    components: { cacheReadUsd, outputUsd, remainingInputMinUsd: minInput, remainingInputMaxUsd: maxInput } };
}
function emptyCostSummary() { return { pointResponses: 0, rangeResponses: 0, unpricedResponses: 0, estimatedKnownTokens: 0, unpricedKnownTokens: 0, unknownUsageResults: 0, minUsd: null, maxUsd: null }; }
function addCost(summary, row, cost) {
  const priced = cost.status !== "unpriced";
  summary[cost.status === "point" ? "pointResponses" : cost.status === "range" ? "rangeResponses" : "unpricedResponses"]++;
  if (count(row.usage.total)) {
    const field = priced ? "estimatedKnownTokens" : "unpricedKnownTokens";
    if (summary[field] !== null) summary[field] = count(summary[field] + row.usage.total) ? summary[field] + row.usage.total : null;
  } else summary.unknownUsageResults++;
  if (priced) { summary.minUsd = (summary.minUsd || 0) + cost.minUsd; summary.maxUsd = (summary.maxUsd || 0) + cost.maxUsd; }
}
module.exports = { PRICING, estimateResponseCost, emptyCostSummary, addCost };
