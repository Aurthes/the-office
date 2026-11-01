import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentState } from "@/features/agents/state/store";
import { AgentSettingsPanel } from "@/features/agents/components/AgentInspectPanels";

const createAgent = (): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:studio:test-session",
  status: "idle",
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: null,
  runStartedAt: null,
  streamText: null,
  thinkingTrace: null,
  latestOverride: null,
  latestOverrideKind: null,
  lastAssistantMessageAt: null,
  lastActivityAt: null,
  latestPreview: null,
  lastUserMessage: null,
  draft: "",
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  historyFetchLimit: null,
  historyFetchedCount: null,
  historyMaybeTruncated: false,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
});

describe("AgentSettingsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does_not_render_name_editor_in_capabilities_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    expect(screen.queryByLabelText("Agent name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update Name" })).not.toBeInTheDocument();
  });

  it("renders_icon_close_button_with_accessible_label", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    expect(screen.getByLabelText("Close panel")).toBeInTheDocument();
    expect(screen.getByTestId("agent-settings-close")).toBeInTheDocument();
  });

  it("does_not_render_show_tool_calls_and_show_thinking_toggles_in_advanced_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    expect(screen.queryByRole("switch", { name: "Show tool calls" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Show thinking" })).not.toBeInTheDocument();
  });

  it("renders_permissions_controls", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run commands off" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run commands ask" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run commands auto" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Web access" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByRole("switch", { name: "File tools" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("updates_switch_aria_state_when_toggled", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    const webSwitch = screen.getByRole("switch", { name: "Web access" });
    fireEvent.click(webSwitch);
    expect(webSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("autosaves_updated_permissions_draft", async () => {
    const onUpdateAgentPermissions = vi.fn(async () => {});
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        permissionsDraft: {
          commandMode: "off",
          webAccess: false,
          fileTools: false,
        },
        onUpdateAgentPermissions,
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Run commands auto" }));
    fireEvent.click(screen.getByRole("switch", { name: "Web access" }));
    fireEvent.click(screen.getByRole("switch", { name: "File tools" }));

    await waitFor(
      () => {
        expect(onUpdateAgentPermissions).toHaveBeenCalledWith({
          commandMode: "auto",
          webAccess: true,
          fileTools: true,
        });
      },
      { timeout: 2000 }
    );
  });

  it("preserves_pending_permissions_toggles_during_props_refresh", () => {
    const onUpdateAgentPermissions = vi.fn(async () => {});

    const props = {
      agent: createAgent(),
      onClose: vi.fn(),
      onDelete: vi.fn(),
      onToolCallingToggle: vi.fn(),
      onThinkingTracesToggle: vi.fn(),

      onUpdateAgentPermissions,
    };

    const { rerender } = render(
      createElement(AgentSettingsPanel, {
        ...props,
        permissionsDraft: {
          commandMode: "off",
          webAccess: false,
          fileTools: false,
        },
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Run commands auto" }));
    fireEvent.click(screen.getByRole("switch", { name: "Web access" }));
    fireEvent.click(screen.getByRole("switch", { name: "File tools" }));

    rerender(
      createElement(AgentSettingsPanel, {
        ...props,
        permissionsDraft: {
          commandMode: "auto",
          webAccess: false,
          fileTools: false,
        },
      })
    );

    expect(screen.getByRole("switch", { name: "Web access" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("switch", { name: "File tools" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("does_not_render_runtime_settings_section", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    expect(screen.queryByText("Runtime settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Personality")).not.toBeInTheDocument();
  });

  it("does_not_render_new_session_control_in_advanced_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

      })
    );

    expect(screen.queryByRole("button", { name: "New session" })).not.toBeInTheDocument();
  });

  it("shows_control_ui_section_in_advanced_mode", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

        adapterType: "openclaw",
      })
    );

    expect(screen.getByTestId("agent-settings-control-ui")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Full Control UI" })).toBeDisabled();
  });

  it("renders_enabled_control_ui_link_when_available", () => {
    render(
      createElement(AgentSettingsPanel, {
        agent: createAgent(),
        mode: "advanced",
        onClose: vi.fn(),
        onDelete: vi.fn(),
        onToolCallingToggle: vi.fn(),
        onThinkingTracesToggle: vi.fn(),

        controlUiUrl: "http://localhost:3000/control",
      })
    );

    const link = screen.getByRole("link", { name: "Open Full Control UI" });
    expect(link).toHaveAttribute("href", "http://localhost:3000/control");
  });
});
