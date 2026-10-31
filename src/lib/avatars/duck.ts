export type DuckAppearance = {
  featherColor: string;
  billColor: string;
  billShape: "classic" | "sculpted";
  billScale: number;
  headwear: "none" | "cap" | "helmet";
  outfit: "none" | "vest" | "jacket";
  outfitColor: string;
  bodyWidth: number;
  bodyDepth: number;
  bodyHeight: number;
  eyeSpacing: number;
  eyeHeight: number;
};

export const DEFAULT_DUCK_APPEARANCE: Readonly<DuckAppearance> = Object.freeze({
  featherColor: "#ffbb3c", billColor: "#f58b28", billShape: "classic", billScale: 1,
  headwear: "none", outfit: "none", outfitColor: "#394b54",
  bodyWidth: 1, bodyDepth: 1, bodyHeight: 1, eyeSpacing: 1, eyeHeight: 1,
});

export function normalizeDuckAppearance(value: unknown): DuckAppearance {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const base = DEFAULT_DUCK_APPEARANCE;
  const ratio = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 1;
  const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  return {
    featherColor: color(raw.featherColor, base.featherColor), billColor: color(raw.billColor, base.billColor),
    billShape: raw.billShape === "sculpted" ? "sculpted" : "classic",
    billScale: typeof raw.billScale === "number" && Number.isFinite(raw.billScale) ? Math.max(.7, Math.min(1.4, raw.billScale)) : 1,
    headwear: raw.headwear === "cap" || raw.headwear === "helmet" ? raw.headwear : "none",
    outfit: raw.outfit === "vest" || raw.outfit === "jacket" ? raw.outfit : "none",
    outfitColor: color(raw.outfitColor, base.outfitColor),
    bodyWidth: ratio(raw.bodyWidth, .75, 1.3), bodyDepth: ratio(raw.bodyDepth, .75, 1.3), bodyHeight: ratio(raw.bodyHeight, .75, 1.3),
    eyeSpacing: ratio(raw.eyeSpacing, .7, 1.3), eyeHeight: ratio(raw.eyeHeight, .9, 1.1),
  };
}
