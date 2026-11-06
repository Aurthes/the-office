import { getCapacitySnapshot } from "@/lib/rate-limit-capacity/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try { return Response.json(await getCapacitySnapshot(), { headers }); }
  catch { return Response.json({ error: "Capacity data is unavailable" }, { status: 503, headers }); }
}
