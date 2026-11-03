import { describe, expect, it } from "vitest";
import { buildShipLayout, parseShipAllocation, shipDeck, type ShipPoint } from "@/features/ring-ship/layout";
import { BREAK_ACTIONS, BREAK_ROOM, breakAction, breakRoomPoint, breakSeatKey, breakSeatPose } from "@/features/ring-ship/breakRoomLayout";
import { freeBreakSeat, hasBreakPartner, routeToBreakSeat } from "@/features/ring-ship/breakRoomMotion";
import { advanceCrew, canvasPoint, crewBodies, hash, syncCrew, worldPoint } from "@/features/ring-ship/crewMotion";
import { advanceCeo, ceoBody, createCeoState } from "@/features/ring-ship/ceoMotion";
import { footingRadius, isWalkable, walkableSegment } from "@/features/ring-ship/walkableSurface";
import { createDuckCrewFigure } from "@/features/ring-ship/duckCrewFigure";
import { normalizeDuckAppearance } from "@/lib/avatars/duck";
import { applyBreakPose } from "@/features/ring-ship/breakPose";

const distance = (a: ShipPoint, b: ShipPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const roster = { projects: [{ id: "p", name: "Project" }], members: [{ id: "worker", projectId: "p" }] };
const layout = shipDeck(buildShipLayout(roster), 0), room = layout.cabins.find(c => c.kind === "break")!;
function worker() {
  const agent = syncCrew([{ id: "worker", name: "Worker", status: "idle", color: "#abc", item: "" }], layout, new Map(), 0)[0];
  agent.pauseUntil = 0;
  agent.outings = (1 - hash(agent.id) % 3 + 3) % 3;
  return agent;
}
describe("break-room visits", () => {
  it("adds one main-deck pod and keeps saved projects and room placements", () => {
    const built = buildShipLayout(roster), saved = structuredClone(built.allocation);
    delete saved.breakRoom;
    const upgraded = buildShipLayout(roster, saved);
    expect(upgraded.cabins.filter(c => c.kind === "break")).toHaveLength(1);
    expect(upgraded.allocation.breakRoom?.deck).toBe(0);
    expect(upgraded.allocation.projects).toEqual(saved.projects);
    expect(upgraded.allocation.monitorRoom).toEqual(saved.monitorRoom);
    expect(upgraded.allocation.cloningRoom).toEqual(saved.cloningRoom);
    const parsed = parseShipAllocation(JSON.stringify(upgraded.allocation));
    expect(buildShipLayout(roster, parsed).allocation).toEqual(upgraded.allocation);
  });
  it("keeps tables and the counter solid, with four supported seats and a clear approach to each", () => {
    expect(isWalkable(breakRoomPoint(layout, room, 0, BREAK_ROOM.counter.z), layout, .4)).toBe(false);
    for (const x of BREAK_ROOM.tables) expect(isWalkable(breakRoomPoint(layout, room, x, BREAK_ROOM.radial), layout, .4)).toBe(false);
    for (let i = 0; i < BREAK_ROOM.seats.length; i++) {
      const pose = breakSeatPose(layout, room, i);
      expect(isWalkable(pose.point, layout, .4)).toBe(true);
      expect(walkableSegment(breakRoomPoint(layout, room, 0, 0), pose.approach, layout, .4)).toBe(true);
      expect(walkableSegment(pose.approach, pose.point, layout, .4)).toBe(true);
    }
  });
  it("does not reserve the same chair twice or send a fifth visitor into a full room", () => {
    const body = { id: "visitor", deck: 0, radius: .43, position: breakRoomPoint(layout, room, 0, 0) };
    const others = Array.from({ length: 4 }, (_, i) => ({ ...body, id: `reserved-${i}`, reservedSeat: breakSeatKey(room.id, i) }));
    expect(freeBreakSeat(layout, room, body, others, 0)).toBeUndefined();
    expect(freeBreakSeat(layout, room, body, others.slice(1), 0)).toBe(0);
  });
  it("starts chatting only after somebody actually reaches the opposite chair", () => {
    const visit = { cabinId: room.id, seat: 0, action: "chat" as const, outward: [] };
    const partner = { id: "listener", deck: 0, radius: .43, position: breakSeatPose(layout, room, 1).approach, reservedSeat: breakSeatKey(room.id, 1) };
    expect(hasBreakPartner(layout, room, visit, [partner])).toBe(false);
    expect(breakAction(visit)).toBe("tea");
    partner.position = breakSeatPose(layout, room, 1).point;
    expect(hasBreakPartner(layout, room, visit, [partner])).toBe(true);
    expect(breakAction({ ...visit, chatting: true })).toBe("chat");
  });
  it("staggered visitors hold different seats while travelling and all arrive without overlap", () => {
    const ids = Array.from({ length: 4 }, (_, i) => `guest-${i}`);
    const world = shipDeck(buildShipLayout({ projects: [{ id: "p", name: "P" }], members: ids.map(id => ({ id, projectId: "p" })) }), 0);
    const guests = syncCrew(ids.map(id => ({ id, name: id, color: "#abc", item: "", status: "idle" as const })), world, new Map(), 0);
    guests.forEach(a => { a.pauseUntil = 0; a.outings = (1 - hash(a.id) % 3 + 3) % 3; });
    advanceCrew(guests, world, 1, .05);
    expect(new Set(guests.map(a => a.breakVisit?.seat)).size).toBe(4);
    const arrived = new Set<string>();
    for (let i = 0; i < 8000 && arrived.size < guests.length; i++) {
      advanceCrew(guests, world, 2, .05);
      for (const a of guests) if (a.state === "sitting" && a.breakVisit) arrived.add(a.id);
      const bodies = crewBodies(guests, world);
      for (let x = 0; x < bodies.length; x++) for (let y = x + 1; y < bodies.length; y++) {
        expect(distance(bodies[x].position, bodies[y].position)).toBeGreaterThanOrEqual(bodies[x].radius + bodies[y].radius - 1e-6);
      }
    }
    expect(arrived.size, JSON.stringify(guests.map(a => ({ id: a.id, visit: a.breakVisit?.seat, position: worldPoint(a), waypoint: a.routeIndex, target: a.route[a.routeIndex], state: a.state })))).toBe(guests.length);
  });
  it("returns continuously when interrupted on the way to a break", () => {
    const a = worker();
    for (let i = 0; i < 160; i++) advanceCrew([a], layout, 1 + i * 50, .05);
    expect(a.breakVisit).toBeDefined(); expect(a.route.length).toBeGreaterThan(0);
    const before = worldPoint(a); a.needsInput = true;
    advanceCrew([a], layout, 8001, .05);
    expect(distance(before, worldPoint(a))).toBeLessThanOrEqual(.105001);
    expect(a.breakVisit).toBeUndefined();
    for (let i = 0; i < 8000 && a.route.length; i++) advanceCrew([a], layout, 8051 + i * 50, .05);
    expect(distance(worldPoint(a), a.home)).toBeLessThan(.00001);
  });
  it("walks to a real chair, preserves the visit on refresh, and retraces it when work starts", () => {
    let a = worker(); advanceCrew([a], layout, 1, .05);
    expect(a.breakVisit).toBeDefined();
    const target = breakSeatPose(layout, room, a.breakVisit!.seat).point;
    let now = 1;
    for (let i = 0; i < 8000 && a.route.length; i++) {
      const before = worldPoint(a); now += 50; advanceCrew([a], layout, now, .05);
      expect(walkableSegment(before, worldPoint(a), layout, footingRadius(crewBodies([a], layout)[0].radius))).toBe(true);
      expect(distance(before, worldPoint(a))).toBeLessThanOrEqual(.052501);
    }
    expect(a.state).toBe("sitting"); expect(distance(worldPoint(a), target)).toBeLessThan(.00001);
    const visit = a.breakVisit;
    a = syncCrew([a], layout, new Map([[a.id, a]]), now)[0];
    expect(a.breakVisit).toBe(visit); expect(a.state).toBe("sitting");
    a.status = "working"; advanceCrew([a], layout, now + 50, .05);
    expect(a.breakVisit).toBeUndefined(); expect(a.visiting).toBe(false);
    for (let i = 0; i < 8000 && a.route.length; i++) advanceCrew([a], layout, now + 100 + i * 50, .05);
    expect(distance(worldPoint(a), a.home)).toBeLessThan(.00001);
    expect(a.state).toBe("sitting"); expect(a.interactionTarget).toBe("desk");
  });
  it("waits for an occupied seat without circling it or sitting in somebody else", () => {
    const a = worker(), seat = 0, pose = breakSeatPose(layout, room, seat);
    Object.assign(a, canvasPoint(pose.approach));
    a.breakVisit = { cabinId: room.id, seat, action: "tea", outward: [pose.approach, pose.point] };
    a.route = [pose.point]; a.routeIndex = 0; a.visiting = true;
    const other = { id: "napping", deck: 0, radius: .43, position: pose.point };
    for (let i = 0; i < 60; i++) advanceCrew([a], layout, i * 50, .05, undefined, [other]);
    const waiting = worldPoint(a);
    expect(a.state).toBe("standing"); expect(a.route).toHaveLength(1);
    expect(distance(waiting, other.position)).toBeGreaterThanOrEqual(.85);
    for (let i = 0; i < 60; i++) advanceCrew([a], layout, 3000 + i * 50, .05, undefined, [other]);
    expect(worldPoint(a)).toEqual(waiting);
    for (let i = 0; i < 80 && a.route.length; i++) advanceCrew([a], layout, 6000 + i * 50, .05);
    expect(a.state).toBe("sitting"); expect(distance(worldPoint(a), pose.point)).toBeLessThan(.00001);
  });
  it("lets the CEO sit with the crew and then resume other actions", () => {
    const ceo = createCeoState(layout, 42); ceo.action = "window"; ceo.routine = 3; ceo.duration = 0;
    advanceCeo(ceo, layout, .05);
    expect(ceo.action).toBe("break"); expect(ceoBody(ceo).reservedSeat).toBeDefined();
    const target = breakSeatPose(layout, room, ceo.breakVisit!.seat).point;
    for (let i = 0; i < 10000 && ceo.route.length; i++) advanceCeo(ceo, layout, .05);
    expect(ceo.route).toHaveLength(0); expect(ceo.cabinId).toBe(room.id); expect(distance(ceo.position, target)).toBeLessThan(.00001);
    ceo.duration = 0; advanceCeo(ceo, layout, .05);
    expect(ceo.breakVisit).toBeUndefined(); expect(ceo.action).toBe("patrol");
    for (let i = 0; i < 10000 && ceo.route.length; i++) {
      const before = { ...ceo.position }; advanceCeo(ceo, layout, .05);
      expect(walkableSegment(before, ceo.position, layout, footingRadius(ceo.radius))).toBe(true);
    }
    expect(ceo.route).toHaveLength(0); expect(ceo.cabinId).not.toBe(room.id);
  });
  it("gives tea, coffee, snacks and conversation distinct reusable poses", () => {
    const figure = createDuckCrewFigure(normalizeDuckAppearance(undefined));
    try {
      const initial = figure.root.children.length, poses = new Set<string>();
      for (const action of BREAK_ACTIONS) {
        applyBreakPose(figure, action, 2);
        poses.add(JSON.stringify(figure.wings.map(w => [w.rotation.x, w.rotation.z])));
      }
      expect(poses.size).toBeGreaterThanOrEqual(3); expect(figure.root.children.length).toBe(initial);
    } finally { figure.dispose(); }
  });
  it("builds a safe route to every chair from the worker's desk", () => {
    for (let i = 0; i < 4; i++) {
      const route = routeToBreakSeat(layout, layout.seats.worker, room, i);
      for (let n = 1; n < route.length; n++) expect(walkableSegment(route[n - 1], route[n], layout, .4)).toBe(true);
    }
  });
});
