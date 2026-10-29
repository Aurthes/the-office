import { describe, expect, it } from "vitest";
import { buildCompanyLayout } from "../../src/features/retro-office/core/companyLayout";

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
});
