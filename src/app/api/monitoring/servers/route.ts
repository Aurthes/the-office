import { getServerSnapshot } from "@/lib/monitoring/servers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try { return Response.json(await getServerSnapshot(), { headers }); }
  catch { return Response.json({ error: "Could not read the server registry." }, { status: 500, headers }); }
}
