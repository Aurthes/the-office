import { describe, expect, it } from "vitest";
import { advanceKirby, createKirbyState, KIRBY_HOLD_MS, resetKirby } from "@/features/ring-ship/kirbyMotion";
import { advanceCrew, canvasPoint, crewBodies, syncCrew, worldPoint, type MovingAgent } from "@/features/ring-ship/crewMotion";
import { companionBody } from "@/features/ring-ship/companionMotion";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";
import { createDuckAppearanceFromSeed } from "@/lib/avatars/duck";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";

function fixture(count = 3) {
  const ids = Array.from({ length: count }, (_, i) => `crew-${i}`);
  const layout = shipDeck(buildShipLayout({ projects: [{ id: "p", name: "P" }], members: ids.map(id => ({ id, projectId: "p" })) }), 0);
  const crew = syncCrew(ids.map(id => ({ id, name: id, color: "#abc", item: "", status: "idle", avatarProfile: { ...createDefaultAgentAvatarProfile(id), duck: createDuckAppearanceFromSeed(id) } })), layout, new Map(), 0);
  const state = createKirbyState(layout, 123);
  crew.forEach((agent, index) => { Object.assign(agent, canvasPoint({ x: state.actor.position.x + 1.3 + index * 1.1, z: state.actor.position.z })); agent.pauseUntil = Infinity; });
  const tick = (now: number, chatId?: string, agents = crew) => advanceKirby(state, agents, layout, now, .016, [...crewBodies(agents, layout), companionBody(state.actor)], chatId);
  return { state, crew, layout, tick };
}
describe("Kirby's one-employee idle prank", () => {
  it("keeps wandering and doing its own small actions when no employee is nearby", () => {
    const { state, layout } = fixture(0), start = { ...state.actor.position }, actions = new Set<string>();
    let moved = false;
    for (let i = 0; i < 12000; i++) {
      const before = { ...state.actor.position };
      advanceKirby(state, [], layout, i * 50, .05, [companionBody(state.actor)]);
      expect(Math.hypot(state.actor.position.x - before.x, state.actor.position.z - before.z)).toBeLessThanOrEqual(1.65 * .05 + 1e-6);
      moved ||= Math.hypot(state.actor.position.x - start.x, state.actor.position.z - start.z) > 1;
      actions.add(state.actor.action);
    }
    expect(moved).toBe(true); expect(state.actor.cycles).toBeGreaterThan(3);
    expect(actions.has("wander")).toBe(true); expect([...actions].filter(action => ["groom", "stretch", "sit"].includes(action)).length).toBeGreaterThan(1);
    expect(state.victim).toBeNull();
  });
  it("locks exactly one target through inhale, five seconds of holding and spit", () => {
    const { state, crew, tick } = fixture(); tick(0);
    expect(state.victim?.id).toBe(crew[0].id); expect(state.phase).toBe("inhale");
    const selected = state.victim;
    tick(600); expect(crew.filter(agent => agent.kirbyPose)).toHaveLength(1);
    tick(1101); expect(state.phase).toBe("holding"); expect(crew[0].kirbyPose?.hidden).toBe(true);
    tick(1101 + KIRBY_HOLD_MS - 1); expect(state.phase).toBe("holding"); expect(state.victim).toBe(selected);
    tick(1101 + KIRBY_HOLD_MS); expect(state.phase).toBe("spit");
    expect(crew.slice(1).every(agent => !agent.kirbyPose)).toBe(true);
    tick(1101 + KIRBY_HOLD_MS + 751); expect(state.victim).toBeNull(); expect(state.phase).toBe("wander");
    expect(crew.every(agent => !agent.kirbyPose)).toBe(true);
    tick(8000); expect(state.victim).toBeNull();
  });
  it.each(["working", "error", "needsInput", "chat", "otherDeck"])("does not target %s employees", exclusion => {
    const { state, crew, layout, tick } = fixture(1);
    if (exclusion === "working" || exclusion === "error") crew[0].status = exclusion;
    if (exclusion === "needsInput") crew[0].needsInput = true;
    if (exclusion === "otherDeck") layout.seats[crew[0].id].deck = 1;
    tick(0, exclusion === "chat" ? crew[0].id : undefined);
    expect(state.victim).toBeNull(); expect(crew[0].kirbyPose).toBeUndefined();
  });
  it("can target an idle employee whose completed result has not been read", () => {
    const { state, crew, tick } = fixture(1); crew[0].needsReview = true; tick(0);
    expect(state.victim?.id).toBe(crew[0].id);
  });
  it("keeps the same target even when a second idle employee moves closer", () => {
    const { state, crew, tick } = fixture(); tick(0);
    Object.assign(crew[1], canvasPoint({ x: state.actor.position.x, z: state.actor.position.z + .9 }));
    tick(500); tick(1200); tick(2000);
    expect(state.victim?.id).toBe(crew[0].id); expect(crew[1].kirbyPose).toBeUndefined();
  });
  it.each(["working", "needsInput", "chat"])("releases an employee who becomes %s while inside", change => {
    const { state, crew, tick } = fixture(1); tick(0); tick(1200);
    if (change === "working") crew[0].status = "working";
    if (change === "needsInput") crew[0].needsInput = true;
    tick(1300, change === "chat" ? crew[0].id : undefined); expect(state.phase).toBe("spit");
    tick(2100, change === "chat" ? crew[0].id : undefined); expect(state.victim).toBeNull(); expect(crew[0].kirbyPose).toBeUndefined();
  });
  it("preserves employee status, identity, appearance and the transient pose across roster refreshes", () => {
    const { state, crew, layout, tick } = fixture(1), original = structuredClone(crew[0]);
    tick(0); tick(1200);
    expect(state.victim?.appearance).toEqual(original.avatarProfile?.duck);
    const next = syncCrew([{ ...crew[0], name: "New name" }], layout, new Map([[crew[0].id, crew[0]]]), 1250);
    expect(next[0].kirbyPose?.hidden).toBe(true);
    const before = worldPoint(next[0]); advanceCrew(next, layout, 1300, .016); expect(worldPoint(next[0])).toEqual(before);
    advanceKirby(state, next, layout, 6300, .016, [companionBody(state.actor)]);
    advanceKirby(state, next, layout, 7100, .016, [companionBody(state.actor)]);
    expect(next[0]).toMatchObject({ id: original.id, status: original.status, avatarProfile: original.avatarProfile });
    expect(next[0].kirbyPose).toBeUndefined(); expect(crewBodies(next, layout)).toHaveLength(1);
  });
  it("cleans up when hidden/unmounted or when the targeted employee disappears", () => {
    const { state, crew, tick } = fixture(1); tick(0); tick(1200); resetKirby(state, crew, 1400);
    expect(state.victim).toBeNull(); expect(crew[0].kirbyPose).toBeUndefined();
    state.cooldownUntil = 0; tick(1600); tick(2800); tick(3000, undefined, [] as MovingAgent[]);
    expect(state.victim).toBeNull(); expect(state.phase).toBe("wander");
  });
  it("clamps suspended-frame movement and finishes an overdue hold after resume", () => {
    const { state, crew, layout, tick } = fixture(1); tick(0); tick(1200);
    advanceKirby(state, crew, layout, 60000, 120, [companionBody(state.actor)]);
    expect(state.phase).toBe("spit"); tick(61000); expect(state.victim).toBeNull();
  });
});
