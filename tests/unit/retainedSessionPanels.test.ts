import React, { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetainedSessionPanels, SESSION_RETENTION_MS } from "../../src/features/office/components/RetainedSessionPanels";
import { ExistingSessionPanel } from "../../src/features/office/components/ExistingSessionPanel";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const removed = vi.fn();
function Probe({ id, focusMode, onToggleFocus }: { id: string; focusMode: boolean; onToggleFocus: () => void }) {
  const [text, setText] = useState("");
  useEffect(() => () => { removed(id); }, [id]);
  return React.createElement(React.Fragment, null, React.createElement("input", { "aria-label": id, value: text, onChange: event => setText(event.target.value) }), React.createElement("button", { "aria-pressed": focusMode, onClick: onToggleFocus }, "Focus " + id));
}
const probes = (activeId: string | null, sessionIds = ["A", "B"], key = "gateway") => React.createElement(RetainedSessionPanels, { key, activeId, sessionIds, renderPanel: (id, state) => React.createElement(Probe, { id, ...state }) });

describe("retained session lifetime", () => {
  it("keeps exact DOM and local state through switching and closing, and starts a fresh timeout on each departure", () => {
    vi.useFakeTimers(); removed.mockClear();
    const view = render(probes("A"));
    const original = screen.getByRole("textbox", { name: "A" });
    fireEvent.change(original, { target: { value: "my layout" } });
    view.rerender(probes("B"));
    expect(original.closest("[data-session-panel]")).toHaveAttribute("inert");
    expect(original).not.toBeVisible();
    act(() => vi.advanceTimersByTime(SESSION_RETENTION_MS - 1));
    view.rerender(probes("A"));
    expect(screen.getByRole("textbox", { name: "A" })).toBe(original);
    expect(original).toHaveValue("my layout");
    act(() => vi.advanceTimersByTime(SESSION_RETENTION_MS * 2));
    expect(original).toBeVisible(); // An active session never times out.
    view.rerender(probes(null));
    act(() => vi.advanceTimersByTime(SESSION_RETENTION_MS - 1));
    expect(original).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(original).not.toBeInTheDocument(); expect(removed).toHaveBeenCalledWith("A");
    view.rerender(probes("A"));
    expect(screen.getByRole("textbox", { name: "A" })).not.toBe(original);
    expect(screen.getByRole("textbox", { name: "A" })).toHaveValue("");
  });

  it("pins only the focused session and restores ordinary retention when Focus is switched off", () => {
    vi.useFakeTimers();
    const view = render(probes("A")); const input = screen.getByRole("textbox", { name: "A" });
    fireEvent.click(screen.getByRole("button", { name: "Focus A" }));
    view.rerender(probes("B")); view.rerender(probes(null));
    act(() => vi.advanceTimersByTime(SESSION_RETENTION_MS * 20));
    expect(input).toBeInTheDocument(); expect(screen.queryByLabelText("B")).toBeNull();
    view.rerender(probes("A"));
    expect(screen.getByRole("button", { name: "Focus A" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Focus A" }));
    view.rerender(probes(null)); act(() => vi.advanceTimersByTime(SESSION_RETENTION_MS - 1));
    expect(input).toBeInTheDocument(); act(() => vi.advanceTimersByTime(1)); expect(input).not.toBeInTheDocument();
  });

  it("rebuilds an expired session even if background throttling prevented its timer from firing", () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const view = render(probes("A")); const original = screen.getByRole("textbox", { name: "A" });
    fireEvent.change(original, { target: { value: "expired" } }); view.rerender(probes("B"));
    vi.setSystemTime(1000 + SESSION_RETENTION_MS + 1); view.rerender(probes("A"));
    expect(screen.getByRole("textbox", { name: "A" })).not.toBe(original);
    expect(screen.getByRole("textbox", { name: "A" })).toHaveValue("");
  });

  it("releases removed sessions, separates gateways and cancels timers on unmount", () => {
    vi.useFakeTimers();
    const view = render(probes("A")); const original = screen.getByRole("textbox", { name: "A" });
    fireEvent.click(screen.getByRole("button", { name: "Focus A" }));
    view.rerender(probes("B", ["B"])); expect(original).not.toBeInTheDocument();
    const before = screen.getByRole("textbox", { name: "B" });
    view.rerender(probes("B", ["B"], "another-gateway")); expect(before).not.toBeInTheDocument();
    view.rerender(probes(null, ["B"], "another-gateway")); expect(vi.getTimerCount()).toBe(1);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});

it.each(["html", "markdown"] as const)("retains loaded older history, scroll position and the open %s workspace without reading it again", async kind => {
  const asset = { kind, name: `report.${kind === "html" ? "html" : "md"}`, source: "/repo/report", url: "/api/session-assets?ref=report" };
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ content: "# Cached report", assets: [] }) }));
  vi.stubGlobal("fetch", fetcher);
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { threadId: string; cursor?: string };
    if (method === "session.inspect") return { id: p.threadId, name: p.threadId, project: "Project", workspace: "/repo", controlsAvailable: true };
    if (method === "session.history") return { threadId: p.threadId, nextCursor: p.cursor ? "even-older" : "older", messages: [{ id: p.cursor || "latest", role: "assistant", content: p.cursor ? "Older history already loaded" : "Current message" }] };
    if (method === "session.workspace.list") return { path: "", entries: [{ name: asset.name, directory: false }] };
    if (method === "session.workspace.read") return { path: asset.name, asset };
    return { connected: true, version: 1, activeTurnId: null, items: [], approvals: [], features: { dictation: false, voice: false, prediction: false } };
  });
  const client = { call };
  const panel = (id: string | null) => React.createElement(RetainedSessionPanels, { activeId: id, sessionIds: ["A", "B"], renderPanel: (threadId, state) => React.createElement(ExistingSessionPanel, { client, threadId, ...state }) });
  const view = render(panel("A")); await screen.findByText("Current message");
  const scroll = screen.getByLabelText("Session history");
  let visibleHeight = 200;
  Object.defineProperty(scroll, "scrollHeight", { value: 1000 }); Object.defineProperty(scroll, "clientHeight", { get: () => visibleHeight });
  fireEvent.click(screen.getByRole("button", { name: /Load older messages/ })); await screen.findByText("Older history already loaded");
  fireEvent.click(screen.getByRole("button", { name: "Open workspace" })); fireEvent.click(await screen.findByRole("button", { name: asset.name }));
  const preview = kind === "html" ? await screen.findByTitle(asset.name) : await screen.findByRole("heading", { name: "Cached report" });
  scroll.scrollTop = 150; fireEvent.scroll(scroll);
  const reads = call.mock.calls.filter(([method, params]) => (params as { threadId: string }).threadId === "A" && ["session.history", "session.workspace.read", "session.workspace.list"].includes(method)).length;
  // Mobile workspace/character views can hide just the conversation while the
  // session itself remains active. A synthetic zero-size scroll is not input.
  visibleHeight = 0; scroll.scrollTop = 0; fireEvent.scroll(scroll);
  expect(call.mock.calls.filter(([method, params]) => (params as { threadId: string }).threadId === "A" && ["session.history", "session.workspace.read", "session.workspace.list"].includes(method))).toHaveLength(reads);
  visibleHeight = 200; scroll.scrollTop = 150;
  view.rerender(panel("B")); await waitFor(() => expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument());
  view.rerender(panel(null)); view.rerender(panel("A"));
  expect(preview).toBeInTheDocument(); expect(preview).toBeVisible(); expect(scroll.scrollTop).toBe(150);
  expect(screen.getByText("Older history already loaded")).toBeVisible();
  expect(call.mock.calls.filter(([method, params]) => (params as { threadId: string }).threadId === "A" && ["session.history", "session.workspace.read", "session.workspace.list"].includes(method))).toHaveLength(reads);
  expect(fetcher).toHaveBeenCalledTimes(kind === "markdown" ? 1 : 0);
});
