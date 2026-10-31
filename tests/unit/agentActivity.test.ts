import { describe, expect, it, vi } from "vitest";
import { getAgentActivity, workChatter } from "@/features/retro-office/core/agentActivity";
import { paintCrewNameplate } from "@/features/ring-ship/crewNameplate";

describe("game-like agent activity", () => {
  it("reuses the nameplate canvas and restores text alignment after speech", () => {
    const c = { clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), textAlign: "left", textBaseline: "alphabetic" };
    let width = 0, height = 0;
    const resizeWidth = vi.fn((value: number) => { width = value; });
    const resizeHeight = vi.fn((value: number) => { height = value; });
    const canvas = Object.defineProperties({ getContext: () => c }, {
      width: { get: () => width, set: resizeWidth }, height: { get: () => height, set: resizeHeight },
    }) as unknown as HTMLCanvasElement;
    const agent = { name: "Alice", color: "#123456", status: "working" as const };
    for (let i = 0; i < 100; i++) paintCrewNameplate(canvas, agent, false, i % 2 ? "" : "More coffee!", i);
    expect(resizeWidth).toHaveBeenCalledOnce(); expect(resizeHeight).toHaveBeenCalledOnce();
    expect(c.clearRect).toHaveBeenCalledTimes(100);
    expect(c.textAlign).toBe("left"); expect(c.textBaseline).toBe("alphabetic");
    paintCrewNameplate(canvas, { ...agent, needsInput: true }, true, "");
    expect(canvas.width).toBe(640); expect(canvas.height).toBe(144);
    expect(resizeWidth).toHaveBeenCalledTimes(2); expect(resizeHeight).toHaveBeenCalledTimes(2);
  });
  it("resolves exactly one of five states, hiding stale unread results during a new run", () => {
    expect(getAgentActivity({ status: "idle" })).toMatchObject({ kind: "idle", marker: "" });
    expect(getAgentActivity({ status: "working", needsReview: true })).toMatchObject({ kind: "working", marker: "⚙︎" });
    expect(getAgentActivity({ status: "working", needsInput: true, needsReview: true })).toMatchObject({ kind: "waiting", marker: "!", color: "#facc15" });
    expect(getAgentActivity({ status: "idle", needsReview: true })).toMatchObject({ kind: "review", marker: "?" });
    expect(getAgentActivity({ status: "error", needsInput: true, needsReview: true })).toMatchObject({ kind: "error", marker: "!", color: "#fb7185" });
  });
  it("keeps the identity visible while idle has no activity bubble", () => {
    const c = { clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), measureText: () => ({ width: 40 }) };
    const canvas = { getContext: () => c, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    const agent = { name: "Alice", color: "#123456", status: "idle" as const };
    paintCrewNameplate(canvas, agent, false, "");
    expect(canvas.height).toBe(128); expect(c.roundRect).not.toHaveBeenCalled(); expect(c.fillText).toHaveBeenCalledWith("Alice", expect.any(Number), expect.any(Number), expect.any(Number));
    c.fillText.mockClear(); paintCrewNameplate(canvas, { ...agent, needsInput: true }, false, "!");
    expect(canvas.height).toBe(128); expect(c.roundRect).not.toHaveBeenCalled();
    expect(c.fillText.mock.calls.map(call => call[0])).toEqual(["Alice", "!"]);
  });
  it("shows either identity plus status or temporary chatter, then restores identity", () => {
    const c = { clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn() };
    const canvas = { getContext: () => c, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    const agent = { name: "Alice", color: "#123456", status: "working" as const };
    paintCrewNameplate(canvas, agent, false, "More coffee!");
    expect(c.fillText.mock.calls.map(call => call[0])).toEqual(["More coffee!"]);
    expect(c.roundRect).toHaveBeenCalledOnce(); c.fillText.mockClear();
    paintCrewNameplate(canvas, agent, false, "", Math.PI);
    expect(c.fillText.mock.calls.map(call => call[0])).toEqual(["Alice", "⚙︎"]);
    expect(c.rotate).toHaveBeenCalledWith(Math.PI);
    c.fillText.mockClear(); paintCrewNameplate(canvas, { ...agent, needsInput: true }, false, "More coffee!");
    expect(c.fillText.mock.calls.map(call => call[0])).toEqual(["Alice", "!"]);
  });
  it("cycles dots and short ambient chatter without any backend calls or progress claims", () => {
    const values = new Set(Array.from({ length: 100 }, (_, i) => workChatter("crew-5", i * 500)));
    expect(values.has(".")).toBe(true); expect(values.has("..")).toBe(true); expect(values.has("...")).toBe(true);
    expect([...values].some(value => value.length > 3)).toBe(true);
    expect(values.has("")).toBe(true);
    expect(workChatter("crew-5", 12000)).toBe(workChatter("crew-5", 12000));
  });
});
