import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { getFillSnapshot } from "@/lib/fill-probability/source";
import type { FillRecordSnapshot } from "@/lib/fill-probability/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const compress = promisify(gzip);

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "Vary": "Accept-Encoding" };
  const url = new URL(request.url), params = url.searchParams;
  const recordView = params.get("view") === "record";
  if (recordView) {
    const keys = ["view", "recordId", "strategy", "exchange", "account", "symbol", "side"];
    if (url.search.length > 65_536 || [...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length !== 1) ||
        keys.filter(key => key !== "symbol").some(key => (params.get(key)?.length ?? 0) > 1024) ||
        !["", "bid", "ask"].includes(params.get("side") || ""))
      return Response.json({ error: "Invalid fill probability selection" }, { status: 400, headers });
  }
  try {
    const snapshot = await getFillSnapshot();
    let reply: typeof snapshot | FillRecordSnapshot = snapshot;
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
    const body = JSON.stringify(reply);
    const preference = request.headers.get("accept-encoding")?.split(",").find(value => /^gzip(?:\s*;|$)/i.test(value.trim()));
    const useGzip = body.length >= 1024 && preference !== undefined && !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(preference);
    // Compress before the tunnel, as the existing account dashboard does.
    const bytes = useGzip ? new Uint8Array(await compress(body)) : body;
    return new Response(bytes, { headers: {
      ...headers, "Content-Type": "application/json",
      ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
    } });
  } catch { return Response.json({ error: "Fill probability data is unavailable" }, { status: 503, headers }); }
}
