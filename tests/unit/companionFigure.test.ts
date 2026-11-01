// @vitest-environment node
import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createBartenderRig } from "@/features/ring-ship/bartenderRig";
import { createCompanionFigure } from "@/features/ring-ship/companionFigure";
import { createCompanionState } from "@/features/ring-ship/companionMotion";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";

let bartender: GLTF, cat: GLTF;
beforeAll(async () => {
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close() {} }));
  const load = async (name: string) => {
    const bytes = await fs.readFile(`public/office-assets/models/companions/${name}.glb`);
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  };
  [bartender, cat] = await Promise.all([load("core-bartender"), load("cat")]);
});
afterAll(() => vi.unstubAllGlobals());

it("articulates the real bartender mesh while retaining its materials, triangle count and source geometry", () => {
  const rig = createBartenderRig(bartender.scene, 1.35), original: THREE.Mesh[] = [], moving: THREE.SkinnedMesh[] = [];
  bartender.scene.traverse(node => { if (node instanceof THREE.Mesh) original.push(node); });
  rig.group.traverse(node => { if (node instanceof THREE.SkinnedMesh) moving.push(node); });
  expect(moving).toHaveLength(original.length);
  expect(moving.map(mesh => mesh.material)).toEqual(original.map(mesh => mesh.material));
  expect(moving.reduce((n, mesh) => n + mesh.geometry.index!.count, 0)).toBe(original.reduce((n, mesh) => n + mesh.geometry.index!.count, 0));
  expect(original.every(mesh => !mesh.geometry.getAttribute("skinIndex"))).toBe(true);
  expect(new Set(moving.map(mesh => mesh.skeleton)).size).toBe(1);
  const mesh = moving.find(mesh => Array.from(mesh.geometry.getAttribute("skinIndex").array).includes(2))!;
  const skin = mesh.geometry.getAttribute("skinIndex"), vertex = Array.from({ length: skin.count }, (_, i) => i).find(i => skin.getX(i) === 2)!;
  rig.group.updateMatrixWorld(true); mesh.skeleton.update();
  const before = mesh.getVertexPosition(vertex, new THREE.Vector3());
  const targets = rig.arms.map(arm => arm.hand.getWorldPosition(new THREE.Vector3()).lerp(arm.origin, .25).add(new THREE.Vector3(.02, .03, .02)));
  for (let i = 0; i < 180; i++) { rig.pose(0, targets[0], 1 / 60); rig.pose(1, targets[1], 1 / 60); }
  rig.group.updateMatrixWorld(true); mesh.skeleton.update();
  for (let i = 0; i < 2; i++) expect(rig.arms[i].hand.getWorldPosition(new THREE.Vector3()).distanceTo(targets[i])).toBeLessThan(.001);
  expect(mesh.getVertexPosition(vertex, new THREE.Vector3()).distanceTo(before)).toBeGreaterThan(.02);
  rig.dispose();
});

it("lets the real cat lie down, stretch and return to its authored pose without accumulating offsets", () => {
  const figure = createCompanionFigure(cat, "cat", .62), layout = shipDeck(buildShipLayout({ projects: [], members: [] }), 0);
  const state = createCompanionState("cat", layout, 1), body = figure.normalized.getObjectByName("body")!;
  figure.animate(state, 1 / 60); const standing = body.position.y;
  state.action = "sleep";
  for (let i = 0; i < 300; i++) { state.time += 1 / 60; figure.animate(state, 1 / 60); }
  expect(body.position.y).toBeLessThan(standing - .1); expect(body.position.y).toBeGreaterThan(standing - .35);
  state.action = "stretch"; state.time = state.duration / 2;
  for (let i = 0; i < 90; i++) figure.animate(state, 1 / 60);
  expect(body.scale.z).toBeGreaterThan(1.08);
  state.action = "idle";
  for (let i = 0; i < 180; i++) figure.animate(state, 1 / 60);
  expect(body.position.y).toBeCloseTo(standing, 1); expect(body.scale.z).toBeCloseTo(1, 2);
  figure.dispose();
});
