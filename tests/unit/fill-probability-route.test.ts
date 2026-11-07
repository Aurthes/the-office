// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { beforeEach, expect, it, vi } from "vitest";
import { fillRow, fillQuote, fillSnapshot, FILL_NOW } from "../fixtures/fill-probability";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/fill-probability/source", () => ({ getFillSnapshot: mocks.read }));
import { GET } from "@/app/api/monitoring/fill-probability/route";
beforeEach(() => { mocks.read.mockReset(); });
it("serves same-origin read-only facts with no-store", async () => {
  mocks.read.mockResolvedValueOnce({ configured: false, serverTime: 123, rows: [] });
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ configured: false, rows: [] });
});
it("does not expose source error details", async () => {
  mocks.read.mockRejectedValueOnce(new Error("redis://private:password@host"));
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability")); expect(response.status).toBe(503); expect(await response.text()).not.toContain("password");
});


it("compresses the original large snapshot before the tunnel without changing facts", async () => {
  const snapshot = { configured: true, serverTime: 123, sourceErrors: 0, rows: Array.from({ length: 50 }, (_, id) => ({ id, actualEma: .0004, target: .001, quote: { finalProbability: .0009 } })) };
  mocks.read.mockResolvedValueOnce(snapshot);
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability", { headers: { "Accept-Encoding": "br, gzip" } }));
  expect(response.headers.get("content-encoding")).toBe("gzip");
  expect(response.headers.get("vary")).toBe("Accept-Encoding");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.length).toBeLessThan(JSON.stringify(snapshot).length / 2);
  expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(snapshot);
});

it("honors gzip refusal and retains the same uncompressed JSON", async () => {
  const snapshot = { configured: true, serverTime: 123, rows: [{ symbol: "a".repeat(2000) }] };
  mocks.read.mockResolvedValueOnce(snapshot);
  const response = await GET(new Request("https://office.test/api/monitoring/fill-probability", { headers: { "Accept-Encoding": "gzip;q=0, br" } }));
  expect(response.headers.get("content-encoding")).toBeNull();
  expect(await response.json()).toEqual(snapshot);
});

it("keeps legacy and obsolete query responses complete", async () => {
  const snapshot = fillSnapshot([fillRow({ quote: fillQuote() })]);
  for (const query of ["", "?benchmarkSource=disk&benchmarkRun=old", "?view=unknown&recordId=anything"]) {
    mocks.read.mockResolvedValueOnce(snapshot);
    expect(await (await GET(new Request("https://office.test/api/monitoring/fill-probability" + query))).json()).toEqual(snapshot);
  }
});

it("returns the complete ordered identity index and an unchanged full original row", async () => {
  const a = fillRow({ id: "a", ready: true, observedAt: FILL_NOW, actualEma: 0, quote: fillQuote({ afterNormalize: 0, underflow: true, logAfterNormalize: -800 }) });
  const b = fillRow({ id: "b", account: "other", schema: 9, clock: "trials", quote: fillQuote() });
  const snapshot = fillSnapshot([a,b]); mocks.read.mockResolvedValue(snapshot);
  for (const [query, expected] of [["", a], ["&recordId=b", b]] as const) {
    const response = await GET(new Request("https://office.test/api/monitoring/fill-probability?view=record" + query));
    const value = await response.json();
    expect(value).toEqual({ configured: snapshot.configured, serverTime: snapshot.serverTime, sampledAt: snapshot.sampledAt, sourceErrors: snapshot.sourceErrors, view: "record",
      records: [a,b].map(({id,strategy,exchange,account,symbol,side}) => ({id,strategy,exchange,account,symbol,side})), row: expected });
    expect(new Set(value.records.map((r: {id:string}) => r.id)).size).toBe(2);
    expect(Object.keys(value.records[0])).toEqual(["id","strategy","exchange","account","symbol","side"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(snapshot.rows).toEqual([a,b]);
});

it("uses all five original filters and falls back within that same snapshot", async () => {
  const a=fillRow({id:"a"}), b=fillRow({id:"b",strategy:"second",exchange:"other",account:"two",symbol:"venue.perp.B_USDT",side:"ask"});
  mocks.read.mockResolvedValue(fillSnapshot([a,b]));
  const query=new URLSearchParams({view:"record",recordId:"a",strategy:"second",exchange:"other",account:"two",symbol:"b_usdt",side:"ask"});
  expect((await (await GET(new Request("https://office.test/api/monitoring/fill-probability?"+query))).json()).row).toEqual(b);
  mocks.read.mockResolvedValue(fillSnapshot([b]));
  const removed=await (await GET(new Request("https://office.test/api/monitoring/fill-probability?view=record&recordId=a"))).json();
  expect(removed.row).toEqual(b); expect(removed.records.map((r:{id:string})=>r.id)).toEqual(["b"]);
});

it("preserves the complete index for no match and never truncates a long symbol into a match", async () => {
  mocks.read.mockResolvedValue(fillSnapshot([fillRow({symbol:"x".repeat(1024)})]));
  for (const symbol of ["missing", "x".repeat(1025)]) {
    const value=await (await GET(new Request("https://office.test/api/monitoring/fill-probability?"+new URLSearchParams({view:"record",symbol})))).json();
    expect(value.row).toBeNull();expect(value.records).toHaveLength(1);
  }
  mocks.read.mockResolvedValue(fillSnapshot([]));
  expect((await (await GET(new Request("https://office.test/api/monitoring/fill-probability?view=record"))).json()).row).toBeNull();
});

it("rejects invalid fixed selectors before any source read", async () => {
  for (const query of ["recordId="+"x".repeat(1025), "side=buy", "recordId=a&recordId=b", "host=other", "symbol="+"x".repeat(65_536)]) {
    const response=await GET(new Request("https://office.test/api/monitoring/fill-probability?view=record&"+query));
    expect(response.status).toBe(400);expect(await response.text()).toBe(JSON.stringify({error:"Invalid fill probability selection"}));
  }
  expect(mocks.read).not.toHaveBeenCalled();
});

it("uses the same compression and private-error contract for record view", async () => {
  const snapshot=fillSnapshot(Array.from({length:40},(_,i)=>fillRow({id:String(i),quote:fillQuote()})));mocks.read.mockResolvedValue(snapshot);
  const request=(encoding:string)=>new Request("https://office.test/api/monitoring/fill-probability?view=record&recordId=3",{headers:{"Accept-Encoding":encoding}});
  const plain=await GET(request("gzip;q=0")), compressed=await GET(request("gzip"));
  const expected=await plain.json();expect(compressed.headers.get("content-encoding")).toBe("gzip");
  expect(JSON.parse(gunzipSync(new Uint8Array(await compressed.arrayBuffer())).toString())).toEqual(expected);
  expect(expected.row).toEqual(snapshot.rows[3]);
  mocks.read.mockRejectedValueOnce(new Error("redis://secret:password@private"));const failed=await GET(request("gzip"));
  expect(failed.status).toBe(503);expect(await failed.text()).not.toContain("password");
});

it("shares one pending and ten-second source read across legacy and different selectors", async () => {
  const {createFillReader}=await vi.importActual<typeof import("@/lib/fill-probability/source")>("@/lib/fill-probability/source");
  const a=fillRow({id:"a"}),b=fillRow({id:"b"});let now=FILL_NOW;
  const read=vi.fn(async()=>[a,b]),cached=createFillReader(read,()=>now);
  const source={id:"primary",strategies:[{name:"maker",setting:"/srv/setting.json",sourceSha:"a".repeat(40),feedbackVersion:8 as const}]};
  mocks.read.mockImplementation(()=>cached([source]));
  const get=(suffix:string)=>GET(new Request("https://office.test/api/monitoring/fill-probability"+suffix));
  const values=await Promise.all([get(""),get("?view=record&recordId=a"),get("?view=record&recordId=b")]);
  expect(read).toHaveBeenCalledTimes(1);expect((await values[0].json()).rows).toEqual([a,b]);expect((await values[2].json()).row).toEqual(b);
  now+=9999;await get("?view=record&symbol=missing");expect(read).toHaveBeenCalledTimes(1);
  now++;await get("?view=record&recordId=a");expect(read).toHaveBeenCalledTimes(2);
});
