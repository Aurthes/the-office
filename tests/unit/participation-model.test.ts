import { describe, expect, it } from "vitest";
import { parseParticipationHour, participationRows, type ParticipationHour } from "../../src/lib/participation/model";

const fixture = (): ParticipationHour => ({ version: 1, hour: 0, updatedAt: 1, startedAt: 0,
  market: [
    { exchange: "venue", symbol: "venue.perp.a_usdt", type: "rpi", notional: 100, count: 10, ready: true, reason: "" },
    { exchange: "venue", symbol: "venue.perp.b_usdt", type: "rpi", notional: 900, count: 90, ready: true, reason: "" },
  ],
  own: [
    { exchange: "venue", account: "one", symbol: "venue.perp.a_usdt", type: "rpi", notional: 50, count: 1, ready: true, reason: "" },
    { exchange: "venue", account: "one", symbol: "venue.perp.b_usdt", type: "rpi", notional: 90, count: 9, ready: true, reason: "" },
    { exchange: "venue", account: "two", symbol: "venue.perp.a_usdt", type: "rpi", notional: 20, count: 2, ready: true, reason: "" },
  ],
});
describe("hourly participation", () => {
  it("deduplicates a shared market across accounts", () => {
    const [r] = participationRows(fixture(), "exchange");
    expect(r.own).toEqual({ notional: 160, count: 12 }); expect(r.market).toEqual({ notional: 1000, count: 100 });
    expect(r.notionalShare).toBe(.16); expect(r.countShare).toBe(.12); expect(r.symbols).toBe(2);
  });
  it("uses weighted sums, independently for notional and count", () => {
    const [r] = participationRows(fixture(), "account", { account: "one" });
    expect(r.notionalShare).toBe(.14); expect(r.countShare).toBe(.10);
  });
  it("keeps RPI and non-RPI separate", () => {
    const d = fixture(); d.market.push({ ...d.market[0], type: "non-rpi", notional: 200 }); d.own.push({ ...d.own[0], type: "non-rpi", notional: 10 });
    const r = participationRows(d, "symbol", { account: "one", symbol: "a_usdt" });
    expect(r).toHaveLength(2); expect(r.find(x => x.type === "non-rpi")?.notionalShare).toBe(.05);
  });
  it("does not turn missing or partial data into zero participation", () => {
    const d = fixture(); d.market[0].ready = false; d.market[0].reason = "行情订阅中断";
    const [r] = participationRows(d, "exchange"); expect(r.notionalShare).toBeNull(); expect(r.reasons).toContain("行情订阅中断");
  });
  it("shows genuine zero only with known positive market activity", () => {
    const d = fixture(); d.own = [{ ...d.own[0], notional: 0, count: 0 }];
    expect(participationRows(d, "symbol")[0].notionalShare).toBe(0);
    d.market[0].notional = 0; d.market[0].count = 0;
    const r = participationRows(d, "symbol")[0]; expect(r.notionalShare).toBeNull(); expect(r.countShare).toBeNull();
  });
  it("rejects duplicate own rows, malformed values, and invalid hour boundaries", () => {
    const d = fixture(); d.own.push({ ...d.own[0] }); expect(() => participationRows(d, "exchange")).toThrow();
    expect(() => parseParticipationHour({ ...fixture(), hour: 1 })).toThrow();
    const bad = fixture(); bad.market[0].notional = NaN; expect(() => parseParticipationHour(bad)).toThrow();
  });
});
