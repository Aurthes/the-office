// @vitest-environment node
import fs from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createKirbyFigure } from "@/features/ring-ship/kirbyFigure";
import { createKirbyState } from "@/features/ring-ship/kirbyMotion";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";
import { FIREFIGHTER_DUCK_APPEARANCE, normalizeDuckAppearance } from "@/lib/avatars/duck";

let source: GLTF;
beforeAll(async () => {
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1024, height: 1024, close() {} }));
  const bytes = await fs.readFile("public/office-assets/models/companions/kirby.glb");
  source = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
});
afterAll(() => vi.unstubAllGlobals());
function canvas() {
  const context = Object.fromEntries(["save", "restore", "clearRect", "scale", "translate", "fillRect", "beginPath", "ellipse", "fill", "stroke", "moveTo", "quadraticCurveTo"].map(name => [name, vi.fn()]));
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}
it("uses the actual low-poly Kirby skeleton and restores copied crew colors/equipment without modifying the cached asset", () => {
  const original: THREE.SkinnedMesh[] = []; source.scene.traverse(node => { if (node instanceof THREE.SkinnedMesh) original.push(node); });
  expect(original).toHaveLength(2);
  expect(original.reduce((count, mesh) => count + mesh.geometry.index!.count / 3, 0)).toBeLessThan(6000);
  const figure = createKirbyFigure(source, canvas), layout = shipDeck(buildShipLayout({ projects: [], members: [] }), 0), state = createKirbyState(layout, 1);
  const meshes: THREE.SkinnedMesh[] = []; figure.root.traverse(node => { if (node instanceof THREE.SkinnedMesh) meshes.push(node); });
  expect(meshes[0].geometry).toBe(original[0].geometry); expect(meshes[0].skeleton).not.toBe(original[0].skeleton);
  expect(meshes[0].material).not.toBe(original[0].material);
  const originalMap = (original[0].material as THREE.MeshStandardMaterial).map;
  expect((meshes[0].material as THREE.MeshStandardMaterial).map).not.toBe(originalMap);
  const appearance = normalizeDuckAppearance(FIREFIGHTER_DUCK_APPEARANCE);
  state.phase = "holding"; state.victim = { id: "idle", name: "Idle", appearance, origin: { x: 0, z: 12 }, landing: { x: 0, z: 12 } };
  figure.animate(state, 1);
  expect(figure.copied.value).toBe(1); expect(figure.bodyColor.value.getHexString()).toBe(appearance.featherColor.slice(1));
  expect(figure.root.getObjectByName("kirby-copied-equipment")?.getObjectByName("firefighter-helmet")).toBeTruthy();
  expect(figure.root.getObjectByName("firefighter-air-tank")).toBeTruthy();
  state.phase = "wander"; state.victim = null; figure.animate(state, 2);
  expect(figure.copied.value).toBe(0); expect(figure.root.getObjectByName("kirby-copied-equipment")).toBeUndefined();
  expect((original[0].material as THREE.MeshStandardMaterial).map).toBe(originalMap);
  const dispose = vi.spyOn(original[0].geometry, "dispose"); figure.dispose(); expect(dispose).not.toHaveBeenCalled(); dispose.mockRestore();
});
