import { describe, expect, it } from "vitest";
import { moveCharacter, type CharacterBody } from "@/features/ring-ship/characterCollision";
import { advanceCrew, canvasPoint, crewBodies, worldPoint, type MovingAgent } from "@/features/ring-ship/crewMotion";
import { advanceCompanion, companionBody, createCompanionState } from "@/features/ring-ship/companionMotion";
import { buildShipLayout, shipDeck, shipPoint, type ShipPoint } from "@/features/ring-ship/layout";
import { footingRadius, isWalkable } from "@/features/ring-ship/walkableSurface";

const distance = (a: ShipPoint, b: ShipPoint) => Math.hypot(a.x - b.x, a.z - b.z);
function body(id: string, x: number, z: number, deck = 0): CharacterBody {
  return { id, position: { x, z }, radius: .41, deck };
}
function crewFixture(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `crew-${i}`);
  const layout = shipDeck(buildShipLayout({ projects: [{ id: "p", name: "P" }], members: ids.map(id => ({ id, projectId: "p" })) }), 0);
  const crew = ids.map(id => {
    const seat = layout.seats[id], point = canvasPoint(seat);
    return { id, name: id, status: "idle", color: "#abc", item: "", ...point, targetX: point.x, targetY: point.y,
      path: [], facing: 0, frame: 0, state: "standing", walkSpeed: 1, phaseOffset: 0,
      home: { x: seat.x, z: seat.z }, route: [], routeIndex: 0, visiting: false, pauseUntil: 0 } as MovingAgent;
  });
  return { crew, layout };
}
function expectSeparated(bodies: CharacterBody[]) {
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    if (bodies[i].deck === bodies[j].deck) expect(distance(bodies[i].position, bodies[j].position)).toBeGreaterThanOrEqual(bodies[i].radius + bodies[j].radius - 1e-6);
  }
}

describe("ship character collision volumes", () => {
  it.each([["two wide employees", .524, .524], ["an employee and Kirby", .524, .8], ["two large companions", .8, .8]] as const)("lets %s pass on every actual bridge without leaving the floor", (_, firstRadius, secondRadius) => {
    const { layout } = crewFixture(2);
    for (const angle of layout.spokes) {
      const start = shipPoint(16, angle), end = shipPoint(22, angle);
      const a = { ...body("a", start.x, start.z), radius: firstRadius }, b = { ...body("b", end.x, end.z), radius: secondRadius }, bodies = [a, b];
      for (let frame = 0; frame < 1200; frame++) {
        a.position = moveCharacter(a, end, .035, bodies, true, layout);
        b.position = moveCharacter(b, start, .035, bodies, true, layout);
        expectSeparated(bodies);
        for (const actor of bodies) expect(isWalkable(actor.position, layout, footingRadius(actor.radius))).toBe(true);
      }
      expect(distance(a.position, end)).toBeLessThan(.01);
      expect(distance(b.position, start)).toBeLessThan(.01);
    }
  });
  it("lets head-on walkers pass with no overlap or deadlock", () => {
    const a = body("a", -3, 0), b = body("b", 3, 0), bodies = [a, b];
    for (let i = 0; i < 600; i++) {
      a.position = moveCharacter(a, { x: 3, z: 0 }, .035, bodies);
      b.position = moveCharacter(b, { x: -3, z: 0 }, .035, bodies);
      expectSeparated(bodies);
    }
    expect(distance(a.position, { x: 3, z: 0 })).toBeLessThan(.01);
    expect(distance(b.position, { x: -3, z: 0 })).toBeLessThan(.01);
  });
  it("checks the whole step and ignores characters on other decks", () => {
    const a = body("a", -2, 0), obstacle = body("b", 0, 0);
    expect(moveCharacter(a, { x: 2, z: 0 }, 4, [a, obstacle], false)).toEqual(a.position);
    obstacle.deck = 1;
    expect(distance(moveCharacter(a, { x: 2, z: 0 }, 4, [a, obstacle], false), { x: 2, z: 0 })).toBeLessThan(1e-8);
  });
  it("recovers an existing overlap by moving away", () => {
    const a = body("a", 0, 0), b = body("b", .1, 0);
    const next = moveCharacter(a, { x: -2, z: 0 }, .035, [a, b]);
    expect(distance(next, b.position)).toBeGreaterThan(distance(a.position, b.position));
  });
  it("keeps a crowd apart when agents share an amenity destination", () => {
    const { crew, layout } = crewFixture(6);
    const target = { x: 12, z: 0 };
    crew.forEach((agent, i) => { Object.assign(agent, canvasPoint(shipPoint(12, Math.PI / 2 + (i - 2.5) * .12))); agent.route = [target]; agent.visiting = true; });
    for (let i = 0; i < 600; i++) { advanceCrew(crew, layout, 1000 + i * 16, .016); expectSeparated(crewBodies(crew, layout)); }
    expect(crew.every(agent => agent.route.length === 0)).toBe(true);
  });
  it("separates idle characters that start at the same location", () => {
    const { crew, layout } = crewFixture(2);
    crew.forEach(agent => { Object.assign(agent, canvasPoint({ x: 12, z: 0 })); agent.pauseUntil = Infinity; });
    for (let i = 0; i < 60; i++) advanceCrew(crew, layout, 1000, .016);
    expectSeparated(crewBodies(crew, layout));
  });
  it("makes NPCs avoid a stationary agent and each other while completing their routes", () => {
    const { crew, layout } = crewFixture(1), agent = crew[0];
    Object.assign(agent, canvasPoint({ x: -12, z: 0 })); agent.pauseUntil = Infinity;
    const cat = createCompanionState("cat", layout, 1), dog = createCompanionState("dog", layout, 2);
    Object.assign(cat, { position: { x: -12, z: -3 }, route: [{ x: -12, z: 3 }], waypoint: 0, duration: Infinity });
    Object.assign(dog, { position: { x: -12, z: 3 }, route: [{ x: -12, z: -3 }], waypoint: 0, duration: Infinity });
    const arrived = new Set<string>();
    for (let i = 0; i < 900; i++) {
      advanceCrew(crew, layout, i * 16, .016, agent.id, [companionBody(cat), companionBody(dog)]);
      for (const npc of [cat, dog]) { advanceCompanion(npc, layout, .016, [...crewBodies(crew, layout), companionBody(cat), companionBody(dog)]); if (!npc.route.length) arrived.add(npc.kind); }
      expectSeparated([...crewBodies(crew, layout), companionBody(cat), companionBody(dog)]);
    }
    expect(distance(worldPoint(agent), { x: -12, z: 0 })).toBeLessThan(1e-8);
    expect([...arrived].sort()).toEqual(["cat", "dog"]);
  });
});
