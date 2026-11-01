import { describe, expect, it } from "vitest";
import { advanceCompanion, companionActivity, createCompanionState, type CompanionKind } from "@/features/ring-ship/companionMotion";
import { buildShipLayout, cabinAngle, shipDeck } from "@/features/ring-ship/layout";
import { ZH_CN } from "@/lib/i18n/messages";

const layout = shipDeck(buildShipLayout({ projects: [], members: [] }), 0);
const kinds: CompanionKind[] = ["cat", "dog", "drone", "bartender"];
describe("autonomous ship companions", () => {
  it.each(kinds)("keeps %s motion bounded, continuous, repeatable and translated over a long visit", kind => {
    const state = createCompanionState(kind, layout, 90210), repeat = createCompanionState(kind, layout, 90210);
    const actions = new Set<string>(), rooms = new Set<string>();
    for (let i = 0; i < 24000; i++) {
      const before = { ...state.position };
      advanceCompanion(state, layout, .05); advanceCompanion(repeat, layout, .05);
      expect(Math.hypot(state.position.x - before.x, state.position.z - before.z)).toBeLessThanOrEqual(1.65 * .05 + .00001);
      expect(Number.isFinite(state.facing) && Number.isFinite(state.y)).toBe(true);
      const radius = Math.hypot(state.position.x, state.position.z);
      expect(radius).toBeGreaterThan(layout.rings[0].radius - 2);
      expect(radius).toBeLessThan(layout.radius);
      expect(ZH_CN[companionActivity(state)]).toBeTruthy();
      actions.add(state.action); rooms.add(state.cabinId);
    }
    expect(state).toEqual(repeat);
    if (kind === "cat" || kind === "dog") {
      expect([...actions]).toEqual(expect.arrayContaining(["run", "wander", "sleep", "stretch", "sit", "sniff"]));
      expect(rooms.size).toBeGreaterThan(1);
    } else if (kind === "drone") expect([...actions]).toEqual(expect.arrayContaining(["patrol", "scan", "repair", "charge"]));
    else expect([...actions]).toEqual(expect.arrayContaining(["wash", "inventory", "pour", "wipe"]));
  });
  it("does not teleport after a long suspended frame, or advance while paused", () => {
    const state = createCompanionState("dog", layout, 7);
    const before = structuredClone(state); advanceCompanion(state, layout, 0); expect(state).toEqual(before);
    state.duration = 0; advanceCompanion(state, layout, .05);
    const point = { ...state.position }; advanceCompanion(state, layout, 120);
    expect(Math.hypot(state.position.x - point.x, state.position.z - point.z)).toBeLessThanOrEqual(1.65 * .05 + .00001);
  });
  it("keeps the bartender behind the counter throughout its station changes", () => {
    const state = createCompanionState("bartender", layout, 123), cabin = layout.cabins.find(c => c.kind === "lounge")!;
    const angle = cabinAngle(layout, cabin.slot), radius = layout.rings[cabin.ring].radius + 1.65;
    for (let i = 0; i < 12000; i++) {
      advanceCompanion(state, layout, .05);
      const x = state.position.x - Math.sin(angle) * radius, z = state.position.z - Math.cos(angle) * radius;
      expect(x * Math.sin(angle) + z * Math.cos(angle)).toBeCloseTo(.42, 6);
      expect(Math.abs(x * Math.cos(angle) - z * Math.sin(angle))).toBeLessThanOrEqual(1.66);
    }
  });
});
