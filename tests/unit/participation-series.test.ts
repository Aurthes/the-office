import { describe, expect, it } from "vitest";
import { participationSeries, type ParticipationHour } from "@/lib/participation/model";
const H = 3_600_000;
export const hour = (h = 2 * H): ParticipationHour => ({ version: 1, hour: h, updatedAt: h + H, startedAt: 0,
  market: [{ exchange: "venue", symbol: "btc", type: "rpi", notional: 1000, count: 100, ready: true, reason: "" }],
  own: [{ exchange: "venue", account: "one", symbol: "btc", type: "rpi", notional: 100, count: 1, ready: true, reason: "" }, { exchange: "venue", account: "two", symbol: "btc", type: "rpi", notional: 200, count: 2, ready: true, reason: "" }],
});
describe("participation time series", () => {
  it("preserves chronological missing hours rather than zero-filling them", () => {
    const s = participationSeries([hour()], 4, 3 * H + 5, "exchange");
    expect(s.points.map(p => p.hour)).toEqual([0, H, 2 * H, 3 * H]);
    expect(s.points.map(p => p.available)).toEqual([false, false, true, false]);
    expect(s.points[0].rows).toEqual([]);
  });
  it("uses the existing deduplicated denominator independently in every hour", () => {
    const s = participationSeries([hour()], 3, 3 * H, "exchange");
    expect(s.points[1].rows[0]).toMatchObject({ own: { notional: 300, count: 3 }, market: { notional: 1000, count: 100 }, notionalShare: .3, countShare: .03 });
  });
  it("keeps incomplete shares null and genuine zeros numeric", () => {
    const a = hour(H); a.market[0].ready = false;
    const b = hour(2 * H); b.own.forEach(r => { r.notional = 0; r.count = 0; });
    const s = participationSeries([a, b], 3, 2 * H, "exchange");
    expect(s.points[1].rows[0].countShare).toBeNull();
    expect(s.points[2].rows[0].countShare).toBe(0);
  });
  it("selects one symbol target without dropping target options", () => {
    const s = participationSeries([hour()], 3, 2 * H, "symbol");
    expect(s.groups).toHaveLength(2); expect(s.focus).toBe(s.groups[0].key);
    expect(s.points[2].rows).toHaveLength(1);
    const other = participationSeries([hour()], 3, 2 * H, "symbol", {}, s.groups[1].key);
    expect(other.points[2].rows[0].account).toBe("two");
  });
  it("applies account and order-class filters before aggregation", () => {
    const s = participationSeries([hour()], 3, 2 * H, "exchange", { account: "one", type: "rpi" });
    expect(s.points[2].rows[0].notionalShare).toBe(.1);
    expect(participationSeries([hour()], 3, 2 * H, "exchange", { type: "non-rpi" }).groups).toEqual([]);
  });
});
