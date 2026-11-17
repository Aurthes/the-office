import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import type { RootState } from "@react-three/fiber";
import { CameraRig } from "@/features/ring-ship/RingShipOffice";
import { shipCameraPose } from "@/features/ring-ship/cameraPose";
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

it.each([[1280,900],[390,844]])("frames the real control center on %sx%s and preserves manual input across roster refresh", (width,height) => {
  const s=setup();harness.state.size={...harness.state.size,width,height};
  const cabin=layout.cabins.find(c=>c.kind==="monitor")!;
  const focus={id:cabin.id,request:1},props={...s.props,focus,objectFocus:null};
  s.view.rerender(createElement(CameraRig,props));s.frames(150);
  const boundsPose=shipCameraPose(layout,width,height,0,false,cabin.id);
  expect(s.controls.target.distanceTo(boundsPose.target)).toBeLessThan(.02);
  expect(s.camera.zoom).toBeCloseTo(boundsPose.zoom,2);
  expect(s.camera.zoom).toBeGreaterThan(shipCameraPose(layout,width,height,0).zoom*2);
  s.controls.dispatchEvent({type:"start",target:s.controls});s.camera.zoom*=1.3;s.camera.position.add(new THREE.Vector3(3,1,-2));
  const position=s.camera.position.clone(),zoom=s.camera.zoom;
  const refreshed=shipDeck(buildShipLayout({projects:[{id:"p",name:"Project"}],members:[]},layout.allocation),0);
  s.view.rerender(createElement(CameraRig,{...props,layout:refreshed}));s.frames(150);
  expect(s.camera.position.distanceTo(position)).toBeLessThan(1e-8);expect(s.camera.zoom).toBe(zoom);
  s.view.rerender(createElement(CameraRig,{...props,layout:refreshed,whole:true}));s.frames(150);
  expect(s.camera.zoom).toBeCloseTo(shipCameraPose(refreshed,width,height,0,true).zoom,2);
  s.view.rerender(createElement(CameraRig,{...props,layout:refreshed,focus:{...focus,request:2}}));s.frames(150);
  expect(s.camera.zoom).toBeCloseTo(shipCameraPose(refreshed,width,height,0,false,cabin.id).zoom,2);
});

it("restores the manual view after chatting and does not reframe it on the next roster refresh",()=>{
 const s=setup(),cabin=layout.cabins.find(c=>c.kind==="monitor")!,focus={id:cabin.id,request:1};
 const roster={projects:[{id:"p",name:"P"}],members:[{id:"a",projectId:"p"}]};const hydrated=buildShipLayout(roster,layout.allocation);
 const props={...s.props,layout:hydrated,focus,objectFocus:null};s.view.rerender(createElement(CameraRig,props));s.frames(150);
 s.controls.dispatchEvent({type:"start",target:s.controls});s.camera.zoom=29;s.camera.position.add(new THREE.Vector3(2,1,4));const position=s.camera.position.clone(),target=s.controls.target.clone();
 s.view.rerender(createElement(CameraRig,{...props,chatAgentId:"a"}));s.frames(150);expect(s.controls.target.distanceTo(target)).toBeGreaterThan(1);
 s.view.rerender(createElement(CameraRig,props));s.frames(150);expect(s.camera.zoom).toBeCloseTo(29,2);
 s.view.rerender(createElement(CameraRig,{...props,layout:buildShipLayout({...roster,projects:[{id:"p",name:"Renamed"}]},hydrated.allocation)}));s.frames(150);
 expect(s.camera.position.distanceTo(position)).toBeLessThan(.04);expect(s.controls.target.distanceTo(target)).toBeLessThan(.04);expect(s.camera.zoom).toBeCloseTo(29,2);
});
