import { describe, expect, it } from "vitest";
import { CEO_ID } from "@/lib/office/organization";
import { advanceCeo, ceoActivity, ceoBody, ceoHome, createCeoState, type CeoAction } from "@/features/ring-ship/ceoMotion";
import { buildShipLayout, shipDeck, shipPoint } from "@/features/ring-ship/layout";
import { isWalkable, footingRadius, walkableSegment } from "@/features/ring-ship/walkableSurface";
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
    for (const action of ["monitor", "stretch", "review", "window", "break", "patrol", "think"]) expect(actions.has(action), action).toBe(true);
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
    expect(ceoBody(s)).toMatchObject({ id: CEO_ID, deck: 0, position: s.position });
  });
  it("settles at an occupied routine stop instead of circling it forever", () => {
    const s = createCeoState(layout, 42);
    s.duration = 0; advanceCeo(s, layout, .05); s.duration = Infinity;
    const other = { id: "resting-crew", position: { ...s.route[0] }, radius: .5, deck: 0 };
    for (let i = 0; i < 240; i++) {
      advanceCeo(s, layout, .05, [other]);
      expect(Math.hypot(s.position.x - other.position.x, s.position.z - other.position.z)).toBeGreaterThanOrEqual(s.radius + other.radius + .029);
    }
    expect(s.route).toHaveLength(0); expect(s.action).toBe("stretch"); expect(s.walking).toBe(false);
    const settled = { ...s.position };
    for (let i = 0; i < 100; i++) advanceCeo(s, layout, .05, [other]);
    expect(s.position).toEqual(settled);
  });
  it("continues a patrol past an occupied intermediate stop", () => {
    const s = createCeoState(layout, 42);
    s.action = "coffee"; s.routine = 4; s.duration = 0;
    advanceCeo(s, layout, .05); s.duration = Infinity;
    const other = { id: "resting-crew", position: { ...s.route[0] }, radius: .5, deck: 0 };
    const destination = s.destinationId;
    for (let i = 0; i < 6000 && s.route.length; i++) {
      const before = { ...s.position }; advanceCeo(s, layout, .05, [other]);
      expect(walkableSegment(before, s.position, layout, footingRadius(s.radius))).toBe(true);
      expect(Math.hypot(s.position.x - before.x, s.position.z - before.z)).toBeLessThanOrEqual(.045001);
    }
    expect(s.route).toHaveLength(0); expect(s.cabinId).toBe(destination); expect(s.cabinId).not.toBe(ceoHome(layout).id);
  });
  it("waits steadily for an occupied chair, then reaches the real seat when it clears", () => {
    const s = createCeoState(layout, 42), chair = monitorChairPose(layout, ceoHome(layout));
    s.position = { x: chair.point.x, z: chair.point.z + 1.3 };
    s.action = "monitor"; s.route = [{ ...chair.point }]; s.duration = Infinity;
    const other = { id: "resting-crew", position: { ...chair.point }, radius: .5, deck: 0 };
    const waiting = { ...s.position };
    for (let i = 0; i < 200; i++) advanceCeo(s, layout, .05, [other]);
    expect(s.route).toHaveLength(1); expect(s.walking).toBe(false); expect(s.position).toEqual(waiting);
    for (let i = 0; i < 100; i++) advanceCeo(s, layout, .05);
    expect(s.route).toHaveLength(0); expect(s.position.x).toBeCloseTo(chair.point.x, 6); expect(s.position.z).toBeCloseTo(chair.point.z, 6);
  });
  it("waits when skipping an occupied corner would cross a floor gap", () => {
    const s = createCeoState(layout, 42);
    s.position = { x: 0, z: 19 }; s.action = "patrol";
    s.route = [{ x: 0, z: 20 }, shipPoint(26, .35)]; s.duration = Infinity;
    const other = { id: "resting-crew", position: { ...s.route[0] }, radius: .5, deck: 0 };
    expect(walkableSegment(s.position, s.route[1], layout, footingRadius(s.radius))).toBe(false);
    const waiting = { ...s.position };
    for (let i = 0; i < 100; i++) advanceCeo(s, layout, .05, [other]);
    expect(s.waypoint).toBe(0); expect(s.walking).toBe(false); expect(s.position).toEqual(waiting);
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
