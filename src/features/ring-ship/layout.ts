import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";

export type RingIndex = 0 | 1 | 2;
export type CabinKind = "work" | "reserve" | "garden" | "hydroponics" | "canteen" | "gym" | "servers" | "maintenance" | "lounge" | "cargo" | "observatory" | "quarters";
export type ShipPoint = { x: number; z: number };
export type ShipAssignment = { ring: RingIndex; slot: number; span: number };
export type ShipAllocation = { version: 1; sectors: number; projects: Record<string, ShipAssignment> };
export type ShipRing = { index: RingIndex; radius: number; depth: number; capacity: number };
export type ShipCabin = {
  id: string; ring: RingIndex; slot: number; kind: CabinKind; name: string; color: string;
  projectId?: string; agentIds: string[];
};
export type ShipSeat = ShipPoint & { agentId: string; cabinId: string; projectId: string; ring: RingIndex; angle: number; facing: number };
export type ShipLayout = {
  allocation: ShipAllocation; rings: ShipRing[]; cabins: ShipCabin[];
  seats: Record<string, ShipSeat>; radius: number; spokes: number[];
};
export const BASE_SECTORS = 8;
export const SHARED_PROJECT_ID = "open-workspace";
export const RING_RADII = [10, 17, 24] as const;
export const RING_DEPTHS = [4.4, 5.4, 6.4] as const;
export const RING_CAPACITIES = [3, 6, 8] as const;
export const PUBLIC_CABINS: ReadonlyArray<{ id: string; ring: RingIndex; slot: number; kind: CabinKind; name: string; color: string }> = [
  { id: "public:lounge", ring: 0, slot: 0, kind: "lounge", name: "观景休息舱", color: "#d6af71" },
  { id: "public:servers", ring: 0, slot: 4, kind: "servers", name: "服务器机房", color: "#77a9ce" },
  { id: "public:garden", ring: 1, slot: 0, kind: "garden", name: "植物园", color: "#75b788" },
  { id: "public:hydroponics", ring: 1, slot: 4, kind: "hydroponics", name: "水培菜园", color: "#79c5aa" },
  { id: "public:canteen", ring: 1, slot: 6, kind: "canteen", name: "餐厅与咖啡舱", color: "#daa26a" },
  { id: "public:gym", ring: 2, slot: 0, kind: "gym", name: "健身舱", color: "#8da4d2" },
  { id: "public:cargo", ring: 2, slot: 1, kind: "cargo", name: "补给储物舱", color: "#bdab83" },
  { id: "public:observatory", ring: 2, slot: 2, kind: "observatory", name: "观星舱", color: "#8fb9ce" },
  { id: "public:quarters", ring: 2, slot: 3, kind: "quarters", name: "船员休息舱", color: "#b5a5c4" },
  { id: "public:maintenance", ring: 2, slot: 4, kind: "maintenance", name: "飞船维修舱", color: "#d3a47a" },
];
const TAU = Math.PI * 2;
const COLORS = ["#61bfb7", "#80a9dd", "#d9ac71", "#af96ce", "#b4bf7a"];
export function projectColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}
export function shipPoint(radius: number, angle: number): ShipPoint { return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius }; }
export function cabinAngle(layout: Pick<ShipLayout, "allocation">, slot: number) { return (slot + 0.5) * TAU / layout.allocation.sectors; }
export function desiredRing(count: number): RingIndex { return count <= RING_CAPACITIES[0] ? 0 : count <= RING_CAPACITIES[1] ? 1 : 2; }

export function parseShipAllocation(value: string | null): ShipAllocation | undefined {
  try {
    const parsed = JSON.parse(value || "null");
    if (parsed?.version !== 1 || !Number.isInteger(parsed.sectors) || parsed.sectors < BASE_SECTORS || parsed.sectors > 4096 || !parsed.projects || typeof parsed.projects !== "object" || Array.isArray(parsed.projects)) return;
    for (const a of Object.values(parsed.projects) as ShipAssignment[]) {
      if (!a || ![0, 1, 2].includes(a.ring) || !Number.isInteger(a.slot) || !Number.isInteger(a.span) || a.slot < 0 || a.span < 1 || a.slot + a.span > parsed.sectors) return;
    }
    return parsed as ShipAllocation;
  } catch { return; }
}

// Shared angular divisions close all three rings. Increasing N by one scales
// every centerline radius by (N+1)/N; each existing bay keeps its floor area.
export function buildShipLayout(roster: CompanyRoster, previous?: ShipAllocation): ShipLayout {
  const projects = new Map(roster.projects.filter(p => p.id !== SHARED_PROJECT_ID).map(p => [p.id, { ...p, agentIds: [] as string[] }]));
  projects.set(SHARED_PROJECT_ID, { id: SHARED_PROJECT_ID, name: "共享工作舱", agentIds: [] });
  const seen = new Set<string>();
  for (const member of roster.members) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    const group = projects.get(member.projectId || "") ?? projects.get(SHARED_PROJECT_ID)!;
    group.agentIds.push(member.id);
  }
  const groups = [...projects.values()].sort((a, b) => {
    const aOld = previous?.projects[a.id], bOld = previous?.projects[b.id];
    return Number(!aOld) - Number(!bOld) || b.agentIds.length - a.agentIds.length || a.id.localeCompare(b.id);
  });
  for (const group of groups) group.agentIds.sort();
  let sectors = Math.max(BASE_SECTORS, previous?.sectors || 0);
  if (!previous) {
    for (const ring of [0, 1, 2] as const) {
      const needed = groups.filter(g => desiredRing(g.agentIds.length) === ring).reduce((sum, group) => sum + Math.max(1, Math.ceil(group.agentIds.length / RING_CAPACITIES[ring])), 0);
      sectors = Math.max(sectors, needed + PUBLIC_CABINS.filter(p => p.ring === ring).length + 2);
    }
  }
  let assignments: Record<string, ShipAssignment>;
  for (;;) {
    const occupied = [new Set<number>(), new Set<number>(), new Set<number>()];
    for (const cabin of PUBLIC_CABINS) occupied[cabin.ring].add(cabin.slot);
    assignments = Object.create(null) as Record<string, ShipAssignment>;
    let complete = true;
    for (const group of groups) {
      const firstRing = desiredRing(group.agentIds.length);
      const old = previous?.projects[group.id];
      let assigned = false;
      for (let candidate = firstRing; candidate <= 2; candidate++) {
        const ring = candidate as RingIndex;
        const span = Math.max(1, Math.ceil(group.agentIds.length / RING_CAPACITIES[ring]));
        const free = (slot: number) => slot >= 0 && slot + span <= sectors && Array.from({ length: span }, (_, i) => slot + i).every(i => !occupied[ring].has(i));
        const slot = old?.ring === ring && free(old.slot) ? old.slot : Array.from({ length: sectors }, (_, i) => i).find(free);
        if (slot === undefined) continue;
        assignments[group.id] = { ring, slot, span };
        for (let i = 0; i < span; i++) occupied[ring].add(slot + i);
        assigned = true; break;
      }
      if (!assigned) { complete = false; break; }
    }
    if (complete) break;
    sectors += 1;
  }
  const allocation: ShipAllocation = { version: 1, sectors, projects: assignments! };
  const rings: ShipRing[] = RING_RADII.map((r, index) => ({ index: index as RingIndex, radius: r * sectors / BASE_SECTORS, depth: RING_DEPTHS[index], capacity: RING_CAPACITIES[index] }));
  const cabins: ShipCabin[] = rings.flatMap(ring => Array.from({ length: sectors }, (_, slot) => ({
    id: `bay:${ring.index}:${slot}`, ring: ring.index, slot, kind: "reserve" as const,
    name: "预留舱", color: "#819ea6", agentIds: [],
  })));
  for (const p of PUBLIC_CABINS) Object.assign(cabins[p.ring * sectors + p.slot], p, { id: p.id });
  const seats: Record<string, ShipSeat> = Object.create(null);
  for (const group of groups) {
    const assignment = assignments![group.id], ring = rings[assignment.ring];
    for (let part = 0; part < assignment.span; part++) {
      const slot = assignment.slot + part, cabin = cabins[assignment.ring * sectors + slot];
      const ids = group.agentIds.slice(part * ring.capacity, (part + 1) * ring.capacity);
      Object.assign(cabin, { kind: "work", name: group.name, color: projectColor(group.id), projectId: group.id, agentIds: ids });
      ids.forEach((agentId, seat) => {
        const desk = seatPosition({ allocation, rings }, cabin, seat);
        seats[agentId] = { ...desk.agent, agentId, cabinId: cabin.id, projectId: group.id, ring: ring.index, angle: desk.angle, facing: desk.facing };
      });
    }
  }
  return { allocation, rings, cabins, seats, radius: rings[2].radius + rings[2].depth / 2,
    spokes: Array.from({ length: 4 }, (_, i) => Math.floor(i * sectors / 4) * TAU / sectors) };
}

export function seatPosition(layout: Pick<ShipLayout, "allocation" | "rings">, cabin: ShipCabin, index: number) {
  const ring = layout.rings[cabin.ring], columns = cabin.ring === 2 ? 4 : 3;
  const column = index % columns, row = Math.floor(index / columns);
  const arcWidth = TAU * ring.radius / layout.allocation.sectors;
  const tangent = (column - (columns - 1) / 2) * (arcWidth - 2.0) / columns;
  const radial = cabin.ring === 0 ? 1.05 : row === 0 ? 1.6 : -1.6;
  const angle = cabinAngle(layout, cabin.slot) + tangent / ring.radius;
  const chairOffset = radial > 0 ? -0.53 : 0.53;
  return { angle, desk: shipPoint(ring.radius + radial, angle), agent: shipPoint(ring.radius + radial + chairOffset, angle),
    facing: radial > 0 ? angle : angle + Math.PI };
}

export function areaBounds(layout: ShipLayout, id: string) {
  const bays = layout.cabins.filter(c => c.id === id || c.projectId === id);
  if (!bays.length) return { x: 0, z: 0, width: layout.radius * 2, depth: layout.radius * 2 };
  const points = bays.flatMap(c => {
    const ring = layout.rings[c.ring];
    return [-0.5, 0, 0.5].flatMap(offset => [ring.radius - ring.depth / 2, ring.radius + ring.depth / 2].map(r => shipPoint(r, (c.slot + 0.5 + offset) * TAU / layout.allocation.sectors)));
  });
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2,
    width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
}

function shortestAngle(from: number, to: number) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); }
function arc(radius: number, from: number, to: number): ShipPoint[] {
  const delta = shortestAngle(from, to), steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.12));
  return Array.from({ length: steps }, (_, i) => shipPoint(radius, from + delta * (i + 1) / steps));
}
export function routeBetweenCabins(layout: ShipLayout, from: ShipSeat, destination: ShipCabin): ShipPoint[] {
  const a = layout.rings[from.ring], b = layout.rings[destination.ring], targetAngle = cabinAngle(layout, destination.slot);
  if (a.index === b.index) return [shipPoint(a.radius, from.angle), ...arc(a.radius, from.angle, targetAngle)];
  const spoke = [...layout.spokes].sort((x, y) => Math.abs(shortestAngle(from.angle, x)) + Math.abs(shortestAngle(x, targetAngle)) - Math.abs(shortestAngle(from.angle, y)) - Math.abs(shortestAngle(y, targetAngle)))[0];
  return [shipPoint(a.radius, from.angle), ...arc(a.radius, from.angle, spoke), shipPoint(b.radius, spoke), ...arc(b.radius, spoke, targetAngle)];
}

export const PUBLIC_DESCRIPTIONS: Record<CabinKind, string> = {
  work: "按 Project 分配的工作舱，点击员工继续原会话。", reserve: "舱体和接口已就绪，后续 Project 可直接启用。",
  garden: "树木、花草和休息座椅组成的自然空间。", hydroponics: "水培种植床、补光灯和循环水系统，供飞船种植食物。",
  canteen: "船员餐桌、厨房和咖啡区。", gym: "跑步、力量训练和活动身体的公共舱。", servers: "服务器、冷却和通信设备。",
  maintenance: "飞船的工具、备件和维修区。", lounge: "看星空、休息和交流的公共空间。",
  cargo: "储存飞船补给和备用设备的货舱。", observatory: "观测星空和远方航路的公共观景舱。", quarters: "船员的休息铺位和个人储物空间。",
};
