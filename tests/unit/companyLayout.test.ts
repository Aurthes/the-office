import { describe, expect, it } from "vitest";
import { buildCompanyLayout } from "../../src/features/retro-office/core/companyLayout";
import { getNavigationBounds } from "../../src/features/retro-office/core/geometry";
import { CollisionWorld } from "../../src/features/retro-office/core/collision";
import { astar, buildNavGrid } from "../../src/features/retro-office/core/navigation";

describe("company work areas", () => {
  it("places project chats at their own desks and other chats in the shared office", () => {
    const layout = buildCompanyLayout({ projects: [{ id: "p1", name: "Project A" }, { id: "p2", name: "Empty project" }],
      members: [{ id: "original-thread", projectId: "p1" }, { id: "free-thread", projectId: null }] });
    expect(layout.areas.map(a => [a.name, a.agentIds])).toEqual([
      ["Open Workspace", ["free-thread"]], ["Project A", ["original-thread"]], ["Empty project", []],
    ]);
    for (const [deskId, threadId] of Object.entries(layout.deskAssignments)) {
      const desk = layout.furniture.find(f => f._uid === deskId)!;
      expect(desk.type).toBe("desk_cubicle");
      expect(threadId === "free-thread" ? desk.y < 720 : desk.y > 870).toBe(true);
    }
    expect(new Set(layout.furniture.map(f => f._uid)).size).toBe(layout.furniture.length);
    expect(layout.furniture.filter(f => f.type === "desk_cubicle").length).toBeGreaterThan(8);
  });
  it("does not move people between desks when session activity reorders the list", () => {
    const projects = [{ id: "project", name: "Project" }];
    const members = [{ id: "b", projectId: "project" }, { id: "a", projectId: "project" }];
    expect(buildCompanyLayout({ projects, members }).deskAssignments)
      .toEqual(buildCompanyLayout({ projects, members: members.toReversed() }).deskAssignments);
  });
  it("adds full-size areas without shrinking existing areas as projects are added", () => {
    const projects = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));
    const small = buildCompanyLayout({ projects: projects.slice(0, 3), members: [] });
    const large = buildCompanyLayout({ projects, members: [] });
    expect(large.areas.slice(1, 4)).toEqual(small.areas.slice(1));
    expect(large.height).toBeGreaterThan(1800);
    for (const a of large.areas.slice(1)) {
      expect(a.maxX - a.minX).toBeGreaterThanOrEqual(500);
      expect(a.maxY - a.minY).toBeGreaterThanOrEqual(340);
      for (const b of large.areas.slice(1).filter(b => b.id !== a.id)) {
        expect(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY).toBe(true);
      }
    }
  });
  it("grows crowded projects and shared desks while keeping workstations inside their areas", () => {
    const members = Array.from({ length: 100 }, (_, i) => ({ id: `m${String(i).padStart(3, "0")}`, projectId: i < 60 ? "p" : null }));
    const layout = buildCompanyLayout({ projects: [{ id: "p", name: "Crowded" }], members });
    expect(Object.keys(layout.deskAssignments)).toHaveLength(members.length);
    expect(layout.areas[1].maxY - layout.areas[1].minY).toBeGreaterThan(3000);
    const projectDesks = layout.furniture.filter(f => f.type === "desk_cubicle" && f._uid.startsWith("company:p:"));
    for (const desk of projectDesks) {
      const bounds = getNavigationBounds(desk), area = layout.areas[1];
      expect(bounds.x).toBeGreaterThan(area.minX);
      expect(bounds.x + bounds.w).toBeLessThan(area.maxX);
      expect(bounds.y).toBeGreaterThan(area.minY);
      expect(bounds.y + bounds.h + 32).toBeLessThan(area.maxY);
    }
    for (const desk of layout.furniture.filter(f => f.type === "desk_cubicle" && f._uid.startsWith("company:open-workspace:"))) {
      expect(desk.y + 100).toBeLessThan(layout.areas[0].maxY);
    }
  });
  it("extends movement and pathfinding to the expanded floor", () => {
    const world = new CollisionWorld();
    world.setBounds(1800, 6000);
    const end = { x: 500, y: 5200 };
    expect(world.clear(end)).toBe(true);
    expect(world.move({ x: 500, y: 1750 }, end)).toEqual(end);
    expect(astar(500, 1750, end.x, end.y, buildNavGrid([], [], world.bounds)).at(-1)).toEqual(end);
    expect(world.clear({ x: 500, y: 6000 })).toBe(false);
  });
});
