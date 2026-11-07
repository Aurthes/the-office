import { getFillSnapshot } from "@/lib/fill-probability/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try { return Response.json(await getFillSnapshot(), { headers }); }
  catch { return Response.json({ error: "Fill probability data is unavailable" }, { status: 503, headers }); }
}
