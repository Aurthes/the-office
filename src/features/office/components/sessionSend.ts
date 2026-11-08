import type { LiveSessionItem, SessionClient } from "./SessionControls";
export type SendReceipt = { status: "started" | "steered"; turnId: string };
export class SessionSendError extends Error {
  constructor(message: string, public delivery: "failed" | "unknown") { super(message); }
}
export function rejectedSessionSend(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  return ["INVALID_REQUEST", "INVALID_PARAMS", "UNAUTHORIZED", "FORBIDDEN"].includes(code) ||
    /^(A previous rewind is still unconfirmed|An edit is being committed|Sign in to Codex for Office before sending|请发送不超过|每次最多 8 个附件|请先输入消息或添加附件|附件引用无效|附件不属于此会话|Message text must be a string|Invalid composer reference)/.test(message);
}
// Owns only normal-send RPC and exact pending-echo identity, never composer state.
export async function sendSessionMessage(client: SessionClient, threadId: string, params: { requestId: string; message: string; [key: string]: unknown }, options: {
  historyEpoch?: string; attachmentNames?: string[]; onSendState?: (id: string, item: LiveSessionItem) => void; onHistorySync?: () => void;
} = {}): Promise<SendReceipt> {
  const local: LiveSessionItem = { id: `local-send:${params.requestId}`, clientId: params.requestId, role: "user", content: params.message,
    timestamp: Date.now(), historyEpoch: options.historyEpoch, delivery: "sending", attachmentNames: options.attachmentNames || [] };
  options.onSendState?.(threadId, local);
  try {
    const result = await client.call("session.send", { threadId, ...params }) as SendReceipt | null;
    if (!result || !["started", "steered"].includes(result.status) || typeof result.turnId !== "string" || !result.turnId) throw new SessionSendError("Could not confirm delivery. Check the conversation before sending again.", "unknown");
    options.onSendState?.(threadId, { ...local, delivery: "accepted", turnId: result.turnId }); options.onHistorySync?.();
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Action failed. Check the session before retrying.";
    const delivery = cause instanceof SessionSendError ? cause.delivery : rejectedSessionSend(cause) ? "failed" : "unknown";
    options.onSendState?.(threadId, { ...local, delivery, deliveryError: message });
    if (delivery === "unknown") options.onHistorySync?.();
    throw new SessionSendError(message, delivery);
  }
}
