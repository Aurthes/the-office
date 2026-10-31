import { createElement } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStarNavigation } from "@/features/ring-ship/StarNavigation";
import { STAR_SYSTEMS } from "@/features/ring-ship/galaxy";
import { WarpJourney } from "@/features/ring-ship/WarpJourney";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("requires confirmation and arrival before changing or saving the current system", () => {
  const key = "test-star-system", hook = renderHook(() => useStarNavigation(key));
  const send = hook.result.current.dispatch;
  act(() => send({ type: "select", id: "blue-nebula" }));
  expect(hook.result.current.state.phase).toBe("idle");
  act(() => { send({ type: "open" }); send({ type: "select", id: "blue-nebula" }); });
  expect(hook.result.current.state).toMatchObject({ phase: "confirm", current: "deep-space", destination: "blue-nebula" });
  expect(localStorage.getItem(key)).toBeNull();
  act(() => send({ type: "engage" }));
  expect(hook.result.current.state.current).toBe("deep-space");
  act(() => { send({ type: "close" }); send({ type: "select", id: "violet-rift" }); send({ type: "engage" }); send({ type: "complete" }); });
  expect(hook.result.current.state).toMatchObject({ phase: "warp", destination: "blue-nebula", current: "deep-space" });
  expect(localStorage.getItem(key)).toBeNull();
  act(() => { send({ type: "arrive" }); send({ type: "arrive" }); send({ type: "complete" }); });
  expect(hook.result.current.state).toMatchObject({ phase: "idle", destination: null, current: "blue-nebula" });
  expect(localStorage.getItem(key)).toBe("blue-nebula");
  hook.unmount();
  expect(renderHook(() => useStarNavigation(key)).result.current.state).toMatchObject({ current: "blue-nebula", phase: "idle" });
});

it("keeps the same location after cancelling a course or selecting the current system", () => {
  localStorage.setItem("navigation-test", "jade-nebula");
  const hook = renderHook(() => useStarNavigation("navigation-test")), send = hook.result.current.dispatch;
  act(() => { send({ type: "open" }); send({ type: "select", id: "jade-nebula" }); });
  expect(hook.result.current.state.phase).toBe("chart");
  act(() => { send({ type: "select", id: "amber-nebula" }); send({ type: "cancel" }); send({ type: "engage" }); send({ type: "close" }); });
  expect(hook.result.current.state).toMatchObject({ phase: "idle", current: "jade-nebula", destination: null });
  expect(localStorage.getItem("navigation-test")).toBe("jade-nebula");
});

it("recovers an unknown stored destination without overwriting other preview state", () => {
  localStorage.setItem("navigation-test", "missing-system");
  localStorage.setItem("claw3d:ship:v1:default:", "saved-cabins");
  expect(renderHook(() => useStarNavigation("navigation-test")).result.current.state.current).toBe("deep-space");
  expect(localStorage.getItem("claw3d:ship:v1:default:")).toBe("saved-cabins");
});

it.each([false, true])("finishes the journey once even when the tab skips animation frames (reduced motion: %s)", reduced => {
  const arrive = vi.fn(), complete = vi.fn();
  let nextFrame: FrameRequestCallback = () => {};
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  render(createElement(WarpJourney, { destination: STAR_SYSTEMS[1], onArrive: arrive, onComplete: complete }));
  act(() => nextFrame(reduced ? 500 : 4500));
  expect(arrive).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  act(() => nextFrame(8000));
  expect(arrive).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(arrive.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0]);
});
