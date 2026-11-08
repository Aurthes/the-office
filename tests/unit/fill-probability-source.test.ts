// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createFillReader, parseFillSources, parseFillReply, parseFillQuote, type FillSource } from "@/lib/fill-probability/source";
import { FILL_NOW, fillRow, fillQuote } from "../fixtures/fill-probability";

// Offline cold-exporter output from xex_mm_cpp@0b5e0136 ARM/QEMU test.
// Probabilities/actions are generic test data, never a live producer record.
import producerQuote from "../fixtures/fill-probability-producer.json";

const source: FillSource = { id: "primary", host: "prod-a", strategies: [{ name: "maker", setting: "/srv/maker/setting.json", sourceSha: "a".repeat(40), feedbackVersion: 8 }] };
it("pins the source and schema and rejects unsafe or ambiguous private configuration", () => {
  expect(parseFillSources({ version: 1, sources: [source] })).toEqual([source]);
  const spec = source.strategies[0];
  for (const s of [{ ...source, host: "-oProxyCommand=bad" }, { ...source, python: "python3;bad" },
    { ...source, strategies: [{ ...spec, sourceSha: "main" }] }, { ...source, strategies: [{ ...spec, feedbackVersion: 7 }] },
    { ...source, strategies: [{ ...spec, setting: "relative" }] }]) expect(() => parseFillSources({ version: 1, sources: [s] })).toThrow();
  expect(() => parseFillSources({ version: 1, sources: [source, source] })).toThrow();
});
it("projects only scalar facts and rejects cross-source or duplicate rows", () => {
  const row = fillRow();
  const result = parseFillReply({ version: 1, rows: [{ ...row, credential: "secret", config: { url: "redis://private" } }] }, source);
  expect(result).toEqual([row]); expect(JSON.stringify(result)).not.toContain("secret");
  for (const rows of [[{ ...row, producer: "other:maker" }], [row, row], [{ ...row, target: NaN }], [{ ...row, sourceSha: "b".repeat(40) }], [{ ...row, schema: 9 }]])
    expect(() => parseFillReply({ version: 1, rows }, source)).toThrow();
});
it("projects original readiness and quote facts without private nested fields", () => {
  const q = fillQuote(); const row = fillRow({ready:true,observedAt:FILL_NOW,skipReason:"",quote:q});
  const projected = parseFillReply({version:1,rows:[{...row,quote:{...q,privateConfig:"secret"}}]},source);
  expect(projected).toEqual([row]); expect(JSON.stringify(projected)).not.toContain("secret");
  for (const bad of [{...q,quoted:false,finalProbability:.001},{...q,p1State:"success means changed"},{...q,finalProbability:NaN}])
    expect(()=>parseFillReply({version:1,rows:[{...row,quote:bad}]},source)).toThrow();
});
it("coalesces reads for ten seconds without changing evidence timestamps", async () => {
  let now = FILL_NOW; const load = vi.fn(async () => [fillRow()]); const read = createFillReader(load, () => now);
  const [a,b] = await Promise.all([read([source]), read([source])]);
  expect(load).toHaveBeenCalledTimes(1); expect(a.rows).toEqual(b.rows);
  now += 9_999; expect((await read([source])).rows[0].savedAt).toBe(FILL_NOW); expect(load).toHaveBeenCalledTimes(1);
  now++; await read([source]); expect(load).toHaveBeenCalledTimes(2);
});
it("keeps last facts unverified on transport failure and reports failure even before a first row", async () => {
  let now = FILL_NOW; const load = vi.fn(async () => [fillRow()]); const read = createFillReader(load, () => now);
  await read([source]); now += 10_000; load.mockRejectedValueOnce(new Error("redis://user:password@private"));
  const failed = await read([source]); expect(failed.sourceErrors).toBe(1); expect(failed.rows[0].error).toBe(true);
  expect(failed.rows[0].savedAt).toBe(FILL_NOW); expect(JSON.stringify(failed)).not.toContain("password");
  const firstFailure = await createFillReader(async () => { throw new Error(); })([source]);
  expect(firstFailure).toMatchObject({ sourceErrors: 1, rows: [] });
});
it("changing source configuration during an in-flight read cannot return the previous source", async () => {
  let finish: (value: ReturnType<typeof fillRow>[]) => void = () => undefined;
  const pending = new Promise<ReturnType<typeof fillRow>[]>(resolve => { finish = resolve; });
  const read = createFillReader(() => pending, () => FILL_NOW);
  const old = read([source]); expect(await read([])).toMatchObject({ configured: false, rows: [] });
  finish([fillRow()]); await old;
  expect(await read([])).toMatchObject({ configured: false, rows: [] });
});

it("accepts compiled C++ cold-exporter scalars exactly for both sides", () => {
  for (const side of ["bid", "ask"] as const) {
    const q = producerQuote[side];
    expect(parseFillQuote(q)).toEqual(q);
    const row = fillRow({ side, quote: parseFillQuote(q) });
    expect(parseFillReply({ version: 1, rows: [row] }, source)).toEqual([row]);
  }
});


it("attributes new/pending/hit diagnostics to the same batch without rereading or retiming facts", async () => {
  let now = FILL_NOW, finish!: (rows: ReturnType<typeof fillRow>[]) => void;
  const wait = new Promise<ReturnType<typeof fillRow>[]>(resolve => { finish = resolve; });
  const read = createFillReader(vi.fn(() => wait), () => now);
  const traces: import("@/lib/fill-probability/source").FillSnapshotTiming[] = [];
  const a = read([source], t => traces.push(t)), b = read([source], t => traces.push(t));
  finish([fillRow()]); const results = await Promise.all([a,b]);
  expect(traces.map(t => t.cache)).toEqual(["new", "pending"]);
  expect(traces[0].batchId).toBe(traces[1].batchId);
  expect(traces[0].sources).toHaveLength(1); expect(results[0]).toEqual(results[1]);
  now += 3000; const hit = await read([source], t => traces.push(t));
  expect(traces[2]).toMatchObject({cache:"hit", ageMs:3000, batchId:traces[0].batchId, sources:[]});
  expect(hit.rows[0].observedAt).toBe(results[0].rows[0].observedAt);
  now += 7000; await read([source], t => traces.push(t));
  expect(traces[3].cache).toBe("new"); expect(traces[3].batchId).not.toBe(traces[0].batchId);
});


it("isolates partial profiles and full snapshots, while retaining pending coalescing for an identical projection",async()=>{
  const {fillTableFields}=await import("@/lib/fill-probability/model");let now=FILL_NOW;const load=vi.fn(async()=>[fillRow()]);const reader=createFillReader(load,()=>now);const a=fillTableFields(["actual"]),b=fillTableFields(["actual","final"]);
  await Promise.all([reader([source],undefined,a),reader([source],undefined,a)]);expect(load).toHaveBeenCalledTimes(1);
  await reader([source],undefined,b);expect(load).toHaveBeenCalledTimes(2);await reader([source]);expect(load).toHaveBeenCalledTimes(3);
  now+=9999;await reader([source]);expect(load).toHaveBeenCalledTimes(3);
});
it("does not promote failed collection to a fresh cache or hide real retry reads behind a failure cache",async()=>{
  let now=FILL_NOW;const load=vi.fn(async()=>[fillRow()]),reader=createFillReader(load,()=>now);const good=await reader([source]);now+=10000;load.mockRejectedValue(new Error("private transport failure"));
  for(let i=0;i<3;i++){const bad=await reader([source]);expect(bad.sampledAt).toBe(good.sampledAt);expect(bad.rows[0].savedAt).toBe(good.rows[0].savedAt);expect(bad.sourceErrors).toBe(1);expect(bad.rows[0].error).toBe(true);}
  expect(load).toHaveBeenCalledTimes(4);
});
it("projects requested fields exactly, retains hidden ordering and zero, and refuses missing requested fields or wrong profiles",async()=>{
  const {FILL_COLUMNS,fillTableFields,projectFillTable}=await import("@/lib/fill-probability/model");const row=fillRow({actualEma:0,quote:fillQuote({currentCaProbability:0})});
  for(const columns of [[],["actual"] as const,[...FILL_COLUMNS]]){
    const fields=fillTableFields([...columns]),projection={row:[...new Set(["id","producer","strategy","instance","account","exchange","market","symbol","side",...fields.row])].sort(),quote:[...fields.quote].sort()};
    const partial={...Object.fromEntries(projection.row.map(k=>[k,row[k as keyof typeof row]])),quote:Object.fromEntries(projection.quote.map(k=>[k,row.quote![k]]))};
    const raw={version:1,projection,rows:[partial]};const restored=parseFillReply(raw,source,fields);
    expect(projectFillTable({configured:true,serverTime:FILL_NOW,sampledAt:FILL_NOW,sourceErrors:0,rows:restored},[...columns])).toEqual(projectFillTable({configured:true,serverTime:FILL_NOW,sampledAt:FILL_NOW,sourceErrors:0,rows:[row]},[...columns]));
    const missing=structuredClone(raw);delete (missing.rows[0] as Record<string,unknown>).observedAt;expect(()=>parseFillReply(missing,source,fields)).toThrow();expect(()=>parseFillReply({...raw,projection:{row:[],quote:[]}},source,fields)).toThrow();
  }
});

it("accepts only exact v10 seconds scope and retains v8/v9 contracts", async () => {
  const scoped: FillSource = { ...source, strategies: [{ ...source.strategies[0], feedbackVersion: 10 }] };
  const row = fillRow({schema:10,pricingMode:"per_symbol_tif",baseToken:"coin",tif:"RPI"});
  expect(parseFillSources({version:1,sources:[scoped]})).toEqual([scoped]);
  expect(parseFillReply({version:1,rows:[row]},scoped)).toEqual([row]);
  const {fillTableFields}=await import("@/lib/fill-probability/model"),fields=fillTableFields(["actual"]);
  const projection={row:[...new Set(["id","producer","strategy","instance","account","exchange","market","symbol","side",...fields.row])].sort(),quote:[...fields.quote].sort()};
  const partial={...Object.fromEntries(projection.row.map(k=>[k,row[k as keyof typeof row]])),quote:null};
  expect(parseFillReply({version:1,rows:[partial],projection},scoped,fields)[0]).toMatchObject({schema:10,pricingMode:row.pricingMode,baseToken:row.baseToken,tif:row.tif,actualEma:row.actualEma});
  delete (partial as Record<string,unknown>).tif;expect(()=>parseFillReply({version:1,rows:[partial],projection},scoped,fields)).toThrow();
  for (const bad of [{...row,tif:""},{...row,pricingMode:undefined},{...row,baseToken:{}},{...row,clock:"trials"},{...row,schema:8}])
    expect(()=>parseFillReply({version:1,rows:[bad]},scoped)).toThrow();
});
