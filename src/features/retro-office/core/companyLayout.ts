import { materializeDefaults } from "./furnitureDefaults";
import { ROAM_POINTS } from "./navigation";
import type { CanvasPoint, FurnitureItem } from "./types";

export type CompanyMembership = { id: string; projectId: string | null };
export type CompanyProject = { id: string; name: string };
export type WorkArea = {
  id: string; name: string; color: string;
  minX: number; maxX: number; minY: number; maxY: number;
  agentIds: string[]; roamPoints: CanvasPoint[];
};
export type CompanyLayout = {
  areas: WorkArea[]; furniture: FurnitureItem[]; deskAssignments: Record<string, string>;
};
export type CompanyRoster = { projects: CompanyProject[]; members: CompanyMembership[] };
const COLORS = ["#53c9ba", "#7da3ed", "#d6a667", "#bb94dd"];

// Keep the original shared office. The extension uses the existing world/nav grid.
export function buildCompanyLayout({ projects, members }: CompanyRoster): CompanyLayout {
  const projectIds = new Set(projects.map(p => p.id));
  const unassigned = members.filter(m => !m.projectId || !projectIds.has(m.projectId));
  const areas: WorkArea[] = [{ id: "open-workspace", name: "Open Workspace", color: "#74c69d",
    minX: 20, maxX: 1780, minY: 20, maxY: 720,
    agentIds: unassigned.map(m => m.id).sort(), roamPoints: ROAM_POINTS }];
  const furniture = materializeDefaults();
  const deskAssignments: Record<string, string> = {};
  const sharedDesks = furniture.filter(item => item.type === "desk_cubicle");
  areas[0].agentIds.forEach((id, i) => { if (sharedDesks[i]) deskAssignments[sharedDesks[i]._uid] = id; });
  const columns = Math.min(3, Math.max(1, projects.length));
  const rows = Math.ceil(projects.length / columns);
  const roomWidth = 1740 / columns, roomHeight = 540 / Math.max(1, rows);
  projects.forEach((project, i) => {
    const minX = 30 + (i % columns) * roomWidth, minY = 870 + Math.floor(i / columns) * roomHeight;
    const ids = members.filter(m => m.projectId === project.id).map(m => m.id).sort();
    const area: WorkArea = { ...project, color: COLORS[i % COLORS.length], minX: minX + 10,
      maxX: minX + roomWidth - 10, minY, maxY: minY + roomHeight - 20,
      agentIds: ids, roamPoints: [
        { x: minX + 45, y: minY + 100 }, { x: minX + roomWidth / 2, y: minY + 100 },
        { x: minX + 45, y: minY + roomHeight - 70 },
      ] };
    areas.push(area);
    const deskColumns = Math.max(1, Math.floor((roomWidth - 80) / 150));
    const count = Math.max(deskColumns * (roomHeight >= 400 ? 2 : 1), ids.length);
    const deskTop = roomHeight >= 400 ? 165 : 90;
    const deskRows = Math.ceil(count / deskColumns);
    for (let seat = 0; seat < count; seat++) {
      const x = minX + 80 + (seat % deskColumns) * 150;
      const y = minY + deskTop + Math.floor(seat / deskColumns) * Math.min(160, (roomHeight - deskTop - 85) / Math.max(1, deskRows - 1));
      const uid = `company:${project.id}:desk:${seat}`;
      furniture.push({ _uid: uid, type: "desk_cubicle", x, y },
        { _uid: `${uid}:computer`, type: "computer", x: x + 20, y: y - 13 });
      if (ids[seat]) deskAssignments[uid] = ids[seat];
    }
    for (const [n, y] of [minY + 150, minY + roomHeight - 65].entries())
      furniture.push({ _uid: `company:${project.id}:plant:${n}`, type: "plant", x: minX + roomWidth - 45, y });
  });
  return { areas, furniture, deskAssignments };
}
