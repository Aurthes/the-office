import { describe, expect, it } from "vitest";
import { advanceCeo, ceoActivity, ceoBody, ceoHome, createCeoState, type CeoAction } from "@/features/ring-ship/ceoMotion";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";
import { isWalkable, footingRadius } from "@/features/ring-ship/walkableSurface";
import { monitorChairPose } from "@/features/ring-ship/monitor-room-geometry";
import { animateCeoFigure } from "@/features/ring-ship/ceoPose";
import { createDuckCrewFigure } from "@/features/ring-ship/duckCrewFigure";
import { normalizeDuckAppearance } from "@/lib/avatars/duck";
const layout = shipDeck(buildShipLayout({ projects: [{ id: "engineering", name: "Engineering" }], members: [{ id: "worker", projectId: "engineering" }] }), 0);
describe("CEO daily life", () => {
  it("starts in the actual monitor chair and leaves it visibly within twelve seconds", () => {
    const s = createCeoState(layout, 17), chair = monitorChairPose(layout, ceoHome(layout));
    expect(s.position).toEqual(chair.point); expect(s.facing).toBe(chair.facing);
    for (let i = 0; i < 240; i++) advanceCeo(s, layout, .05);
    expect(Math.hypot(s.position.x - chair.point.x, s.position.z - chair.point.z)).toBeGreaterThan(.5);
    expect(s.action).not.toBe("monitor");
  });
  it.each([1, 14])("visits a department and returns without floor gaps (%i projects)", count => {
    const projects = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));
    const world = shipDeck(buildShipLayout({ projects, members: projects.map(p => ({ id: p.id, projectId: p.id })) }), 0);
    const s = createCeoState(world, 42), actions = new Set<string>(), rooms = new Set<string>();
    let departures = 0, seatedAgain = false;
    for (let i = 0; i < 24000; i++) {
      const before = { ...s.position }; advanceCeo(s, world, .05);
      expect(Math.hypot(s.position.x - before.x, s.position.z - before.z)).toBeLessThanOrEqual(.045001);
      if (s.route.length) departures++;
      else { actions.add(s.action); rooms.add(s.cabinId); if (s.action === "monitor" && departures) seatedAgain = true; }
      if (i % 20 === 0) expect(isWalkable(s.position, world, footingRadius(s.radius))).toBe(true);
    }
    for (const action of ["monitor", "stretch", "review", "window", "coffee", "patrol", "think"]) expect(actions.has(action), action).toBe(true);
    expect(rooms.size).toBeGreaterThan(1); expect(seatedAgain).toBe(true);
  });
  it("stops near an occupied destination without overlapping it", () => {
    const s = createCeoState(layout, 3), angle = s.facing - Math.PI;
    const target = { x: s.position.x + Math.sin(angle) * 1.5, z: s.position.z + Math.cos(angle) * 1.5 };
    const other = { id: "other", position: target, radius: .43, deck: 0 };
    s.action = "patrol"; s.route = [target]; s.duration = 100;
    for (let i = 0; i < 100; i++) {
      advanceCeo(s, layout, .05, [other]);
      expect(Math.hypot(s.position.x - target.x, s.position.z - target.z)).toBeGreaterThanOrEqual(s.radius + other.radius + .029);
    }
    expect(ceoBody(s)).toMatchObject({ id: "npc:ceo", deck: 0, position: s.position });
  });
  it("does not advance when paused or jump after a suspended frame", () => {
    const s = createCeoState(layout, 5); s.duration = 0; advanceCeo(s, layout, .05);
    const copy = structuredClone(s); advanceCeo(s, layout, 0); expect(s).toEqual(copy);
    const before = { ...s.position }; advanceCeo(s, layout, 120);
    expect(Math.hypot(s.position.x - before.x, s.position.z - before.z)).toBeLessThanOrEqual(.045001);
    expect(ceoActivity(s)).not.toBe(ceoActivity(createCeoState(layout, 5)));
  });
  it("animates distinct poses without growing the figure", () => {
    const rig = createDuckCrewFigure(normalizeDuckAppearance(undefined)), s = createCeoState(layout, 1);
    const chair = monitorChairPose(layout, ceoHome(layout)), count = rig.root.children.length;
    try {
      const poses = new Set<string>();
      for (const action of ["monitor", "stretch", "review", "window", "coffee", "patrol", "think", "celebrate"] as CeoAction[]) {
        s.action = action; s.time = 2; s.duration = 5;
        let props;
        for (let i = 0; i < 60; i++) props = animateCeoFigure(rig, s, chair.seatHeight, .016);
        expect(props!.tablet).toBe(action === "review"); expect(props!.cup).toBe(action === "coffee");
        poses.add(JSON.stringify(rig.wings.map(w => [w.rotation.x.toFixed(2), w.rotation.z.toFixed(2)])));
        expect(rig.feet.every(f => f.position.y >= .07)).toBe(true);
      }
      expect(poses.size).toBeGreaterThanOrEqual(6); expect(rig.root.children.length).toBe(count);
    } finally { rig.dispose(); }
  });
});
