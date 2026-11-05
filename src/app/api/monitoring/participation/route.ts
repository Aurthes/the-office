import { getParticipation } from "@/lib/participation/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("hour");
  const hour = raw === null ? undefined : Number(raw);
  const headers = { "Cache-Control": "no-store" };
  if (hour !== undefined && (!/^\d{1,16}$/.test(raw!) || !Number.isSafeInteger(hour) || hour < 0 || hour % 3_600_000)) return Response.json({ error: "请选择整点小时" }, { status: 400, headers });
  try { return Response.json(await getParticipation(hour), { headers }); }
  catch { return Response.json({ error: "暂时无法读取参与度数据，已显示的数据可能过期" }, { status: 503, headers }); }
}
