import { loadServerRegistry, saveServerRegistry } from "../../../../../server/server-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try { return Response.json(await loadServerRegistry(), { headers }); }
  catch { return Response.json({ error: "Could not read the server registry." }, { status: 500, headers }); }
}
export async function PUT(request: Request) {
  const text = await request.text();
  if (text.length > 80_000) return Response.json({ error: "Server registry is too large." }, { status: 413, headers });
  let value;
  try { value = JSON.parse(text); }
  catch { return Response.json({ error: "Invalid server configuration." }, { status: 400, headers }); }
  if (!value || typeof value !== "object") return Response.json({ error: "Invalid server configuration." }, { status: 400, headers });
  try { return Response.json(await saveServerRegistry(value.hosts), { headers }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Could not save server configuration.";
    const invalid = /^(Register |Each machine |Use an SSH |Group names )/.test(message);
    return Response.json({ error: invalid ? message : "Could not save server configuration." }, { status: invalid ? 400 : 500, headers });
  }
}
