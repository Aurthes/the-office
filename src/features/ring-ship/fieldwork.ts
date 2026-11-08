import { cabinAngle, routeBetweenCabins, shipPoint, SHARED_PROJECT_ID, type DeckIndex, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { isWalkable, nearestWalkablePoint } from "./walkableSurface";
import { workTargetText, type SiteTask } from "@/lib/office/fieldworkTask";
import type { CollisionActor } from "./furnitureCollisions";

export type SiteAction = "travelling" | "changing" | "survey" | "blueprint" | "notes" | "measure" | "patrol" | "packing" | "returning" | "lift";
export type FieldworkState = {
  cabinId: string; nextId: string | null; camp: ShipPoint; phase: SiteAction; time: number; cycle: number; geared: boolean;
  legs: Array<{ deck: DeckIndex; points: ShipPoint[] }>; afterTravel: "changing" | "home"; liftFrom: DeckIndex;
};
const ALIASES: Partial<Record<ShipCabin["kind"], string[]>> = {
  garden: ["rainforest", "rainforest habitat", "rainforesthabitat", "雨林", "热带雨林"],
  hydroponics: ["hydroponics", "水培", "水耕"], bar: ["listening bar", "bar", "留声机", "吧台", "酒吧"],
  lounge: ["observation deck", "observation lounge", "lounge", "休息室", "休息区"], canteen: ["canteen", "dining", "食堂", "餐厅"],
  break: ["break room", "茶水间", "休息间"],
  gym: ["gym", "健身房"], servers: ["server room", "serverroom", "机房", "服务器房"], ai: ["ai center", "ai中心", "ai 中心"],
  monitor: ["monitor room", "中控", "监控室"], maintenance: ["maintenance", "维修舱", "维修间"],
  cargo: ["cargo", "supply storage", "货舱", "仓库"], observatory: ["observatory", "天文台", "观测舱"],
  quarters: ["hibernation bay", "hibernation", "sleeping pods", "休眠舱", "休眠区", "crew quarters", "宿舍", "生活舱"], return: ["return bay", "返航舱"], cloning: ["clone lab", "cloning lab", "cloning", "克隆舱", "克隆实验室"],
};
function mentions(text: string, phrase: string) {
  if (!/^[a-z\d ]+$/i.test(phrase)) return text.includes(phrase.toLowerCase());
  return new RegExp(`(^|[^a-z\\d])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z\\d])`, "i").test(text);
}
// Unknown/ambiguous construction work camps in the real shared work cabin.
function sharedWorksite(layout: ShipLayout, homeDeck: DeckIndex) {
  return layout.cabins.filter(c => c.kind === "work" && c.projectId === SHARED_PROJECT_ID)
    .sort((a, b) => Number(b.deck === homeDeck) - Number(a.deck === homeDeck)
      || Math.abs(a.deck - homeDeck) - Math.abs(b.deck - homeDeck) || a.deck - b.deck || a.ring - b.ring || a.slot - b.slot || a.id.localeCompare(b.id))[0];
}
function onRequestedDeck(cabins: ShipCabin[], text: string, homeDeck: DeckIndex) {
  const level = text.match(/\b(?:l|deck\s*)([123])\b|([一二三])层/);
  const requested = level ? level[1] ? Number(level[1]) - 1 : "一二三".indexOf(level[2]) : homeDeck;
  return cabins.find(c => c.deck === requested) || (!level ? cabins[0] : undefined);
}
export function resolveWorksite(task: SiteTask | null | undefined, layout: ShipLayout, homeDeck: DeckIndex): ShipCabin | undefined {
  const fallback = () => sharedWorksite(layout, homeDeck);
  const goals = (typeof task === "string" ? [task] : [task?.phase || "", task?.title || ""]).map(workTargetText).map(t => t.toLowerCase());
  for (const plain of goals) {
    const kinds = Object.entries(ALIASES).filter(([, aliases]) => aliases.some(alias => mentions(plain, alias))).map(([kind]) => kind);
    const named = layout.cabins.filter(c => c.kind !== "reserve" && c.name.toLowerCase() !== "office" && mentions(plain, c.name.toLowerCase()));
    const names = new Set([...kinds, ...named.map(c => c.projectId ? `project:${c.projectId}` : c.kind)]);
    if (!names.size) continue;
    if (names.size !== 1) return fallback();
    const key = [...names][0];
    const candidates = layout.cabins.filter(c => key.startsWith("project:") ? c.kind === "work" && c.projectId === key.slice(8) : c.kind === key);
    return onRequestedDeck(candidates, plain, homeDeck) || fallback();
  }
  // Business-specific phrases only. A generic board/whiteboard is not Teaser.
  const teaser = goals.find(t => /(?:\bteaser\b|趣题看板|趣题白板|趣题板)/i.test(t));
  if (teaser) return onRequestedDeck(layout.cabins.filter(c => c.kind === "break"), teaser, homeDeck) || fallback();
  return fallback();
}
export function insideSite(layout: ShipLayout, cabin: ShipCabin, point: ShipPoint, padding = .4) {
  const ring = layout.rings[cabin.ring], radius = Math.hypot(point.x, point.z);
  const angle = Math.atan2(point.x, point.z) - cabinAngle(layout, cabin.slot);
  return Math.abs(radius - ring.radius) <= ring.depth / 2 - padding
    && Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) <= Math.PI / layout.allocation.sectors - padding / ring.radius;
}
export function sitePoint(layout: ShipLayout, cabin: ShipCabin, seed: number, patrol = 0, actor?: CollisionActor, free: (p: ShipPoint) => boolean = () => true): ShipPoint | undefined {
  const ring = layout.rings[cabin.ring], u = (seed % 5 - 2) * .65 + Math.sin(patrol * 2.1) * .65;
  const offsets = [[u, -1.1 + Math.cos(patrol * 1.7) * .35], ...[-1.1, -.5, .1, .7].flatMap(v => [-1.3, -.65, 0, .65, 1.3].map(x => [x, v]))];
  for (const [x, v] of offsets) {
    const p = shipPoint(ring.radius + v, cabinAngle(layout, cabin.slot) + x / ring.radius);
    if (insideSite(layout, cabin, p) && isWalkable(p, layout, .4, cabin.deck, actor) && free(p)) return p;
  }
  // Never project a camp into a neighbouring cabin. The caller waits/retries.
}
export function siteJourney(layout: ShipLayout, position: ShipPoint, deck: DeckIndex, destination: ShipCabin, target: ShipPoint, actor?: CollisionActor) {
  const ring = [...layout.rings].sort((a, b) => Math.abs(a.radius - Math.hypot(position.x, position.z)) - Math.abs(b.radius - Math.hypot(position.x, position.z)))[0];
  const angle = Math.atan2(position.x, position.z);
  const safe = (points: ShipPoint[], level: DeckIndex) => points.map(p => nearestWalkablePoint(p, layout, .4, level, undefined, actor));
  if (deck === destination.deck) return [{ deck, points: safe([...routeBetweenCabins(layout, { ring: ring.index, angle }, destination), target], deck) }];
  const spoke = [...layout.spokes].sort((a, b) => Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) - Math.abs(Math.atan2(Math.sin(b - angle), Math.cos(b - angle))))[0];
  const inner = shipPoint(layout.rings[0].radius, spoke), lift = shipPoint(3.8, spoke);
  const entry = { ...destination, ring: 0 as const, deck };
  return [
    { deck, points: safe([...routeBetweenCabins(layout, { ring: ring.index, angle }, entry, spoke), inner, lift], deck) },
    { deck: destination.deck, points: safe([inner, ...routeBetweenCabins(layout, { ring: 0, angle: spoke }, destination), target], destination.deck) },
  ];
}
export const SITE_ACTIVITIES: Record<SiteAction, string> = {
  travelling: "Taking the toolkit to the site", changing: "Hard hat on. Ready to build!", survey: "Checking the clearance",
  blueprint: "Consulting the blueprints", notes: "Measure twice. Quack once.", measure: "One more measurement", patrol: "Inspecting the worksite",
  packing: "Packing up the field kit", returning: "Taking the findings back to the desk", lift: "Taking the central lift",
};
