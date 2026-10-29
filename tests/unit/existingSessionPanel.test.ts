import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExistingSessionPanel } from "../../src/features/office/components/ExistingSessionPanel";

const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const metadata = (id = "original") => ({ id, name: `Name ${id}`, workspace: "/repo", project: "Project", status: "idle" });
const page = (text: string, nextCursor: string | null, threadId = "original") => ({ threadId, nextCursor, messages: [{ id: text, content: text, role: "assistant" }] });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("existing session history pagination", () => {
  it("shows metadata before history finishes, then reads no more history on its five-second metadata timer", async () => {
    const first = deferred();
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : first.promise);
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByRole("heading", { name: "Name original" });
    expect(call).toHaveBeenCalledWith("session.inspect", { threadId: "original", includeHistory: false });
    expect(screen.getByRole("status").textContent).toContain("读取这一块");
    await act(async () => first.resolve(page("latest", "older")));
    expect(screen.getByText("latest")).toBeTruthy();
    vi.useFakeTimers();
    // Re-mount with fake timers so the metadata interval is controlled.
    cleanup(); call.mockClear();
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(15000));
    expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(1);
    expect(call.mock.calls.filter(([method]) => method === "session.inspect").length).toBeGreaterThan(1);
  });
  it("loads one older chunk on upward scroll, blocks overlapping requests, and preserves the viewport when prepending", async () => {
    const older = deferred(); let pages = 0;
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : ++pages === 1 ? Promise.resolve(page("latest", "older")) : older.promise);
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByText("latest");
    const scroller = screen.getByLabelText("会话记录"); let height = 1000;
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
    await screen.findByText(/这一块没有对话文字/);
    expect(pages).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /读取更早记录/ }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("recovered")).toBeTruthy());
    expect(pages).toBe(3);
  });
});
