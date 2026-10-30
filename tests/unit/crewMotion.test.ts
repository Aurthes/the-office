import { describe, expect, it } from "vitest";
import { advanceCrew, canvasPoint, hash, worldPoint, type MovingAgent } from "@/features/ring-ship/crewMotion";
import { buildShipLayout, routeBetweenCabins, shipDeck, type ShipLayout, type ShipPoint } from "@/features/ring-ship/layout";

const DT = 1 / 60;
function fixture() {
  let id = "";
  for (let i = 0; ; i++) {
    id = `runner-${i}`;
    // On L1, the second amenity in the existing deterministic roam order is the garden.
    if (hash(id) % 5 === 1) break;
  }
  const layout = shipDeck(buildShipLayout({ projects: [{ id: "p", name: "Project" }], members: [{ id, projectId: "p" }] }), 0);
  const seat = layout.seats[id], home = { x: seat.x, z: seat.z }, point = canvasPoint(home);
  const agent = { id, name: id, status: "idle", color: "#abc", item: "", ...point, targetX: point.x, targetY: point.y,
    path: [], facing: seat.facing, frame: 0, state: "standing", walkSpeed: 1, phaseOffset: 0,
    home, route: [], routeIndex: 0, visiting: false, pauseUntil: 0 } as MovingAgent;
  return { layout, agent };
}
function distance(a: ShipPoint, b: ShipPoint) { return Math.hypot(a.x - b.x, a.z - b.z); }
function onWalkway(layout: ShipLayout, point: ShipPoint) {
  return layout.rings.some(r => Math.abs(Math.hypot(point.x, point.z) - r.radius) <= r.depth / 2 + 0.02)
    || layout.spokes.some(a => Math.abs(point.x * Math.cos(a) - point.z * Math.sin(a)) < 0.63);
}
function step(agent: MovingAgent, layout: ShipLayout, frames = 1, chat?: string) {
  for (let i = 0; i < frames; i++) advanceCrew([agent], layout, 1000 + i * 1000 * DT, DT, chat);
}
function runHome(agent: MovingAgent, layout: ShipLayout) {
  let frames = 0;
  while (distance(worldPoint(agent), agent.home) > 0.001 && frames < 6000) {
    const before = worldPoint(agent); step(agent, layout); const after = worldPoint(agent);
    expect(distance(before, after)).toBeLessThanOrEqual(2.1 * DT + 0.000001);
    expect(onWalkway(layout, after)).toBe(true);
    frames++;
  }
  expect(frames).toBeLessThan(6000);
  expect(distance(worldPoint(agent), agent.home)).toBeLessThan(0.001);
  expect(agent.state).toBe("sitting"); expect(agent.interactionTarget).toBe("desk");
}

describe("crew job arrival", () => {
  it("turns around mid-walk and jogs home continuously, then sits and types", () => {
    const { agent, layout } = fixture(); step(agent, layout, 140);
    const before = worldPoint(agent); expect(distance(before, agent.home)).toBeGreaterThan(1);
    agent.status = "working"; step(agent, layout);
    expect(distance(before, worldPoint(agent))).toBeLessThanOrEqual(2.1 * DT + 0.000001);
    expect(agent.state).toBe("walking"); expect(agent.walkSpeed).toBe(2); expect(agent.interactionTarget).toBeUndefined();
    runHome(agent, layout); expect(agent.facing).toBe(layout.seats[agent.id].facing);
  });
  it("retraces the existing corridor when interrupted between rings", () => {
    const { agent, layout } = fixture();
    for (let i = 0; i < 6000; i++) {
      step(agent, layout);
      const radius = Math.hypot(worldPoint(agent).x, worldPoint(agent).z);
      if (radius > 17 && radius < 20) break;
    }
    const before = worldPoint(agent); expect(Math.hypot(before.x, before.z)).toBeGreaterThan(17);
    const visited = agent.route.slice(0, agent.routeIndex);
    agent.status = "working"; step(agent, layout);
    expect(agent.route).toEqual(visited.reverse().concat([agent.home]));
    runHome(agent, layout);
  });
  it("can return after reaching and resting in the public garden", () => {
    const { agent, layout } = fixture(); step(agent, layout);
    for (let i = 0; i < 6000 && agent.route.length; i++) step(agent, layout);
    expect(agent.visiting).toBe(true); expect(distance(worldPoint(agent), agent.home)).toBeGreaterThan(10);
    const before = worldPoint(agent); agent.status = "working"; step(agent, layout);
    expect(distance(before, worldPoint(agent))).toBeLessThanOrEqual(2.1 * DT + 0.000001);
    runHome(agent, layout);
  });
  it("keeps the remaining route when already walking back", () => {
    const { agent, layout } = fixture();
    const garden = layout.cabins.find(c => c.kind === "garden")!;
    const outward = routeBetweenCabins(layout, layout.seats[agent.id], garden);
    Object.assign(agent, canvasPoint(outward.at(-1)!)); agent.route = outward.slice().reverse().concat([agent.home]);
    agent.visiting = false; step(agent, layout, 100);
    const remaining = agent.route.slice(agent.routeIndex); agent.status = "working"; step(agent, layout);
    expect(agent.route.slice(agent.routeIndex)).toEqual(remaining); runHome(agent, layout);
  });
  it.each(["error", "needsInput"])("does not warp if %s arrives before the duck reaches its desk", alert => {
    const { agent, layout } = fixture(); step(agent, layout, 140); agent.status = "working"; step(agent, layout);
    if (alert === "error") agent.status = "error"; else agent.needsInput = true;
    const before = worldPoint(agent); step(agent, layout);
    expect(distance(before, worldPoint(agent))).toBeLessThanOrEqual(2.1 * DT + 0.000001); runHome(agent, layout);
  });
  it("pauses an idle conversation in place but starts the return as soon as work begins", () => {
    const { agent, layout } = fixture(); step(agent, layout, 140); const before = worldPoint(agent);
    step(agent, layout, 30, agent.id); expect(worldPoint(agent)).toEqual(before);
    agent.status = "working"; step(agent, layout, 2, agent.id);
    expect(agent.state).toBe("walking"); expect(distance(worldPoint(agent), before)).toBeGreaterThan(0);
  });
});
