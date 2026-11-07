import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { getFillSnapshot } from "@/lib/fill-probability/source";
import { readTaskPathBenchmark } from "@/lib/fill-probability/read-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const compress = promisify(gzip);

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "Vary": "Accept-Encoding" };
  const params = new URL(request.url).searchParams;
  const benchmark = params.get("benchmarkSource");
  try {
    const value = benchmark === null ? await getFillSnapshot() : await readTaskPathBenchmark(benchmark, params.get("benchmarkRun") || "");
    const body = JSON.stringify(value);
    const preference = request.headers.get("accept-encoding")?.split(",").find(value => /^gzip(?:\s*;|$)/i.test(value.trim()));
    const useGzip = (benchmark !== null || body.length >= 1024) && preference !== undefined && !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(preference);
    // Compress before the tunnel, as the existing account dashboard does.
    const bytes = useGzip ? new Uint8Array(await compress(body)) : body;
    return new Response(bytes, { headers: {
      ...headers, "Content-Type": "application/json",
      ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
    } });
  } catch {
    if (benchmark !== null) return Response.json({ contract: "t85-html-read-v1", runId: params.get("benchmarkRun"), source: benchmark, rows: [], error: "Task benchmark unavailable" }, { status: 503, headers });
    return Response.json({ error: "Fill probability data is unavailable" }, { status: 503, headers });
  }
}
