export const MARKOUT_HORIZONS = ["100ms", "1s", "5s", "15s", "30s", "1m", "2m", "5m", "10m", "15m", "30m", "60m"] as const;
export type MarkoutClass = "rpi" | "non-rpi" | "unknown";
export type MarkoutFilter = { strategy?: string; exchange?: string; symbol?: string; type?: string };
export type MarkoutQuery = MarkoutFilter & { horizon: string; hours: number; level: "overall" | "exchange" | "symbol" };
export type MarkoutRaw = { time: number; strategy: string; symbol: string; side: string; tif: string; run: string; fields: Record<string, number | null> };
export type MarkoutRead = { rows: MarkoutRaw[]; quality: MarkoutRaw[]; sourceErrors: number; sampledAt: number; configured: boolean };
export type MarkoutBand = { time: number; type: MarkoutClass; n: number; count: number; overflow: number; invalid: number; legacy: number; missing: number; pending: number; incomplete: boolean; transportIncomplete: boolean; runs: number; quantiles: number[] | null };
export type MarkoutSeries = { configured: boolean; sampledAt: number; start: number; end: number; bucketMs: number; horizon: string; sourceErrors: number; points: MarkoutBand[]; options: { strategies: string[]; exchanges: string[]; symbols: string[] }; population: string; clock: string };
export const markoutBucketMs = (hours: number) => hours === 1 ? 300_000 : hours === 6 ? 900_000 : 3_600_000;
export const markoutClass = (tif: string): MarkoutClass => tif === "rpi" ? "rpi" : tif === "gtx" || tif === "gtc" ? "non-rpi" : "unknown";
export function markoutQuantiles(values: number[]): number[] | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return [.05,.25,.5,.75,.95].map(p => { const x = (sorted.length-1)*p, i = Math.floor(x); return (1-(x-i))*sorted[i]+(x-i)*sorted[Math.ceil(x)]; });
}
const exchange = (symbol: string) => symbol.split(".")[0];
const identity = (row: MarkoutRaw) => JSON.stringify([row.strategy,row.symbol,row.side,row.tif,row.run]);
const selected = (r: MarkoutRaw, f: MarkoutQuery) => (!f.strategy || r.strategy === f.strategy) && (!f.exchange || exchange(r.symbol) === f.exchange) && (!f.symbol || r.symbol === f.symbol);
export function makerMarkoutSeries(read: MarkoutRead, query: MarkoutQuery, now: number): MarkoutSeries {
  const bucketMs = markoutBucketMs(query.hours), end = Math.floor(now/bucketMs)*bucketMs, start = end-query.hours*3_600_000;
  const classes: MarkoutClass[] = ["rpi","non-rpi","unknown"];
  type Acc = MarkoutBand & { samples: number[]; runIds: Set<string> };
  const buckets = new Map<string, Acc>();
  for (let t=start;t<end;t+=bucketMs) for (const type of classes) buckets.set(`${t}:${type}`, { time:t,type,n:0,count:0,overflow:0,invalid:0,legacy:0,missing:0,pending:0,incomplete:read.sourceErrors>0,transportIncomplete:false,runs:0,quantiles:null,samples:[],runIds:new Set() });
  const target = (r: MarkoutRaw) => buckets.get(`${Math.floor(r.time/bucketMs)*bucketMs}:${markoutClass(r.tif)}`);
  const strategies = new Set<string>(), exchanges = new Set<string>(), symbols = new Set<string>();
  for (const r of [...read.quality,...read.rows]) { strategies.add(r.strategy); exchanges.add(exchange(r.symbol)); symbols.add(r.symbol); }
  const seen = new Map<string,string>();
  for (const row of read.rows) {
    if (!selected(row,query) || row.time<start || row.time>=end) continue;
    const bucket = target(row); if (!bucket) continue;
    const key = `${identity(row)}:${row.time}`, wire = JSON.stringify(row.fields), old = seen.get(key);
    if (old !== undefined) { if (old !== wire) bucket.incomplete = true; continue; }
    seen.set(key,wire); bucket.runIds.add(`${row.strategy}:${row.run}`);
    const f = row.fields, count = f.count;
    if (!Number.isSafeInteger(count) || count!<0) { bucket.invalid++; bucket.incomplete=true; continue; }
    bucket.count += count!;
    if (f.sample_schema !== 1) { bucket.legacy += count!; bucket.incomplete ||= count!>0; continue; }
    const n = f.sample_count, overflow = f.sample_overflow, invalid = f.sample_invalid;
    if (![n,overflow,invalid].every(v => Number.isSafeInteger(v) && v!>=0) || n!>64 || count!==n!+overflow!+invalid!) { bucket.invalid++; bucket.incomplete=true; continue; }
    bucket.overflow += overflow!; bucket.invalid += invalid!;
    if (overflow!>0 || invalid!>0) bucket.incomplete=true;
    for (let i=0;i<n!;i++) {
      const value = f[`sample_${String(i).padStart(2,"0")}`];
      if (typeof value !== "number" || !Number.isFinite(value)) { bucket.invalid++; bucket.incomplete=true; }
      else bucket.samples.push(value);
    }
  }
  // Quality rows include one preceding bucket, giving missing-counter deltas
  // without attributing all lifetime misses to every later time bucket.
  const totals = new Map<string,number>(), rawIds = new Set<string>(), qualityIds = new Set<string>();
  const badTypes = new Set<MarkoutClass>(), settledPrior = new Map<string,number>();
  for (const r of read.rows) {
    if (!selected(r,query) || r.time<start) continue;
    const id=`${identity(r)}:${r.time}`; if(rawIds.has(id))continue;rawIds.add(id);
    const count=r.fields.count, key=`${identity(r)}:${Math.floor(r.time/bucketMs)*bucketMs}`;
    if(typeof count!=="number" || !Number.isSafeInteger(count) || count<0)badTypes.add(markoutClass(r.tif));
    else totals.set(key,(totals.get(key)||0)+count);
  }
  const prior = new Map<string,number>();
  for (const row of [...read.quality].sort((a,b) => a.time-b.time)) {
    if (!selected(row,query)) continue;
    const key = identity(row), bucketKey=`${key}:${row.time}`, settled=row.fields.settled, oldSettled=settledPrior.get(key);
    qualityIds.add(bucketKey);
    if(typeof settled==="number" && Number.isSafeInteger(settled) && settled>=0)settledPrior.set(key,settled);
    if(row.time>=start && (typeof settled!=="number" || !Number.isSafeInteger(settled) || settled<0 || (oldSettled===undefined ? settled : settled-oldSettled)!==(totals.get(bucketKey)||0)))badTypes.add(markoutClass(row.tif));
    const missing = row.fields.missing, pending = row.fields.pending, previous = prior.get(key);
    if (typeof missing === "number" && Number.isSafeInteger(missing) && missing>=0) prior.set(key,missing);
    if (row.time<start || row.time>=end) continue;
    const bucket=target(row); if (!bucket) continue;
    bucket.runIds.add(`${row.strategy}:${row.run}`);
    if (!Number.isSafeInteger(missing) || missing!<0 || previous!==undefined && missing!<previous) { bucket.incomplete=true; continue; }
    const delta = previous===undefined ? missing! : missing!-previous;
    bucket.missing += delta;
    if (delta>0) bucket.incomplete=true;
    if (typeof pending==="number" && Number.isSafeInteger(pending) && pending>=0) bucket.pending+=pending;
    // Pending refers to later, not-yet-mature fills, not the settled export-time
    // sample population. It is shown separately and never turned into zeros.
  }
  for(const r of read.rows)if(selected(r,query) && r.time>=start && r.time<end && !qualityIds.has(`${identity(r)}:${Math.floor(r.time/bucketMs)*bucketMs}`))badTypes.add(markoutClass(r.tif));
  const points = [...buckets.values()].filter(b => !query.type || b.type===query.type).map(b => {
    const { samples,runIds,...point }=b;
    const incomplete=b.incomplete||badTypes.has(b.type);
    return { ...point,incomplete,transportIncomplete:badTypes.has(b.type),n:samples.length,runs:runIds.size,quantiles:incomplete ? null : markoutQuantiles(samples) };
  });
  return { configured:read.configured,sampledAt:read.sampledAt,start,end,bucketMs,horizon:query.horizon,sourceErrors:read.sourceErrors,points,options:{strategies:[...strategies].sort(),exchanges:[...exchanges].sort(),symbols:[...symbols].sort()},population:"Equal-weight valid opening-maker fill segments; not unique orders",clock:"UTC export time; closed calendar buckets" };
}
