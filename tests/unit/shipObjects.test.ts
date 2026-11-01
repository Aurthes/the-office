import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Builder, buildShipGeometry, disposeShipGeometry, SHIP_MODELS } from "@/features/ring-ship/geometry";
import { buildShipLayout, DECK_STEP, shipDeck } from "@/features/ring-ship/layout";
import { SHIP_OBJECT_INFO, SHIP_OBJECT_NOTES, shipObjectAtHit, shipObjectCameraPose, shipObjectHighlight, type ShipObject } from "@/features/ring-ship/shipObjects";
import { ZH_CN } from "@/lib/i18n/messages";

afterEach(() => vi.restoreAllMocks());
const cabin = shipDeck(buildShipLayout({ projects: [], members: [] }), 0).cabins[0];
function pick(group: THREE.Group, x: number) {
  group.updateMatrixWorld(true);
  const hit = new THREE.Raycaster(new THREE.Vector3(x, 10, 0), new THREE.Vector3(0, -1, 0)).intersectObject(group)[0];
  return hit ? shipObjectAtHit(hit.object, hit.faceIndex) : null;
}
describe("individually interactive batched ship props", () => {
  it("picks individual props through real triangle hits without selecting the floor or splitting material batches", () => {
    const b = new Builder({}); b.cabin = cabin;
    b.box([20, .1, 4], [0, -.1, 0], "#ffffff");
    b.object("crate", () => b.box([1, 1, 1], [-3, .5, 0], "#ffffff"));
    b.box([1, .1, 1], [0, 0, 0], "#ffffff");
    b.object("locker", () => {
      b.box([1, 2, 1], [3, 1, 0], "#ffffff");
      b.box([.2, .2, .1], [3, 1.5, .6], "#ff0000");
    });
    const group = b.finish();
    expect(group.children).toHaveLength(2);
    expect(pick(group, -3)?.kind).toBe("crate");
    expect(pick(group, 3)?.kind).toBe("locker");
    expect(pick(group, 0)).toBeNull();
    const locker = b.objects.find(o => o.kind === "locker")!;
    expect(locker.parts).toHaveLength(2);
    expect(locker.bounds.max.z).toBeCloseTo(.65);
    expect(shipObjectAtHit(group.children[0], null)).toBeNull();
    const source = (group.children[0] as THREE.Mesh).geometry, disposed = vi.fn();
    source.addEventListener("dispose", disposed);
    const glow = shipObjectHighlight(locker);
    glow.geometry.computeBoundingBox();
    expect(glow.geometry.boundingBox).toEqual(locker.bounds);
    expect(glow.geometry.getAttribute("position").array).not.toBe(source.getAttribute("position").array);
    glow.geometry.dispose(); glow.material.dispose();
    expect(disposed).not.toHaveBeenCalled();
    disposeShipGeometry(group);
  });
  it("keeps a plant separate from the growing bed around it, including later pieces of the bed", () => {
    const b = new Builder({}); b.cabin = cabin;
    b.object("growingBed", () => {
      b.box([6, .3, 2], [0, .15, 0], "#ffffff");
      b.object("seedling", () => b.ball(.3, [0, .7, 0], "#ffffff"));
      b.box([.1, 1, 1], [2, .5, 0], "#ffffff");
    });
    const group = b.finish();
    expect(group.children).toHaveLength(1);
    expect(pick(group, 0)?.kind).toBe("seedling");
    expect(pick(group, 2)?.kind).toBe("growingBed");
    expect(b.objects.find(o => o.kind === "growingBed")?.parts).toHaveLength(2);
    disposeShipGeometry(group);
  });
  it("covers furnishings and procedural equipment on multiple decks with unique IDs and bounded draw calls", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), fillText: vi.fn() } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
    const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    const models = Object.fromEntries(SHIP_MODELS.map(name => [name, model]));
    const layout = buildShipLayout({ projects: [{ id: "project", name: "A project" }], members: [{ id: "agent", projectId: "project" }] });
    const objects: ShipObject[] = [];
    for (const deck of [0, 2] as const) {
      const group = buildShipGeometry(shipDeck(layout, deck), models);
      const props = group.userData.shipObjects as ShipObject[];
      expect(props.length).toBeGreaterThan(200);
      expect(props.every(p => p.deck === deck && !p.bounds.isEmpty() && p.parts.length > 0)).toBe(true);
      const untracked = vi.spyOn(Builder.prototype, "object").mockImplementation((_kind, draw) => draw());
      const baseline = buildShipGeometry(shipDeck(layout, deck), models);
      untracked.mockRestore();
      expect(group.children).toHaveLength(baseline.children.length);
      disposeShipGeometry(baseline);
      objects.push(...props);
      disposeShipGeometry(group);
    }
    expect(new Set(objects.map(o => o.id)).size).toBe(objects.length);
    for (const kind of ["workstation", "pottedPlant", "rainforestFern", "tropicalPlant", "serverRack", "machineFan", "growingBed", "seedling", "treadmill", "bed", "crate", "telescope", "workbench", "monitor"])
      expect(objects.some(o => o.kind === kind), kind).toBe(true);
    model.children.forEach(object => { const mesh = object as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
  });
  it.each([[1280, 860], [390, 844], [844, 390]])("frames upper-deck objects clear of the card at %i × %i", (width, height) => {
    const object = { bounds: new THREE.Box3(new THREE.Vector3(19, 0, 9), new THREE.Vector3(21, 3, 11)), deck: 2 as const };
    const position = new THREE.Vector3(70, 73, 94), target = new THREE.Vector3();
    const pose = shipObjectCameraPose(object, width, height, position, target);
    expect(pose.position.clone().sub(pose.target).normalize().distanceTo(position.normalize())).toBeLessThan(.00001);
    const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 5000);
    camera.position.copy(pose.position); camera.zoom = pose.zoom; camera.lookAt(pose.target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    for (const x of [19, 21]) for (const y of [0, 3]) for (const z of [9, 11]) {
      const p = new THREE.Vector3(x, y + 2 * DECK_STEP, z).project(camera);
      const screenX = (p.x + 1) * width / 2, screenY = (1 - p.y) * height / 2;
      expect(screenX).toBeGreaterThan(0); expect(screenX).toBeLessThan(width >= 768 ? width - 284 : width);
      expect(screenY).toBeGreaterThan(0); expect(screenY).toBeLessThan(width < 768 ? height - 240 : height);
    }
    expect(pose.zoom).toBeLessThanOrEqual(110);
  });
  it("translates all object names, descriptions and playful notes", () => {
    for (const text of [...Object.values(SHIP_OBJECT_INFO).flat(), ...SHIP_OBJECT_NOTES]) expect(ZH_CN[text], text).toBeTruthy();
  });
});
