import { readWhiteboard, saveWhiteboard } from "../../../../../../../server/teaser-whiteboards";
import { createRequestPolicy } from "../../../../../../../server/proxy-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const limit = 96 * 1024;
type Context = { params: Promise<{ id: string }> };
const messages: Record<number, string> = {
  400: "Invalid whiteboard request.", 403: "Whiteboard writes must come from this Office.",
  404: "This teaser is unavailable.", 409: "This whiteboard changed. Reload before saving.",
  413: "Whiteboard request is too large.", 415: "Whiteboard writes require JSON.",
  503: "Whiteboard is unavailable. Try again.",
};
const error = (status: number) => Response.json({ error: messages[status] }, { status, headers });
const failure = (cause: unknown) => {
  const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 503;
  return error([400, 404, 409].includes(status) ? status : 503);
};

// Authentication remains the same Office proxy boundary as every Office API.
// Its request policy also gives writes a canonical, configured/local Origin check.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(request.url);
    return createRequestPolicy(process.env.CLAW3D_PUBLIC_ORIGINS || "")({
      headers: { host: request.headers.get("host"), origin },
      socket: { localPort: Number(url.port || (url.protocol === "https:" ? 443 : 80)) },
    });
  } catch { return false; }
}

export async function GET(_request: Request, context: Context) {
  try { return Response.json({ whiteboard: readWhiteboard((await context.params).id) }, { headers }); }
  catch (cause) { return failure(cause); }
}

export async function PUT(request: Request, context: Context) {
  if (!sameOrigin(request)) return error(403);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") || "")) return error(415);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return error(413);
  const reader = request.body?.getReader();
  if (!reader) return error(400);
  let input: unknown;
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); return error(413); }
      chunks.push(value);
    }
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return error(400); }
  finally { reader.releaseLock(); }
  try { return Response.json({ whiteboard: saveWhiteboard((await context.params).id, input) }, { headers }); }
  catch (cause) { return failure(cause); }
}
