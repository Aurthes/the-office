import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictationShortcut } from "@/features/office/components/useDictationShortcut";

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel"); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.useRealTimers(); vi.restoreAllMocks(); });
function setup(phase = "idle") {
  const field = document.createElement("textarea"); document.body.append(field);
  vi.spyOn(field, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const props = { input: { current: field }, phase, enabled: true, start: vi.fn(), stop: vi.fn(), discard: vi.fn() };
  const view = renderHook(useDictationShortcut, { initialProps: props });
  const down = (extra = {}) => fireEvent.keyDown(field, { key: "Alt", code: "AltLeft", altKey: true, ...extra });
  const up = () => fireEvent.keyUp(field, { key: "Alt", code: "AltLeft" });
  return { ...props, view, down, up, props };
}
describe("Mac Option dictation", () => {
  it("latches a short tap, then stops on the next tap without sending", () => {
    const h = setup(); h.down(); act(() => vi.advanceTimersByTime(100)); h.up();
    expect(h.start).toHaveBeenCalledOnce(); expect(h.stop).not.toHaveBeenCalled();
    h.view.rerender({ ...h.props, phase: "recording" });
    act(() => vi.advanceTimersByTime(1000)); expect(h.stop).not.toHaveBeenCalled();
    h.down(); h.up(); expect(h.stop).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("starts a hold at the threshold and transcribes on release without sending", () => {
    const h = setup(); h.down();
    act(() => vi.advanceTimersByTime(249)); expect(h.start).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(h.start).toHaveBeenCalledOnce();
    h.view.rerender({ ...h.props, phase: "recording" });
    h.down({ repeat: true }); h.up(); expect(h.stop).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("uses Enter for transcribe-and-send and Esc for cancellation", () => {
    const h = setup("recording");
    fireEvent.keyDown(h.input.current, { key: "Enter" }); expect(h.stop).toHaveBeenCalledExactlyOnceWith(true);
    fireEvent.keyDown(h.input.current, { key: "Escape" }); expect(h.discard).toHaveBeenCalledOnce();
    expect(h.start).not.toHaveBeenCalled();
  });
  it.each(["starting", "transcribing"])("can cancel %s without a late Option release restarting it", phase => {
    const h = setup(phase); h.down(); fireEvent.keyDown(h.input.current, { key: "Escape" }); h.up();
    expect(h.discard).toHaveBeenCalledOnce(); expect(h.start).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
  });
  it("leaves Option editor chords and Shift-Enter alone", () => {
    const h = setup(); h.down(); fireEvent.keyDown(h.input.current, { key: "ArrowLeft", altKey: true }); h.up();
    act(() => vi.advanceTimersByTime(1000)); expect(h.start).not.toHaveBeenCalled();
    h.down({ metaKey: true }); h.up(); expect(h.start).not.toHaveBeenCalled();
    h.view.rerender({ ...h.props, phase: "recording" });
    fireEvent.keyDown(h.input.current, { key: "Enter", shiftKey: true }); expect(h.stop).not.toHaveBeenCalled();
  });
  it("does not start in another input, a hidden composer, or while unavailable", () => {
    const h = setup(), other = document.createElement("input"); document.body.append(other);
    fireEvent.keyDown(other, { key: "Alt", code: "AltLeft" }); fireEvent.keyUp(other, { key: "Alt", code: "AltLeft" });
    expect(h.start).not.toHaveBeenCalled();
    vi.mocked(h.input.current.getClientRects).mockReturnValue([] as unknown as DOMRectList);
    h.down(); h.up(); expect(h.start).not.toHaveBeenCalled();
    vi.mocked(h.input.current.getClientRects).mockReturnValue([{}] as unknown as DOMRectList);
    h.view.rerender({ ...h.props, enabled: false }); h.down(); h.up(); expect(h.start).not.toHaveBeenCalled();
  });
  it("clears a pending tap on blur and stops a held attempt if keyup is lost", () => {
    const h = setup(); h.down(); fireEvent.blur(window); h.up();
    act(() => vi.advanceTimersByTime(1000)); expect(h.start).not.toHaveBeenCalled();
    h.down(); act(() => vi.advanceTimersByTime(250));
    fireEvent.blur(window); h.up(); expect(h.stop).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("does not leave a timer or keyup handler behind after unmount", () => {
    const h = setup(); h.down(); h.view.unmount();
    act(() => vi.advanceTimersByTime(1000)); h.up(); expect(h.start).not.toHaveBeenCalled();
  });
});
