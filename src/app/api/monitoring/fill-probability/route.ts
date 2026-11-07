import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { getFillSnapshot } from "@/lib/fill-probability/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const compress = promisify(gzip);

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "Vary": "Accept-Encoding" };
  try {
    const body = JSON.stringify(await getFillSnapshot());
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
