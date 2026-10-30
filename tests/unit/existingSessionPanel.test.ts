import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExistingSessionPanel } from "../../src/features/office/components/ExistingSessionPanel";

const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const metadata = (id = "original") => ({ id, name: `Name ${id}`, workspace: "/repo", project: "Project", status: "idle" });
const page = (text: string, nextCursor: string | null, threadId = "original") => ({ threadId, nextCursor, messages: [{ id: text, content: text, role: "assistant" }] });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("existing session history pagination", () => {
  it("keeps messages received live while the latest history page is still loading", async () => {
    const history = deferred();
    const live = { id: "live", role: "assistant", content: "live reply" };
    const call = vi.fn((method: string) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.history") return history.promise;
      return Promise.resolve({ connected: true, version: 1, activeTurnId: null, items: [live], approvals: [] });
    });
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByText("live reply");
    await act(async () => history.resolve(page("earlier reply", null)));
    expect(screen.getByText("live reply")).toBeTruthy();
    expect(screen.getByText("earlier reply")).toBeTruthy();
  });
  it("shows metadata before history finishes and never polls metadata or history", async () => {
    const first = deferred();
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : first.promise);
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByRole("heading", { name: "Name original" });
    expect(call).toHaveBeenCalledWith("session.inspect", { threadId: "original", includeHistory: false });
    expect(screen.getByRole("status").textContent).toContain("Loading messages");
    await act(async () => first.resolve(page("latest", "older")));
    expect(screen.getByText("latest")).toBeTruthy();
    vi.useFakeTimers();
    // Re-mount under fake timers to prove no background polling is scheduled.
    cleanup(); call.mockClear();
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(15000));
    expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(1);
    expect(call.mock.calls.filter(([method]) => method === "session.inspect")).toHaveLength(1);
  });
  it("recovers once after reconnect, queues catch-up behind an in-flight page and never overlaps chunks", async () => {
    const initial = deferred(); let status!: (value: "connected" | "disconnected") => void, reads = 0;
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : ++reads === 1 ? initial.promise : Promise.resolve(page("caught up", null)));
    const client = { call, onStatus: (handler: typeof status) => { status = handler; handler("connected"); return () => {}; } };
    render(React.createElement(ExistingSessionPanel, { client, threadId: "original" }));
    await act(async () => {}); expect(reads).toBe(1);
    await act(async () => status("disconnected")); await act(async () => status("connected")); expect(reads).toBe(1);
    await act(async () => initial.resolve(page("before reconnect", null)));
    await screen.findByText("caught up"); expect(reads).toBe(2);
    expect(call.mock.calls.filter(([method]) => method === "session.inspect")).toHaveLength(2);
  });
  it("keeps a shorter authoritative live completion when stale history finishes later", async () => {
    const history = deferred();
    const call = vi.fn((method: string) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.history") return history.promise;
      return Promise.resolve({ connected: true, version: 1, activeTurnId: null, items: [{ id: "m", role: "assistant", status: "completed", content: "final" }], approvals: [] });
    });
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByText("final");
    await act(async () => history.resolve({ threadId: "original", nextCursor: null, messages: [{ id: "m", role: "assistant", content: "older longer intermediate text" }] }));
    expect(screen.getByText("final")).toBeTruthy();expect(screen.queryByText("older longer intermediate text")).toBeNull();
  });
  it("loads one older chunk on upward scroll, blocks overlapping requests, and preserves the viewport when prepending", async () => {
    const older = deferred(); let pages = 0;
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : ++pages === 1 ? Promise.resolve(page("latest", "older")) : older.promise);
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByText("latest");
    const scroller = screen.getByLabelText("Session history"); let height = 1000;
    Object.defineProperty(scroller, "scrollHeight", { get: () => height });
    Object.defineProperty(scroller, "clientHeight", { value: 400 });
    fireEvent.wheel(scroller, { deltaY: -100 });
    fireEvent.wheel(scroller, { deltaY: -100 });
    expect(pages).toBe(2);
    height = 1300;
    await act(async () => older.resolve(page("previous", null)));
    expect(scroller.scrollTop).toBe(300);
    expect(screen.getByText("previous").compareDocumentPosition(screen.getByText("latest")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(call).toHaveBeenLastCalledWith("session.history", { threadId: "original", cursor: "older" });
  });
  it("offers a jump back to latest while reading history and resumes following without another history read", async () => {
    let listener!: (event: { event: string; payload?: unknown }) => void, subscriptionId = "", height = 1400;
    const call = vi.fn((method: string, params: unknown) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.subscribe") { subscriptionId = (params as { subscriptionId: string }).subscriptionId; return Promise.resolve({ subscribed: true }); }
      return Promise.resolve(page("latest", null));
    });
    const client = { call, onEvent: (handler: typeof listener) => { listener = handler; return () => {}; } };
    render(React.createElement(ExistingSessionPanel, { client, threadId: "original" }));
    await screen.findByText("latest");
    const scroller = screen.getByLabelText("Session history");
    Object.defineProperty(scroller, "scrollHeight", { get: () => height });Object.defineProperty(scroller, "clientHeight", { value: 400 });
    scroller.scrollTop = 400;fireEvent.scroll(scroller);
    const push = (version: number) => listener({ event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: null, approvals: [], items: [{ id: "live", content: `live ${version}`, role: "assistant", phase: "final_answer", status: "inProgress" }] } });
    await act(async () => push(1));expect(scroller.scrollTop).toBe(400);
    expect(screen.getByRole("button", { name: "Go to latest message" })).toBeTruthy();
    const reads = call.mock.calls.filter(([method]) => method === "session.history").length;
    fireEvent.click(screen.getByRole("button", { name: "Go to latest message" }));
    expect(scroller.scrollTop).toBe(1000);expect(screen.queryByRole("button", { name: "Go to latest message" })).toBeNull();
    height = 1600;await act(async () => push(2));expect(scroller.scrollTop).toBe(1200);
    expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(reads);
  });
  it("ignores a previous session's late history response", async () => {
    const late = deferred(); const call = vi.fn((method: string, p: unknown) => {
      const { threadId } = p as { threadId: string };
      return method === "session.inspect" ? Promise.resolve(metadata(threadId)) : threadId === "original" ? late.promise : Promise.resolve(page("new session", null, threadId));
    });
    const client = { call };
    const view = render(React.createElement(ExistingSessionPanel, { client, threadId: "original" }));
    view.rerender(React.createElement(ExistingSessionPanel, { client, threadId: "other" }));
    await screen.findByText("new session");
    await act(async () => late.resolve(page("stale", "older")));
    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("Name other");
  });
  it("does not auto-scan tool-only pages and supports deliberate loading and retry", async () => {
    let pages = 0;
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : ++pages === 1 ? Promise.resolve({ threadId: "original", messages: [], nextCursor: "older" }) : pages === 2 ? Promise.reject(new Error("temporary failure")) : Promise.resolve(page("recovered", null)));
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByText(/No chat text on this page/);
    expect(pages).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Load older messages/ }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("recovered")).toBeTruthy());
    expect(pages).toBe(3);
  });
});
