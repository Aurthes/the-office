import { monitor } from "../../../../../server/background-processes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" }, url = new URL(request.url);
  try {
    if (url.searchParams.has("id")) return Response.json(await monitor.log(url.searchParams.get("id"), url.searchParams.get("stream") || "events"), { headers });
    return Response.json(await monitor.snapshot(), { headers });
  } catch (error) {
    const missing = error instanceof Error && error.message === "Unknown background task log.";
    return Response.json({ error: missing ? "Unknown background task log." : "Could not load background tasks." }, { status: missing ? 404 : 500, headers });
  }
}
