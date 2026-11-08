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
  pricingMode?: "per_symbol_tif"; baseToken?: string; tif?: string;
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

export function fillState(row: Pick<FillRow, "error" | "enabled" | "sourceSha" | "schema" | "clock" | "heartbeatAt" | "savedAt" | "weightedExposureSeconds" | "ready" | "observedAt">, now: number, readFailed = false): FillState {
  if (readFailed || row.error) return "stale";
  if (row.enabled === false) return "disabled";
  if (row.enabled !== true || !row.sourceSha || !/^[0-9a-f]{40}$/i.test(row.sourceSha) ||
      !(([8, 10].includes(row.schema ?? 0) && row.clock === "exposure_seconds") || (row.schema === 9 && row.clock === "trials")) ||
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

export function quoteState(row: Pick<FillRow, "error" | "sourceSha" | "pid" | "heartbeatAt"> & { quote: Pick<FillQuote, "available" | "at" | "exportedAt" | "baseTarget"> | null }, now: number, readFailed = false): "ready" | "stale" | "unknown" {
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

export const FILL_COLUMNS = ["target", "base", "model", "actual", "ca", "logca", "base-reference", "ca-probability", "before-normalize", "pmax", "after-normalize", "before-guard", "p1", "post-only", "p2", "guard", "final"] as const;
export type FillColumn = typeof FILL_COLUMNS[number];
export const FILL_DEFAULT_COLUMNS: FillColumn[] = ["model", "actual", "ca", "base-reference", "ca-probability"];
const tableIdentity = ["producer", "instance", "strategy", "exchange", "market", "account", "symbol"] as const;
const sideFields = ["id", "sourceSha", "pid", "heartbeatAt", "savedAt", "observedAt", "schema", "clock", "enabled", "weightedExposureSeconds", "ready", "error", "reason", "skipReason", "target", "pricingMode", "baseToken", "tif"] as const;
export type FillTableSide = Pick<FillRow, typeof sideFields[number]> & Partial<Pick<FillRow, "baseTheoreticalEma" | "theoreticalEma" | "actualEma">> & {
  quote: Pick<FillQuote, "available" | "at" | "exportedAt" | "baseTarget" | "currentCaProbability"> & Partial<FillQuote> | null;
};
export type FillTableRow = Pick<FillRow, typeof tableIdentity[number]> & { id: string; bid: FillTableSide | null; ask: FillTableSide | null };
export type FillTableSnapshot = Omit<FillSnapshot, "rows"> & { view: "table"; columns: FillColumn[]; rows: FillTableRow[] };
export const fillTableId = (row: Pick<FillRow, typeof tableIdentity[number]>) => JSON.stringify(tableIdentity.map(key => row[key]));

// Shared column dependencies for the source transfer and the original table projection.
export function fillTableFields(columns: FillColumn[]) {
  const rowFields: (keyof FillRow)[] = [...sideFields];
  const quoteFields = new Set<keyof FillQuote>(["available", "at", "exportedAt", "baseTarget", "currentCaProbability"]);
  const dependencies: Partial<Record<FillColumn, (keyof FillQuote)[]>> = {
    ca: ["ca"], logca: ["logCa"], "base-reference": ["baseAtReferenceProbability", "referencePrice"], "ca-probability": ["referencePrice"],
    "before-normalize": ["beforeNormalize"], pmax: ["pmax", "normalizationEnabled"],
    "after-normalize": ["afterNormalize", "normalizationEnabled", "normalizationScale", "underflow", "logAfterNormalize"],
    "before-guard": ["p1BeforeProbability", "p1BeforePrice"], p1: ["p1State", "p1AfterProbability", "p1AfterPrice"],
    "post-only": ["postOnlyState", "postOnlyAfterProbability", "postOnlyAfterPrice"], p2: ["p2State", "p2AfterProbability", "p2AfterPrice"],
    guard: ["postOnlyState", "p2State", "guardReason"], final: ["quoted", "finalProbability", "finalPrice", "guardReason", "disabledMask"],
  };
  for (const column of columns) {
    if (column === "base") rowFields.push("baseTheoreticalEma");
    if (column === "model") rowFields.push("theoreticalEma");
    if (column === "actual") rowFields.push("actualEma");
    for (const field of dependencies[column] || []) quoteFields.add(field);
  }
  return { row: [...new Set(rowFields)], quote: [...quoteFields] };
}

// A scalar projection of one existing shared snapshot, also used for full-server rollback.
export function projectFillTable(snapshot: FillSnapshot, columns: FillColumn[]): FillTableSnapshot {
  const { row: rowFields, quote: quoteFields } = fillTableFields(columns);
  const groups = new Map<string, FillTableRow>();
  for (const row of snapshot.rows) {
    const id = fillTableId(row);
    if (!groups.has(id)) groups.set(id, { id, ...Object.fromEntries(tableIdentity.map(key => [key, row[key]])), bid: null, ask: null } as FillTableRow);
    const group = groups.get(id)!;
    if (group[row.side] !== null) throw new Error("Duplicate probability side");
    group[row.side] = { ...Object.fromEntries(rowFields.map(key => [key, row[key]])),
      quote: row.quote === null ? null : Object.fromEntries([...quoteFields].map(key => [key, row.quote![key]])),
    } as FillTableSide;
  }
  return { configured: snapshot.configured, serverTime: snapshot.serverTime, sampledAt: snapshot.sampledAt,
    sourceErrors: snapshot.sourceErrors, view: "table", columns: [...columns], rows: [...groups.values()] };
}

// Internal ordering only. Both original quote clocks must be usable; zero is data.
export function fillTableDeviation(row: FillTableRow, now: number, failed = false): number | null {
  let sum = 0;
  for (const side of [row.bid, row.ask]) {
    if (!side || quoteState(side, now, failed) !== "ready") return null;
    const q = side.quote!;
    if (!probability(q.currentCaProbability) || !probability(q.baseTarget)) return null;
    sum += Math.abs(q.currentCaProbability - q.baseTarget);
  }
  return sum;
}
export function fillTableOrder(a: FillTableRow, b: FillTableRow, now: number, failed = false): number {
  const av = fillTableDeviation(a, now, failed), bv = fillTableDeviation(b, now, failed);
  const order = av === null ? bv === null ? 0 : 1 : bv === null ? -1 : bv - av;
  return order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
