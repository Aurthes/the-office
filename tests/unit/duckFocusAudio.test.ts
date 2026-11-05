import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DUCK_CALL_MAX_MS, DUCK_CALL_MIN_MS, useDuckFocusAudio } from "@/features/ring-ship/useDuckFocusAudio";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import { useCallback, useState } from "react";
import { useCompanyRosterSync } from "@/features/office/hooks/useCompanyRosterSync";

type Buffer = { sample: number };
function harness() {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  // Sample numbers match the preview: short/focus, review, waiting, error,
  // followed by the four original focus calls.
  const clips = Array.from({ length: 16 }, (_, index) => index + 1).map(sample => ({
    id: String(sample), base64: btoa(String.fromCharCode(sample)),
    group: sample <= 2 || sample >= 13 ? "focus" : sample <= 6 ? "review" : sample <= 10 ? "waiting" : "error",
  }));
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

type AttentionAgent = Pick<OfficeAgent, "id" | "status" | "needsInput" | "needsReview">;
const worker = (patch: Partial<AttentionAgent> = {}): AttentionAgent => ({ id: "worker", status: "idle", ...patch });

it("quacks once for each new yellow marker without focus or periodic repeats", async () => {
  const h = harness();
  const view = renderHook(({ agents }) => useDuckFocusAudio(null, agents), { initialProps: { agents: [worker()] } });
  await h.settle(); await h.unlock(); const engine = h.engines[0];
  view.rerender({ agents: [worker({ status: "working" })] }); await h.settle();
  expect(engine.sources).toHaveLength(0);
  view.rerender({ agents: [worker({ status: "working", needsInput: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(1); expect(engine.sources[0].start).toHaveBeenCalledOnce();
  expect([7, 8, 9, 10]).toContain(engine.sources[0].buffer?.sample);
  view.rerender({ agents: [worker({ status: "working", needsInput: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(1);
  view.rerender({ agents: [worker({ needsReview: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(2); expect(engine.sources[0].stop).toHaveBeenCalledOnce();
  expect([3, 4, 5, 6]).toContain(engine.sources[1].buffer?.sample);
  act(() => engine.sources[1].finish());
  await h.advance(60_000); expect(engine.sources).toHaveLength(2);
});

it("baselines the first populated roster and does not replay markers after transient empty rosters", async () => {
  const h = harness();
  const view = renderHook(({ agents }) => useDuckFocusAudio(null, agents), { initialProps: { agents: [] as AttentionAgent[] } });
  await h.settle(); await h.unlock(); const engine = h.engines[0];
  view.rerender({ agents: [worker({ needsInput: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(0);
  view.rerender({ agents: [] });
  view.rerender({ agents: [worker({ needsInput: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(0);
  view.rerender({ agents: [worker({ needsInput: true }), worker({ id: "new-worker", needsReview: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(1);
});

it("alerts in background tabs for yellow markers and red errors", async () => {
  const h = harness();
  const view = renderHook(({ agents }) => useDuckFocusAudio(null, agents), { initialProps: { agents: [worker()] } });
  await h.settle(); await h.unlock(); const engine = h.engines[0]; h.visibility(true);
  view.rerender({ agents: [worker({ needsInput: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(1);
  h.visibility(false); h.visibility(true); expect(engine.sources[0].stop).not.toHaveBeenCalled();
  act(() => engine.sources[0].finish());
  view.rerender({ agents: [worker({ status: "error", needsInput: true, needsReview: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(2);
  expect([11, 12]).toContain(engine.sources[1].buffer?.sample);
  view.rerender({ agents: [worker({ status: "error", needsInput: true, needsReview: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(2);
  view.rerender({ agents: [worker({ needsReview: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(3);
});

it.each([
  { kind: "review", patch: { needsReview: true }, random: 0, sample: 3 },
  { kind: "review", patch: { needsReview: true }, random: .999, sample: 6 },
  { kind: "waiting", patch: { needsInput: true }, random: 0, sample: 7 },
  { kind: "waiting", patch: { needsInput: true }, random: .999, sample: 10 },
  { kind: "error", patch: { status: "error" as const }, random: 0, sample: 11 },
  { kind: "error", patch: { status: "error" as const }, random: .999, sample: 12 },
])("selects only the $kind group at random=$random", async ({ patch, random, sample }) => {
  const h = harness(); vi.spyOn(Math, "random").mockReturnValue(random);
  const view = renderHook(({ agents }) => useDuckFocusAudio(null, agents), { initialProps: { agents: [worker()] } });
  await h.settle(); await h.unlock();
  view.rerender({ agents: [worker(patch)] }); await h.settle();
  expect(h.engines[0].sources).toHaveLength(1);
  expect(h.engines[0].sources[0].buffer?.sample).toBe(sample);
});

it.each([1, 2, 13, 14, 15, 16])("includes preview clip %i in normal calls without using status sounds", async sample => {
  const h = harness(), pool = [1, 2, 13, 14, 15, 16];
  vi.spyOn(Math, "random").mockReturnValue((pool.indexOf(sample) + .01) / pool.length);
  renderHook(() => useDuckFocusAudio("worker")); await h.settle(); await h.unlock();
  expect(h.engines[0].sources[0].buffer?.sample).toBe(sample);
});

it.each([false, true])("prefers an error over simultaneous yellow markers, reversed roster=%s", async reversed => {
  const h = harness(); vi.spyOn(Math, "random").mockReturnValue(0);
  const idle = ["review", "error", "waiting"].map(id => worker({ id }));
  const view = renderHook(({ agents }) => useDuckFocusAudio(null, agents), { initialProps: { agents: idle } });
  await h.settle(); await h.unlock();
  const next = [worker({ id: "review", needsReview: true }), worker({ id: "error", status: "error" }), worker({ id: "waiting", needsInput: true })];
  view.rerender({ agents: reversed ? next.reverse() : next }); await h.settle();
  expect(h.engines[0].sources).toHaveLength(1);
  expect(h.engines[0].sources[0].buffer?.sample).toBe(11);
});

it("keeps legacy calls in the normal pool and does not substitute them for missing status sounds", async () => {
  const h = harness();
  const clips = h.clips.filter(clip => clip.group === "focus").map(({ id, base64 }) => ({ id, base64 }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ clips }) })));
  const view = renderHook(({ agents }) => useDuckFocusAudio("worker", agents), { initialProps: { agents: [worker()] } });
  await h.settle(); await h.unlock();
  view.rerender({ agents: [worker({ needsInput: true })] }); await h.settle();
  const engine = h.engines[0]; expect(engine.sources).toHaveLength(1);
  expect(engine.sources[0].stop).not.toHaveBeenCalled();
});

it("respects gesture unlock and mute without delayed catch-up alerts", async () => {
  const h = harness();
  const view = renderHook(({ agents }) => useDuckFocusAudio(null, agents), { initialProps: { agents: [worker()] } });
  await h.settle();
  view.rerender({ agents: [worker({ needsInput: true })] }); await h.settle();
  await h.unlock(); const engine = h.engines[0]; expect(engine.sources).toHaveLength(0);
  act(() => view.result.current.toggleMuted());
  view.rerender({ agents: [worker({ needsReview: true })] }); await h.settle();
  act(() => view.result.current.toggleMuted()); await h.settle(); expect(engine.sources).toHaveLength(0);
  view.rerender({ agents: [worker({ status: "working" })] });
  view.rerender({ agents: [worker({ needsInput: true })] }); await h.settle();
  expect(engine.sources).toHaveLength(1);
  view.unmount(); expect(engine.sources[0].stop).toHaveBeenCalledOnce();
});

it("preempts ambient calls without restarting them on ordinary roster updates", async () => {
  const h = harness(); vi.spyOn(Math, "random").mockReturnValue(0);
  const view = renderHook(({ agents }) => useDuckFocusAudio("worker", agents), { initialProps: { agents: [worker()] } });
  await h.settle(); await h.unlock(); const engine = h.engines[0];
  view.rerender({ agents: [worker({ status: "working" })] }); await h.settle();
  expect(engine.sources).toHaveLength(1);
  view.rerender({ agents: [worker({ needsReview: true })] }); await h.settle();
  expect(engine.sources[0].stop).toHaveBeenCalledOnce(); expect(engine.sources).toHaveLength(2);
  act(() => engine.sources[1].finish());
  await h.advance(DUCK_CALL_MIN_MS - 1); expect(engine.sources).toHaveLength(2);
  await h.advance(1); expect(engine.sources).toHaveLength(3);
});

it("receives background roster changes and quacks before the tab becomes visible", async () => {
  const h = harness();
  let snapshot = [worker()], push!: (event: { event: string }) => void;
  const client = { call: vi.fn(), onEvent: (handler: typeof push) => { push = handler; return () => {}; } };
  renderHook(() => {
    const [agents, setAgents] = useState(snapshot);
    const load = useCallback(async () => { setAgents(snapshot); }, []);
    useCompanyRosterSync(client, true, load);
    return useDuckFocusAudio(null, agents);
  });
  await h.settle(); await h.unlock(); const engine = h.engines[0];
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); h.visibility(true);
  snapshot = [worker({ needsInput: true })];
  await act(async () => push({ event: "roster.updated" }));
  expect(engine.sources).toHaveLength(1);
  expect(engine.sources[0].start).toHaveBeenCalledOnce();
});
