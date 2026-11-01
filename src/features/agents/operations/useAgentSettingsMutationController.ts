import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentPermissionsDraft } from "@/features/agents/operations/agentPermissionsOperation";
import { updateAgentPermissionsViaStudio } from "@/features/agents/operations/agentPermissionsOperation";
import {
  planAgentSettingsMutation,
  type AgentSettingsMutationContext,
} from "@/features/agents/operations/agentSettingsMutationWorkflow";
import {
  buildQueuedMutationBlock,
  runAgentConfigMutationLifecycle,
  type MutationBlockState,
  type MutationWorkflowKind,
} from "@/features/agents/operations/mutationLifecycleWorkflow";
import type { SettingsRouteTab } from "@/features/agents/operations/settingsRouteWorkflow";
import type { ConfigMutationKind } from "@/features/agents/operations/useConfigMutationQueue";
import { useGatewayRestartBlock } from "@/features/agents/operations/useGatewayRestartBlock";
import type { AgentState } from "@/features/agents/state/store";
import type { GatewayClient, GatewayStatus } from "@/lib/gateway/GatewayClient";
import { isGatewayDisconnectLikeError } from "@/lib/gateway/GatewayClient";
import type { GatewayModelPolicySnapshot } from "@/lib/gateway/models";
import {
  renameGatewayAgent,
  deleteGatewayAgent,
} from "@/lib/gateway/agentConfig";

export type RestartingMutationBlockState = MutationBlockState & { kind: MutationWorkflowKind };

type AgentForSettingsMutation = Pick<AgentState, "agentId" | "name" | "sessionKey">;

export type UseAgentSettingsMutationControllerParams = {
  client: GatewayClient;
  status: GatewayStatus;

  isLocalGateway: boolean;
  agents: AgentForSettingsMutation[];
  hasCreateBlock: boolean;
  enqueueConfigMutation: (params: {
    kind: ConfigMutationKind;
    label: string;
    run: () => Promise<void>;
    requiresIdleAgents?: boolean;
  }) => Promise<void>;
  gatewayConfigSnapshot: GatewayModelPolicySnapshot | null;
  settingsRouteActive: boolean;
  inspectSidebarAgentId: string | null;
  inspectSidebarTab: SettingsRouteTab | null;
  loadAgents: () => Promise<void>;
  refreshGatewayConfigSnapshot: () => Promise<GatewayModelPolicySnapshot | null>;
  clearInspectSidebar: () => void;
  setInspectSidebarCapabilities: (agentId: string) => void;
  dispatchUpdateAgent: (agentId: string, patch: Partial<AgentState>) => void;
  removeAgent?: (agentId: string) => void;
  setMobilePaneChat: () => void;
  setError: (message: string) => void;
};

export function useAgentSettingsMutationController(params: UseAgentSettingsMutationControllerParams) {
  const { agents, loadAgents, setMobilePaneChat, status } = params;

  const [restartingMutationBlock, setRestartingMutationBlock] =
    useState<RestartingMutationBlockState | null>(null);
  const REMOTE_MUTATION_EXEC_TIMEOUT_MS = 45_000;

  const hasRenameMutationBlock = restartingMutationBlock?.kind === "rename-agent";
  const hasDeleteMutationBlock = restartingMutationBlock?.kind === "delete-agent";
  const hasRestartBlockInProgress = Boolean(
    restartingMutationBlock && restartingMutationBlock.phase !== "queued"
  );

  const mutationContext: AgentSettingsMutationContext = useMemo(
    () => ({
      status: params.status,
      hasCreateBlock: params.hasCreateBlock,
      hasRenameBlock: hasRenameMutationBlock,
      hasDeleteBlock: hasDeleteMutationBlock,

    }),
    [

      hasDeleteMutationBlock,
      hasRenameMutationBlock,
      params.hasCreateBlock,
      params.status,
    ]
  );

  const runRestartingMutationLifecycle = useCallback(
    async (input: {
      kind: MutationWorkflowKind;
      agentId: string;
      agentName: string;
      label: string;
      executeMutation: () => Promise<void>;
    }) => {
      return await runAgentConfigMutationLifecycle({
        kind: input.kind,
        label: input.label,
        isLocalGateway: params.isLocalGateway,
        deps: {
          enqueueConfigMutation: params.enqueueConfigMutation,
          setQueuedBlock: () => {
            const queuedBlock = buildQueuedMutationBlock({
              kind: input.kind,
              agentId: input.agentId,
              agentName: input.agentName,
              startedAt: Date.now(),
            });
            setRestartingMutationBlock({
              kind: input.kind,
              agentId: queuedBlock.agentId,
              agentName: queuedBlock.agentName,
              phase: queuedBlock.phase,
              startedAt: queuedBlock.startedAt,
              sawDisconnect: queuedBlock.sawDisconnect,
            });
          },
          setMutatingBlock: () => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== input.kind || current.agentId !== input.agentId) return current;
              return {
                ...current,
                phase: "mutating",
              };
            });
          },
          patchBlockAwaitingRestart: (patch) => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== input.kind || current.agentId !== input.agentId) return current;
              return {
                ...current,
                ...patch,
              };
            });
          },
          clearBlock: () => {
            setRestartingMutationBlock((current) => {
              if (!current) return current;
              if (current.kind !== input.kind || current.agentId !== input.agentId) return current;
              return null;
            });
          },
          executeMutation: async () => {
            const timeoutLabel =
              input.kind === "delete-agent"
                ? "Delete agent request timed out."
                : "Rename agent request timed out.";
            await Promise.race([
              input.executeMutation(),
              new Promise<never>((_, reject) => {
                window.setTimeout(
                  () =>
                    reject(
                      new Error(
                        `${timeoutLabel} The gateway did not respond in time.`
                      )
                    ),
                  REMOTE_MUTATION_EXEC_TIMEOUT_MS
                );
              }),
            ]);
          },
          shouldAwaitRemoteRestart: async () => false,
          reloadAgents: params.loadAgents,
          setMobilePaneChat: params.setMobilePaneChat,
          onError: params.setError,
        },
      });
    },
    [
      params.enqueueConfigMutation,
      params.isLocalGateway,
      params.loadAgents,
      params.setError,
      params.setMobilePaneChat,
    ]
  );

  useGatewayRestartBlock({
    status: params.status,
    block: restartingMutationBlock,
    setBlock: setRestartingMutationBlock,
    maxWaitMs: 90_000,
    onTimeout: () => {
      const timeoutMessage =
        restartingMutationBlock?.kind === "delete-agent"
          ? "Gateway restart timed out after deleting the agent."
          : "Gateway restart timed out after renaming the agent.";
      setRestartingMutationBlock(null);
      params.setError(timeoutMessage);
    },
    onRestartComplete: async (_, ctx) => {
      await params.loadAgents();
      if (ctx.isCancelled()) return;
      setRestartingMutationBlock(null);
      params.setMobilePaneChat();
    },
  });

  useEffect(() => {
    if (!restartingMutationBlock) return;
    if (restartingMutationBlock.kind !== "delete-agent") return;
    if (restartingMutationBlock.phase !== "awaiting-restart") return;
    if (status !== "connected") return;

    const deletedAgentStillPresent = agents.some(
      (entry) => entry.agentId === restartingMutationBlock.agentId
    );
    if (!deletedAgentStillPresent) {
      setRestartingMutationBlock(null);
      setMobilePaneChat();
      return;
    }

    let cancelled = false;
    const refreshAgents = async () => {
      try {
        await loadAgents();
      } catch (error) {
        if (!isGatewayDisconnectLikeError(error)) {
          console.error("Failed to refresh agents while awaiting delete restart.", error);
        }
      }
    };

    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      void refreshAgents();
    }, 2500);
    void refreshAgents();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    agents,
    loadAgents,
    restartingMutationBlock,
    setMobilePaneChat,
    status,
  ]);

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      const decision = planAgentSettingsMutation(
        { kind: "delete-agent", agentId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          params.setError(decision.message);
        }
        return;
      }

      const agent = params.agents.find((entry) => entry.agentId === decision.normalizedAgentId);
      if (!agent) return;
      const confirmed = window.confirm(
        `Delete ${agent.name}? This removes the agent record from OpenClaw and clears its scheduled automations. Claw3D will not touch workspace files.`
      );
      if (!confirmed) return;

      await runRestartingMutationLifecycle({
        kind: "delete-agent",
        agentId: decision.normalizedAgentId,
        agentName: agent.name,
        label: `Delete ${agent.name}`,
        executeMutation: async () => {
          await deleteGatewayAgent({
            client: params.client,
            agentId: decision.normalizedAgentId,

          });
          params.removeAgent?.(decision.normalizedAgentId);
          params.clearInspectSidebar();
        },
      });
    },
    [mutationContext, params, runRestartingMutationLifecycle]
  );

  const handleRenameAgent = useCallback(
    async (agentId: string, name: string) => {
      const decision = planAgentSettingsMutation(
        { kind: "rename-agent", agentId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          params.setError(decision.message);
        }
        return false;
      }
      const agent = params.agents.find((entry) => entry.agentId === decision.normalizedAgentId);
      if (!agent) return false;

      return await runRestartingMutationLifecycle({
        kind: "rename-agent",
        agentId: decision.normalizedAgentId,
        agentName: name,
        label: `Rename ${agent.name}`,
        executeMutation: async () => {
          await renameGatewayAgent({
            client: params.client,
            agentId: decision.normalizedAgentId,
            name,
          });
          params.dispatchUpdateAgent(decision.normalizedAgentId, { name });
        },
      });
    },
    [mutationContext, params, runRestartingMutationLifecycle]
  );

  const handleUpdateAgentPermissions = useCallback(
    async (agentId: string, draft: AgentPermissionsDraft) => {
      const decision = planAgentSettingsMutation(
        { kind: "update-agent-permissions", agentId },
        mutationContext
      );
      if (decision.kind === "deny") {
        if (decision.message) {
          params.setError(decision.message);
        }
        return;
      }

      const agent = params.agents.find((entry) => entry.agentId === decision.normalizedAgentId);
      if (!agent) return;

      await params.enqueueConfigMutation({
        kind: "update-agent-permissions",
        label: `Update permissions for ${agent.name}`,
        run: async () => {
          await updateAgentPermissionsViaStudio({
            client: params.client,
            agentId: decision.normalizedAgentId,
            sessionKey: agent.sessionKey,
            draft,
            loadAgents: async () => {},
          });
          await params.loadAgents();
          await params.refreshGatewayConfigSnapshot();
          params.setInspectSidebarCapabilities(decision.normalizedAgentId);
          params.setMobilePaneChat();
        },
      });
    },
    [mutationContext, params]
  );

  return {

    restartingMutationBlock,
    hasRenameMutationBlock,
    hasDeleteMutationBlock,
    hasRestartBlockInProgress,
    handleDeleteAgent,

    handleRenameAgent,
    handleUpdateAgentPermissions,

  };
}
