import { describe, expect, it } from "vitest";
import { createShipShadowSchedule } from "@/features/ring-ship/shipShadows";

describe("ship shadow scheduling", () => {
  it.each([30, 60, 120])("refreshes far shadows at 15 Hz in a %i Hz render loop", fps => {
    const schedule = createShipShadowSchedule();
    const frames = Array.from({ length: fps }, (_, i) => schedule(i / fps, 12, 0));
    expect(frames.filter(frame => frame.update)).toHaveLength(15);
    expect(frames.every(frame => frame.size === 1024)).toBe(true);
  });

  it("keeps close views at the original resolution and refreshes every frame", () => {
    const schedule = createShipShadowSchedule();
    for (let i = 0; i < 120; i++) expect(schedule(i / 120, 37, 0)).toEqual({ size: 2048, update: true });
  });

  it("restores full quality immediately on zoom-in and avoids boundary oscillation", () => {
    const schedule = createShipShadowSchedule();
    expect(schedule(0, 12, 0).size).toBe(1024);
    expect(schedule(.01, 23, 0).size).toBe(1024);
    expect(schedule(.02, 24, 0)).toEqual({ size: 2048, update: true });
    expect(schedule(.03, 21, 0).size).toBe(2048);
    expect(schedule(.04, 19, 0)).toEqual({ size: 1024, update: true });
  });

  it("refreshes immediately when decks change, travel starts, or the render clock restarts", () => {
    const schedule = createShipShadowSchedule();
    schedule(10, 12, 0);
    expect(schedule(10.01, 12, 0).update).toBe(false);
    expect(schedule(10.02, 12, 1).update).toBe(true);
    expect(schedule(10.03, 12, -1, true)).toEqual({ size: 2048, update: true });
    expect(schedule(10.04, 12, 1)).toEqual({ size: 1024, update: true });
    expect(schedule(0, 12, 1).update).toBe(true);
  });
});
