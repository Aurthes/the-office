import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompanyRosterSync } from "../../src/features/office/hooks/useCompanyRosterSync";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("push roster refresh", () => {
  it("does not lose a change received during an existing read and ignores chat deltas", async () => {
    let event!: (event: { event: string }) => void, finish!: () => void;
    const unsubscribe = vi.fn();
    const client = { call: vi.fn(), onEvent: vi.fn(handler => { event = handler; return unsubscribe; }) };
    const load = vi.fn(async () => {});
    load.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = renderHook(() => useCompanyRosterSync(client, true, load));
    expect(load).toHaveBeenCalledTimes(1);
    act(() => { event({ event: "session.stream" }); event({ event: "roster.updated" }); event({ event: "roster.updated" }); });
    await act(async () => finish());
    expect(load).toHaveBeenCalledTimes(2);
    view.unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("defers hidden-page updates and reconciles immediately when visible", async () => {
    let event!: (event: { event: string }) => void;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const client = { call: vi.fn(), onEvent: vi.fn(handler => { event = handler; return () => {}; }) };
    const load = vi.fn(async () => {});
    renderHook(() => useCompanyRosterSync(client, true, load));
    act(() => event({ event: "roster.updated" })); expect(load).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("recovers a transient read error without waiting for another roster mutation", async () => {
    vi.useFakeTimers();
    const client = { call: vi.fn(), onEvent: vi.fn(() => () => {}) };
    const load = vi.fn(async () => {}).mockRejectedValueOnce(new Error("temporary"));
    renderHook(() => useCompanyRosterSync(client, true, load));
    await act(async () => {}); expect(load).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
