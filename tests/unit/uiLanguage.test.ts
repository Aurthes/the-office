import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/features/office/components/panels/SettingsPanel";
import { CompanyWorkAreaMenu } from "@/features/office/components/CompanyWorkAreaMenu";
import { SessionControls } from "@/features/office/components/SessionControls";
import { SessionQuestions } from "@/features/office/components/SessionQuestions";
import { SessionTranscript } from "@/features/office/components/SessionTranscript";
import { setUiLanguage, UI_LANGUAGE_KEY, useUiText } from "@/lib/i18n/ui-language";
import { translateUi } from "@/lib/i18n/messages";

const settingsProps = {
  officeTitle: "我的工作室", officeTitleLoaded: true, onOfficeTitleChange: vi.fn(),
  remoteOfficeEnabled: false, remoteOfficeSourceKind: "presence_endpoint" as const,
  remoteOfficeLabel: "远程团队", remoteOfficePresenceUrl: "", remoteOfficeGatewayUrl: "", remoteOfficeTokenConfigured: false,
  onRemoteOfficeEnabledChange: vi.fn(), onRemoteOfficeSourceKindChange: vi.fn(), onRemoteOfficeLabelChange: vi.fn(),
  onRemoteOfficePresenceUrlChange: vi.fn(), onRemoteOfficeGatewayUrlChange: vi.fn(), onRemoteOfficeTokenChange: vi.fn(),
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); setUiLanguage("en"); localStorage.clear(); });

describe("interface language", () => {
  it("defaults to English regardless of browser language, including SSR", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
    localStorage.setItem(UI_LANGUAGE_KEY, "unsupported");
    render(React.createElement(SettingsPanel, settingsProps));
    expect(screen.getByLabelText("Language")).toHaveValue("en");
    expect(screen.getByText("Studio title")).toBeVisible();
    expect(screen.queryByRole("switch", { name: "Voice replies" })).toBeNull();
    expect(screen.queryByText("Choose the voice used for spoken agent replies.")).toBeNull();
    expect(screen.getByLabelText("Dictation shortcut")).toHaveValue("ctrl-shift-space");
    function Label() { const t = useUiText(); return React.createElement("span", null, t("Settings")); }
    localStorage.setItem(UI_LANGUAGE_KEY, "zh-CN");
    expect(renderToString(React.createElement(Label))).toContain("Settings");
  });

  it("switches settings and other components immediately, preserves names, and persists across remounts", () => {
    const ui = () => React.createElement(React.Fragment, null,
      React.createElement(SettingsPanel, settingsProps),
      React.createElement(CompanyWorkAreaMenu, { areas: [{ id: "p", name: "Settings", agentIds: [] }], activeId: "p", sessionCount: 2, open: true, onOpenChange: vi.fn(), onSelect: vi.fn() }),
      React.createElement(SessionTranscript, { messages: [{ id: "u", role: "user", content: "中文原文 stays unchanged" }, { id: "a", role: "assistant", content: "Keep English 原文" }] }),
    );
    const view = render(ui());
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh-CN" } });
    expect(screen.getByLabelText("语言")).toHaveValue("zh-CN");
    expect(screen.getByText("工作室标题")).toBeVisible();
    expect(screen.getByLabelText("听写快捷键")).toHaveValue("ctrl-shift-space");
    expect(screen.getByRole("combobox", { name: "前往工区" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Settings · 0" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("我的工作室")).toBeInTheDocument();
    expect(screen.getByDisplayValue("远程团队")).toBeInTheDocument();
    expect(screen.getByText("中文原文 stays unchanged")).toBeInTheDocument();
    expect(screen.getByText("Keep English 原文")).toBeInTheDocument();
    expect(localStorage.getItem(UI_LANGUAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    view.unmount(); render(ui());
    expect(screen.getByLabelText("语言")).toHaveValue("zh-CN");
    fireEvent.change(screen.getByLabelText("语言"), { target: { value: "en" } });
    expect(screen.getByText("Studio title")).toBeVisible();
    expect(screen.queryByText("工作室标题")).toBeNull();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps drafts and native subscriptions when language changes, and sends the original text", async () => {
    const call = vi.fn(async () => ({ subscribed: true }));
    let push!: (event: { event: string; payload?: unknown }) => void;
    const client = { call, onEvent: (handler: typeof push) => { push = handler; return vi.fn(); } };
    const onItems = vi.fn();
    render(React.createElement(SessionControls, { client, threadId: "language-draft", onItems }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    const subscriptionId = (call.mock.calls[0] as unknown as [string, { subscriptionId: string }])[1].subscriptionId;
    act(() => push({ event: "session.stream", payload: { threadId: "language-draft", subscriptionId, connected: true, version: 1, activeTurnId: null, items: [], approvals: [] } }));
    fireEvent.change(screen.getByLabelText("Send to session"), { target: { value: "继续用中文沟通 please" } });
    act(() => setUiLanguage("zh-CN"));
    expect(screen.getByLabelText("发送到原会话")).toHaveValue("继续用中文沟通 please");
    expect(call).toHaveBeenCalledTimes(1);
    act(() => setUiLanguage("en"));
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "language-draft", message: "继续用中文沟通 please" })));
  });

  it("changes question controls while preserving questions and answer options", () => {
    render(React.createElement(SessionQuestions, { client: { call: vi.fn() }, threadId: "t", request: { requestId: "q", questions: [{ id: "q1", question: "你想保留哪个名字？", isOther: true, options: [{ label: "Settings", description: "请原样保留" }] }] } }));
    expect(screen.getByText("你想保留哪个名字？")).toBeVisible();
    expect(screen.getByRole("button", { name: "Custom answer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit answer" })).not.toBeInTheDocument();
    act(() => setUiLanguage("zh-CN"));
    expect(screen.getByText("你想保留哪个名字？")).toBeVisible();
    expect(screen.getByRole("button", { name: /Settings.*请原样保留/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "自定义回答" }));
    expect(screen.getByRole("button", { name: "提交答案" })).toBeVisible();
  });

  it("follows another tab and works when storage is unavailable", () => {
    render(React.createElement(SettingsPanel, settingsProps));
    act(() => { localStorage.setItem(UI_LANGUAGE_KEY, "zh-CN"); window.dispatchEvent(new StorageEvent("storage", { key: UI_LANGUAGE_KEY })); });
    expect(screen.getByLabelText("语言")).toHaveValue("zh-CN");
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    act(() => setUiLanguage("en"));
    expect(screen.getByLabelText("Language")).toHaveValue("en");
    act(() => setUiLanguage("zh-CN"));
    expect(screen.getByLabelText("语言")).toHaveValue("zh-CN");
  });

  it("localizes known app errors and interpolates values without changing them", () => {
    expect(translateUi("原会话控制未连接", "en")).toBe("Session controls are disconnected");
    expect(translateUi("Open session: {0}", "en", { "0": "设置" })).toBe("Open session: 设置");
    expect(translateUi("__proto__", "zh-CN")).toBe("__proto__");
  });
});
