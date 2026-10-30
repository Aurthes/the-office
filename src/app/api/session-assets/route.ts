import path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { describeSessionAssets, readSessionAsset, HTML_POLICY } from "../../../../server/codex-session-assets";

export const runtime = "nodejs";
const compress = promisify(gzip);

// The authenticated web-access service protects this route, like the chat API.
// Signed references come from actual native messages; no arbitrary path parameter.
export async function GET(request: Request) {
  if (process.env.CLAW3D_CODEX_GATEWAY !== "1") return new Response("Not available", { status: 404 });
  try {
    const query = new URL(request.url).searchParams;
    const asset = await readSessionAsset(query.get("ref"));
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (asset.mime === "text/markdown" && query.get("format") === "json") {
      const content = asset.bytes.toString("utf8");
      return Response.json({ content, assets: describeSessionAssets(content, [], { baseDir: path.dirname(asset.path) }) }, { headers });
    }
    const preference = request.headers.get("accept-encoding")?.split(",").find(value => /^gzip(?:\s*;|$)/i.test(value.trim()));
    const useGzip = asset.mime === "text/html" && asset.bytes.length >= 1024 && preference !== undefined && !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(preference);
    const bytes = useGzip ? await compress(asset.bytes) : asset.bytes;
    return new Response(new Uint8Array(bytes), { headers: {
      ...headers, "Content-Type": asset.mime + (asset.mime.startsWith("text/") ? "; charset=utf-8" : ""),
      ...(asset.mime === "application/octet-stream" ? { "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(asset.path)) } : {}),
      ...(asset.mime === "text/html" ? { "Content-Security-Policy": HTML_POLICY } : {}),
      ...(asset.mime === "text/html" ? { "Vary": "Accept-Encoding" } : {}),
      ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
    } });
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return Response.json({ error: missing ? "The file has moved or no longer exists" : "Cannot preview this file. It may be too large or the link has expired." }, { status: missing ? 404 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
