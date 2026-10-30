// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial } from "three";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AGENT_HEIGHT, AGENT_RADIUS, SCALE } from "@/features/retro-office/core/constants";
import { captureCollisionGeometry, circleHitsBox, CollisionWorld, collisionBounds, segmentHitsBox, type CollisionBox } from "@/features/retro-office/core/collision";
import { astar, buildNavGrid, withAgentObstacles } from "@/features/retro-office/core/navigation";
import { actorSeatPermission, resolveAgentCollisions } from "@/features/retro-office/systems/NavigationSystem";
import { buildFurnitureItemMatrix, FURNITURE_GLB } from "@/features/retro-office/objects/furniture";
import { getDeskWorkstations } from "@/features/retro-office/core/workstations";
import { resolvePingPongTargets } from "@/features/retro-office/core/navigation";
import type { RenderAgent } from "@/features/retro-office/core/types";

const box = (x: number, y: number, halfX = 30, halfY = 20, angle = 0, owner = "solid"): CollisionBox => ({ owner, x, y, halfX, halfY, angle, bottom: 0, top: 1 });
const worldFor = (boxes: CollisionBox[]) => { const world = new CollisionWorld(); world.set("furniture", { boxes, dynamic: [] }); return world; };
const actor = (id: string, x: number, y: number, extra: Partial<RenderAgent> = {}): RenderAgent => ({ id, name: id, status: "idle", state: "walking", x, y, targetX: x, targetY: y, path: [], facing: 0, frame: 0, walkSpeed: .3, phaseOffset: 0, ...extra }) as RenderAgent;
const material = new MeshBasicMaterial();
const mesh = (x: number, y: number, z: number, width: number, height: number, depth: number) => { const m = new Mesh(new BoxGeometry(width, height, depth), material); m.position.set(x, y, z); return m; };

describe("scene-derived collision volumes", () => {
  it("measures new physical types without a whitelist and respects visibility/height", () => {
    const root = new Group();
    root.add(mesh(0, .4, 0, .5, .8, .5)); // new, unregistered solid
    root.add(mesh(2, .01, 0, 1, .02, 1)); // carpet
    root.add(mesh(3, AGENT_HEIGHT + .3, 0, 1, .2, 1)); // overhead cabinet
    const hidden = mesh(4, .5, 0, 1, 1, 1); hidden.visible = false; root.add(hidden);
    const visual = mesh(5, .5, 0, 1, 1, 1); visual.userData.collision = false; root.add(visual);
    const captured = captureCollisionGeometry(root);
    expect(captured.boxes).toHaveLength(1);
    expect(circleHitsBox({ x: 900, y: 900 }, captured.boxes[0])).toBe(true);
  });
  it("measures separate instances with their actual transforms and owner IDs", () => {
    const instances = new InstancedMesh(new BoxGeometry(.4, .8, .6), material, 2);
    instances.setMatrixAt(0, new Matrix4().makeTranslation(0, .4, 0));
    instances.setMatrixAt(1, new Matrix4().makeTranslation(2, .4, 0));
    instances.userData.collisionItems = [{ id: "a" }, { id: "b" }];
    const volumes = captureCollisionGeometry(instances).boxes;
    expect(volumes.map(v => v.owner)).toEqual(["a", "b"]);
    expect(volumes[1].x - volumes[0].x).toBeCloseTo(2 / SCALE);
  });
  it.each(Object.entries(FURNITURE_GLB))("routes around the actual %s asset after arbitrary rotation", async (type, url) => {
    const bytes = await readFile(`public${url}`);
    const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const item = { _uid: type, type, x: 650, y: 650, facing: 35 };
    const root = new Group(); root.matrix.copy(buildFurnitureItemMatrix(item, type)); root.matrixAutoUpdate = false;
    root.userData.collisionItem = { id: type, rotation: 35 * Math.PI / 180 }; root.add(scene);
    const boxes = captureCollisionGeometry(root).boxes;
    expect(boxes.length).toBeGreaterThan(0);
    const bounds = boxes.map(v => collisionBounds(v, AGENT_RADIUS));
    const left = Math.min(...bounds.map(b => b.x)), right = Math.max(...bounds.map(b => b.x + b.w));
    const cy = (Math.min(...bounds.map(b => b.y)) + Math.max(...bounds.map(b => b.y + b.h))) / 2;
    const start = { x: left - 50, y: cy }, end = { x: right + 50, y: cy };
    const grid = buildNavGrid([], boxes), route = astar(start.x, start.y, end.x, end.y, grid);
    expect(route.length).toBeGreaterThan(0); expect(route.at(-1)).toEqual(end);
    let previous = start;
    for (const next of route) {
      expect(boxes.some(b => segmentHitsBox(previous, next, b)), `path clips ${type}`).toBe(false);
      previous = next;
    }
  });
  it("keeps an open booth interior instead of blocking its entire outer rectangle", () => {
    const root = new Group();
    root.add(mesh(-.7, .7, 0, .06, 1.4, 1.4), mesh(.7, .7, 0, .06, 1.4, 1.4), mesh(0, .7, -.7, 1.4, 1.4, .06));
    const boxes = captureCollisionGeometry(root).boxes;
    const route = astar(900, 1000, 900, 900, buildNavGrid([], boxes));
    expect(route.at(-1)).toEqual({ x: 900, y: 900 });
    expect(boxes.some(b => segmentHitsBox({ x: 900, y: 1000 }, { x: 900, y: 900 }, b))).toBe(false);
  });
  it("updates a moving door without rebuilding static furniture", () => {
    const door = new Group(), leaf = new Group(); leaf.userData.collisionDynamic = true;
    leaf.position.x = -.36; leaf.add(mesh(.36, .6, 0, .72, 1.2, .05)); door.add(leaf);
    const world = new CollisionWorld(); world.set("furniture", captureCollisionGeometry(door)); const revision = world.revision;
    world.refreshDynamic();
    const start = { x: 900, y: 850 }, end = { x: 900, y: 950 };
    expect(world.move(start, end).y).toBeLessThan(900);
    leaf.rotation.y = -Math.PI * .55; world.refreshDynamic();
    expect(world.move(start, end)).toEqual(end); expect(world.revision).toBe(revision);
  });
});

describe("shared collision movement", () => {
  it("chooses another clear face when an object's front is occupied", () => {
    const world = worldFor([box(500, 500, 30, 20, 0, "desk"), box(500, 538, 20, 10, 0, "neighbour")]);
    const point = world.approach("desk")!;
    expect(world.clear(point)).toBe(true); expect(point.x).toBeGreaterThan(540); expect(point.y).toBe(500);
  });
  it("uses clear floor beside a desk when another real object occupies its work point", () => {
    const desk = { _uid: "desk", type: "desk_cubicle", x: 500, y: 600 };
    const [original] = getDeskWorkstations([desk]);
    const world = worldFor([box(original.x, original.y, 12, 12, 0, "sofa")]);
    const [resolved] = getDeskWorkstations([desk], world);
    expect(resolved.pose).toBe("standing"); expect(world.clear(resolved)).toBe(true);
    expect(Math.hypot(resolved.x - original.x, resolved.y - original.y)).toBeGreaterThan(AGENT_RADIUS);
  });
  it("places table interactions around its measured, rotated volume", () => {
    const physical = box(500, 500, 45, 25, .7, "table");
    const [a, b] = resolvePingPongTargets({ _uid: "table", type: "pingpong", x: 900, y: 900 }, physical);
    expect(circleHitsBox(a, physical)).toBe(false); expect(circleHitsBox(b, physical)).toBe(false);
    expect((a.x + b.x) / 2).toBeCloseTo(physical.x); expect((a.y + b.y) / 2).toBeCloseTo(physical.y);
  });
  it("keeps a moving crowd clear of each other and solids over repeated frames", () => {
    const world = worldFor([box(600, 600, 35, 60, .4)]);
    let actors = Array.from({ length: 12 }, (_, i) => actor(String(i), 480 + (i % 4) * 40, 480 + Math.floor(i / 4) * 40));
    let seed = 1234;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    actors = resolveAgentCollisions({ agents: actors, previous: [], world }).agents;
    for (let frame = 0; frame < 200; frame++) {
      const desired = actors.map(a => ({ ...a, x: a.x + (random() - .3) * 5, y: a.y + (random() - .3) * 5 }));
      actors = resolveAgentCollisions({ agents: desired, previous: actors, world }).agents;
      for (let i = 0; i < actors.length; i++) {
        expect(world.clear(actors[i]), `crowd pushed into a solid: ${JSON.stringify({frame,i,x:actors[i].x,y:actors[i].y})}`).toBe(true);
        for (const b of actors.slice(i + 1)) expect(Math.hypot(actors[i].x - b.x, actors[i].y - b.y)).toBeGreaterThanOrEqual(AGENT_RADIUS * 2 - .01);
      }
    }
  });

  it("sweeps a complete large step through thin/rotated objects", () => {
    for (const angle of [0, .6, Math.PI / 2]) {
      const obstacle = box(500, 500, 2, 50, angle), world = worldFor([obstacle]);
      const start = { x: 350, y: 500 }, result = world.move(start, { x: 650, y: 500 });
      expect(result.x).toBeLessThan(600); expect(circleHitsBox(result, obstacle)).toBe(false);
    }
  });
  it("can move away from a rounded box corner and slide along a wall", () => {
    const obstacle = box(500, 500), world = worldFor([obstacle]);
    const corner = { x: 543, y: 533 }; expect(world.clear(corner)).toBe(true);
    expect(world.move(corner, { x: 550, y: 540 })).toEqual({ x: 550, y: 540 });
    const start = { x: 546.02, y: 500 }, end = world.move(start, { x: 540, y: 505 });
    expect(end.y).toBeGreaterThan(start.y); expect(world.clear(end)).toBe(true);
  });
  it("ejects an actor safely when furniture is moved onto it", () => {
    const obstacle = box(500, 500, 45, 45, .4), world = worldFor([obstacle]);
    expect(world.clear(world.resolve({ x: 500, y: 500 }))).toBe(true);
  });
  it("allows only the assigned seat, without ignoring any other chair", () => {
    const world = worldFor([box(500, 500, 10, 10, 0, "mine"), box(600, 500, 10, 10, 0, "other")]);
    const a = actor("a", 500, 500, { status: "working", interactionTarget: "desk", workstation: { x: 500, y: 500, chairUid: "mine", deskUid: "desk", pose: "sitting", facing: 0, seatHeight: .3, surfaceHeight: .6 } });
    expect(world.clear(a, actorSeatPermission(a))).toBe(true);
    expect(world.clear({ x: 600, y: 500 }, actorSeatPermission(a))).toBe(false);
    expect(actorSeatPermission({ ...a, targetX: 700 })).toBeUndefined();
  });
  it("keeps two fast crossing bodies from passing through each other", () => {
    const previous = [actor("a", 300, 500), actor("b", 600, 500)];
    const desired = [actor("a", 600, 500), actor("b", 300, 500)];
    const result = resolveAgentCollisions({ agents: desired, previous, world: worldFor([]) }).agents;
    expect(result[0].x).toBeLessThan(result[1].x);
    expect(result[1].x - result[0].x).toBeGreaterThanOrEqual(AGENT_RADIUS * 2);
  });
  it.each(["sitting", "standing", "working_out", "dancing"] as const)("walking bodies avoid an anchored %s person", state => {
    const fixed = actor("fixed", 500, 500, { state, status: "working", interactionTarget: "desk" });
    const old = actor("walk", 600, 500), desired = { ...old, x: 500 };
    const result = resolveAgentCollisions({ agents: [fixed, desired], previous: [fixed, old], world: worldFor([]) }).agents;
    expect(result[0].x).toBe(500); expect(result[0].y).toBe(500);
    expect(Math.hypot(result[1].x - 500, result[1].y - 500)).toBeGreaterThanOrEqual(AGENT_RADIUS * 2);
  });
  it("includes janitors and separates coincident crowded spawns without wall penetration", () => {
    const obstacle = box(440, 500, 10, 150), world = worldFor([obstacle]);
    const agents = Array.from({ length: 14 }, (_, i) => actor(String(i), 480, 500, i === 0 ? { role: "janitor" } as Partial<RenderAgent> : {}));
    const result = resolveAgentCollisions({ agents, previous: [], world }).agents;
    for (const [i, a] of result.entries()) {
      expect(world.clear(a), `wall penetration ${i}`).toBe(true);
      for (const b of result.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y), "body overlap").toBeGreaterThanOrEqual(AGENT_RADIUS * 2 - .01);
    }
  });
  it("reroutes around people with the same volume checks", () => {
    const occupied = [{ x: 500, y: 500 }], grid = withAgentObstacles(buildNavGrid([], []), occupied);
    const route = astar(400, 500, 600, 500, grid); expect(route.at(-1)).toEqual({ x: 600, y: 500 });
    let previous = { x: 400, y: 500 };
    for (const next of route) {
      for (let t = 0; t <= 1; t += .05) expect(Math.hypot(previous.x + (next.x - previous.x) * t - 500, previous.y + (next.y - previous.y) * t - 500)).toBeGreaterThanOrEqual(AGENT_RADIUS * 2);
      previous = next;
    }
  });
});
