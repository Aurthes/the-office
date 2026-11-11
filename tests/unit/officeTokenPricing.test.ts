// @vitest-environment node
import { createRequire } from "node:module";
import { expect, it } from "vitest";
const { estimateResponseCost: cost, emptyCostSummary, addCost } = createRequire(import.meta.url)("../../server/office-token-pricing.js");
const row = (I = 1000, C = 200, W: number | null = 0, O = 100, model = "gpt-6.1-sol") => ({ configuredModel: model, modelBasis: "turnContext", usage: { input: I, cachedInput: C, cacheWriteInput: W, output: O, total: I + O, reasoningOutput: 60 } });
it("uses disjoint input/cache/write partitions and never charges reasoning twice", () => {
  expect(cost(row(1000, 200, 100, 100), { writeReported: true, write30m: 100, write12h: 0 })).toMatchObject({ status: "point", minUsd: 0.00267, maxUsd: 0.00267 });
  expect(cost(row(12000, 4000, 7000, 0), { writeReported: true, write30m: 3000, write12h: 4000 }).minUsd).toBeCloseTo(0.0299, 12);
  const a = row(); expect(cost(a)).toEqual(cost({ ...a, usage: { ...a.usage, reasoningOutput: null } }));
});
it("keeps default zero writes unknown, positive writes with unknown TTL ranged, and infers zero only from all-cached input", () => {
  expect(cost(row())).toMatchObject({ status: "range", minUsd: 0.00262, maxUsd: 0.00502, reasons: ["cacheWriteQuantityNotRecorded"] });
  expect(cost(row(1000, 200, null))).toEqual(cost(row()));
  expect(cost(row(1000, 200, 100))).toMatchObject({ status: "range", reasons: ["cacheRetentionNotRecorded"] });
  expect(cost(row(1000, 1000, 0))).toMatchObject({ status: "point", minUsd: 0.0011 });
  expect(cost(row(), { writeReported: true })).toMatchObject({ status: "point", minUsd: 0.00262 });
});
it("applies the long-context tier per request strictly above 272000, never to a grouped sum", () => {
  expect(cost(row(272000, 0, 0, 100), { writeReported: true })).toMatchObject({ longContext: false, minUsd: 0.545 });
  expect(cost(row(272001, 0, 0, 100), { writeReported: true }).minUsd).toBeCloseTo(1.089504, 12);
  const a = row(200000, 0, 0, 0), c = cost(a, { writeReported: true });
  const summary = emptyCostSummary(); addCost(summary, a, c); addCost(summary, a, c);
  expect(summary.minUsd).toBe(0.8); expect(cost(row(400000, 0, 0, 0), { writeReported: true }).minUsd).toBe(1.6);
});
it.each([
  [row(1, 0, 0, 1, "gpt-6.1-sol-latest"), {}, "unknownModelOrPrice"],
  [{ ...row(), usage: { ...row().usage, input: null } }, {}, "missingOrInvalidInputCachedOutput"],
  [row(100, 90, 11), {}, "inconsistentQuantities"],
  [row(Number.MAX_SAFE_INTEGER, 0, 0, 1), {}, "inconsistentQuantities"],
  [row(1000, 200, 100), { writeReported: true, write30m: 99, write12h: 0 }, "invalidCacheRetentionPartition"],
])("leaves unsupported or invalid costs unpriced instead of zero (%j)", (value, evidence, reason) => {
  expect(cost(value, evidence)).toMatchObject({ status: "unpriced", minUsd: null, maxUsd: null, reasons: [reason] });
});
