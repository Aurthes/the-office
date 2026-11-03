import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { BAR_LAYOUT } from "./barLayout";
import { BREAK_ROOM } from "./breakRoomLayout";

export type RingIndex = 0 | 1 | 2;
export type DeckIndex = 0 | 1 | 2;
export const DECKS = [0, 1, 2] as const;
export const DECK_STEP = 10;
export const SHIP_CORRIDOR_START = 3.2;
// Leave room for opposing crew and companions to pass with collision enabled.
export const SHIP_CORRIDOR_WIDTH = 3.2;
// Two maximum-size crew members, with room to pass rather than squeeze.
export const SHIP_AISLE_WIDTH = 2.4;
export const DECK_NAMES = ["Main deck", "Expansion deck", "Reserve deck"] as const;
export type CabinKind = "work" | "reserve" | "garden" | "hydroponics" | "canteen" | "break" | "gym" | "servers" | "ai" | "maintenance" | "lounge" | "bar" | "cargo" | "observatory" | "quarters" | "return" | "monitor" | "cloning";
export type ShipPoint = { x: number; z: number };
export type ShipAssignment = { deck?: DeckIndex; ring: RingIndex; slot: number; span: number };
type CabinLocation = { deck: DeckIndex; ring: RingIndex; slot: number };
export type ShipAllocation = { version: 1; sectors: number; projects: Record<string, ShipAssignment>; monitorRoom?: CabinLocation; cloningRoom?: CabinLocation; serverRoom?: CabinLocation; breakRoom?: CabinLocation };
export type ShipRing = { index: RingIndex; radius: number; depth: number; capacity: number };
export type ShipCabin = {
  id: string; deck: DeckIndex; ring: RingIndex; slot: number; kind: CabinKind; name: string; color: string;
  projectId?: string; agentIds: string[];
};
export type ShipSeat = ShipPoint & { agentId: string; cabinId: string; projectId: string; deck: DeckIndex; ring: RingIndex; angle: number; facing: number };
export type ShipLayout = {
  allocation: ShipAllocation; rings: ShipRing[]; cabins: ShipCabin[];
  seats: Record<string, ShipSeat>; radius: number; spokes: number[];
};
export const BASE_SECTORS = 8;
export const SHARED_PROJECT_ID = "open-workspace";
export const RING_RADII = [12, 26, 42] as const;
export const RING_DEPTHS = [5.6, 6.8, 8] as const;
export const RING_CAPACITIES = [3, 6, 8] as const;
export const CLONING_POD = { spacing: 2, v: 1.6, width: 1.9, length: 3.15 } as const;
export const CLONING_AISLE_V = -2.05;
export const CLONING_LAB_WIDTH = 8.4;
export const PUBLIC_CABINS: ReadonlyArray<{ id: string; ring: RingIndex; slot: number; kind: CabinKind; name: string; color: string }> = [
  { id: "public:lounge", ring: 0, slot: 0, kind: "lounge", name: "Observation lounge", color: "#d6af71" },
  { id: "public:bar", ring: 0, slot: 7, kind: "bar", name: "Listening bar", color: "#c6a46a" },
  { id: "public:servers", ring: 0, slot: 4, kind: "ai", name: "AI Center", color: "#86e6de" },
  { id: "public:garden", ring: 1, slot: 0, kind: "garden", name: "Rainforest habitat", color: "#75b788" },
  { id: "public:hydroponics", ring: 1, slot: 4, kind: "hydroponics", name: "Hydroponics", color: "#79c5aa" },
  { id: "public:canteen", ring: 1, slot: 6, kind: "canteen", name: "Dining and coffee", color: "#daa26a" },
  { id: "public:gym", ring: 2, slot: 0, kind: "gym", name: "Gym", color: "#8da4d2" },
  { id: "public:cargo", ring: 2, slot: 1, kind: "cargo", name: "Supply storage", color: "#bdab83" },
  { id: "public:observatory", ring: 2, slot: 2, kind: "observatory", name: "Observatory", color: "#8fb9ce" },
  { id: "public:quarters", ring: 2, slot: 3, kind: "quarters", name: "Hibernation bay", color: "#b5a5c4" },
  { id: "public:maintenance", ring: 2, slot: 4, kind: "maintenance", name: "Maintenance", color: "#d3a47a" },
  { id: "public:return", ring: 2, slot: 7, kind: "return", name: "Return bay", color: "#f5bb68" },
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
export function cloningPoint(layout: ShipLayout, cabin: ShipCabin, u: number, v: number): ShipPoint {
  const angle = cabinAngle(layout, cabin.slot), center = shipPoint(layout.rings[cabin.ring].radius, angle);
  return { x: center.x + u * Math.cos(angle) + v * Math.sin(angle), z: center.z - u * Math.sin(angle) + v * Math.cos(angle) };
}
export function desiredRing(count: number): RingIndex { return count <= RING_CAPACITIES[0] ? 0 : count <= RING_CAPACITIES[1] ? 1 : 2; }

export function parseShipAllocation(value: string | null): ShipAllocation | undefined {
  try {
    const parsed = JSON.parse(value || "null");
    if (parsed?.version !== 1 || !Number.isInteger(parsed.sectors) || parsed.sectors < BASE_SECTORS || parsed.sectors > 4096 || !parsed.projects || typeof parsed.projects !== "object" || Array.isArray(parsed.projects)) return;
    for (const a of Object.values(parsed.projects) as ShipAssignment[]) {
      if (!a || (a.deck !== undefined && !DECKS.includes(a.deck)) || ![0, 1, 2].includes(a.ring) || !Number.isInteger(a.slot) || !Number.isInteger(a.span) || a.slot < 0 || a.span < 1 || a.slot + a.span > parsed.sectors) return;
    }
    for (const room of [parsed.monitorRoom, parsed.cloningRoom, parsed.serverRoom, parsed.breakRoom]) {
      if (room && (!DECKS.includes(room.deck) || ![0, 1, 2].includes(room.ring) || !Number.isInteger(room.slot) || room.slot < 0 || room.slot >= parsed.sectors)) return;
    }
    return parsed as ShipAllocation;
  } catch { return; }
}

// Shared angular divisions close all three rings. Increasing N by one scales
// every centerline radius by (N+1)/N; each existing bay keeps its floor area.
export function buildShipLayout(roster: CompanyRoster, previous?: ShipAllocation): ShipLayout {
  const projects = new Map(roster.projects.filter(p => p.id !== SHARED_PROJECT_ID).map(p => [p.id, { ...p, agentIds: [] as string[] }]));
  projects.set(SHARED_PROJECT_ID, { id: SHARED_PROJECT_ID, name: "Shared workspace", agentIds: [] });
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
  let serverRoom = previous?.serverRoom;
  let breakRoom = previous?.breakRoom;
  let assignments: Record<string, ShipAssignment>;
  for (;;) {
    const occupied = DECKS.map(() => [new Set<number>(), new Set<number>(), new Set<number>()]);
    for (const deck of DECKS) for (const cabin of PUBLIC_CABINS) {
      if ((cabin.kind !== "return" && cabin.kind !== "bar") || deck === 0) occupied[deck][cabin.ring].add(cabin.kind === "bar" ? sectors - 1 : cabin.slot);
    }
    for (const room of [previous?.monitorRoom, previous?.cloningRoom, previous?.serverRoom, previous?.breakRoom]) {
      if (room) occupied[room.deck][room.ring].add(room.slot);
    }
    if (!serverRoom) {
      for (const ring of [1, 0, 2] as const) {
        const slot = Array.from({ length: sectors }, (_, i) => i).find(slot => !occupied[0][ring].has(slot) && !groups.some(group => {
          const old = previous?.projects[group.id];
          return old && (old.deck ?? 0) === 0 && old.ring === ring && slot >= old.slot && slot < old.slot + old.span;
        }));
        if (slot !== undefined) { serverRoom = { deck: 0, ring, slot }; break; }
      }
      // A full main deck needs one new bay; keep existing project placements.
      if (!serverRoom) { sectors += 1; continue; }
    }
    occupied[0][serverRoom.ring].add(serverRoom.slot);
    if (!breakRoom) {
      for (const ring of [0, 1, 2] as const) {
        const slot = Array.from({ length: sectors }, (_, i) => i).find(slot => !occupied[0][ring].has(slot) && !groups.some(group => {
          const old = previous?.projects[group.id];
          return old && (old.deck ?? 0) === 0 && old.ring === ring && slot >= old.slot && slot < old.slot + old.span;
        }));
        if (slot !== undefined) { breakRoom = { deck: 0, ring, slot }; break; }
      }
      if (!breakRoom) { sectors += 1; continue; }
    }
    occupied[breakRoom.deck][breakRoom.ring].add(breakRoom.slot);
    assignments = Object.create(null) as Record<string, ShipAssignment>;
    let complete = true;
    for (const group of groups) {
      const firstRing = desiredRing(group.agentIds.length);
      const old = previous?.projects[group.id];
      let assigned = false;
      // Prefer the existing deck, then ready cabins on the other decks.
      const decks = old ? [old.deck ?? 0, ...DECKS.filter(d => d !== (old.deck ?? 0))] : DECKS;
      for (const deck of decks) {
        for (let candidate = firstRing; candidate <= 2; candidate++) {
          const ring = candidate as RingIndex;
          const span = Math.max(1, Math.ceil(group.agentIds.length / RING_CAPACITIES[ring]));
          const free = (slot: number) => slot >= 0 && slot + span <= sectors && Array.from({ length: span }, (_, i) => slot + i).every(i => !occupied[deck][ring].has(i));
          const slot = old?.ring === ring && (old.deck ?? 0) === deck && free(old.slot) ? old.slot : Array.from({ length: sectors }, (_, i) => i).find(free);
          if (slot === undefined) continue;
          assignments[group.id] = { deck, ring, slot, span };
          for (let i = 0; i < span; i++) occupied[deck][ring].add(slot + i);
          assigned = true; break;
        }
        if (assigned) break;
      }
      if (!assigned) { complete = false; break; }
    }
    if (complete) break;
    sectors += 1;
  }
  const allocation: ShipAllocation = { version: 1, sectors, projects: assignments!, serverRoom, breakRoom };
  const rings: ShipRing[] = RING_RADII.map((r, index) => ({ index: index as RingIndex, radius: r * sectors / BASE_SECTORS, depth: RING_DEPTHS[index], capacity: RING_CAPACITIES[index] }));
  const cabins: ShipCabin[] = DECKS.flatMap(deck => rings.flatMap(ring => Array.from({ length: sectors }, (_, slot) => ({
    id: cabinId(`bay:${ring.index}:${slot}`, deck), deck, ring: ring.index, slot, kind: "reserve" as const,
    name: "Reserve cabin", color: "#819ea6", agentIds: [],
  }))));
  for (const deck of DECKS) for (const p of PUBLIC_CABINS) {
    const slot = p.kind === "bar" ? sectors - 1 : p.slot;
    if ((p.kind !== "return" && p.kind !== "bar") || deck === 0) Object.assign(cabins[deck * 3 * sectors + p.ring * sectors + slot], p, { id: cabinId(p.id, deck), slot });
    if (p.kind === "ai" && deck !== 0) Object.assign(cabins[deck * 3 * sectors + p.ring * sectors + p.slot], { kind: "servers", name: "Server room", color: "#77a9ce" });
  }
  const seats: Record<string, ShipSeat> = Object.create(null);
  for (const group of groups) {
    const assignment = assignments![group.id], ring = rings[assignment.ring];
    for (let part = 0; part < assignment.span; part++) {
      const slot = assignment.slot + part, deck = assignment.deck ?? 0, cabin = cabins[deck * 3 * sectors + assignment.ring * sectors + slot];
      const ids = group.agentIds.slice(part * ring.capacity, (part + 1) * ring.capacity);
      Object.assign(cabin, { kind: "work", name: group.name, color: projectColor(group.id), projectId: group.id, agentIds: ids });
      ids.forEach((agentId, seat) => {
        const desk = seatPosition({ allocation, rings }, cabin, seat);
        seats[agentId] = { ...desk.agent, agentId, cabinId: cabin.id, projectId: group.id, deck, ring: ring.index, angle: desk.angle, facing: desk.facing };
      });
    }
  }
  const server = cabins[serverRoom.ring * sectors + serverRoom.slot];
  Object.assign(server, { id: "public:server-room", kind: "servers", name: "Server room", color: "#77a9ce" });
  const breakCabin = cabins[breakRoom.deck * 3 * sectors + breakRoom.ring * sectors + breakRoom.slot];
  Object.assign(breakCabin, { id: "public:break-room", kind: "break", name: "Break room", color: "#dca77c" });
  // Adopt one ready bay without moving existing projects or adding a new pod.
  // Persist its position so future projects cannot take over the monitor room.
  const savedMonitor = previous?.monitorRoom;
  const monitor = savedMonitor
    ? cabins.find(c => c.deck === savedMonitor.deck && c.ring === savedMonitor.ring && c.slot === savedMonitor.slot && c.kind === "reserve")
    : cabins.find(c => c.deck === 0 && c.ring === 1 && c.kind === "reserve") ?? cabins.find(c => c.kind === "reserve");
  if (monitor) {
    allocation.monitorRoom = { deck: monitor.deck, ring: monitor.ring, slot: monitor.slot };
    Object.assign(monitor, { id: "public:monitor", kind: "monitor", name: "Monitor room", color: "#71d3c8" });
  }
  const savedLab = previous?.cloningRoom;
  const lab = savedLab
    ? cabins.find(c => c.deck === savedLab.deck && c.ring === savedLab.ring && c.slot === savedLab.slot && c.kind === "reserve")
    : cabins.find(c => c.deck === 0 && c.ring !== 0 && c.kind === "reserve") ?? cabins.find(c => c.kind === "reserve");
  if (lab) {
    allocation.cloningRoom = { deck: lab.deck, ring: lab.ring, slot: lab.slot };
    Object.assign(lab, { id: "public:cloning", kind: "cloning", name: "Cloning laboratory", color: "#8edbd4" });
  }
  return { allocation, rings, cabins, seats, radius: rings[2].radius + rings[2].depth / 2,
    spokes: Array.from({ length: 4 }, (_, i) => Math.floor(i * sectors / 4) * TAU / sectors) };
}

// Keep original L1 ids and saved v1 placements readable after the upgrade.
export function cabinId(id: string, deck: DeckIndex) { return deck === 0 ? id : `${id}:deck:${deck}`; }
export function shipDeck(layout: ShipLayout, deck: DeckIndex): ShipLayout {
  return { ...layout, cabins: layout.cabins.filter(c => c.deck === deck),
    seats: Object.fromEntries(Object.entries(layout.seats).filter(([, seat]) => seat.deck === deck)) };
}

export function seatPosition(layout: Pick<ShipLayout, "allocation" | "rings">, cabin: ShipCabin, index: number) {
  const ring = layout.rings[cabin.ring], columns = cabin.ring === 2 ? 4 : 3;
  const column = index % columns, row = Math.floor(index / columns);
  const arcWidth = TAU * ring.radius / layout.allocation.sectors;
  const tangent = (column - (columns - 1) / 2) * Math.min((arcWidth - 2.0) / columns, cabin.ring === 0 ? 2.5 : cabin.ring === 1 ? 3.5 : 4);
  // A seated maximum-size crew member also stays outside the passing lane.
  const radial = cabin.ring === 0 || row === 0 ? 2.27 : -2.27;
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
    const halfAngle = c.kind === "cloning" ? CLONING_LAB_WIDTH / ring.radius / 2 : Math.PI / layout.allocation.sectors;
    return [-halfAngle, 0, halfAngle].flatMap(offset => [ring.radius - ring.depth / 2, ring.radius + ring.depth / 2].map(r => shipPoint(r, cabinAngle(layout,c.slot) + offset)));
  });
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2,
    width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
}

function shortestAngle(from: number, to: number) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); }
function arc(layout: ShipLayout, ringIndex: RingIndex, deck: DeckIndex, from: number, to: number): ShipPoint[] {
  const radius=layout.rings[ringIndex].radius;
  const delta = shortestAngle(from, to), steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.12));
  const rooms=layout.cabins.filter(c=>(c.kind==="cloning"||c.kind==="bar"||c.kind==="break"||c.kind==="monitor")&&c.ring===ringIndex&&c.deck===deck);
  if(!rooms.length||Math.abs(delta)<1e-8)return Array.from({ length: steps }, (_, i) => shipPoint(radius, from + delta * (i + 1) / steps));
  const boundary=(room:ShipCabin)=>(room.kind==="bar"?BAR_LAYOUT.routeHalfWidth:room.kind==="break"?BREAK_ROOM.routeHalfWidth:room.kind==="monitor"?radius*Math.PI/layout.allocation.sectors-1:CLONING_POD.spacing+CLONING_POD.width/2+1)/radius;
  const aisle=(room:ShipCabin)=>room.kind==="bar"?BAR_LAYOUT.aisle:room.kind==="break"?BREAK_ROOM.aisle:room.kind==="monitor"?1.9:CLONING_AISLE_V;
  const events: Array<{t:number;enter?:boolean}>=Array.from({length:steps+1},(_,i)=>({t:i/steps}));
  for(const room of rooms)for(const wrap of [-TAU,0,TAU])for(const side of [-1,1]){
    const t=(shortestAngle(from,cabinAngle(layout,room.slot))+wrap+side*boundary(room))/delta;
    if(t>0&&t<1)events.push({t,enter:side*Math.sign(delta)<0});
  }
  return events.sort((a,b)=>a.t-b.t).flatMap(event=>{
    const angle=from+delta*event.t,room=rooms.find(room=>Math.abs(shortestAngle(cabinAngle(layout,room.slot),angle))<boundary(room)+1e-8);
    const offset=room ? aisle(room) : 0;
    if(event.enter!==undefined){
      const outside=shipPoint(radius,angle);
      const inside=shipPoint(radius+offset,angle);return event.enter?[outside,inside]:[inside,outside];
    }
    return [shipPoint(radius+offset,angle)];
  });
}
export function routeBetweenCabins(layout: ShipLayout, from: Pick<ShipSeat, "ring" | "angle">, destination: ShipCabin, arrivalAngle = cabinAngle(layout, destination.slot)): ShipPoint[] {
  const a = layout.rings[from.ring], b = layout.rings[destination.ring], targetAngle = arrivalAngle;
  if (a.index === b.index) return [shipPoint(a.radius, from.angle), ...arc(layout,a.index,destination.deck,from.angle,targetAngle)];
  const spoke = [...layout.spokes].sort((x, y) => Math.abs(shortestAngle(from.angle, x)) + Math.abs(shortestAngle(x, targetAngle)) - Math.abs(shortestAngle(from.angle, y)) - Math.abs(shortestAngle(y, targetAngle)))[0];
  return [shipPoint(a.radius, from.angle), ...arc(layout,a.index,destination.deck,from.angle,spoke), shipPoint(b.radius, spoke), ...arc(layout,b.index,destination.deck,spoke,targetAngle)];
}

export const PUBLIC_DESCRIPTIONS: Record<CabinKind, string> = {
  break: "A little tea-and-coffee pod with snacks, shared tables and time to catch up with the crew.",
  bar: "A dedicated bar for drinks, music and conversation, with a robot bartender and counter stools.",
  cloning: "Fork an agent with its conversation history and personal settings. Two pods, two independent futures.",
  ai: "Open the computation core for subscription usage, tokens, and API quotas.",
  monitor: "Open the main screen for strategy dashboards and server fleet status.",
  return: "Return to Earth in a drop pod and archive the same Codex session.",
  work: "Workspace assigned by project. Select a crew member to continue their session.", reserve: "Cabin and connections are ready for future projects.",
  garden: "A rainforest habitat with layered tree canopies, broad leaves, ferns, and vines around water and paths.", hydroponics: "Hydroponic beds, grow lights, and circulating water for growing food.",
  canteen: "Crew dining tables, kitchen, and coffee area.", gym: "A shared cabin for running, strength training, and exercise.", servers: "Rows of server racks, overhead cooling fans, cooling pipes, and maintenance terminals with a central service aisle.",
  maintenance: "Tools, spare parts, and ship repairs.", lounge: "A shared space for stargazing, rest, and conversation.",
  cargo: "Storage for ship supplies and spare equipment.", observatory: "A shared observation cabin for stars and distant routes.", quarters: "Compact sleeping capsules. Idle crew rest here after one hour and wake when assigned a task.",
};
