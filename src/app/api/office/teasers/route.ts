import { readTeasers } from "../../../../../server/teaser-board";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Writes stay in the local agent CLI. This read endpoint uses the existing
// authenticated Office boundary and never accepts filesystem paths or commands.
export function GET() {
  const headers = { "Cache-Control": "no-store" };
  try { return Response.json({ teasers: readTeasers() }, { headers }); }
  catch { return Response.json({ error: "The teaser board could not be loaded." }, { status: 503, headers }); }
}
