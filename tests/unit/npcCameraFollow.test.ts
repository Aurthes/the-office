import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import type { RootState } from "@react-three/fiber";
import { CameraRig } from "@/features/ring-ship/RingShipOffice";
import { buildShipLayout, shipDeck } from "@/features/ring-ship/layout";
import { shipObjectCameraPose, type ShipObject } from "@/features/ring-ship/shipObjects";

const harness = vi.hoisted(() => ({
  state: undefined as unknown as RootState,
  frame: undefined as unknown as (state: RootState, delta: number) => void,
}));
vi.mock("@react-three/fiber", async importOriginal => ({
  ...await importOriginal<typeof import("@react-three/fiber")>(),
  useThree: () => harness.state,
  useFrame: (callback: typeof harness.frame) => { harness.frame = callback; },
}));

const disposers: Array<() => void> = [];
afterEach(() => { cleanup(); disposers.splice(0).forEach(dispose => dispose()); });
const layout = shipDeck(buildShipLayout({ projects: [], members: [] }), 0);
function setup(kind: "dumu" | "dufu" | "kirby" = "dumu", npc = true) {
  const camera = new THREE.OrthographicCamera(-640, 640, 430, -430, .1, 5000);
  camera.position.set(30, 50, 40); camera.zoom = 12;
  const canvas = document.createElement("canvas"), controls = new OrbitControls(camera, canvas);
  disposers.push(() => controls.dispose());
  harness.state = { camera, size: { width: 1280, height: 860 }, gl: { domElement: canvas } } as unknown as RootState;
  const object: ShipObject = { id: `npc:${kind}`, kind, deck: 0, cabinId: layout.cabins[0].id,
    cabinName: layout.cabins[0].name, bounds: new THREE.Box3(new THREE.Vector3(2, 0, 3), new THREE.Vector3(3, 1, 4)), parts: [],
    ...(npc ? { npc: { name: kind, activity: "Walking" } } : {}) };
  const pose = shipObjectCameraPose(object, 1280, 860, camera.position, controls.target);
  const props = { layout, focus: { id: "", request: 0 }, controlsRef: { current: controls }, lookupRef: { current: new Map() },
    deck: 0 as const, whole: false, busy: false, objectFocus: object as ShipObject | null };
  const view = render(createElement(CameraRig, props));
  const frames = (count = 1) => { for (let i = 0; i < count; i++) harness.frame(harness.state, 1 / 60); };
  return { camera, controls, object, pose, props, view, frames };
}

it.each(["dumu", "dufu", "kirby"] as const)("keeps following %s after orbiting, preserving the chosen angle and zoom", kind => {
  const { camera, controls, object, frames } = setup(kind); frames(120);
  controls.dispatchEvent({ type: "start", target: controls });
  camera.position.copy(controls.target).add(new THREE.Vector3(-12, 8, 5)); camera.zoom = 47; controls.update();
  const position = camera.position.clone(), target = controls.target.clone(), offset = position.clone().sub(target);
  const movement = new THREE.Vector3(1.5, .1, -2.5); object.bounds.translate(movement); frames();
  expect(camera.position.distanceTo(position.add(movement))).toBeLessThan(1e-8);
  expect(controls.target.distanceTo(target.add(movement))).toBeLessThan(1e-8);
  expect(camera.position.clone().sub(controls.target).distanceTo(offset)).toBeLessThan(1e-8);
  expect(camera.zoom).toBe(47);
});

it("keeps the initial focus aimed at a walking NPC", () => {
  const { camera, controls, object, pose, frames } = setup(); frames(3);
  const movement = new THREE.Vector3(-3, 0, 2); object.bounds.translate(movement); frames(180);
  expect(controls.target.distanceTo(pose.target.add(movement))).toBeLessThan(.001);
  expect(camera.position.distanceTo(pose.position.add(movement)) * camera.zoom).toBeLessThan(.5);
});

it("stops tracking the previous NPC when its information card is closed", () => {
  const { camera, controls, object, props, view, frames } = setup(); frames(120);
  view.rerender(createElement(CameraRig, { ...props, objectFocus: null })); controls.dispatchEvent({ type: "start", target: controls });
  const position = camera.position.clone(), target = controls.target.clone();
  object.bounds.translate(new THREE.Vector3(3, 0, 2)); frames();
  expect(camera.position).toEqual(position); expect(controls.target).toEqual(target);
});

it("still lets manual camera input interrupt a stationary object's focus", () => {
  const { camera, controls, object, frames } = setup("dumu", false); frames(3);
  controls.dispatchEvent({ type: "start", target: controls });
  const position = camera.position.clone(), target = controls.target.clone();
  object.bounds.translate(new THREE.Vector3(3, 0, 2)); frames();
  expect(camera.position).toEqual(position); expect(controls.target).toEqual(target);
});
