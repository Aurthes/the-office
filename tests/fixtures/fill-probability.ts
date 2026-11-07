import type { FillQuote, FillRow, FillSnapshot } from "@/lib/fill-probability/model";

export const FILL_NOW = 1_794_000_000_000;
export function fillRow(changes: Partial<FillRow> = {}): FillRow {
  return {
    id: "primary:maker:account-one:venue.perp.a_usdt:bid", producer: "primary:maker", strategy: "maker", instance: "5",
    account: "account-one", exchange: "venue", market: "perp", symbol: "venue.perp.a_usdt", side: "bid",
    sourceSha: "a".repeat(40), pid: 123, heartbeatAt: FILL_NOW, savedAt: FILL_NOW, observedAt: null,
    schema: 8, clock: "exposure_seconds", halfLife: 100, adjustmentInterval: 100, adjustmentProgress: 42,
    enabled: true, weightedHits: 0.04, weightedExposureSeconds: 100,
    baseTheoreticalEma: 0.0012, theoreticalEma: 0.0009, actualEma: 0.0004, ca: 0.8, logCa: -0.2231435513,
    target: 0.001, ready: null, skipReason: null, quote: null, reason: null, error: false, ...changes,
  };
}

// Offline candidate observation fixture. It is not a deployed producer record.
export function fillQuote(changes: Partial<FillQuote> = {}): FillQuote {
  return {
    at: FILL_NOW - 100, exportedAt: FILL_NOW, available: true, baseTarget: .001,
    beforeNormalize: .0015, afterNormalize: .0012, pmax: .0012,
    normalizationScale: .8, normalizationEnabled: true, underflow: false, logAfterNormalize: null,
    ca: .8, logCa: -.2231435513, referencePrice: 99.8,
    currentCaProbability: .0012, baseAtReferenceProbability: .0015,
    p1BeforePrice: 99.8, p1AfterPrice: 99.7, postOnlyAfterPrice: 99.6,
    p2AfterPrice: 99.5, finalPrice: 99.5,
    p1BeforeProbability: .0012, p1AfterProbability: .0011, postOnlyAfterProbability: .001,
    p2AfterProbability: .0009, finalProbability: .0009,
    p1State: "changed", postOnlyState: "changed", p2State: "changed",
    guardReason: null, quoted: true, disabledMask: 0, ...changes,
  };
}
export function fillSnapshot(rows = [fillRow()]): FillSnapshot {
  return { configured: true, serverTime: FILL_NOW, sampledAt: FILL_NOW, sourceErrors: 0, rows };
}
