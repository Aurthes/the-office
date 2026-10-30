import path from "node:path";
import { describeSessionAssets, readSessionAsset, HTML_POLICY } from "../../../../server/codex-session-assets";

export const runtime = "nodejs";

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
    return new Response(new Uint8Array(asset.bytes), { headers: {
      ...headers, "Content-Type": asset.mime + (asset.mime.startsWith("text/") ? "; charset=utf-8" : ""),
      ...(asset.mime === "text/html" ? { "Content-Security-Policy": HTML_POLICY } : {}),
    } });
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return Response.json({ error: missing ? "文件已移动或不存在" : "此文件无法预览，可能过大或链接已失效" }, { status: missing ? 404 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
