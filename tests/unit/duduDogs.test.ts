import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { advanceDudu, createDuduState, duduActivity } from "@/features/ring-ship/duduMotion";
import { createDuduFigure } from "@/features/ring-ship/duduFigure";
import { advanceCompanion, companionBody, createCompanionState } from "@/features/ring-ship/companionMotion";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";
import { footingRadius, isWalkable } from "@/features/ring-ship/walkableSurface";
import { ZH_CN } from "@/lib/i18n/messages";
const layout = shipDeck(buildShipLayout({ projects: [], members: [] }), 0);

describe("嘟母 and 嘟父", () => {
  it.each([1, 7, 42])("wander between cabins and complete all four duets with floor support and no overlaps (seed %s)", seed => {
    const state = createDuduState(layout, seed), interactions = new Set<string>(), rooms = new Set<string>();
    for (let frame = 0; frame < 18000; frame++) {
      const before = state.dogs.map(dog => ({ ...dog.position }));
      advanceDudu(state, layout, .05);
      if (state.phase === "play") interactions.add(state.interaction);
      state.dogs.forEach((dog, i) => {
        rooms.add(dog.cabinId);
        expect(isWalkable(dog.position, layout, footingRadius(dog.radius))).toBe(true);
        expect(Math.hypot(dog.position.x - before[i].x, dog.position.z - before[i].z)).toBeLessThanOrEqual(.083);
        expect(ZH_CN[duduActivity(state, i)]).toBeTruthy();
      });
      const [a, b] = state.dogs;
      expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
    }
    expect([...interactions].sort()).toEqual(["boop", "chase", "cuddle", "highFive"]);
    expect(rooms.size).toBeGreaterThan(1);
  });
  it("starts a shared greeting promptly and freezes its whole routine when paused", () => {
    const state = createDuduState(layout, 4);
    const original = structuredClone(state); advanceDudu(state, layout, 0); expect(state).toEqual(original);
    let greeted = false;
    for (let frame = 0; frame < 160; frame++) { advanceDudu(state, layout, .05); greeted ||= state.phase === "play"; }
    expect(greeted).toBe(true);
    const clock = state.clock; advanceDudu(state, layout, 120); expect(state.clock - clock).toBeCloseTo(.05);
  });
  it("keeps its collision volumes away from the existing moving companions", () => {
    const state = createDuduState(layout, 42), others = [createCompanionState("cat", layout, 13), createCompanionState("dog", layout, 22), createCompanionState("kirby", layout, 31, .8)];
    for (let frame = 0; frame < 9000; frame++) {
      const bodies = () => [...state.dogs, ...others].map(companionBody);
      advanceDudu(state, layout, .05, bodies());
      for (const other of others) advanceCompanion(other, layout, .05, bodies());
      for (const dog of state.dogs) for (const other of others) expect(Math.hypot(dog.position.x - other.position.x, dog.position.z - other.position.z)).toBeGreaterThanOrEqual(dog.radius + other.radius - 1e-6);
    }
  });
  it.each(["dumu", "dufu"] as const)("has a bounded, articulated %s figure without external assets or extra lights", kind => {
    const figure = createDuduFigure(kind), state = createDuduState(layout, 1), dog = state.dogs[kind === "dumu" ? 0 : 1];
    const poses = new Set<string>(); let triangles = 0;
    try {
      figure.root.traverse(node => { expect(node instanceof THREE.Light).toBe(false); if (node instanceof THREE.Mesh) triangles += (node.geometry.index?.count || node.geometry.getAttribute("position").count) / 3; });
      expect(triangles).toBeLessThan(30000);
      for (const interaction of [undefined, "boop", "highFive", "cuddle", "chase"] as const) for (let i = 0; i <= 20; i++) {
        figure.animate(dog, i * .3, interaction === "chase", interaction, i / 20); figure.root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(figure.root);
        expect(figure.bounds.containsBox(bounds)).toBe(true); poses.add(figure.root.children[1].matrixWorld.elements.join(","));
      }
      expect(poses.size).toBeGreaterThan(10);
    } finally { figure.dispose(); }
  });
});
