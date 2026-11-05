import { getParticipation, getParticipationSeries } from "@/lib/participation/source";
import type { ParticipationLevel } from "@/lib/participation/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("hour");
  const hour = raw === null ? undefined : Number(raw);
  const headers = { "Cache-Control": "no-store" };
  if (hour !== undefined && (!/^\d{1,16}$/.test(raw!) || !Number.isSafeInteger(hour) || hour < 0 || hour % 3_600_000)) return Response.json({ error: "请选择整点小时" }, { status: 400, headers });
  const window = params.get("window"), level = params.get("level") || "exchange";
  if (window !== null && (!["24", "72", "168"].includes(window) || !["symbol", "account", "exchange"].includes(level) || raw !== null || [...params.values()].some(s => s.length > 512))) return Response.json({ error: "请选择有效的时间范围和汇总层级" }, { status: 400, headers });
  try {
    if (window !== null) return Response.json(await getParticipationSeries(Number(window), level as ParticipationLevel, { exchange: params.get("exchange") || "", account: params.get("account") || "", symbol: params.get("symbol") || "", type: params.get("type") || "" }, params.get("focus") || ""), { headers });
    return Response.json(await getParticipation(hour), { headers });
  }
  catch { return Response.json({ error: "暂时无法读取参与度数据，已显示的数据可能过期" }, { status: 503, headers }); }
}
