"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { AgentInspectHeader } from "@/features/agents/components/inspect/AgentInspectHeader";
import {
  resolveExecutionRoleFromAgent,
  resolvePresetDefaultsForRole,
  type AgentPermissionsDraft,
} from "@/features/agents/operations/agentPermissionsOperation";
import type { AgentState } from "@/features/agents/state/store";
import type { StudioGatewayAdapterType } from "@/lib/studio/settings";

export type AgentSettingsPanelProps = {
  agent: AgentState;
  mode?: "capabilities" | "advanced";
  showHeader?: boolean;
  onClose: () => void;
  permissionsDraft?: AgentPermissionsDraft;
  onUpdateAgentPermissions?: (draft: AgentPermissionsDraft) => Promise<void> | void;
  onDelete: () => void;
  canDelete?: boolean;
  onToolCallingToggle: (enabled: boolean) => void;
  onThinkingTracesToggle: (enabled: boolean) => void;

  controlUiUrl?: string | null;
  adapterType?: StudioGatewayAdapterType | null;

};

const arePermissionsDraftEqual = (a: AgentPermissionsDraft, b: AgentPermissionsDraft): boolean =>
  a.commandMode === b.commandMode &&
  a.webAccess === b.webAccess &&
  a.fileTools === b.fileTools;

export const AgentSettingsPanel = ({
  agent,
  mode = "capabilities",
  showHeader = true,
  onClose,
  permissionsDraft,
  onUpdateAgentPermissions = () => {},
  onDelete,
  canDelete = true,

  controlUiUrl = null,
  adapterType = "openclaw",

}: AgentSettingsPanelProps) => {
  const isOpenClawRuntime = adapterType === "openclaw";
  const initialPermissionsDraft =
    permissionsDraft ?? resolvePresetDefaultsForRole(resolveExecutionRoleFromAgent(agent));
  const [permissionsBaselineValue, setPermissionsBaselineValue] =
    useState<AgentPermissionsDraft>(initialPermissionsDraft);
  const [permissionsDraftValue, setPermissionsDraftValue] =
    useState<AgentPermissionsDraft>(initialPermissionsDraft);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [permissionsSaveState, setPermissionsSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [permissionsSaveError, setPermissionsSaveError] = useState<string | null>(null);
  const permissionsSaveTimerRef = useRef<number | null>(null);
  const permissionsDraftAgentIdRef = useRef(agent.agentId);

  const resolvedExecutionRole = useMemo(() => resolveExecutionRoleFromAgent(agent), [agent]);
  const resolvedPermissionsDraft = useMemo(
    () => permissionsDraft ?? resolvePresetDefaultsForRole(resolvedExecutionRole),
    [permissionsDraft, resolvedExecutionRole]
  );
  const permissionsDirty = useMemo(
    () => !arePermissionsDraftEqual(permissionsDraftValue, permissionsBaselineValue),
    [permissionsBaselineValue, permissionsDraftValue]
  );

  useEffect(() => {
    const agentChanged = permissionsDraftAgentIdRef.current !== agent.agentId;
    permissionsDraftAgentIdRef.current = agent.agentId;
    setPermissionsBaselineValue(resolvedPermissionsDraft);
    if (!agentChanged && (permissionsSaving || permissionsDirty)) {
      return;
    }
    setPermissionsDraftValue(resolvedPermissionsDraft);
    setPermissionsSaveState("idle");
    setPermissionsSaveError(null);
    setPermissionsSaving(false);
  }, [agent.agentId, permissionsDirty, permissionsSaving, resolvedPermissionsDraft]);

  const runPermissionsSave = useCallback(
    async (draft: AgentPermissionsDraft) => {
      if (permissionsSaving) return;
      setPermissionsSaving(true);
      setPermissionsSaveState("saving");
      setPermissionsSaveError(null);
      try {
        await onUpdateAgentPermissions(draft);
        setPermissionsSaveState("saved");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save permissions.";
        setPermissionsSaveState("error");
        setPermissionsSaveError(message);
      } finally {
        setPermissionsSaving(false);
      }
    },
    [onUpdateAgentPermissions, permissionsSaving]
  );

  useEffect(() => {
    return () => {
      if (permissionsSaveTimerRef.current !== null) {
        window.clearTimeout(permissionsSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!permissionsDirty) return;
    if (permissionsSaving) return;
    if (permissionsSaveTimerRef.current !== null) {
      window.clearTimeout(permissionsSaveTimerRef.current);
    }
    setPermissionsSaveState("idle");
    permissionsSaveTimerRef.current = window.setTimeout(() => {
      permissionsSaveTimerRef.current = null;
      void runPermissionsSave(permissionsDraftValue);
    }, 450);
    return () => {
      if (permissionsSaveTimerRef.current !== null) {
        window.clearTimeout(permissionsSaveTimerRef.current);
        permissionsSaveTimerRef.current = null;
      }
    };
  }, [permissionsDirty, permissionsDraftValue, permissionsSaving, runPermissionsSave]);

  const panelLabel = mode === "advanced" ? "Advanced" : "";
  const canOpenControlUi = typeof controlUiUrl === "string" && controlUiUrl.trim().length > 0;

  return (
    <div
      className="agent-inspect-panel"
      data-testid="agent-settings-panel"
      style={{ position: "relative", left: "auto", top: "auto", width: "100%", height: "100%" }}
    >
      {showHeader ? (
        <AgentInspectHeader
          label={panelLabel}
          title={agent.name}
          onClose={onClose}
          closeTestId="agent-settings-close"
        />
      ) : null}

      <div className="flex flex-col gap-0 px-5 pb-5">
        {mode === "capabilities" ? (
          <section className="sidebar-section" data-testid="agent-settings-permissions">
            <div className="mt-2 flex flex-col gap-8">
              <div className="px-1 py-1">
                <div className="sidebar-copy flex flex-col gap-1 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/88">Run commands</span>
                  <div
                    className="ui-segment ui-segment-command-mode mt-2 grid-cols-3"
                    role="group"
                    aria-label="Run commands"
                  >
                    {(
                      [
                        { id: "off", label: "Off" },
                        { id: "ask", label: "Ask" },
                        { id: "auto", label: "Auto" },
                      ] as const
                    ).map((option) => {
                      const selected = permissionsDraftValue.commandMode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-label={`Run commands ${option.label.toLowerCase()}`}
                          aria-pressed={selected}
                          className="ui-segment-item px-3 py-2.5 text-center font-mono text-[11px] font-semibold tracking-[0.04em]"
                          data-active={selected ? "true" : "false"}
                          onClick={() =>
                            setPermissionsDraftValue((current) => ({
                              ...current,
                              commandMode: option.id,
                            }))
                          }
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="ui-settings-row flex min-h-[68px] items-center justify-between gap-6 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-label="Web access"
                    aria-checked={permissionsDraftValue.webAccess}
                    className={`ui-switch self-center ${permissionsDraftValue.webAccess ? "ui-switch--on" : ""}`}
                    onClick={() =>
                      setPermissionsDraftValue((current) => ({
                        ...current,
                        webAccess: !current.webAccess,
                      }))
                    }
                  >
                    <span className="ui-switch-thumb" />
                  </button>
                  <div className="sidebar-copy flex flex-col">
                    <span className="text-[11px] font-medium text-foreground/88">Web access</span>
                    <span className="text-[10px] text-muted-foreground/70">
                      Allows this agent to fetch live web results.
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/55" aria-hidden="true" />
              </div>
              <div className="ui-settings-row flex min-h-[68px] items-center justify-between gap-6 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-label="File tools"
                    aria-checked={permissionsDraftValue.fileTools}
                    className={`ui-switch self-center ${permissionsDraftValue.fileTools ? "ui-switch--on" : ""}`}
                    onClick={() =>
                      setPermissionsDraftValue((current) => ({
                        ...current,
                        fileTools: !current.fileTools,
                      }))
                    }
                  >
                    <span className="ui-switch-thumb" />
                  </button>
                  <div className="sidebar-copy flex flex-col">
                    <span className="text-[11px] font-medium text-foreground/88">File tools</span>
                    <span className="text-[10px] text-muted-foreground/70">
                      Lets this agent read and edit files in its workspace.
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/55" aria-hidden="true" />
              </div>
              <div className="ui-settings-row flex min-h-[68px] items-center justify-between gap-6 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-label="Browser automation"
                    aria-checked="false"
                    className="ui-switch self-center"
                    disabled
                  >
                    <span className="ui-switch-thumb" />
                  </button>
                  <div className="sidebar-copy flex flex-col">
                    <span className="text-[11px] font-medium text-foreground/88">Browser automation</span>
                    <span className="text-[10px] text-muted-foreground/70">Coming soon</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/55" aria-hidden="true" />
              </div>
            </div>
            <div className="sidebar-copy mt-3 text-[11px] text-muted-foreground">
              {permissionsSaveState === "saving" ? "Saving..." : null}
              {permissionsSaveState === "saved" ? "Saved." : null}
              {permissionsSaveState === "error" && permissionsSaveError ? (
                <span>
                  Couldn&apos;t save. {permissionsSaveError}{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => {
                      void runPermissionsSave(permissionsDraftValue);
                    }}
                  >
                    Retry
                  </button>
                </span>
              ) : null}
            </div>
            {permissionsSaveState === "error" && !permissionsSaveError ? (
              <div className="ui-alert-danger mt-3 rounded-md px-3 py-2 text-xs">
                Couldn&apos;t save permissions.
              </div>
            ) : null}
          </section>
        ) : null}

        {mode === "advanced" ? (
          <>
            {isOpenClawRuntime ? (
              <section className="sidebar-section mt-8" data-testid="agent-settings-control-ui">
                <h3 className="sidebar-section-title ui-text-danger">Danger Zone</h3>
                <div className="ui-alert-danger mt-3 rounded-md px-3 py-3 text-[11px]">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <div className="space-y-1">
                      <div className="font-medium">Advanced users only.</div>
                      <div>Open the full OpenClaw Control UI outside Studio.</div>
                      <div>Changes there can break agent behavior or put Studio out of sync.</div>
                    </div>
                  </div>
                </div>
                {canOpenControlUi ? (
                  <a
                    className="sidebar-btn-primary ui-btn-danger mt-3 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-center font-mono text-[10px] font-semibold tracking-[0.06em]"
                    href={controlUiUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Full Control UI
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : (
                  <>
                    <button
                      className="sidebar-btn-primary ui-btn-danger mt-3 inline-flex px-3 py-2.5 font-mono text-[10px] font-semibold tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-65"
                      type="button"
                      disabled
                    >
                      Open Full Control UI
                    </button>
                    <div className="mt-2 text-[10px] text-muted-foreground/70">
                      Control UI link unavailable for this gateway.
                    </div>
                  </>
                )}
              </section>
            ) : null}

            {canDelete ? (
              <section className="sidebar-section mt-8">
                <div className="text-[11px] text-muted-foreground/68">
                  Removes the agent from the gateway config.
                </div>
                <button
                  className="sidebar-btn-ghost ui-btn-danger mt-3 inline-flex px-3 py-2 font-mono text-[10px] font-semibold tracking-[0.06em]"
                  type="button"
                  onClick={onDelete}
                >
                  Delete agent
                </button>
              </section>
            ) : (
              <section className="sidebar-section mt-8">
                <h3 className="sidebar-section-title">System agent</h3>
                <div className="mt-3 text-[11px] text-muted-foreground">
                  The main agent is reserved and cannot be deleted.
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>

    </div>
  );
};
