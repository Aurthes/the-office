import { describe, expect, it } from "vitest";
import {
  planAgentSettingsMutation,
  type AgentSettingsMutationContext,
} from "@/features/agents/operations/agentSettingsMutationWorkflow";

const createContext = (
  overrides?: Partial<AgentSettingsMutationContext>
): AgentSettingsMutationContext => ({
  status: "connected",
  hasCreateBlock: false,
  hasRenameBlock: false,
  hasDeleteBlock: false,

  ...(overrides ?? {}),
});

describe("agentSettingsMutationWorkflow", () => {
  it("denies_guarded_actions_when_not_connected", () => {
    const renameResult = planAgentSettingsMutation(
      { kind: "rename-agent", agentId: "agent-1" },
      createContext({ status: "disconnected" })
    );

    expect(renameResult).toEqual({
      kind: "deny",
      reason: "start-guard-deny",
      message: null,
      guardReason: "not-connected",
    });

  });

  it("denies_delete_for_reserved_main_agent_with_actionable_message", () => {
    const result = planAgentSettingsMutation(
      { kind: "delete-agent", agentId: " main " },
      createContext()
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "reserved-main-delete",
      message: "The main agent cannot be deleted.",
    });
  });

  it("denies_guarded_actions_when_mutation_block_is_active", () => {
    const result = planAgentSettingsMutation(
      { kind: "update-agent-permissions", agentId: "agent-1" },
      createContext({ hasCreateBlock: true })
    );

    expect(result).toEqual({
      kind: "deny",
      reason: "start-guard-deny",
      message: null,
      guardReason: "create-block-active",
    });
  });

});
