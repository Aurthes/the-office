import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { getFillSnapshot, FillSourceDataError, type FillSnapshotTiming } from "@/lib/fill-probability/source";
import { FILL_COLUMNS, FILL_DEFAULT_COLUMNS, fillTableFields, projectFillTable, type FillColumn, type FillRecordSnapshot, type FillTableSnapshot } from "@/lib/fill-probability/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const compress = promisify(gzip);

export async function GET(request: Request) {
  const started = performance.now(), requestId = randomUUID();
  const timings: string[] = [];
  const duration = (name: string, ms: number) => { if (Number.isFinite(ms) && ms >= 0) timings.push(`${name};dur=${ms.toFixed(3)}`); };
  const count = (name: string, value: number) => { if (Number.isFinite(value) && value >= 0) timings.push(`${name};desc="${Math.round(value)}"`); };
  const headers = { "Cache-Control": "no-store", "Vary": "Accept-Encoding", "X-Fill-Request-Id": requestId };
  const diagnosticHeaders = () => ({ ...headers, "Server-Timing": timings.join(", ") });
  const url = new URL(request.url), params = url.searchParams;
  const recordView = params.get("view") === "record";
  const tableView = params.get("view") === "table";
  let columns: FillColumn[] = FILL_DEFAULT_COLUMNS;
  if (tableView) {
    const requested = params.has("columns") ? (params.get("columns") ? params.get("columns")!.split(",") : []) : FILL_DEFAULT_COLUMNS;
    if (url.search.length > 65_536 || [...params.keys()].some(key => !["view", "columns"].includes(key) || params.getAll(key).length !== 1) ||
        requested.length > FILL_COLUMNS.length || new Set(requested).size !== requested.length || requested.some(key => !FILL_COLUMNS.includes(key as FillColumn)))
      return Response.json({ error: "Invalid fill probability selection" }, { status: 400, headers });
    columns = FILL_COLUMNS.filter(key => requested.includes(key));
  }
  if (recordView) {
    const keys = ["view", "recordId", "strategy", "exchange", "account", "symbol", "side"];
    if (url.search.length > 65_536 || [...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length !== 1) ||
        keys.filter(key => key !== "symbol").some(key => (params.get(key)?.length ?? 0) > 1024) ||
        !["", "bid", "ask"].includes(params.get("side") || ""))
      return Response.json({ error: "Invalid fill probability selection" }, { status: 400, headers });
  }
  try {
    let sourceTiming: FillSnapshotTiming | undefined;
    const snapshotStarted = performance.now();
    const snapshot = await getFillSnapshot(value => { sourceTiming = value; }, tableView ? fillTableFields(columns) : undefined);
    duration("fill_snapshot", performance.now() - snapshotStarted);
    if (sourceTiming) {
      timings.push(`fill_cache;desc="${sourceTiming.cache}"`, `fill_batch;desc="${sourceTiming.batchId}"`);
      if (sourceTiming.ageMs !== null) duration("fill_age", sourceTiming.ageMs);
      for (const [index, source] of sourceTiming.sources.slice(0, 4).entries()) {
        for (const key of ["totalMs", "prepareMs", "execMs", "decodeMs"] as const)
          if (source[key] !== undefined) duration(`src${index}_${key}`, source[key]!);
        for (const key of ["stdoutBytes", "wireBytes", "decodedBytes"] as const)
          if (source[key] !== undefined) count(`src${index}_${key}`, source[key]!);
      }
    }
    const projectionStarted = performance.now();
    let reply: typeof snapshot | FillRecordSnapshot | FillTableSnapshot = snapshot;
    if (tableView) { try { reply = projectFillTable(snapshot, columns); } catch { throw new FillSourceDataError(); } }
    if (recordView) {
      const filtered = snapshot.rows.filter(row =>
        (!params.get("strategy") || row.strategy === params.get("strategy")) &&
        (!params.get("exchange") || row.exchange === params.get("exchange")) &&
        (!params.get("account") || row.account === params.get("account")) &&
        (!params.get("side") || row.side === params.get("side")) &&
        row.symbol.toLowerCase().includes((params.get("symbol") || "").toLowerCase()));
      reply = {
        configured: snapshot.configured, serverTime: snapshot.serverTime,
        sampledAt: snapshot.sampledAt, sourceErrors: snapshot.sourceErrors, view: "record",
        records: snapshot.rows.map(({ id, strategy, exchange, account, symbol, side }) => ({ id, strategy, exchange, account, symbol, side })),
        row: filtered.find(row => row.id === params.get("recordId")) || filtered[0] || null,
      };
    }
    duration("fill_project", performance.now() - projectionStarted);
    const jsonStarted = performance.now(), body = JSON.stringify(reply);
    duration("fill_json", performance.now() - jsonStarted);
    count("fill_decodedBytes", Buffer.byteLength(body, "utf8"));
    count("fill_rows", "rows" in reply ? reply.rows.length : reply.records.length);
    const preference = request.headers.get("accept-encoding")?.split(",").find(value => /^gzip(?:\s*;|$)/i.test(value.trim()));
    const useGzip = body.length >= 1024 && preference !== undefined && !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(preference);
    // Compress before the tunnel, as the existing account dashboard does.
    const gzipStarted = performance.now();
    const bytes = useGzip ? new Uint8Array(await compress(body)) : body;
    duration("fill_gzip", performance.now() - gzipStarted);
    count("fill_encodedBytes", typeof bytes === "string" ? Buffer.byteLength(bytes, "utf8") : bytes.byteLength);
    // Response-ready is not a socket-finish measurement.
    duration("fill_ready", performance.now() - started);
    return new Response(bytes, { headers: {
      ...diagnosticHeaders(), "Content-Type": "application/json",
      ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
    } });
  } catch (error) { duration("fill_ready", performance.now() - started); return Response.json(error instanceof FillSourceDataError ? { error: "Fill probability data is invalid", retryable: false } : { error: "Fill probability data is unavailable" }, { status: error instanceof FillSourceDataError ? 502 : 503, headers: diagnosticHeaders() }); }
}
