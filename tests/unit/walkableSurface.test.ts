import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildShipLayout, cabinAngle, shipDeck, shipPoint, SHIP_CORRIDOR_START, SHIP_CORRIDOR_WIDTH, type ShipLayout, type ShipPoint } from "@/features/ring-ship/layout";
import { cabinDeck } from "@/features/ring-ship/shell-shapes";
import { footingRadius, isWalkable, walkableSegment } from "@/features/ring-ship/walkableSurface";
import { moveCharacter } from "@/features/ring-ship/characterCollision";
import { advanceCompanion, companionBody, createCompanionState } from "@/features/ring-ship/companionMotion";
import { advanceKirby, createKirbyState } from "@/features/ring-ship/kirbyMotion";
import { advanceCrew, canvasPoint, crewBodies, syncCrew, worldPoint } from "@/features/ring-ship/crewMotion";

const layout = shipDeck(buildShipLayout({ projects: [{ id: "p", name: "P" }], members: [{ id: "crew", projectId: "p" }] }), 0);

// Ground truth is the rendered floor mesh, independent of the navigation check.
function renderedFloor(layout: ShipLayout) {
  const meshes: THREE.Mesh[] = [], material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const step = Math.PI * 2 / layout.allocation.sectors;
  for (const cabin of layout.cabins) {
    const ring = layout.rings[cabin.ring];
    const opening = cabin.kind === "return" ? { ...shipPoint(ring.radius + 1.8, cabinAngle(layout, cabin.slot)), radius: 1.02 } : undefined;
    meshes.push(new THREE.Mesh(cabinDeck(ring.radius, ring.depth / 2, cabin.slot * step, (cabin.slot + 1) * step, opening), material));
  }
  for (const angle of layout.spokes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(SHIP_CORRIDOR_WIDTH, .22, layout.radius - SHIP_CORRIDOR_START), material);
    const p = shipPoint((layout.radius + SHIP_CORRIDOR_START) / 2, angle);
    mesh.position.set(p.x, -.08, p.z); mesh.rotation.y = angle; meshes.push(mesh);
  }
  meshes.forEach(mesh => mesh.updateMatrixWorld(true));
  const ray = new THREE.Raycaster(undefined, new THREE.Vector3(0, -1, 0));
  return {
    supports(point: ShipPoint, radius = 0) {
      for (let i = 0; i < (radius ? 16 : 1); i++) {
        const angle = i * Math.PI / 8;
        ray.ray.origin.set(point.x + radius * Math.sin(angle), 2, point.z + radius * Math.cos(angle));
        if (!ray.intersectObjects(meshes, false).length) return false;
      }
      return true;
    },
    dispose() { meshes.forEach(mesh => mesh.geometry.dispose()); material.dispose(); },
  };
}

describe("walking stays on the ship's actual floor", () => {
  it("respects narrow collars, bridge edges and the launch opening on its deck", () => {
    expect(isWalkable(shipPoint(14.6, Math.PI / 4), layout)).toBe(false);
    expect(isWalkable({ x: .65, z: 19 }, layout)).toBe(false);
    expect(isWalkable({ x: 0, z: 19 }, layout, .4)).toBe(true);
    const cabin = layout.cabins.find(c => c.kind === "return")!;
    const opening = shipPoint(43.8, cabinAngle(layout, cabin.slot));
    expect(isWalkable(opening, layout)).toBe(false);
    expect(isWalkable(opening, shipDeck(buildShipLayout({ projects: [], members: [] }), 1), 0, 1)).toBe(true);
  });
  it("rejects a shortcut through space even when both endpoints have floor", () => {
    const start = { x: 0, z: 19 }, end = shipPoint(26, .35);
    expect(isWalkable(start, layout)).toBe(true); expect(isWalkable(end, layout)).toBe(true);
    expect(walkableSegment(start, end, layout, .4)).toBe(false);
    const body = { id: "npc:kirby", position: start, radius: .8, deck: 0 };
    expect(moveCharacter(body, end, 20, [], false, layout)).toEqual(start);
  });
  it("recovers an existing space pose and keeps crowded patrols supported", () => {
    const floor = renderedFloor(layout), kirby = createKirbyState(layout, 22, .8);
    kirby.actor.position = { x: 1.3, z: 19 };
    const companions = [createCompanionState("cat", layout, 33, .4819), createCompanionState("dog", layout, 45, .5174), createCompanionState("bartender", layout, 65, 1.178)];
    try {
      for (let frame = 0; frame < 4800; frame++) {
        const bodies = () => [companionBody(kirby.actor), ...companions.map(companionBody)];
        advanceKirby(kirby, [], layout, frame * 50, .05, bodies());
        for (const actor of companions) advanceCompanion(actor, layout, .05, bodies());
        if (frame % 10 === 0) for (const body of bodies()) expect(floor.supports(body.position, footingRadius(body.radius))).toBe(true);
      }
    } finally { floor.dispose(); }
  });
  it("keeps crew grounded when recovering a chat pose and walking between rings", () => {
    const crew = syncCrew([{ id: "crew", name: "Crew", color: "#abc", item: "", status: "idle" }], layout, new Map(), 0);
    const floor = renderedFloor(layout), agent = crew[0];
    try {
      Object.assign(agent, canvasPoint({ x: 1.4, z: 19 }));
      advanceCrew(crew, layout, 0, .05, agent.id);
      expect(floor.supports(worldPoint(agent), .4)).toBe(true);
      Object.assign(agent, canvasPoint(agent.home)); agent.pauseUntil = 0;
      const rings = new Set<number>();
      for (let frame = 0; frame < 10000; frame++) {
        advanceCrew(crew, layout, frame * 50, .05);
        const point = worldPoint(agent);
        if (frame % 10 === 0) expect(floor.supports(point, .4)).toBe(true);
        for (const ring of layout.rings) if (Math.abs(Math.hypot(point.x, point.z) - ring.radius) < 1) rings.add(ring.index);
      }
      expect(rings.size).toBeGreaterThan(1);
    } finally { floor.dispose(); }
  });
  it("returns an inhaled employee to supported ground at a bridge junction", () => {
    const crew = syncCrew([{ id: "crew", name: "Crew", color: "#abc", item: "", status: "idle" }], layout, new Map(), 0);
    const kirby = createKirbyState(layout, 3, .8), floor = renderedFloor(layout);
    kirby.actor.position = { x: 0, z: 14 }; kirby.actor.facing = 0;
    Object.assign(crew[0], canvasPoint({ x: 0, z: 15.3 }));
    const tick = (now: number) => advanceKirby(kirby, crew, layout, now, .016, [...crewBodies(crew, layout), companionBody(kirby.actor)]);
    try {
      tick(0); tick(1200); expect(kirby.phase).toBe("holding");
      tick(16200); tick(17000);
      expect(kirby.victim).toBeNull(); expect(crew[0].kirbyPose).toBeUndefined();
      expect(floor.supports(worldPoint(crew[0]), .4)).toBe(true);
      expect(Math.hypot(worldPoint(crew[0]).x - kirby.actor.position.x, worldPoint(crew[0]).z - kirby.actor.position.z)).toBeGreaterThan(1.2);
    } finally { floor.dispose(); }
  });
});
