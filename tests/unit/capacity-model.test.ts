import { expect, it } from "vitest";
import { capacityDisplay, capacityRows } from "@/lib/rate-limit-capacity/model";
import { NOW, producer } from "../fixtures/capacity";

it("expires heartbeat and evidence independently at 30 seconds", () => {
  const p=producer();
  expect(capacityDisplay(capacityRows([p])[0],NOW+29_999).state).toBe("normal");
  expect(capacityDisplay(capacityRows([p])[0],NOW+30_000).state).toBe("stale");
  p.heartbeat.ts=NOW+40_000;
  const d=capacityDisplay(capacityRows([p])[0],NOW+40_000);
  expect(d).toMatchObject({state:"stale",lastState:"normal",reason:"evidence"});
});
it("keeps Spot, Perp, and accounts independent", () => {
  const spot=producer("low"), perp=producer("normal","perp");
  const other=producer(); other.heartbeat.rate_limit_capacity[0].account="other"; other.expected=[];
  const rows=capacityRows([spot,perp,other]);
  expect(rows).toHaveLength(3);
  expect(rows.map(r=>[r.account,r.market,capacityDisplay(r,NOW).state])).toContainEqual(["account-one","spot","low"]);
  expect(rows.map(r=>[r.account,r.market,capacityDisplay(r,NOW).state])).toContainEqual(["account-one","perp","normal"]);
});
it("does not conceal low or unresolved low with another process's healthy reply", () => {
  const low=producer("low"), healthy=producer("normal","spot","second");
  expect(capacityDisplay(capacityRows([low,healthy])[0],NOW).state).toBe("low");
  healthy.heartbeat.ts=NOW+40_000;
  healthy.heartbeat.rate_limit_capacity[0].evidence_at_ms=NOW+40_000;
  healthy.heartbeat.rate_limit_capacity[0].observed_at_ms=NOW+40_000;
  expect(capacityDisplay(capacityRows([low,healthy])[0],NOW+40_000)).toMatchObject({state:"stale",lastState:"low"});
});
it("old producers and missing market reports remain unknown even with a successful heartbeat", () => {
  const p=producer(); p.heartbeat.rate_limit_capacity_schema=0;
  expect(capacityDisplay(capacityRows([p])[0],NOW).state).toBe("unknown");
  p.heartbeat.rate_limit_capacity_schema=1;
  p.heartbeat.rate_limit_capacity=[];
  expect(capacityDisplay(capacityRows([p])[0],NOW).state).toBe("unknown");
});
it("rejects contradictory states, duplicate reports, and future timestamps", () => {
  const p=producer(); p.heartbeat.rate_limit_capacity[0].low_capacity=true;
  expect(capacityDisplay(capacityRows([p])[0],NOW).state).toBe("unknown");
  const q=producer(); q.heartbeat.rate_limit_capacity.push(q.heartbeat.rate_limit_capacity[0]);
  expect(capacityDisplay(capacityRows([q])[0],NOW).state).toBe("unknown");
  const future=producer(); future.heartbeat.ts=NOW+10_000;
  expect(capacityDisplay(capacityRows([future])[0],NOW).state).toBe("stale");
});
it("an unavailable reader cannot display retained normal values as healthy", () => {
  const row=capacityRows([producer()])[0];
  expect(capacityDisplay(row,NOW,true)).toMatchObject({state:"stale",lastState:"normal",reason:"read"});
});
it("unknown observers prevent a combined all-clear and run identity survives projection", () => {
  const rows=capacityRows([producer(),producer("unknown","spot","second")]);
  expect(capacityDisplay(rows[0],NOW).state).toBe("unknown");
  expect(rows[0].evidence[0]).toMatchObject({instance:"0",pid:123,startedAt:NOW-60_000});
});
