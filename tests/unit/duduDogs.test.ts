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
      figure.root.traverse(node => {
        expect(node instanceof THREE.Light).toBe(false);
        if (node instanceof THREE.Mesh) {
          triangles += (node.geometry.index?.count || node.geometry.getAttribute("position").count) / 3;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            expect(material.transparent).toBe(false);
            if (material instanceof THREE.MeshStandardMaterial) expect(material.bumpMap).toBeNull();
          }
        }
      });
      expect(triangles).toBeLessThan(30000);
      for (const interaction of [undefined, "boop", "highFive", "cuddle", "chase"] as const) for (let i = 0; i <= 20; i++) {
        figure.animate(dog, i * .3, interaction === "chase", interaction, i / 20); figure.root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(figure.root, true);
        expect(figure.bounds.containsBox(bounds)).toBe(true); poses.add(figure.root.children[1].matrixWorld.elements.join(","));
      }
      expect(poses.size).toBeGreaterThan(10);
    } finally { figure.dispose(); }
  });
  it.each(["dumu", "dufu"] as const)("keeps a round %s head and four planted paws, and smoothly changes posture", kind => {
    const figure = createDuduFigure(kind), dog = createDuduState(layout, 1).dogs[kind === "dumu" ? 0 : 1];
    try {
      figure.animate(dog, 0, false, undefined, 0, "quadruped"); figure.root.updateMatrixWorld(true);
      const head = new THREE.Box3().setFromObject(figure.root.getObjectByName("round-head")!, true).getSize(new THREE.Vector3());
      expect(head.z / head.x).toBeGreaterThan(.8);
      const mesh = figure.root.getObjectByName("sculpted-body") as THREE.SkinnedMesh;
      const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
      const bottoms = [Infinity, Infinity, Infinity, Infinity], left = [...bottoms], right = bottoms.map(() => -Infinity), vertex = new THREE.Vector3();
      const profiles = [.08, .17].map(y => ({ y, legs: Array.from({ length: 4 }, () => ({ front: -Infinity, back: Infinity, left: Infinity, right: -Infinity })) }));
      for (let i = 0; i < indices.count; i++) if (indices.getX(i) >= 2 && weights.getX(i) > .5) {
        mesh.getVertexPosition(i, vertex);
        for (const profile of profiles) if (Math.abs(vertex.y - profile.y) < .012) {
          const leg = profile.legs[indices.getX(i) - 2]; leg.front = Math.max(leg.front, vertex.z); leg.back = Math.min(leg.back, vertex.z);
          leg.left = Math.min(leg.left, vertex.x); leg.right = Math.max(leg.right, vertex.x);
        }
      }
      for (let i = 0; i < 4; i++) {
        const lower = profiles[0].legs[i], upper = profiles[1].legs[i];
        // Upper legs must stay fuller than lower legs from both front and side.
        const taper = i >= 2 ? 1.25 : 1.02;
        expect(upper.front - upper.back).toBeGreaterThan((lower.front - lower.back) * taper);
        expect(upper.right - upper.left).toBeGreaterThan((lower.right - lower.left) * taper);
        if (i >= 2) {
          // Rear thighs must also be fuller than forelegs, not just their own calves.
          const fore = profiles[1].legs[i - 2];
          expect(upper.front - upper.back).toBeGreaterThan((fore.front - fore.back) * 1.05);
          expect(upper.right - upper.left).toBeGreaterThan((fore.right - fore.left) * 1.05);
        }
      }
      for (let i = 0; i < indices.count; i++) if (indices.getX(i) >= 2 && weights.getX(i) > .8) {
        mesh.getVertexPosition(i, vertex); const paw = indices.getX(i) - 2; bottoms[paw] = Math.min(bottoms[paw], vertex.y);
        if (vertex.y < .08) { left[paw] = Math.min(left[paw], vertex.x); right[paw] = Math.max(right[paw], vertex.x); }
      }
      for (const y of bottoms) { expect(y).toBeGreaterThanOrEqual(-.02); expect(y).toBeLessThan(.035); }
      const widths = left.map((x, i) => right[i] - x);
      expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(1.25);
      let previous = figure.root.userData.posture;
      for (let frame = 1; frame <= 40; frame++) {
        figure.animate(dog, frame * .05, false, undefined, 0, "upright"); figure.root.updateMatrixWorld(true);
        const current = figure.root.userData.posture;
        expect(Math.abs(current - previous)).toBeLessThan(.31); previous = current;
        expect(figure.bounds.containsBox(new THREE.Box3().setFromObject(figure.root, true))).toBe(true);
      }
      expect(previous).toBeLessThan(.001);
    } finally { figure.dispose(); }
  });
  it.each(["dumu", "dufu"] as const)("keeps the %s torso proportioned and level, with its tail inside the rump through posture changes", kind => {
    const figure = createDuduFigure(kind), dog = createDuduState(layout, 1).dogs[kind === "dumu" ? 0 : 1];
    try {
      figure.animate(dog, 0, false, undefined, 0, "quadruped"); figure.root.updateMatrixWorld(true);
      const mesh = figure.root.getObjectByName("sculpted-body") as THREE.SkinnedMesh;
      const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight"), vertex = new THREE.Vector3();
      const torso = new THREE.Box3(), back = [-.25, -.1, .03].map(z => ({ z, top: -Infinity }));
      for (let i = 0; i < indices.count; i++) if (indices.getX(i) === 0 && weights.getX(i) > .8) {
        mesh.getVertexPosition(i, vertex); torso.expandByPoint(vertex);
        for (const section of back) if (Math.abs(vertex.z - section.z) < .02) section.top = Math.max(section.top, vertex.y);
      }
      const size = torso.getSize(new THREE.Vector3());
      expect(size.z / size.y).toBeGreaterThan(1.4); expect(size.z / size.y).toBeLessThan(1.7);
      const head = new THREE.Box3().setFromObject(figure.root.getObjectByName("round-head")!, true).getSize(new THREE.Vector3());
      expect(size.y / head.y).toBeGreaterThan(.65); expect(size.y / head.y).toBeLessThan(.8);
      const heights = back.map(section => section.top);
      expect(heights.every(Number.isFinite)).toBe(true);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(.04);
      const material = mesh.material as THREE.MeshStandardMaterial; material.side = THREE.DoubleSide;
      const ray = new THREE.Raycaster(), socket = new THREE.Vector3();
      for (let frame = 0; frame <= 60; frame++) {
        figure.animate(dog, frame * .05, true, undefined, 0, frame < 30 ? "upright" : "quadruped"); figure.root.updateMatrixWorld(true);
        mesh.computeBoundingSphere(); figure.root.getObjectByName("tail")!.getWorldPosition(socket);
        ray.set(socket, new THREE.Vector3(1, 0, 0));
        const hits = ray.intersectObject(mesh, false).map(hit => hit.distance).filter((distance, i, all) => i === 0 || distance - all[i - 1] > 1e-5);
        // A ray from an embedded tail root exits the closed body once.
        expect(hits).toHaveLength(1); expect(hits[0]).toBeGreaterThan(.04);
      }
    } finally { figure.dispose(); }
  });
  it.each(["upright", "quadruped"] as const)("keeps 嘟父's collar visible and close to its neck in the %s pose", posture => {
    const figure = createDuduFigure("dufu"), dog = createDuduState(layout, 1).dogs[1];
    try {
      figure.animate(dog, 0, false, undefined, 0, posture); figure.root.updateMatrixWorld(true);
      const head = figure.root.getObjectByName("head-joint")!, collar = figure.root.getObjectByName("red-collar") as THREE.Mesh;
      const band = new THREE.Box3().setFromBufferAttribute(collar.geometry.getAttribute("position") as THREE.BufferAttribute);
      const origin = new THREE.Vector3(0, (band.min.y + band.max.y) / 2, 1).applyMatrix4(head.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(head.matrixWorld);
      const hits = new THREE.Raycaster(origin, direction).intersectObject(figure.root, true);
      expect(hits[0]?.object).toBe(collar);
      expect(hits[1]?.distance - hits[0]?.distance).toBeLessThan(.03);
    } finally { figure.dispose(); }
  });
});
