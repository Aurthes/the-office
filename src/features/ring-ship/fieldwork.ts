import { cabinAngle, routeBetweenCabins, shipPoint, type DeckIndex, type ShipCabin, type ShipLayout, type ShipPoint } from "./layout";
import { isWalkable, nearestWalkablePoint } from "./walkableSurface";

export type SiteAction = "travelling" | "changing" | "survey" | "blueprint" | "notes" | "measure" | "patrol" | "packing" | "returning" | "lift";
export type FieldworkState = {
  cabinId: string; nextId: string | null; camp: ShipPoint; phase: SiteAction; time: number; cycle: number; geared: boolean;
  legs: Array<{ deck: DeckIndex; points: ShipPoint[] }>; afterTravel: "changing" | "home"; liftFrom: DeckIndex;
};
const ALIASES: Partial<Record<ShipCabin["kind"], string[]>> = {
  garden: ["rainforest", "rainforest habitat", "rainforesthabitat", "雨林", "热带雨林"],
  hydroponics: ["hydroponics", "水培", "水耕"], bar: ["listening bar", "bar", "留声机", "吧台", "酒吧"],
  lounge: ["observation lounge", "lounge", "休息室", "休息区"], canteen: ["canteen", "dining", "食堂", "餐厅"],
  break: ["break room", "茶水间", "休息间"],
  gym: ["gym", "健身房"], servers: ["server room", "serverroom", "机房", "服务器房"], ai: ["ai center", "ai中心", "ai 中心"],
  monitor: ["monitor room", "中控", "监控室"], maintenance: ["maintenance", "维修舱", "维修间"],
  cargo: ["cargo", "supply storage", "货舱", "仓库"], observatory: ["observatory", "天文台", "观测舱"],
  quarters: ["crew quarters", "宿舍", "生活舱"], return: ["return bay", "返航舱"], cloning: ["cloning", "克隆舱", "克隆实验室"],
};
function mentions(text: string, phrase: string) {
  if (!/^[a-z\d ]+$/i.test(phrase)) return text.includes(phrase.toLowerCase());
  return new RegExp(`(^|[^a-z\\d])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z\\d])`, "i").test(text);
}
// Ambiguous requests stay at the desk. Repeated public rooms prefer the worker's
// deck, unless the request explicitly names another deck.
export function resolveWorksite(text: string | null | undefined, layout: ShipLayout, homeDeck: DeckIndex): ShipCabin | undefined {
  if (!text?.trim()) return;
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/[（(](?:比如|例如|for example|e\.g\.)[^)）]*[)）]/gi, " ").toLowerCase();
  const matches = layout.cabins.filter(c => c.kind !== "reserve" && c.name.toLowerCase() !== "office"
    && (mentions(plain, c.name.toLowerCase()) || (ALIASES[c.kind] || []).some(alias => mentions(plain, alias))));
  const names = new Set(matches.map(c => c.projectId || c.kind));
  if (names.size !== 1) return;
  const level = plain.match(/\b(?:l|deck\s*)([123])\b|([一二三])层/);
  const requested = level ? level[1] ? Number(level[1]) - 1 : "一二三".indexOf(level[2]) : homeDeck;
  return matches.find(c => c.deck === requested) || (!level ? matches[0] : undefined);
}
export function sitePoint(layout: ShipLayout, cabin: ShipCabin, seed: number, patrol = 0): ShipPoint {
  const ring = layout.rings[cabin.ring], u = (seed % 5 - 2) * .65 + Math.sin(patrol * 2.1) * .65;
  const v = -1.1 + Math.cos(patrol * 1.7) * .35;
  const p = shipPoint(ring.radius + v, cabinAngle(layout, cabin.slot) + u / ring.radius);
  return isWalkable(p, layout, .4, cabin.deck) ? p : nearestWalkablePoint(p, layout, .4, cabin.deck);
}
export function siteJourney(layout: ShipLayout, position: ShipPoint, deck: DeckIndex, destination: ShipCabin, target: ShipPoint) {
  const ring = [...layout.rings].sort((a, b) => Math.abs(a.radius - Math.hypot(position.x, position.z)) - Math.abs(b.radius - Math.hypot(position.x, position.z)))[0];
  const angle = Math.atan2(position.x, position.z);
  const safe = (points: ShipPoint[], level: DeckIndex) => points.map(p => nearestWalkablePoint(p, layout, .4, level));
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
