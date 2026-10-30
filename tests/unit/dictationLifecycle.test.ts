import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "@/features/office/components/useDictation";
let recognition: FakeRecognition;
class FakeRecognition {
  onstart?: () => void; onend?: () => void; onerror?: (e: { error: string }) => void;
  onresult?: (e: { results: { 0: { transcript: string }; isFinal: boolean }[] }) => void;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { recognition = this; }
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("webkitSpeechRecognition", FakeRecognition); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("dictation lifecycle", () => {
  it("waits for the actual start and keeps interim text when Chrome ends a long capture", () => {
    const text = vi.fn(), view = renderHook(() => useDictation(text, "original"));
    act(() => view.result.current.start()); expect(view.result.current.phase).toBe("starting");
    act(() => recognition.onstart?.()); expect(view.result.current.phase).toBe("listening");
    const longText = "长句".repeat(9000);
    act(() => recognition.onresult?.({ results: [{ 0: { transcript: longText }, isFinal: false }] }));
    act(() => recognition.onresult?.({ results: [] }));
    act(() => recognition.onend?.());
    expect(text).toHaveBeenLastCalledWith("original " + longText);
    expect(view.result.current.listening).toBe(false);
    expect(view.result.current.notice).toContain("浏览器已结束听写");
  });
  it("shows a service-start timeout instead of listening indefinitely", () => {
    const view = renderHook(() => useDictation(vi.fn(), "draft"));
    act(() => view.result.current.start()); act(() => vi.advanceTimersByTime(12000));
    expect(view.result.current.phase).toBe("idle"); expect(view.result.current.error).toContain("未能启动");
    expect(recognition.abort).toHaveBeenCalledOnce();
  });
  it("waits for late final text after stop and then returns to editable mode", () => {
    const text = vi.fn(), view = renderHook(() => useDictation(text, ""));
    act(() => view.result.current.start()); act(() => recognition.onstart?.());
    act(() => view.result.current.stop()); expect(view.result.current.phase).toBe("finishing");
    act(() => recognition.onresult?.({ results: [{ 0: { transcript: "最后几个字" }, isFinal: true }] }));
    act(() => recognition.onend?.());
    expect(text).toHaveBeenLastCalledWith("最后几个字"); expect(view.result.current.phase).toBe("idle");
  });
  it("releases a stalled stop and reports an end with no text", () => {
    const view = renderHook(() => useDictation(vi.fn(), "draft"));
    act(() => view.result.current.start()); act(() => recognition.onstart?.()); act(() => view.result.current.stop());
    act(() => vi.advanceTimersByTime(8000)); expect(view.result.current.error).toContain("结束超时");
    act(() => view.result.current.start()); act(() => recognition.onend?.());
    expect(view.result.current.error).toContain("没有收到识别文字");
  });
  it("ignores late events from a failed capture and cancels timers on exit", () => {
    const text = vi.fn(), view = renderHook(() => useDictation(text, "draft"));
    act(() => view.result.current.start()); const previous = recognition;
    act(() => previous.onerror?.({ error: "network" }));
    act(() => view.result.current.start());
    act(() => previous.onresult?.({ results: [{ 0: { transcript: "stale" }, isFinal: true }] }));
    expect(text).not.toHaveBeenCalled(); view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
