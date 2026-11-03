import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DUCK_CALL_MAX_MS, DUCK_CALL_MIN_MS, useDuckFocusAudio } from "@/features/ring-ship/useDuckFocusAudio";

type Buffer = { sample: number };
function harness() {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const clips = [1, 2, 3, 4].map(sample => ({ id: String(sample), base64: btoa(String.fromCharCode(sample)) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ clips }) })));
  class Source {
    buffer: Buffer | null = null;
    onended: (() => void) | null = null;
    connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
    finish() { this.onended?.(); }
  }
  class Engine {
    state = "running"; destination = {}; sources: Source[] = [];
    gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    resume = vi.fn(async () => {}); close = vi.fn(async () => { this.state = "closed"; });
    decodeAudioData = vi.fn(async (bytes: ArrayBuffer): Promise<Buffer> => ({ sample: new Uint8Array(bytes)[0] }));
    createGain = () => this.gain;
    createBufferSource = () => { const source = new Source(); this.sources.push(source); return source; };
    constructor() { engines.push(this); }
  }
  const engines: Engine[] = [];
  vi.stubGlobal("AudioContext", Engine);
  const settle = () => act(async () => {});
  const unlock = () => act(async () => { fireEvent.pointerDown(window); });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const visibility = (value: boolean) => act(() => { hidden = value; fireEvent(document, new Event("visibilitychange")); });
  return { clips, engines, settle, unlock, advance, visibility };
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("unlocks on the first selection, ignores status rerenders, and waits after each finished call", async () => {
  const h = harness(); vi.spyOn(Math, "random").mockReturnValue(0);
  const view = renderHook(({ id }) => useDuckFocusAudio(id), { initialProps: { id: "worker-1" as string | null } });
  await h.settle(); expect(view.result.current.available).toBe(true); expect(h.engines).toHaveLength(0);
  await h.unlock(); const engine = h.engines[0]; expect(engine.sources).toHaveLength(1);
  expect(engine.sources[0].start).toHaveBeenCalledOnce();
  view.rerender({ id: "worker-1" }); await h.settle(); expect(engine.sources).toHaveLength(1);
  await h.advance(DUCK_CALL_MAX_MS * 2); expect(engine.sources).toHaveLength(1); // Never overlap an unfinished call.
  act(() => engine.sources[0].finish());
  await h.advance(DUCK_CALL_MIN_MS - 1); expect(engine.sources).toHaveLength(1);
  await h.advance(1); expect(engine.sources).toHaveLength(2);
  expect(engine.sources[1].buffer?.sample).not.toBe(engine.sources[0].buffer?.sample);
  view.rerender({ id: null }); expect(engine.sources[1].stop).toHaveBeenCalledOnce();
  await h.advance(60_000); expect(engine.sources).toHaveLength(2);
});

it("stops the previous character immediately and cancels pending calls when muted or unmounted", async () => {
  const h = harness();
  const view = renderHook(({ id }) => useDuckFocusAudio(id), { initialProps: { id: "worker" } });
  await h.settle(); await h.unlock(); const engine = h.engines[0];
  view.rerender({ id: "npc:ceo" }); await h.settle();
  expect(engine.sources[0].stop).toHaveBeenCalledOnce(); expect(engine.sources).toHaveLength(2);
  act(() => view.result.current.toggleMuted()); expect(engine.sources[1].stop).toHaveBeenCalledOnce();
  await h.advance(60_000); expect(engine.sources).toHaveLength(2);
  act(() => view.result.current.toggleMuted()); await h.settle(); expect(engine.sources).toHaveLength(3);
  view.unmount(); expect(engine.sources[2].stop).toHaveBeenCalledOnce(); expect(engine.close).toHaveBeenCalledOnce();
  await h.advance(60_000); fireEvent.pointerDown(window); expect(h.engines).toHaveLength(1);
});

it("silences hidden pages and waits a fresh interval on return", async () => {
  const h = harness(); vi.spyOn(Math, "random").mockReturnValue(.999);
  renderHook(() => useDuckFocusAudio("worker")); await h.settle(); await h.unlock();
  const engine = h.engines[0]; h.visibility(true); expect(engine.sources[0].stop).toHaveBeenCalledOnce();
  await h.advance(90_000); expect(engine.sources).toHaveLength(1);
  h.visibility(false); await h.advance(DUCK_CALL_MIN_MS); expect(engine.sources).toHaveLength(1);
  await h.advance(DUCK_CALL_MAX_MS - DUCK_CALL_MIN_MS); expect(engine.sources).toHaveLength(2);
});

it("does not start a clip decoded after its focus was replaced", async () => {
  const h = harness(); vi.spyOn(Math, "random").mockReturnValue(0);
  const view = renderHook(({ id }) => useDuckFocusAudio(id), { initialProps: { id: "worker" } });
  await h.settle();
  let resolve!: (value: Buffer) => void;
  // Create the engine without a focused target, then hold its first decode.
  view.rerender({ id: "" }); await h.unlock(); const engine = h.engines[0];
  engine.decodeAudioData.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  view.rerender({ id: "worker" }); await h.settle(); expect(resolve).toBeTypeOf("function");
  view.rerender({ id: "npc:ceo" }); await h.settle();
  await act(async () => resolve({ sample: 1 }));
  expect(engine.sources).toHaveLength(1); expect(engine.sources[0].start).toHaveBeenCalledOnce();
});

it("does not revive an old decode after a page hides and returns", async () => {
  const h = harness();
  const view = renderHook(({ id }) => useDuckFocusAudio(id), { initialProps: { id: "" } });
  await h.settle(); await h.unlock(); const engine = h.engines[0];
  let resolve!: (value: Buffer) => void;
  engine.decodeAudioData.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  view.rerender({ id: "worker" }); await h.settle(); h.visibility(true); h.visibility(false);
  await act(async () => resolve({ sample: 1 })); expect(engine.sources).toHaveLength(0);
  await h.advance(DUCK_CALL_MAX_MS); expect(engine.sources).toHaveLength(1);
});

it("stays silent without an installed bank or a focused duck", async () => {
  const h = harness(); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ clips: [] }) })));
  const view = renderHook(() => useDuckFocusAudio(null)); await h.settle(); await h.unlock();
  expect(view.result.current.available).toBe(false); expect(h.engines[0].sources).toHaveLength(0);
});
