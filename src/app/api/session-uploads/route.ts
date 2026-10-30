import { saveUpload } from "../../../../server/codex-session-uploads";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.CLAW3D_CODEX_GATEWAY !== "1") return new Response("Not available", { status: 404 });
  try {
    const url = new URL(request.url);
    return Response.json(await saveUpload(request, url.searchParams.get("threadId") || "", url.searchParams.get("name") || "attachment"), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 400;
    return Response.json({ error: cause instanceof Error ? cause.message : "Upload failed" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
