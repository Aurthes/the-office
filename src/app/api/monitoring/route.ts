import { loadMonitorLinks, saveMonitorLinks } from "@/lib/monitoring/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try { return Response.json({ links: loadMonitorLinks() }, { headers }); }
  catch { return Response.json({ error: "Could not load monitor links." }, { status: 500, headers }); }
}

export async function PUT(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "JSON required." }, { status: 415, headers });
  try {
    const body = await request.text();
    if (body.length > 40_000) return Response.json({ error: "Monitor configuration is too large." }, { status: 413, headers });
    return Response.json({ links: saveMonitorLinks(JSON.parse(body).links) }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error && !('code' in error) ? error.message : "Could not save monitor links." }, { status: 400, headers });
  }
}
