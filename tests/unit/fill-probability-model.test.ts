import { expect, it } from "vitest";
import { fillState, quoteState, gapColor, probabilityGap } from "@/lib/fill-probability/model";
import { FILL_NOW, fillQuote, fillRow } from "../fixtures/fill-probability";

it("compares one-second probabilities with signed absolute and relative gaps", () => {
  expect(probabilityGap(0.0012, 0.001, false)).toMatchObject({ absolute: expect.closeTo(0.0002), relative: expect.closeTo(0.2) });
  expect(probabilityGap(0.0008, 0.001, false)).toMatchObject({ absolute: expect.closeTo(-0.0002), relative: expect.closeTo(-0.2) });
  expect(probabilityGap(0, 0.001, true)).toMatchObject({ absolute: -0.001, relative: -1 });
  for (const [value, target] of [[null, 0.001], [NaN, 0.001], [0.001, 0], [0.001, null], [2, 0.001], [0.001, 1]] as const) expect(probabilityGap(value, target, true)).toBeNull();
});
it("uses a monotonic symmetric distance color and neutral unknown evidence", () => {
  const distances = [0, 0.1, 0.25, 0.5, 1, 2];
  const hues = distances.map(d => Number(gapColor(d, true).match(/hsl\(([0-9.]+)/)![1]));
  expect(hues).toEqual([120, 108, 90, 60, 0, 0]);
  for (const d of distances) {
    expect(gapColor(d, true)).toBe(gapColor(-d, true));
    expect(gapColor(d, false)).toBe("#a8b5bd");
  }
  expect(gapColor(Infinity, true)).toBe("#a8b5bd");
});
it("keeps fresh supported cache values historical because observation readiness is absent", () => {
  expect(fillState(fillRow(), FILL_NOW)).toBe("snapshot");
  expect(fillState(fillRow({ schema: 9, clock: "trials" }), FILL_NOW)).toBe("snapshot");
  expect(fillState(fillRow({ schema: 8, clock: "trials" }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ sourceSha: null }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ savedAt: null }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ heartbeatAt: null }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ schema: null, reason: "cache-not-exported" }), FILL_NOW)).toBe("unknown");
  expect(fillState(fillRow({ enabled: false }), FILL_NOW)).toBe("disabled");
  expect(fillState(fillRow({ weightedExposureSeconds: 0 }), FILL_NOW)).toBe("empty");
});
it("expires cached evidence without relying on another API response", () => {
  expect(fillState(fillRow(), FILL_NOW + 29_999)).toBe("snapshot");
  expect(fillState(fillRow(), FILL_NOW + 30_000)).toBe("stale");
  expect(fillState(fillRow({ heartbeatAt: FILL_NOW - 30_000 }), FILL_NOW)).toBe("stale");
  expect(fillState(fillRow({ savedAt: FILL_NOW + 6_000 }), FILL_NOW)).toBe("stale");
  expect(fillState(fillRow(), FILL_NOW, true)).toBe("stale");
  expect(fillState(fillRow({ error: true }), FILL_NOW)).toBe("stale");
});
it("uses the original ready flag and actual observation time without inventing a confidence threshold", () => {
  expect(fillState(fillRow({ ready: true, observedAt: FILL_NOW }), FILL_NOW)).toBe("ready");
  expect(fillState(fillRow({ ready: false, observedAt: FILL_NOW }), FILL_NOW)).toBe("not-ready");
  expect(fillState(fillRow({ ready: true, observedAt: null }), FILL_NOW)).toBe("snapshot");
  expect(fillState(fillRow({ ready: true, observedAt: FILL_NOW - 30_000 }), FILL_NOW)).toBe("stale");
  expect(fillState(fillRow({ ready: true, observedAt: FILL_NOW + 6_000 }), FILL_NOW)).toBe("stale");
});
it("ages current quote and historical EMA independently", () => {
  const current = fillRow({ quote: fillQuote(), ready: true, observedAt: FILL_NOW - 30_000 });
  expect(fillState(current, FILL_NOW)).toBe("stale");
  expect(quoteState(current, FILL_NOW)).toBe("ready");
  expect(quoteState(fillRow({ savedAt: null, schema: null, quote: fillQuote() }), FILL_NOW)).toBe("ready");
  for (const quote of [fillQuote({ at: FILL_NOW - 30_000 }), fillQuote({ exportedAt: FILL_NOW - 30_000 })])
    expect(quoteState(fillRow({ quote }), FILL_NOW)).toBe("stale");
  expect(quoteState(fillRow({ quote: fillQuote({ available: false }) }), FILL_NOW)).toBe("unknown");
  expect(quoteState(fillRow({ quote: fillQuote(), sourceSha: null }), FILL_NOW)).toBe("unknown");
  expect(quoteState(current, FILL_NOW, true)).toBe("stale");
});


it("projects selected original scalars and pairs only complete context identities", async () => {
  const {projectFillTable,FILL_DEFAULT_COLUMNS,FILL_COLUMNS}=await import("@/lib/fill-probability/model");
  const {fillQuote,fillSnapshot}=await import("../fixtures/fill-probability");
  const a=fillRow({id:"a",actualEma:0,quote:fillQuote()}),b=fillRow({id:"b",side:"ask",schema:9,clock:"trials",quote:fillQuote({ca:null})});
  const other=fillRow({id:"c",instance:"another",quote:null});
  const full=fillSnapshot([a,b,other]),reply=projectFillTable(full,FILL_DEFAULT_COLUMNS);
  expect(reply.rows).toHaveLength(2);expect(reply.rows[0].bid!.actualEma).toBe(0);expect(reply.rows[0].ask!.schema).toBe(9);
  expect(reply.rows[0].bid!.quote!.ca).toBe(a.quote!.ca);expect(reply.rows[0].ask!.quote!.ca).toBeNull();
  expect(reply.rows[1].ask).toBeNull();expect(reply.rows[0].bid).not.toHaveProperty("baseTheoreticalEma");
  expect(reply.rows[0].bid!.quote).not.toHaveProperty("guardReason");expect(reply.rows[0].bid!.quote!.at).toBe(a.quote!.at);
  for(const columns of [[],[...FILL_COLUMNS]]) {
    const projected=projectFillTable(full,columns).rows[0].bid!;
    for(const [key,value] of Object.entries(projected)) if(key!=="quote") expect(value).toEqual(a[key as keyof typeof a]);
    for(const [key,value] of Object.entries(projected.quote!)) expect(value).toEqual(a.quote![key as keyof typeof a.quote]);
    expect(projected.quote!.currentCaProbability).toBe(a.quote!.currentCaProbability);
  }
  expect(()=>projectFillTable(fillSnapshot([a,a]),FILL_DEFAULT_COLUMNS)).toThrow();
});

it("orders by the sum of both absolute deviations, not maximum probability", async()=>{
  const {projectFillTable,fillTableDeviation,fillTableOrder}=await import("@/lib/fill-probability/model");
  const {fillQuote,fillSnapshot}=await import("../fixtures/fill-probability");
  const pair=(symbol:string,bid:number,ask:number,target=.001)=>[fillRow({id:symbol+"b",symbol,quote:fillQuote({currentCaProbability:bid,baseTarget:target})}),fillRow({id:symbol+"a",symbol,side:"ask",quote:fillQuote({currentCaProbability:ask,baseTarget:target})})];
  const rows=projectFillTable(fillSnapshot([...pair("two",.0018,.0018),...pair("one",.002,.001),...pair("zero",0,0),...pair("hit",.001,.001),...pair("different",.002,.002,.002)]),[]).rows;
  expect([...rows].sort((a,b)=>fillTableOrder(a,b,FILL_NOW)).map(r=>r.symbol)).toEqual(["zero","two","one","different","hit"]);
  expect(fillTableDeviation(rows[0],FILL_NOW)).toBeCloseTo(.0016);expect(fillTableDeviation(rows[2],FILL_NOW)).toBe(.002);
  rows[0].ask!.quote!.at=FILL_NOW-30_000;expect(fillTableDeviation(rows[0],FILL_NOW)).toBeNull();
  expect([...rows].sort((a,b)=>fillTableOrder(a,b,FILL_NOW)).at(-1)!.symbol).toBe("two");
  expect(fillTableDeviation(rows[1],FILL_NOW,true)).toBeNull();
  rows[1].bid!.savedAt=FILL_NOW-60_000;expect(fillTableDeviation(rows[1],FILL_NOW)).not.toBeNull();
});
