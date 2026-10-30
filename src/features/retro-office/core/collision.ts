import { Matrix4, Vector3, type Object3D, type Mesh, type InstancedMesh } from "three";
import { AGENT_HEIGHT, AGENT_RADIUS, CANVAS_H, CANVAS_W, SCALE } from "./constants";
import { segmentIntersectsBounds } from "./geometry";
import type { CanvasPoint } from "./types";

export type CollisionBox = {
  owner: string;
  x: number; y: number;
  halfX: number; halfY: number;
  angle: number;
  bottom: number; top: number;
};
type Owner = { id: string; rotation?: number };
type DynamicPart = { node: Object3D; owner: Owner };
export type CollisionCapture = { boxes: CollisionBox[]; dynamic: DynamicPart[] };

const local = (p: CanvasPoint, box: CollisionBox) => {
  const dx = p.x - box.x, dy = p.y - box.y, c = Math.cos(box.angle), s = Math.sin(box.angle);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};
const global = (p: CanvasPoint, box: CollisionBox) => {
  const c = Math.cos(box.angle), s = Math.sin(box.angle);
  return { x: box.x + p.x * c - p.y * s, y: box.y + p.x * s + p.y * c };
};
export const collisionBounds = (box: CollisionBox, radius = 0) => {
  const c = Math.abs(Math.cos(box.angle)), s = Math.abs(Math.sin(box.angle));
  const hx = box.halfX * c + box.halfY * s + radius, hy = box.halfX * s + box.halfY * c + radius;
  return { x: box.x - hx, y: box.y - hy, w: hx * 2, h: hy * 2 };
};
export const circleHitsBox = (p: CanvasPoint, box: CollisionBox, radius = AGENT_RADIUS) => {
  const q = local(p, box);
  return Math.hypot(Math.max(Math.abs(q.x) - box.halfX, 0), Math.max(Math.abs(q.y) - box.halfY, 0)) < radius - 1e-5;
};
export const segmentHitsBox = (from: CanvasPoint, to: CanvasPoint, box: CollisionBox, radius = AGENT_RADIUS) => {
  const a = local(from, box), b = local(to, box), r = radius - 1e-5;
  // A swept circle against an OBB is a rectangle with rounded corners.
  // A merely expanded rectangle incorrectly traps valid points near corners.
  if (segmentIntersectsBounds(a, b, { x: -box.halfX, y: -box.halfY - r, w: box.halfX * 2, h: (box.halfY + r) * 2 })
    || segmentIntersectsBounds(a, b, { x: -box.halfX - r, y: -box.halfY, w: (box.halfX + r) * 2, h: box.halfY * 2 })) return true;
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  for (const x of [-box.halfX, box.halfX]) for (const y of [-box.halfY, box.halfY]) {
    const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length2)) : 0;
    if ((a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2 < r * r) return true;
  }
  return false;
};

const projectOutside = (p: CanvasPoint, box: CollisionBox, radius: number) => {
  const q = local(p, box);
  const near = { x: Math.max(-box.halfX, Math.min(box.halfX, q.x)), y: Math.max(-box.halfY, Math.min(box.halfY, q.y)) };
  const dx = q.x - near.x, dy = q.y - near.y, d = Math.hypot(dx, dy);
  if (d > 1e-8) return global({ x: near.x + dx / d * (radius + .02), y: near.y + dy / d * (radius + .02) }, box);
  if (box.halfX - Math.abs(q.x) < box.halfY - Math.abs(q.y)) q.x = (q.x < 0 ? -1 : 1) * (box.halfX + radius + .02);
  else q.y = (q.y < 0 ? -1 : 1) * (box.halfY + radius + .02);
  return global(q, box);
};

/** Measure rendered meshes, including instancing. No furniture-type whitelist. */
export function captureCollisionGeometry(root: Object3D, prefix = "scene", includeDynamic = false): CollisionCapture {
  root.updateWorldMatrix(true, true);
  const boxes: CollisionBox[] = [], dynamic: DynamicPart[] = [];
  const yaw = new Matrix4(), transform = new Matrix4(), instance = new Matrix4();
  const measure = (mesh: Mesh, matrix: Matrix4, owner: Owner) => {
    mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    // Remove the item's yaw before measuring so rotated furniture keeps an OBB.
    const rotation = owner.rotation ?? 0;
    transform.multiplyMatrices(yaw.makeRotationY(-rotation), matrix);
    const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(transform);
    // Thin floor coverings can be stepped over; objects above the head can be
    // walked under. Geometry at torso height blocks even when it is elevated.
    if (bounds.max.y <= .045 || bounds.min.y >= AGENT_HEIGHT || bounds.isEmpty()) return;
    const centre = bounds.getCenter(new Vector3()).applyMatrix4(yaw.makeRotationY(rotation));
    boxes.push({ owner: owner.id, x: centre.x / SCALE + CANVAS_W / 2, y: centre.z / SCALE + CANVAS_H / 2,
      halfX: (bounds.max.x - bounds.min.x) / SCALE / 2, halfY: (bounds.max.z - bounds.min.z) / SCALE / 2,
      angle: -rotation, bottom: bounds.min.y, top: bounds.max.y });
  };
  const visit = (node: Object3D, inherited: Owner) => {
    if (!node.visible || node.userData.collision === false || (node as Object3D & { isTroikaText?: boolean }).isTroikaText) return;
    const owner = (node.userData.collisionItem as Owner | undefined) ?? inherited;
    if (node.userData.collisionDynamic && !includeDynamic) { dynamic.push({ node, owner }); return; }
    const mesh = node as Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const instanced = mesh as InstancedMesh;
      if (instanced.isInstancedMesh) {
        const owners = node.userData.collisionItems as Owner[] | undefined;
        for (let i = 0; i < instanced.count; i++) {
          instanced.getMatrixAt(i, instance);
          measure(mesh, new Matrix4().multiplyMatrices(mesh.matrixWorld, instance), owners?.[i] ?? owner);
        }
      } else measure(mesh, mesh.matrixWorld, owner);
    }
    for (const child of node.children) visit(child, owner);
  };
  visit(root, { id: prefix });
  return { boxes, dynamic };
}

/** One scene-owned collision world, shared by navigation and movement. */
export class CollisionWorld {
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.revision;
  private sources = new Map<string, CollisionCapture>();
  private buckets = new Map<string, CollisionBox[]>();
  private dynamicBoxes: CollisionBox[] = [];
  boxes: CollisionBox[] = [];
  revision = 0;
  layout: unknown = null;
  set(source: string, capture: CollisionCapture, layout?: unknown) {
    this.sources.set(source, capture);
    if (source === "furniture") this.layout = layout;
    this.rebuild();
  }
  delete(source: string) { this.sources.delete(source); if (source === "furniture") this.layout = null; this.rebuild(); }
  ready(layout: unknown) { return this.sources.has("shell") && this.sources.has("furniture") && this.layout === layout; }
  ownerBounds(owner: string): CollisionBox | undefined {
    const boxes = this.boxes.filter(box => box.owner === owner), first = boxes[0];
    if (!first) return;
    const points = boxes.flatMap(box => [-1, 1].flatMap(x => [-1, 1].map(y => local(global({ x: x * box.halfX, y: y * box.halfY }, box), first))));
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const centre = global({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, first);
    return { ...first, ...centre, halfX: (maxX - minX) / 2, halfY: (maxY - minY) / 2 };
  }
  approach(owner: string, side: CanvasPoint = { x: 0, y: 1 }): CanvasPoint | undefined {
    const bounds = this.ownerBounds(owner);
    if (!bounds) return;
    const sides = [side, { x: side.y, y: -side.x }, { x: -side.y, y: side.x }, { x: -side.x, y: -side.y }];
    const points = sides.map(s => global({ x: s.x * (bounds.halfX + AGENT_RADIUS + 2), y: s.y * (bounds.halfY + AGENT_RADIUS + 2) }, bounds));
    // Prefer another clear face over pushing an interaction point through a
    // neighbouring object into a narrow, inaccessible pocket.
    return points.find(p => this.clear(p)) ?? this.resolve(points[0]);
  }
  private rebuild() {
    this.boxes = [...this.sources.values()].flatMap(s => s.boxes);
    this.buckets.clear();
    for (const box of this.boxes) {
      const b = collisionBounds(box, AGENT_RADIUS);
      for (let y = Math.floor(b.y / 100); y <= Math.floor((b.y + b.h) / 100); y++) {
        for (let x = Math.floor(b.x / 100); x <= Math.floor((b.x + b.w) / 100); x++) {
          const key = `${x}:${y}`, bucket = this.buckets.get(key);
          if (bucket) bucket.push(box); else this.buckets.set(key, [box]);
        }
      }
    }
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  refreshDynamic() {
    this.dynamicBoxes = [...this.sources.values()].flatMap(source => source.dynamic.flatMap(({ node, owner }) => {
      const capture = captureCollisionGeometry(node, owner.id, true);
      return capture.boxes.map(box => ({ ...box, owner: owner.id }));
    }));
  }
  private nearby(from: CanvasPoint, to = from): CollisionBox[] {
    const found = new Set<CollisionBox>();
    for (let y = Math.floor(Math.min(from.y, to.y) / 100); y <= Math.floor(Math.max(from.y, to.y) / 100); y++) {
      for (let x = Math.floor(Math.min(from.x, to.x) / 100); x <= Math.floor(Math.max(from.x, to.x) / 100); x++) {
        for (const box of this.buckets.get(`${x}:${y}`) ?? []) found.add(box);
      }
    }
    return [...found, ...this.dynamicBoxes];
  }
  clear(point: CanvasPoint, ignore?: string) {
    return this.insideFloor(point) && this.nearby(point).every(box => box.owner === ignore || !circleHitsBox(point, box));
  }
  private insideFloor(p: CanvasPoint) {
    return p.x >= AGENT_RADIUS && p.y >= AGENT_RADIUS && p.x <= CANVAS_W - AGENT_RADIUS && p.y <= CANVAS_H - AGENT_RADIUS;
  }
  resolve(point: CanvasPoint, ignore?: string): CanvasPoint {
    let result = { x: Math.max(AGENT_RADIUS, Math.min(CANVAS_W - AGENT_RADIUS, point.x)),
      y: Math.max(AGENT_RADIUS, Math.min(CANVAS_H - AGENT_RADIUS, point.y)) };
    for (let pass = 0; pass < 12; pass++) {
      let changed = false;
      for (const box of this.nearby(result)) {
        if (box.owner !== ignore && circleHitsBox(result, box)) { result = projectOutside(result, box, AGENT_RADIUS); changed = true; }
      }
      if (!changed && this.insideFloor(result)) return result;
    }
    // A moved prop can surround an actor with several intersecting meshes.
    // Find nearby free floor instead of leaving it wedged between those meshes.
    for (let ring = 1; ring <= 20; ring++) for (let i = 0; i < 24; i++) {
      const p = { x: point.x + Math.cos(i * Math.PI / 12) * ring * 12, y: point.y + Math.sin(i * Math.PI / 12) * ring * 12 };
      if (this.clear(p, ignore)) return p;
    }
    return result;
  }
  move(from: CanvasPoint, desired: CanvasPoint, ignore?: string): CanvasPoint {
    const start = this.clear(from, ignore) ? from : this.resolve(from, ignore);
    if (Math.hypot(start.x - from.x, start.y - from.y) > .01) return start;
    const candidates = this.nearby(start, desired).filter(box => box.owner !== ignore);
    const safe = (to: CanvasPoint) => this.insideFloor(to) && candidates.every(box => !segmentHitsBox(start, to, box));
    if (safe(desired)) return desired;
    // Sweep the complete step, then slide along the wall. This also stops fast
    // moves/teleports from tunnelling through a thin obstacle.
    let low = 0, high = 1;
    for (let i = 0; i < 12; i++) {
      const t = (low + high) / 2, p = { x: start.x + (desired.x - start.x) * t, y: start.y + (desired.y - start.y) * t };
      if (safe(p)) low = t; else high = t;
    }
    let best = { x: start.x + (desired.x - start.x) * low, y: start.y + (desired.y - start.y) * low };
    for (const p of [{ x: desired.x, y: start.y }, { x: start.x, y: desired.y }]) {
      if (safe(p) && Math.hypot(p.x - start.x, p.y - start.y) > Math.hypot(best.x - start.x, best.y - start.y)) best = p;
    }
    return best;
  }
}
