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
  width: number; height: number;
};
export type CompanyRoster = { projects: CompanyProject[]; members: CompanyMembership[] };
const COLORS = ["#53c9ba", "#7da3ed", "#d6a667", "#bb94dd"];

// Keep full-size desks and aisles. Three fixed-width lanes grow south as needed.
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
  const overflow = areas[0].agentIds.slice(sharedDesks.length);
  overflow.forEach((id, seat) => {
    const uid = `company:open-workspace:desk:${seat}`;
    const x = 110 + (seat % 3) * 150, y = 850 + Math.floor(seat / 3) * 160;
    furniture.push({ _uid: uid, type: "desk_cubicle", x, y },
      { _uid: `${uid}:computer`, type: "computer", x: x + 20, y: y - 13 });
    deskAssignments[uid] = id;
    areas[0].maxY = Math.max(areas[0].maxY, y + 110);
  });
  const laneBottoms = Array(3).fill(areas[0].maxY + 150) as number[];
  const roomWidth = 540, deskColumns = 3;
  projects.forEach((project, i) => {
    const lane = i % 3;
    const minX = 30 + lane * 580, minY = laneBottoms[lane];
    const ids = members.filter(m => m.projectId === project.id).map(m => m.id).sort();
    const count = Math.max(deskColumns, ids.length);
    const deskRows = Math.ceil(count / deskColumns);
    const roomHeight = 200 + deskRows * 160;
    laneBottoms[lane] = minY + roomHeight + 70;
    const area: WorkArea = { ...project, color: COLORS[i % COLORS.length], minX: minX + 10,
      maxX: minX + roomWidth - 10, minY, maxY: minY + roomHeight - 20,
      agentIds: ids, roamPoints: [
        { x: minX + 45, y: minY + 100 }, { x: minX + roomWidth / 2, y: minY + 100 },
        { x: minX + 45, y: minY + roomHeight - 70 },
      ] };
    areas.push(area);
    for (let seat = 0; seat < count; seat++) {
      const x = minX + 80 + (seat % deskColumns) * 150;
      const y = minY + 160 + Math.floor(seat / deskColumns) * 160;
      const uid = `company:${project.id}:desk:${seat}`;
      furniture.push({ _uid: uid, type: "desk_cubicle", x, y },
        { _uid: `${uid}:computer`, type: "computer", x: x + 20, y: y - 13 });
      if (ids[seat]) deskAssignments[uid] = ids[seat];
    }
    for (const [n, y] of [minY + 150, minY + roomHeight - 65].entries())
      furniture.push({ _uid: `company:${project.id}:plant:${n}`, type: "plant", x: minX + roomWidth - 45, y });
  });
  return { areas, furniture, deskAssignments, width: 1800,
    height: Math.max(1800, ...laneBottoms) };
}
