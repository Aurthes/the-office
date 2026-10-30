export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.CLAW3D_CODEX_GATEWAY !== "1") return new Response("Not available", { status: 404 });
  try {
    const threadId = new URL(request.url).searchParams.get("threadId") || "";
    if (!/^[a-f\d-]{36}$/i.test(threadId)) return Response.json({ error: "会话无效" }, { status: 400 });
    const target = new URL(process.env.CLAW3D_GATEWAY_URL || "ws://127.0.0.1:18790");
    if (!["ws:", "wss:"].includes(target.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("Local native gateway required");
    target.protocol = target.protocol === "wss:" ? "https:" : "http:"; target.pathname = "/dictation"; target.search = new URLSearchParams({ threadId }).toString();
    const response = await fetch(target, { method: "POST", body: request.body, duplex: "half", headers: {
      Authorization: "Bearer " + process.env.CLAW3D_GATEWAY_TOKEN, "Content-Type": "audio/wav",
    }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(660000)]) } as RequestInit & { duplex: "half" });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "连接原生听写失败，录音已保留，请重试" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
