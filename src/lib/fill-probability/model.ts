export const FILL_REFRESH_MS = 10_000;
export const FILL_MAX_AGE_MS = 30_000;

export type FillGuardState = "changed" | "unchanged" | "not-run" | "rejected" | "unknown";
export type FillQuote = {
  at: number | null; exportedAt: number | null; available: boolean;
  baseTarget: number | null; beforeNormalize: number | null; afterNormalize: number | null;
  pmax: number | null; normalizationScale: number | null; normalizationEnabled: boolean | null;
  underflow: boolean | null; logAfterNormalize: number | null;
  ca: number | null; logCa: number | null; referencePrice: number | null;
  currentCaProbability: number | null; baseAtReferenceProbability: number | null;
  p1BeforePrice: number | null; p1AfterPrice: number | null; postOnlyAfterPrice: number | null;
  p2AfterPrice: number | null; finalPrice: number | null;
  p1BeforeProbability: number | null; p1AfterProbability: number | null;
  postOnlyAfterProbability: number | null; p2AfterProbability: number | null; finalProbability: number | null;
  p1State: FillGuardState; postOnlyState: FillGuardState; p2State: FillGuardState;
  guardReason: string | null; quoted: boolean | null; disabledMask: number | null;
};

export type FillRow = {
  id: string; producer: string; strategy: string; instance: string;
  account: string; exchange: string; market: string; symbol: string; side: "bid" | "ask";
  sourceSha: string | null; pid: number | null;
  heartbeatAt: number | null; savedAt: number | null; observedAt: number | null;
  schema: number | null; clock: "exposure_seconds" | "trials" | "unknown";
  halfLife: number | null; adjustmentInterval: number | null; adjustmentProgress: number | null;
  enabled: boolean | null; weightedHits: number | null; weightedExposureSeconds: number | null;
  baseTheoreticalEma: number | null; theoreticalEma: number | null; actualEma: number | null;
  ca: number | null; logCa: number | null; target: number | null;
  ready: boolean | null; skipReason: string | null; quote: FillQuote | null;
  reason: string | null; error: boolean;
};
export type FillSnapshot = {
  configured: boolean; serverTime: number; sampledAt: number | null;
  sourceErrors: number; rows: FillRow[];
};
export type FillRecordIdentity = Pick<FillRow, "id" | "strategy" | "exchange" | "account" | "symbol" | "side">;
export type FillRecordSnapshot = Omit<FillSnapshot, "rows"> & {
  view: "record"; records: FillRecordIdentity[]; row: FillRow | null;
};
export type FillState = "ready" | "snapshot" | "stale" | "disabled" | "empty" | "not-ready" | "unknown";

const finite = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
const probability = (v: number | null): v is number => finite(v) && v >= 0 && v <= 1;
const fresh = (v: number | null, now: number) => finite(v) && v > 0 && v <= now + 5_000 && now - v < FILL_MAX_AGE_MS;

export function fillState(row: FillRow, now: number, readFailed = false): FillState {
  if (readFailed || row.error) return "stale";
  if (row.enabled === false) return "disabled";
  if (row.enabled !== true || !row.sourceSha || !/^[0-9a-f]{40}$/i.test(row.sourceSha) ||
      !((row.schema === 8 && row.clock === "exposure_seconds") || (row.schema === 9 && row.clock === "trials")) ||
      !finite(row.heartbeatAt) || !finite(row.savedAt)) return "unknown";
  if (!fresh(row.heartbeatAt, now) || !fresh(row.savedAt, now)) return "stale";
  if (!finite(row.weightedExposureSeconds)) return "unknown";
  if (row.weightedExposureSeconds <= 0) return "empty";
  if (row.ready === false) return "not-ready";
  if (row.ready === true && finite(row.observedAt) && row.observedAt > 0)
    return fresh(row.observedAt, now) ? "ready" : "stale";
  // Older producers have no observation/readiness facts. Preserve their numbers
  // as historical snapshots; never infer readiness from a fresh save timestamp.
  return "snapshot";
}

export function quoteState(row: FillRow, now: number, readFailed = false): "ready" | "stale" | "unknown" {
  if (readFailed || row.error) return "stale";
  const q = row.quote;
  // Backend schema/pin verification owns quote.available. EMA readiness and its
  // save/observation clock are independent of this account's quote calculation.
  if (!q?.available || !row.sourceSha || !/^[0-9a-f]{40}$/i.test(row.sourceSha) ||
      !finite(row.pid) || row.pid <= 0 || !finite(row.heartbeatAt) ||
      !finite(q.at) || !finite(q.exportedAt) || !probability(q.baseTarget) || q.baseTarget <= 0 || q.baseTarget >= 1) return "unknown";
  if (!fresh(row.heartbeatAt, now) || !fresh(q.at, now) || !fresh(q.exportedAt, now)) return "stale";
  return q.at <= q.exportedAt + 5_000 ? "ready" : "unknown";
}

export function probabilityGap(value: number | null, target: number | null, trusted: boolean) {
  if (!probability(value) || !probability(target) || target <= 0 || target >= 1) return null;
  const absolute = value - target;
  const relative = absolute / target;
  if (!Number.isFinite(absolute) || !Number.isFinite(relative)) return null;
  return { absolute, relative, color: gapColor(relative, trusted) };
}

// Distance is symmetric and monotonic. The flag describes usable evidence, not
// trading health; missing/stale/sample-unknown evidence stays neutral.
export function gapColor(relative: number, trusted: boolean): string {
  if (!trusted || !Number.isFinite(relative)) return "#a8b5bd";
  const hue = 120 * (1 - Math.min(Math.abs(relative), 1));
  return `hsl(${hue} 65% 70%)`;
}
