import type { FillRow, FillSnapshot } from "@/lib/fill-probability/model";

export const FILL_NOW = 1_794_000_000_000;
export function fillRow(changes: Partial<FillRow> = {}): FillRow {
  return {
    id: "primary:maker:account-one:venue.perp.a_usdt:bid", producer: "primary:maker", strategy: "maker", instance: "5",
    account: "account-one", exchange: "venue", market: "perp", symbol: "venue.perp.a_usdt", side: "bid",
    sourceSha: "a".repeat(40), pid: 123, heartbeatAt: FILL_NOW, savedAt: FILL_NOW, observedAt: null,
    schema: 8, clock: "exposure_seconds", halfLife: 100, adjustmentInterval: 100, adjustmentProgress: 42,
    enabled: true, weightedHits: 0.04, weightedExposureSeconds: 100,
    baseTheoreticalEma: 0.0012, theoreticalEma: 0.0009, actualEma: 0.0004, ca: 0.8, logCa: -0.2231435513,
    target: 0.001, reason: null, error: false, ...changes,
  };
}
export function fillSnapshot(rows = [fillRow()]): FillSnapshot {
  return { configured: true, serverTime: FILL_NOW, sampledAt: FILL_NOW, sourceErrors: 0, rows };
}
