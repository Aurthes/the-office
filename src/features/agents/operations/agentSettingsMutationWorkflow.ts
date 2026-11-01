import {
  resolveMutationStartGuard,
  type MutationStartGuardResult,
} from "@/features/agents/operations/mutationLifecycleWorkflow";

export const RESERVED_MAIN_AGENT_ID = "main";
export type AgentSettingsMutationRequest = {
  kind: "delete-agent" | "rename-agent" | "update-agent-permissions";
  agentId: string;
};
export type AgentSettingsMutationContext = {
  status: "connected" | "connecting" | "disconnected";
  hasCreateBlock: boolean;
  hasRenameBlock: boolean;
  hasDeleteBlock: boolean;
};
export type AgentSettingsMutationDenyReason = "start-guard-deny" | "reserved-main-delete" | "missing-agent-id";
export type AgentSettingsMutationDecision =
  | { kind: "allow"; normalizedAgentId: string }
  | { kind: "deny"; reason: AgentSettingsMutationDenyReason; message: string | null; guardReason?: Exclude<MutationStartGuardResult, { kind: "allow" }>["reason"] };

export const planAgentSettingsMutation = (request: AgentSettingsMutationRequest, context: AgentSettingsMutationContext): AgentSettingsMutationDecision => {
  const normalizedAgentId = request.agentId.trim();
  if (!normalizedAgentId) return { kind: "deny", reason: "missing-agent-id", message: null };
  const guard = resolveMutationStartGuard(context);
  if (guard.kind === "deny") return { kind: "deny", reason: "start-guard-deny", message: null, guardReason: guard.reason };
  if (request.kind === "delete-agent" && normalizedAgentId === RESERVED_MAIN_AGENT_ID) {
    return { kind: "deny", reason: "reserved-main-delete", message: "The main agent cannot be deleted." };
  }
  return { kind: "allow", normalizedAgentId };
};
