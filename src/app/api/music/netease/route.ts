import { createNeteaseMusic } from "../../../../../server/netease-music";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const music = createNeteaseMusic();
function failure(error: unknown) {
  const cause = error as { publicMessage?: string; status?: number; code?: string };
  return Response.json({ error: cause.publicMessage || "Music service is unavailable. Please retry.", code: cause.publicMessage ? cause.code : "MUSIC_UNAVAILABLE" }, { status: cause.publicMessage ? cause.status || 502 : 500, headers });
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const action = url.searchParams.get("action");
    const result = action === "search" ? await music.search(url.searchParams.get("query"))
      : action === "track" ? await music.track(url.searchParams.get("id"))
      : action === "login" ? await music.pollLogin() : await music.status();
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
export async function POST() {
  try { return Response.json(await music.startLogin(), { headers }); }
  catch (error) { return failure(error); }
}
