import { parseAgentIdFromSessionKey } from "@/lib/gateway/GatewayClient";

export type LatestUpdateKind = "heartbeat" | null;

export type LatestUpdateIntent =
  | { kind: "reset" }
  | {
      kind: "fetch-heartbeat";
      agentId: string;
      sessionLimit: number;
      historyLimit: number;
    }
  | { kind: "noop" };

const SPECIAL_UPDATE_HEARTBEAT_RE = /\bheartbeat\b/i;

const HEARTBEAT_SESSION_LIMIT = 48;
const HEARTBEAT_HISTORY_LIMIT = 200;

export const resolveLatestUpdateKind = (message: string): LatestUpdateKind => SPECIAL_UPDATE_HEARTBEAT_RE.test(message) ? "heartbeat" : null;

export const resolveLatestUpdateIntent = (params: {
  message: string;
  agentId: string;
  sessionKey: string;
  hasExistingOverride: boolean;
}): LatestUpdateIntent => {
  const kind = resolveLatestUpdateKind(params.message);
  if (!kind) {
    return params.hasExistingOverride ? { kind: "reset" } : { kind: "noop" };
  }
  if (kind === "heartbeat") {
    const resolvedAgentId =
      params.agentId.trim() || parseAgentIdFromSessionKey(params.sessionKey) || "";
    if (!resolvedAgentId) {
      return { kind: "reset" };
    }
    return {
      kind: "fetch-heartbeat",
      agentId: resolvedAgentId,
      sessionLimit: HEARTBEAT_SESSION_LIMIT,
      historyLimit: HEARTBEAT_HISTORY_LIMIT,
    };
  }
  return { kind: "reset" };
};

export const buildLatestUpdatePatch = (
  content: string,
  kind?: "heartbeat"
): {
  latestOverride: string | null;
  latestOverrideKind: "heartbeat" | null;
} => {
  return {
    latestOverride: content || null,
    latestOverrideKind: content && kind ? kind : null,
  };
};
