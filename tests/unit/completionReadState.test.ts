import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompletionReadState } from "@/features/office/hooks/useCompletionReadState";
beforeEach(() => { localStorage.clear(); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("completed result read receipts", () => {
  it("keeps unviewed results unread, persists a viewed completion, and leaves a newer completion unread", () => {
    const view = renderHook(({ viewed }: { viewed: { id: string; key: string } | null }) => useCompletionReadState(viewed), { initialProps: { viewed: null as { id: string; key: string } | null } });
    expect(view.result.current.readById.t).toBeUndefined();
    view.rerender({ viewed: { id: "t", key: "completion-1" } });
    expect(view.result.current.readById.t).toBe("completion-1");
    view.unmount();
    const reopened = renderHook(() => useCompletionReadState(null));
    expect(reopened.result.current.readById.t).toBe("completion-1");
    expect(reopened.result.current.readById.t).not.toBe("completion-2");
  });
  it("does not count a hidden tab as a review and marks it seen when the user returns", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const view = renderHook(() => useCompletionReadState({ id: "t", key: "new" }));
    expect(view.result.current.readById.t).toBeUndefined();
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(view.result.current.readById.t).toBe("new");
  });
  it("syncs receipts from another tab without marking other results read", () => {
    const view = renderHook(() => useCompletionReadState(null));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "the-office:read-completions:v1", newValue: JSON.stringify({ other: "c" }) })));
    expect(view.result.current.readById).toEqual({ other: "c" });
  });
  it("retains an in-memory receipt if browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const view = renderHook(() => useCompletionReadState({ id: "t", key: "c" }));
    expect(view.result.current.readById.t).toBe("c");
  });
});
