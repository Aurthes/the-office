import { translateUi, type UiTranslator } from "@/lib/i18n/messages";
import { SHARED_PROJECT_ID } from "./layout";
import * as THREE from "three";
import { cabinDeck } from "./shell-shapes";
import { addCabinDetails } from "./interior-details";
import { addRainforest, addMachineRoom } from "./ship-biomes";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import workstationModels from "@/features/retro-office/core/workstation-models.json";
import { CHAIR_SEAT, DESK_SURFACE_HEIGHT, WORKSTATION_SCALE } from "@/features/retro-office/core/geometry";
import { cabinAngle, seatPosition, shipPoint, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";

export const FURNITURE_MODELS = ["desk", "chairDesk", "pottedPlant", "plantSmall1", "loungeSofa", "tableRound", "kitchenCoffeeMachine", "kitchenCabinet", "bookcaseClosed", "lampRoundFloor", "kitchenFridgeSmall", "chairModernCushion", "tableCoffee", "table", "loungeDesignChair"] as const;
export const SHIP_MODELS = [...FURNITURE_MODELS, "rainforestTree", "rainforestFern", "rainforestBush", "rainforestRock", "machineConsole", "machineFan"] as const;
export type ModelName = typeof SHIP_MODELS[number];
export type ModelTemplates = Partial<Record<ModelName, GLTF["scene"]>>;
const legacyFurniture = (name: ModelName) => FURNITURE_MODELS.includes(name as typeof FURNITURE_MODELS[number]);
export const shipModelUrl = (name: ModelName) => legacyFurniture(name) ? `/office-assets/models/furniture/${name}.glb` : `/office-assets/models/ship/${name}.gltf`;
export const SHIP_WORKSTATION = {
  deskWidth: (workstationModels.desk.max[0] - workstationModels.desk.min[0]) * WORKSTATION_SCALE.desk_cubicle,
  chairWidth: (workstationModels.chairDesk.max[0] - workstationModels.chairDesk.min[0]) * WORKSTATION_SCALE.chair,
  surfaceHeight: DESK_SURFACE_HEIGHT + 0.08,
  seatHeight: CHAIR_SEAT[1] * WORKSTATION_SCALE.chair + 0.08,
};
const HULL = "#e1e7e6", METAL = "#30495b", ORANGE = "#df9b51", TEAL = "#6abeb6";
const TAU = Math.PI * 2;
const ASSET_COLORS: Record<string, string> = { wood: "#d3c2a7", woodDark: "#52616c", metal: "#d5e0df", metalMedium: "#82939d", metalDark: METAL, carpet: "#dba36c", plant: "#4b9364" };

// Bake repeated furniture and hull pieces into a small number of material meshes.
// Camera/agent changes do not rebuild these buffers or add asset requests.
export class Builder {
  groups = new Map<string, { material: THREE.MeshStandardMaterial; geometries: THREE.BufferGeometry[] }>();
  labels: Array<{ texture: THREE.Texture; position: THREE.Vector3; rotation: THREE.Euler; width: number; height: number }> = [];
  constructor(private models: ModelTemplates) {}
  add(geometry: THREE.BufferGeometry, color: string, matrix = new THREE.Matrix4(), glow = false, surface?: THREE.MeshStandardMaterial) {
    const key = `${color}:${glow}:${surface?.uuid || ""}`;
    if (!this.groups.has(key)) {
      const material = surface ? surface.clone() : new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.13,
        ...(glow ? { emissive: color, emissiveIntensity: 0.8 } : {}) });
      material.color.set(color);
      this.groups.set(key, { material, geometries: [] });
    }
    let value = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    for (const attribute of Object.keys(value.attributes)) if (!["position", "normal", "uv", ...(surface?.vertexColors ? ["color"] : [])].includes(attribute)) value.deleteAttribute(attribute);
    if (!value.attributes.normal) value.computeVertexNormals();
    if (!value.attributes.uv) value.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(value.attributes.position.count * 2), 2));
    if (surface?.vertexColors && !value.attributes.color) value.setAttribute("color", new THREE.BufferAttribute(new Float32Array(value.attributes.position.count * 3).fill(1), 3));
    value = value.applyMatrix4(matrix); this.groups.get(key)!.geometries.push(value);
  }
  box(size: [number, number, number], p: [number, number, number], color: string, rotation = 0, glow = false) {
    this.add(new THREE.BoxGeometry(...size), color, transform(p, rotation), glow);
  }
  cylinder(radius: number, height: number, p: [number, number, number], color: string, sides = 16, glow = false) {
    this.add(new THREE.CylinderGeometry(radius, radius, height, sides), color, transform(p), glow);
  }
  ball(radius: number, p: [number, number, number], color: string, scale: [number, number, number] = [1, 1, 1]) {
    this.add(new THREE.IcosahedronGeometry(radius, 1), color, transform(p, 0, scale));
  }
  curve(points: [number, number, number][], radius: number, color: string) {
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), points.length * 5, radius, 6, false), color);
  }
  annulus(inner: number, outer: number, start: number, end: number, y: number, height: number, color: string, glow = false) {
    const shape = new THREE.Shape();
    shape.moveTo(Math.cos(start) * inner, Math.sin(start) * inner);
    shape.lineTo(Math.cos(start) * outer, Math.sin(start) * outer);
    shape.absarc(0, 0, outer, start, end, false);
    shape.lineTo(Math.cos(end) * inner, Math.sin(end) * inner);
    shape.absarc(0, 0, inner, end, start, true); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: Math.max(5, Math.ceil((end - start) * outer * 1.2)) });
    geometry.rotateX(-Math.PI / 2);
    this.add(geometry, color, transform([0, y, 0]), glow);
  }
  localBox(layout: ShipLayout, cabin: ShipCabin, tangent: number, radial: number, y: number, size: [number, number, number], color: string, rotation = 0, glow = false) {
    const ring = layout.rings[cabin.ring], angle = cabinAngle(layout, cabin.slot) + tangent / ring.radius;
    const p = shipPoint(ring.radius + radial, angle);
    this.box(size, [p.x, y, p.z], color, angle + rotation, glow);
  }
  furniture(name: ModelName, width: number, p: ShipPoint, y = 0.08, rotation = 0) {
    const model = this.models[name];
    if (!model) return false;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const scale = width / Math.max(0.01, size.x);
    const normalization = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
    const world = transform([p.x, y, p.z], rotation).multiply(normalization);
    model.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const source = mesh.material as THREE.MeshStandardMaterial;
      const color = (legacyFurniture(name) ? ASSET_COLORS[source.name] : null) || `#${source.color?.getHexString() || "b6c2c9"}`;
      this.add(mesh.geometry.clone(), color, world.clone().multiply(mesh.matrixWorld), false, legacyFurniture(name) ? undefined : source);
    });
    return true;
  }
  sign(text: string, subtitle: string, point: ShipPoint, angle: number, width: number, accent: string) {
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 192;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#17313c"; ctx.fillRect(0, 0, 1024, 192);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, 12, 192);
    ctx.fillStyle = "#ecf2eb"; ctx.font = "600 60px system-ui"; ctx.textAlign = "center";
    ctx.fillText(text, 512, 83, 960); ctx.fillStyle = accent; ctx.font = "32px system-ui"; ctx.fillText(subtitle, 512, 148, 950);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    this.labels.push({ texture, position: new THREE.Vector3(point.x, 0.095, point.z), rotation: new THREE.Euler(-Math.PI / 2, 0, angle), width, height: width * 192 / 1024 });
  }
  finish() {
    const group = new THREE.Group();
    for (const { geometries, material } of this.groups.values()) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!merged) { material.dispose(); continue; }
      const mesh = new THREE.Mesh(merged, material); mesh.receiveShadow = true; mesh.castShadow = true; group.add(mesh);
    }
    for (const label of this.labels) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(label.width, label.height), new THREE.MeshBasicMaterial({ map: label.texture, toneMapped: false }));
      mesh.position.copy(label.position); mesh.rotation.copy(label.rotation); group.add(mesh);
    }
    return group;
  }
}
function transform(position: [number, number, number], rotation = 0, scale: [number, number, number] = [1, 1, 1]) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotation, 0)), new THREE.Vector3(...scale));
}
export function disposeShipGeometry(group: THREE.Group) {
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      // Imported textures belong to the persistent model cache. Only labels
      // created for this geometry own their canvas textures.
      const value = material as THREE.MeshBasicMaterial;
      if (value.map instanceof THREE.CanvasTexture) value.map.dispose();
      material.dispose();
    }
  });
}

export function buildShipGeometry(layout: ShipLayout, models: ModelTemplates = {}, t: UiTranslator = (text, values) => translateUi(text, "en", values)) {
  const b = new Builder(models), step = TAU / layout.allocation.sectors;
  const spokeSlots = new Set(layout.spokes.map(angle => Math.round(angle / step)));
  for (const cabin of layout.cabins) {
    const ring = layout.rings[cabin.ring], inner = ring.radius - ring.depth / 2, outer = ring.radius + ring.depth / 2;
    const theta = cabinAngle(layout, cabin.slot), reserve = cabin.kind === "reserve";
    const spokeAtEnd = spokeSlots.has((cabin.slot + 1) % layout.allocation.sectors);

    const opening = cabin.kind === "return" ? { ...shipPoint(ring.radius + 1.8, theta), radius: 1.02 } : undefined;
    b.add(cabinDeck(ring.radius, ring.depth/2, cabin.slot*step, (cabin.slot+1)*step, opening), reserve ? "#8fa5ac" : cabin.kind === "garden" ? "#a2b48f" : "#c7bca6");

    for (const t of [-0.27, 0, 0.27]) {
      const a = theta + t * step, p = shipPoint(outer - 0.2, a);
      b.box([Math.min(1.5, ring.radius * step / 5), 0.2, 0.05], [p.x, 0.23, p.z], METAL, a);
      const light = shipPoint(inner - 0.04, a);
      b.box([0.6, 0.07, 0.08], [light.x, -0.24, light.z], reserve ? "#82a8b1" : "#edbf78", a, true);
    }
    const next = layout.cabins.find(c => c.ring === cabin.ring && c.slot === (cabin.slot + 1) % layout.allocation.sectors)!;
    if (!spokeAtEnd && (!cabin.projectId || cabin.projectId !== next.projectId)) {
      const angle = (cabin.slot + 1) * step;
      // A central opening keeps the ring's circulation lane unobstructed.
      for (const side of [-1, 1]) {
        const length = ring.depth / 2 * .79 - 0.65, p = shipPoint(ring.radius + side * (0.65 + length / 2), angle);
        b.box([0.14, 0.42, length], [p.x, 0.21, p.z], HULL, angle);
      }
    }
    const sign = shipPoint(inner + 0.65, theta);
    b.sign(cabin.kind === "work" && cabin.projectId !== SHARED_PROJECT_ID ? cabin.name : t(cabin.name), reserve ? t("Standby") : cabin.kind === "work" ? t("{0} seats", { "0": ring.capacity }) : cabin.kind === "return" ? t("Return to Earth / Archive") : t("Common cabin"), sign, theta, Math.min(5.2, ring.radius * step * 0.68), cabin.color);
    if (reserve) {
      addCabinDetails(b, layout, cabin);
      for (const u of [-1, 1]) b.localBox(layout, cabin, u * Math.min(2, ring.radius * step / 4), 0.5, 0.08, [1.0, 0.02, 0.04], "#c6d5d5");
      continue;
    }
    if (cabin.kind === "work") {
      for (let i = 0; i < ring.capacity; i++) {
        const seat = seatPosition(layout, cabin, i);
        b.box([2.2, .012, 1.7], [seat.desk.x, .067, seat.desk.z], "#829f9e", seat.facing);
        if (!b.furniture("desk", SHIP_WORKSTATION.deskWidth, seat.desk, 0.08, seat.facing)) {
          b.box([SHIP_WORKSTATION.deskWidth, 0.1, 0.6], [seat.desk.x, SHIP_WORKSTATION.surfaceHeight - 0.05, seat.desk.z], "#ded5bf", seat.facing);
          b.box([0.95, 0.5, 0.35], [seat.desk.x, 0.33, seat.desk.z], HULL, seat.facing);
        }
        const screen = shipPoint(Math.hypot(seat.desk.x, seat.desk.z) + (i < (cabin.ring === 2 ? 4 : 3) ? 0.13 : -0.13), seat.angle);
        b.box([0.48, 0.32, 0.035], [screen.x, SHIP_WORKSTATION.surfaceHeight + 0.19, screen.z], METAL, seat.facing);
        const glow = shipPoint(Math.hypot(screen.x, screen.z) + (seat.facing === seat.angle ? -0.03 : 0.03), seat.angle);
        b.box([0.4, 0.22, 0.025], [glow.x, SHIP_WORKSTATION.surfaceHeight + 0.2, glow.z], "#579eb3", seat.facing, true);
        b.furniture("chairDesk", SHIP_WORKSTATION.chairWidth, seat.agent, 0.08, seat.facing);
      }
    } else addAmenity(b, layout, cabin);
    addCabinDetails(b, layout, cabin);
  }
  // A low central reactor leaves inner cabins visible in the overhead view.
  b.cylinder(3.5, 0.6, [0, -0.2, 0], HULL, 48);
  b.cylinder(2.45, 1.3, [0, 0.65, 0], HULL, 32);
  b.cylinder(2.52, 0.12, [0, 1.2, 0], ORANGE, 48);
  b.cylinder(1.7, 0.2, [0, 1.45, 0], METAL, 40);
  b.cylinder(0.95, 0.15, [0, 1.59, 0], "#ffd189", 32, true);
  b.sign(t("Central lift"), "", { x: 0, z: 2.7 }, 0, 2.7, "#e3b775");
  for (const angle of layout.spokes) {
    const start = 3.2, end = layout.radius, p = shipPoint((start + end) / 2, angle);
    b.box([1.25, 0.22, end - start], [p.x, -0.08, p.z], HULL, angle);
    for (const side of [-1, 1]) {
      const x = p.x + Math.cos(angle) * side * 0.59, z = p.z - Math.sin(angle) * side * 0.59;
      b.box([0.045, 0.05, end - start], [x, 0.08, z], "#bfe6d7", angle, true);
    }
  }
  return b.finish();
}

function addAmenity(b: Builder, layout: ShipLayout, cabin: ShipCabin) {
  const ring = layout.rings[cabin.ring], width = ring.radius * TAU / layout.allocation.sectors;
  const local = (u: number, v: number) => shipPoint(ring.radius + v, cabinAngle(layout, cabin.slot) + u / ring.radius);
  if (cabin.kind === "return") {
    // The launch collar is hollow; no solid pad may cover the boarding hole.
    for(const u of [-1.5,1.5]) {
      b.localBox(layout,cabin,u,1.8,.95,[.18,1.8,.25],METAL);
      b.localBox(layout,cabin,u,1.8,1.7,[.2,.16,.28],"#f5bc65",0,true);
    }
    b.localBox(layout,cabin,0,.3,.06,[1.1,.08,1.7],"#87958c");
    b.localBox(layout,cabin,-3,1.6,.7,[.9,1.3,.65],METAL);
    b.localBox(layout,cabin,-3,1.22,1.12,[.65,.35,.05],TEAL,0,true);
  } else if (cabin.kind === "garden") {
    addRainforest(b, layout, cabin);
  } else if (cabin.kind === "hydroponics") {
    for (const u of [-width * 0.27, 0, width * 0.27]) for (const v of [-1.35, 1.35]) {
      b.localBox(layout, cabin, u, v, 0.4, [2, 0.65, 0.9], HULL);
      b.localBox(layout, cabin, u, v, 0.74, [1.85, 0.05, 0.78], "#456f67");
      for (const leaf of [-0.6, 0, 0.6]) {
        const p = local(u + leaf, v);
        b.ball(0.31, [p.x, 0.89, p.z], leaf ? "#74ad5b" : "#549652", [1, 0.45, 1]);
      }
      b.localBox(layout, cabin, u, v, 2.1, [1.8, 0.06, 0.12], "#d4ede7", 0, true);
      b.localBox(layout, cabin, u + 0.95, v, 1.1, [0.07, 2, 0.08], METAL);
    }
  } else if (cabin.kind === "servers") {
    addMachineRoom(b, layout, cabin);
  } else if (cabin.kind === "gym") {
    for (const u of [-width * 0.25, 0, width * 0.25]) {
      b.localBox(layout, cabin, u, 1.2, 0.19, [1.5, 0.3, 2.2], METAL);
      b.localBox(layout, cabin, u, 1.2, 0.36, [1.12, 0.04, 1.7], "#72878b");
      for (const side of [-0.62, 0.62]) b.localBox(layout, cabin, u + side, 1.8, 1.0, [0.07, 1.4, 0.07], HULL);
      b.localBox(layout, cabin, u, 1.85, 1.55, [1.35, 0.22, 0.2], TEAL);
    }
    for (const u of [-1.3, 1.3]) b.localBox(layout, cabin, u, -1.7, 0.08, [2.0, 0.035, 0.8], "#849eaf");
  } else if (cabin.kind === "cargo") {
    for (const u of [-width * 0.28, 0, width * 0.28]) for (const v of [-1.6, 1.6]) {
      b.localBox(layout, cabin, u, v, 0.55, [1.6, 1, 1.35], "#a7b7b8");
      b.localBox(layout, cabin, u, v, 1.08, [1.68, 0.1, 1.4], ORANGE);
      b.localBox(layout, cabin, u, v, 0.58, [0.16, 1.05, 1.42], HULL);
    }
  } else if (cabin.kind === "quarters") {
    for (const u of [-width * 0.28, 0, width * 0.28]) {
      b.localBox(layout, cabin, u, 1.25, 0.35, [1.65, 0.55, 2.0], HULL);
      b.localBox(layout, cabin, u, 1.25, 0.66, [1.45, 0.12, 1.8], "#a9bdc5");
      b.localBox(layout, cabin, u, 1.9, 0.78, [1.2, 0.12, 0.35], "#ede2c7");
      b.localBox(layout, cabin, u, -1.7, 0.7, [1.0, 1.3, 0.65], "#9bafb4");
    }
  } else if (cabin.kind === "observatory") {
    for (const u of [-width * 0.25, width * 0.25]) {
      const p = local(u, 1.0);
      b.cylinder(0.18, 1.1, [p.x, 0.62, p.z], METAL);
      b.localBox(layout, cabin, u, 1.25, 1.24, [0.6, 0.5, 1.25], HULL);
      b.localBox(layout, cabin, u, 1.9, 1.24, [0.45, 0.38, 0.05], "#7ea8ba", 0, true);
      b.furniture("loungeSofa", 1.8, local(u, -1.6), 0.08, cabinAngle(layout, cabin.slot) + Math.PI);
    }
  } else if (cabin.kind === "maintenance") {
    for (const u of [-width * 0.27, 0, width * 0.27]) {
      b.localBox(layout, cabin, u, 1.6, 0.5, [2.0, 0.9, 0.8], HULL);
      b.localBox(layout, cabin, u, 1.6, 0.98, [2.1, 0.09, 1], ORANGE);
      b.localBox(layout, cabin, u, -1.8, 0.45, [1, 0.8, 0.85], "#a1b0b3");
      b.localBox(layout, cabin, u, -1.8, 0.8, [1.04, 0.08, 0.9], ORANGE);
    }
  } else {
    const canteen = cabin.kind === "canteen";
    for (const u of [-width * 0.22, width * 0.22]) {
      b.furniture(canteen ? "tableRound" : "loungeSofa", canteen ? 1.4 : 2.1, local(u, 1.1), 0.08, cabinAngle(layout, cabin.slot));
      b.furniture("chairDesk", 0.6, local(u, -0.6), 0.08, cabinAngle(layout, cabin.slot));
      b.furniture("pottedPlant", 0.6, local(u, -1.4), 0.08);
    }
    if (canteen) {
      const p = local(0, 1.55); b.furniture("kitchenCabinet", 1.9, p, 0.08, cabinAngle(layout, cabin.slot));
      b.furniture("kitchenCoffeeMachine", 0.55, p, 0.95, cabinAngle(layout, cabin.slot));
    }
  }
}
