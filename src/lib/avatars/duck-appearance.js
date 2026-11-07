"use strict";

const DUCK_FEATHER_COLORS = ["#ffbb3c", "#ece9d8", "#829a99", "#b1c8b0", "#d39c91", "#aab8d4", "#638d9b", "#a993b4", "#575d67"];
const DUCK_EQUIPMENT_COLORS = ["#394b54", "#435842", "#97704e", "#63768e", "#773f42", "#ded9c7", "#c48c49", "#765c86"];
const DUCK_BILL_COLORS = ["#f58b28", "#d5a14b", "#e4bb76", "#bd7754", "#d18e89", "#46494d"];

const DEFAULT_DUCK_APPEARANCE = Object.freeze({
  featherColor: "#ffbb3c", headColor: null, headScale: 1, crest: "none",
  billColor: "#f58b28", billShape: "classic", billScale: 1, billWidth: 1, billLength: 1,
  headwear: "none", headwearColor: null, eyewear: "none", outfit: "none", outfitColor: "#394b54", backpack: false, backpackStyle: "pack",
  bodyWidth: 1, bodyDepth: 1, bodyHeight: 1, bellyPatch: false, bellyColor: "#ece9d8",
  eyeSpacing: 1, eyeHeight: 1, eyeScale: 1, eyeColor: "#302e28", eyeStyle: "round",
  wingColor: null, wingLength: 1, wingWidth: 1, wingSpread: 0, wingStyle: "smooth",
  footColor: null, footScale: 1, footSpacing: 1, footStyle: "webbed",
  tailColor: null, tailScale: 1, tailStyle: "round",
});

const FIREFIGHTER_DUCK_APPEARANCE = Object.freeze({
  ...DEFAULT_DUCK_APPEARANCE,
  featherColor: "#ece9d8", headwear: "firefighter", headwearColor: "#bd3e32",
  outfit: "firefighter", outfitColor: "#a78d62", wingColor: "#a78d62",
  backpack: true, backpackStyle: "air-tank", footStyle: "boots", footColor: "#283136",
});

function normalizeDuckAppearance(value) {
  const raw = value && typeof value === "object" ? value : {};
  const base = DEFAULT_DUCK_APPEARANCE;
  const ratio = (value, min, max, fallback = 1) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const color = (value, fallback) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  const optionalColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  return {
    featherColor: color(raw.featherColor, base.featherColor), headColor: optionalColor(raw.headColor), headScale: ratio(raw.headScale, .85, 1.15),
    crest: choice(raw.crest, ["none", "tuft", "mohawk"], "none"),
    billColor: color(raw.billColor, base.billColor), billShape: choice(raw.billShape, ["classic", "sculpted"], "classic"),
    billScale: ratio(raw.billScale, .7, 1.4), billWidth: ratio(raw.billWidth, .75, 1.35), billLength: ratio(raw.billLength, .75, 1.35),
    headwear: choice(raw.headwear, ["none", "cap", "helmet", "beanie", "crown", "firefighter"], "none"), headwearColor: optionalColor(raw.headwearColor),
    eyewear: choice(raw.eyewear, ["none", "round", "visor"], "none"),
    outfit: choice(raw.outfit, ["none", "vest", "jacket", "scarf", "firefighter"], "none"), outfitColor: color(raw.outfitColor, base.outfitColor), backpack: raw.backpack === true,
    backpackStyle: choice(raw.backpackStyle, ["pack", "air-tank"], "pack"),
    bodyWidth: ratio(raw.bodyWidth, .75, 1.3), bodyDepth: ratio(raw.bodyDepth, .75, 1.3), bodyHeight: ratio(raw.bodyHeight, .75, 1.3),
    bellyPatch: raw.bellyPatch === true, bellyColor: color(raw.bellyColor, base.bellyColor),
    eyeSpacing: ratio(raw.eyeSpacing, .7, 1.3), eyeHeight: ratio(raw.eyeHeight, .9, 1.1), eyeScale: ratio(raw.eyeScale, .7, 1.4),
    eyeColor: color(raw.eyeColor, base.eyeColor), eyeStyle: choice(raw.eyeStyle, ["round", "sleepy", "happy"], "round"),
    wingColor: optionalColor(raw.wingColor), wingLength: ratio(raw.wingLength, .65, 1.45), wingWidth: ratio(raw.wingWidth, .65, 1.4),
    wingSpread: ratio(raw.wingSpread, 0, 40, 0), wingStyle: choice(raw.wingStyle, ["smooth", "layered"], "smooth"),
    footColor: optionalColor(raw.footColor), footScale: ratio(raw.footScale, .75, 1.4), footSpacing: ratio(raw.footSpacing, .75, 1.35),
    footStyle: choice(raw.footStyle, ["webbed", "boots"], "webbed"),
    tailColor: optionalColor(raw.tailColor), tailScale: ratio(raw.tailScale, .6, 1.5), tailStyle: choice(raw.tailStyle, ["round", "fan", "pointed"], "round"),
  };
}

// A stored creation seed makes a new recruit unique without changing its look on
// reconnect, reload, or another browser. Older agents keep their existing style.
function createDuckAppearanceFromSeed(seed) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ state >>> 15, 1 | state);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  const pick = (values) => values[Math.floor(random() * values.length)];
  const between = (min, max) => Math.round((min + random() * (max - min)) * 100) / 100;
  return normalizeDuckAppearance({
    ...DEFAULT_DUCK_APPEARANCE,
    featherColor: pick(DUCK_FEATHER_COLORS), headColor: random() < .35 ? pick(DUCK_FEATHER_COLORS) : null,
    headScale: between(.9, 1.12), crest: pick(["none", "none", "tuft", "mohawk"]),
    billColor: pick(DUCK_BILL_COLORS), billShape: pick(["classic", "sculpted"]), billScale: between(.85, 1.15), billWidth: between(.85, 1.15), billLength: between(.85, 1.15),
    headwear: pick(["none", "none", "cap", "helmet", "beanie", "crown"]), headwearColor: pick(DUCK_EQUIPMENT_COLORS),
    eyewear: pick(["none", "none", "round", "visor"]), outfit: pick(["none", "vest", "jacket", "scarf"]), outfitColor: pick(DUCK_EQUIPMENT_COLORS), backpack: random() < .3,
    bodyWidth: between(.88, 1.18), bodyDepth: between(.88, 1.15), bodyHeight: between(.9, 1.18), bellyPatch: random() < .4,
    eyeSpacing: between(.85, 1.15), eyeHeight: between(.96, 1.04), eyeScale: between(.85, 1.2), eyeStyle: pick(["round", "round", "sleepy", "happy"]),
    wingColor: random() < .3 ? pick(DUCK_FEATHER_COLORS) : null, wingLength: between(.85, 1.2), wingWidth: between(.85, 1.2), wingSpread: between(0, 16), wingStyle: pick(["smooth", "layered"]),
    footColor: random() < .3 ? pick(DUCK_BILL_COLORS) : null, footScale: between(.85, 1.2), footSpacing: between(.9, 1.2), footStyle: pick(["webbed", "webbed", "boots"]),
    tailScale: between(.85, 1.2), tailStyle: pick(["round", "fan", "pointed"]),
  });
}

module.exports = { DUCK_FEATHER_COLORS, DUCK_EQUIPMENT_COLORS, DUCK_BILL_COLORS, DEFAULT_DUCK_APPEARANCE, FIREFIGHTER_DUCK_APPEARANCE, normalizeDuckAppearance, createDuckAppearanceFromSeed };
