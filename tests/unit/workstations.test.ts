// @vitest-environment node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { Box3, Matrix4 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { AGENT_RADIUS, SCALE } from "@/features/retro-office/core/constants";
import { CHAIR_SEAT, WORKSTATION_SCALE, getItemBaseSize, getItemRotationRadians, getNavigationBounds, workstationClearance, workstationPoint } from "@/features/retro-office/core/geometry";
import { astar, buildNavGrid, getDeskLocations, resolveDeskIndexForItem } from "@/features/retro-office/core/navigation";
import { materializeDefaults } from "@/features/retro-office/core/furnitureDefaults";
import { buildCompanyLayout } from "@/features/retro-office/core/companyLayout";
import models from "@/features/retro-office/core/workstation-models.json";
import type { FurnitureItem } from "@/features/retro-office/core/types";
const desk: FurnitureItem = { _uid: "desk", type: "desk_cubicle", x: 500, y: 600 };
const chair: FurnitureItem = { _uid: "chair", type: "chair", x: 520, y: 590, facing: 180 };
const clearance = (point: { x: number; y: number }, item: FurnitureItem) => {
  return workstationClearance(point, item);
};
const rotated = (item: FurnitureItem, angle: number): FurnitureItem => {
  const { width, height } = getItemBaseSize(item), pivot = { x: 550, y: 627.5 }, radians = angle * Math.PI / 180;
  const dx = item.x + width / 2 - pivot.x, dy = item.y + height / 2 - pivot.y;
  return { ...item, x: pivot.x + dx * Math.cos(radians) + dy * Math.sin(radians) - width / 2,
    y: pivot.y - dx * Math.sin(radians) + dy * Math.cos(radians) - height / 2, facing: (item.facing || 0) + angle };
};
describe("model-aligned workstations", () => {
  it("matches the renderer's real GLB volumes, scale and pivot after rotation", async () => {
    for (const [name, item] of [["desk", desk], ["chairDesk", chair]] as const) {
      const bytes = await fs.readFile(path.resolve("public/office-assets/models/furniture/" + name + ".glb"));
      expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(models[name].sha256);
      const { scene } = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, "");
      const scale = WORKSTATION_SCALE[item.type as keyof typeof WORKSTATION_SCALE];
      for (const angle of [0, 90, 180, 270, 35]) {
        const source = rotated(item, angle), { width, height } = getItemBaseSize(source);
        const matrix = new Matrix4().makeTranslation(source.x * SCALE, 0, source.y * SCALE)
          .multiply(new Matrix4().makeTranslation(width * SCALE / 2, 0, height * SCALE / 2))
          .multiply(new Matrix4().makeRotationY(getItemRotationRadians(source)))
          .multiply(new Matrix4().makeTranslation(-width * SCALE / 2, 0, -height * SCALE / 2))
          .multiply(new Matrix4().makeScale(scale, scale, scale));
        const actual = new Box3().setFromObject(scene).applyMatrix4(matrix), bounds = getNavigationBounds(source);
        expect(bounds.x).toBeCloseTo(actual.min.x / SCALE, 5); expect(bounds.y).toBeCloseTo(actual.min.z / SCALE, 5);
        expect(bounds.w).toBeCloseTo((actual.max.x - actual.min.x) / SCALE, 5); expect(bounds.h).toBeCloseTo((actual.max.z - actual.min.z) / SCALE, 5);
      }
    }
  });
  it("stands outside the real desk when no chair exists; old target is inside it", () => {
    const [work] = getDeskLocations([desk]);
    expect(work.pose).toBe("standing"); expect(work.chairUid).toBeUndefined();
    expect(clearance(work, desk)).toBeGreaterThanOrEqual(AGENT_RADIUS);
    expect(clearance({ x: desk.x + 40, y: desk.y - 5 }, desk)).toBe(0);
    expect(Math.cos(work.facing)).toBeCloseTo(-1);
  });
  it("uses the actual chair cushion and height for a seated person", () => {
    const [work] = getDeskLocations([desk, chair]);
    expect(work.pose).toBe("sitting"); expect(work.chairUid).toBe(chair._uid);
    expect({ x: work.x, y: work.y }).toEqual(workstationPoint(chair, CHAIR_SEAT[0], CHAIR_SEAT[2]));
    expect(work.seatHeight).toBeCloseTo(0.2802, 4);
    expect(clearance(work, desk)).toBeGreaterThanOrEqual(AGENT_RADIUS);
  });
  it("keeps rotated desk/chair pairs aligned and routes every approach clear of the desk", () => {
    for (const angle of [0, 35, 45, 90, 180, 270]) {
      const d = rotated(desk, angle), c = rotated(chair, angle);
      for (const furniture of [[d], [d, c]]) {
        const [work] = getDeskLocations(furniture);
        expect(work.pose).toBe(furniture.length === 2 ? "sitting" : "standing");
        const grid = buildNavGrid(furniture);
        for (const start of [{ x: 300, y: 620 }, { x: 800, y: 620 }, { x: 550, y: 350 }, { x: 550, y: 850 }]) {
          for (const [from, to] of [[start, work], [work, start]]) {
            const route = astar(from.x, from.y, to.x, to.y, grid);
            expect(route.length).toBeGreaterThan(0);
            let previous = from;
            for (const next of route) {
              const steps = Math.ceil(Math.hypot(next.x - previous.x, next.y - previous.y));
              for (let i = 1; i <= steps; i++) {
                const point = { x: previous.x + (next.x - previous.x) * i / steps, y: previous.y + (next.y - previous.y) * i / steps };
                expect(clearance(point, d), "agent radius clips a rotated desk").toBeGreaterThanOrEqual(AGENT_RADIUS - 0.01);
              }
              previous = next;
            }
          }
        }
      }
    }
  });
  it("does not invent seats, share chairs, or sit in a chair embedded in the desk", () => {
    const defaults = getDeskLocations(materializeDefaults());
    expect(defaults.filter(work => work.pose === "sitting")).toHaveLength(7);
    expect(defaults.filter(work => work.pose === "standing")).toHaveLength(1);
    expect(getDeskLocations([desk, { ...chair, facing: 0 }])[0].pose).toBe("standing");
    const shared = getDeskLocations([desk, { ...desk, _uid: "second", x: 535 }, chair]);
    expect(shared.filter(work => work.chairUid)).toHaveLength(1);
    const company = buildCompanyLayout({ projects: [{ id: "p", name: "Project" }], members: [{ id: "a", projectId: "p" }] });
    const project = getDeskLocations(company.furniture).filter(work => work.deskUid.startsWith("company:"));
    expect(project.length).toBeGreaterThan(0); expect(project.every(work => work.pose === "standing")).toBe(true);
  });
  it("keeps desk assignments by stable ID when a chair is moved or removed", () => {
    const before = getDeskLocations([desk, chair]), after = getDeskLocations([desk]);
    expect(before[0].y).not.toBe(after[0].y);
    expect(resolveDeskIndexForItem(desk, before)).toBe(0); expect(resolveDeskIndexForItem(desk, after)).toBe(0);
  });
  it("never appends a blocked requested destination after finding a safe neighbour", () => {
    const grid = buildNavGrid([desk]), inside = { x: desk.x + 40, y: desk.y - 5 };
    const route = astar(350, 650, inside.x, inside.y, grid);
    expect(route.at(-1)).not.toEqual(inside);
    expect(clearance(route.at(-1)!, desk)).toBeGreaterThanOrEqual(AGENT_RADIUS);
    const spawn = astar(inside.x, inside.y, inside.x, inside.y, grid).at(-1)!;
    expect(clearance(spawn, desk)).toBeGreaterThanOrEqual(AGENT_RADIUS);
  });
});
