import { capacityRows, type CapacitySnapshot, type CapacityState, type Market } from "@/lib/rate-limit-capacity/model";
export const NOW = 1_793_950_000_000;
export function producer(state: CapacityState = "normal", market: Market = "spot", name = "maker") {
  const row = { exchange: "gateio", account: "account-one", market, state, low_capacity: state === "unknown" ? null : state === "low",
    normal_limit: market === "spot" ? 10 : 100, normal_window_ms: 1000, limit: 10,
    reset_wait_ms: state === "low" ? 9940 : -1, evidence_at_ms: NOW, observed_at_ms: NOW };
  return { id: `primary:${name}`, strategy: name, expected: [row], error: null,
    heartbeat: { ts: NOW, type: "hb", success: true, strategy: name, strategy_idx: "0", pid: 123, reporter_started_at_ms: NOW-60_000,
      rate_limit_capacity_schema: 1, rate_limit_capacity: [row] } };
}
export function snapshot(producers = [producer()]): CapacitySnapshot {
  return { configured: true, serverTime: NOW, sampledAt: NOW, sourceErrors: 0, rows: capacityRows(producers) };
}
