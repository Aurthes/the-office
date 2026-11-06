export const CAPACITY_REFRESH_MS = 5_000;
export const CAPACITY_MAX_AGE_MS = 30_000;
const CLOCK_TOLERANCE_MS = 5_000;
export type CapacityState = "normal" | "low" | "unknown";
export type Market = "spot" | "perp";
export type Scope = { exchange: string; account: string; market: Market };
export type CapacityEvidence = {
  producer: string; strategy: string; state: CapacityState; heartbeatAt: number | null;
  evidenceAt: number | null; observedAt: number | null; limit: number | null;
  normalLimit: number | null; normalWindowMs: number | null; waitMs: number | null;
  instance: string | null; pid: number | null; startedAt: number | null;
  error: boolean;
};
export type CapacityRow = Scope & { evidence: CapacityEvidence[] };
export type ProducerReply = { id: string; strategy: string; expected?: unknown; heartbeat?: unknown; error?: string | null };
export type CapacitySnapshot = {
  configured: boolean; serverTime: number; sampledAt: number | null;
  sourceErrors: number; rows: CapacityRow[];
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const positive = (v: unknown) => { const n = number(v); return n !== null && n > 0 ? n : null; };
const timestamp = (v: unknown) => { const n = positive(v); return n !== null && n <= 8_640_000_000_000_000 ? n : null; };
const scope = (v: unknown): Scope | null => {
  const r = object(v);
  if (!["gate", "gateio"].includes(String(r.exchange)) || typeof r.account !== "string" || !r.account.trim() || r.account.length > 256 || !["spot", "perp"].includes(String(r.market))) return null;
  return { exchange: "gateio", account: r.account, market: r.market as Market };
};
const key = (s: Scope) => JSON.stringify([s.exchange, s.account, s.market]);

// Browser-safe facts only. Transport/configuration and Redis credentials stay server-side.
export function capacityRows(producers: ProducerReply[]): CapacityRow[] {
  const grouped = new Map<string, CapacityRow>();
  for (const producer of producers) {
    const hb = object(producer.heartbeat);
    const raw = Array.isArray(hb.rate_limit_capacity) ? hb.rate_limit_capacity.slice(0, 1024) : [];
    const reported = new Map<string, Record<string, unknown>>();
    // Duplicate market records are ambiguous; do not silently choose a green one.
    for (const item of raw) { const s = scope(item); if (s) reported.set(key(s), reported.has(key(s)) ? {} : object(item)); }
    const expected = new Map<string, Scope>();
    for (const item of [...(Array.isArray(producer.expected) ? producer.expected : []), ...raw]) {
      const s = scope(item); if (s) expected.set(key(s), s);
    }
    const valid = hb.rate_limit_capacity_schema === 1 && hb.strategy === producer.strategy &&
      hb.type === "hb" && hb.success === true && !hb.rate_limit_capacity_error;
    for (const [identity, s] of expected) {
      const r = reported.get(identity) || {};
      const complete = valid && positive(r.limit) !== null && positive(r.normal_limit) !== null && positive(r.normal_window_ms) !== null;
      const state: CapacityState = complete && r.state === "normal" && r.low_capacity === false ? "normal" :
        complete && r.state === "low" && r.low_capacity === true ? "low" : "unknown";
      const e: CapacityEvidence = {
        producer: producer.id, strategy: producer.strategy, state,
        heartbeatAt: timestamp(hb.ts), evidenceAt: timestamp(r.evidence_at_ms), observedAt: timestamp(r.observed_at_ms),
        limit: positive(r.limit), normalLimit: positive(r.normal_limit), normalWindowMs: positive(r.normal_window_ms),
        waitMs: number(r.reset_wait_ms), error: !!producer.error,
        instance: typeof hb.strategy_idx === "string" ? hb.strategy_idx.slice(0, 128) : null,
        pid: positive(hb.pid), startedAt: positive(hb.reporter_started_at_ms),
      };
      const row = grouped.get(identity) || { ...s, evidence: [] };
      row.evidence.push(e); grouped.set(identity, row);
    }
  }
  return [...grouped.values()].sort((a, b) => a.account.localeCompare(b.account) || a.market.localeCompare(b.market));
}

export type CapacityDisplay = { state: CapacityState | "stale"; lastState: CapacityState; evidence: CapacityEvidence | null; reason: "read" | "heartbeat" | "evidence" | "unknown" | null };
function displayEvidence(e: CapacityEvidence, now: number, readFailed: boolean): CapacityDisplay {
  const result = (state: CapacityDisplay["state"], reason: CapacityDisplay["reason"]): CapacityDisplay => ({ state, reason, lastState: e.state, evidence: e });
  const fresh = (t: number | null) => t !== null && t <= now + CLOCK_TOLERANCE_MS && now - t < CAPACITY_MAX_AGE_MS;
  if (readFailed || e.error) return result("stale", "read");
  if (!fresh(e.heartbeatAt)) return result("stale", "heartbeat");
  if (e.state === "unknown") return result("unknown", "unknown");
  if (!fresh(e.evidenceAt) || !fresh(e.observedAt) || e.evidenceAt! > e.heartbeatAt! + CLOCK_TOLERANCE_MS) return result("stale", "evidence");
  return result(e.state, null);
}

export function capacityDisplay(row: CapacityRow, now: number, readFailed = false): CapacityDisplay {
  const facts = row.evidence.map(e => displayEvidence(e, now, readFailed));
  // A different process's healthy reply cannot conceal a current or unresolved low.
  const low = facts.find(e => e.state === "low");
  if (low) return low;
  const unresolved = facts.find(e => e.lastState === "low");
  if (unresolved) return unresolved;
  const stale = facts.find(e => e.state === "stale");
  if (stale) return stale;
  const unknown = facts.find(e => e.state === "unknown");
  return unknown || facts[0] || { state: "unknown", lastState: "unknown", evidence: null, reason: "unknown" };
}
