"use client";
import { useId, useState, type KeyboardEvent } from "react";
import { RotateCcw, Shuffle } from "lucide-react";
import { DEFAULT_DUCK_APPEARANCE, DUCK_FEATHER_COLORS, DUCK_EQUIPMENT_COLORS, DUCK_BILL_COLORS, createDuckAppearanceFromSeed, type DuckAppearance } from "@/lib/avatars/duck";
import { randomUUID } from "@/lib/uuid";
import { useUiText } from "@/lib/i18n/ui-language";

type Part = "head" | "face" | "body" | "wings" | "feet" | "tail" | "gear";
type NumberKey = { [K in keyof DuckAppearance]: DuckAppearance[K] extends number ? K : never }[keyof DuckAppearance];
type ColorKey = "featherColor" | "headColor" | "billColor" | "eyeColor" | "bellyColor" | "wingColor" | "footColor" | "tailColor" | "outfitColor" | "headwearColor";
const PARTS: Array<{ id: Part; label: string; fields: Array<keyof DuckAppearance> }> = [
  { id: "head", label: "Head", fields: ["headScale", "headColor", "crest", "headwear", "headwearColor"] },
  { id: "face", label: "Face", fields: ["eyeStyle", "eyeColor", "eyeScale", "eyeSpacing", "eyeHeight", "eyewear", "billShape", "billColor", "billScale", "billWidth", "billLength"] },
  { id: "body", label: "Body", fields: ["featherColor", "bodyWidth", "bodyDepth", "bodyHeight", "bellyPatch", "bellyColor"] },
  { id: "wings", label: "Wings", fields: ["wingColor", "wingStyle", "wingWidth", "wingLength", "wingSpread"] },
  { id: "feet", label: "Feet", fields: ["footColor", "footStyle", "footScale", "footSpacing"] },
  { id: "tail", label: "Tail", fields: ["tailColor", "tailStyle", "tailScale"] },
  { id: "gear", label: "Gear", fields: ["outfit", "outfitColor", "backpack"] },
];

export function DuckAppearanceEditor({ value, onChange, disabled, onPartChange }: {
  value: DuckAppearance; onChange: (value: DuckAppearance) => void; disabled: boolean;
  onPartChange: (part: Part) => void;
}) {
  const t = useUiText(), id = useId();
  const [active, setActive] = useState<Part>("head");
  const set = <K extends keyof DuckAppearance>(key: K, v: DuckAppearance[K]) => onChange({ ...value, [key]: v });
  const choosePart = (part: Part) => { setActive(part); onPartChange(part); };
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? PARTS.length - 1 : offset ? (index + offset + PARTS.length) % PARTS.length : -1;
    if (next < 0) return;
    event.preventDefault(); choosePart(PARTS[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  const options = <K extends keyof DuckAppearance>(key: K, choices: Array<[DuckAppearance[K], string]>) => <div className="duck-character-options">{choices.map(([v, label]) => <button type="button" key={String(v)} aria-pressed={value[key] === v} onClick={() => set(key, v)}>{t(label)}</button>)}</div>;
  const colors = (key: ColorKey, label: string, palette = DUCK_FEATHER_COLORS, fallback?: string) => <div className="duck-character-color-picker">
    <div className="duck-character-swatches">{palette.map(color => <button type="button" key={color} aria-label={`${t(label)} ${color}`} aria-pressed={value[key] === color} style={{ background: color }} onClick={() => set(key, color)} />)}
      <input type="color" aria-label={t(label)} value={value[key] ?? fallback ?? value.featherColor} onChange={event => set(key, event.target.value)} /></div>
    {fallback ? <button className="duck-character-match" type="button" aria-pressed={value[key] === null} onClick={() => set(key, null)}>{t(key === "footColor" ? "Match bill color" : key === "headwearColor" ? "Match outfit color" : "Match feather color")}</button> : null}
  </div>;
  const range = (key: NumberKey, label: string, min: number, max: number, degrees = false) => <label className="duck-character-range">{t(label)}<output>{Math.round(value[key] * (degrees ? 1 : 100))}{degrees ? "°" : "%"}</output>
    <input type="range" aria-label={t(label)} min={min} max={max} step="1" value={Math.round(value[key] * (degrees ? 1 : 100))} onChange={event => set(key, Number(event.target.value) / (degrees ? 1 : 100))} /></label>;
  const toggle = (key: "bellyPatch" | "backpack", label: string) => <label className="duck-character-toggle"><span>{t(label)}</span><input type="checkbox" aria-label={t(label)} checked={value[key]} onChange={event => set(key, event.target.checked)} /></label>;
  const part = PARTS.find(part => part.id === active)!;
  const replacePart = (from: Readonly<DuckAppearance>) => {
    const next = { ...value };
    for (const field of part.fields) Object.assign(next, { [field]: from[field] });
    onChange(next);
  };
  return <div className="duck-character-editor">
    <div className="duck-character-tabs" role="tablist" aria-label={t("Character parts")}>{PARTS.map((part, index) => <button type="button" role="tab" key={part.id}
      id={`${id}-${part.id}-tab`} aria-controls={`${id}-${part.id}-panel`} aria-selected={active === part.id} tabIndex={active === part.id ? 0 : -1} disabled={disabled}
      onClick={() => choosePart(part.id)} onKeyDown={event => moveTab(event, index)}>{t(part.label)}</button>)}</div>
    <div role="tabpanel" id={`${id}-${active}-panel`} aria-labelledby={`${id}-${active}-tab`} className="duck-character-fields">
      {active === "head" ? <>
        <fieldset disabled={disabled}><legend>{t("Head shape")}</legend>{range("headScale", "Head size", 85, 115)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Head color")}</legend>{colors("headColor", "Head color", DUCK_FEATHER_COLORS, value.featherColor)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Crest")}</legend>{options("crest", [["none", "None"], ["tuft", "Tuft"], ["mohawk", "Mohawk"]])}<p className="duck-character-field-hint">{t("Visible without headwear.")}</p></fieldset>
        <fieldset disabled={disabled}><legend>{t("Headwear")}</legend>{options("headwear", [["none", "None"], ["cap", "Cap"], ["helmet", "Helmet"], ["beanie", "Beanie"], ["crown", "Crown"]])}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Headwear color")}</legend>{colors("headwearColor", "Headwear color", DUCK_EQUIPMENT_COLORS, value.outfitColor)}</fieldset>
      </> : active === "face" ? <>
        <fieldset disabled={disabled}><legend>{t("Eyes")}</legend>{options("eyeStyle", [["round", "Round"], ["sleepy", "Sleepy"], ["happy", "Happy"]])}{range("eyeScale", "Eye size", 70, 140)}{range("eyeSpacing", "Eye spacing", 70, 130)}{range("eyeHeight", "Eye height", 90, 110)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Eye color")}</legend>{colors("eyeColor", "Eye color", ["#302e28", "#476f82", "#47785f", "#7d5d42", "#6e527d"])}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Eyewear")}</legend>{options("eyewear", [["none", "None"], ["round", "Round glasses"], ["visor", "Visor"]])}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Bill shape")}</legend>{options("billShape", [["classic", "Classic"], ["sculpted", "Sculpted"]])}{range("billScale", "Bill size", 70, 140)}{range("billWidth", "Bill width", 75, 135)}{range("billLength", "Bill length", 75, 135)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Bill color")}</legend>{colors("billColor", "Bill color", DUCK_BILL_COLORS)}</fieldset>
      </> : active === "body" ? <>
        <fieldset disabled={disabled}><legend>{t("Body proportions")}</legend>{range("bodyDepth", "Body length (front–back)", 75, 130)}{range("bodyWidth", "Body width (left–right)", 75, 130)}{range("bodyHeight", "Body height", 75, 130)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Feathers")}</legend>{colors("featherColor", "Feather color")}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Belly")}</legend>{toggle("bellyPatch", "Belly patch")}{value.bellyPatch ? colors("bellyColor", "Belly color", DUCK_FEATHER_COLORS) : null}</fieldset>
      </> : active === "wings" ? <>
        <fieldset disabled={disabled}><legend>{t("Wing shape")}</legend>{options("wingStyle", [["smooth", "Smooth"], ["layered", "Layered feathers"]])}{range("wingLength", "Wing length", 65, 145)}{range("wingWidth", "Wing width", 65, 140)}{range("wingSpread", "Wing spread", 0, 40, true)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Wing color")}</legend>{colors("wingColor", "Wing color", DUCK_FEATHER_COLORS, value.featherColor)}</fieldset>
      </> : active === "feet" ? <>
        <fieldset disabled={disabled}><legend>{t("Footwear")}</legend>{options("footStyle", [["webbed", "Webbed feet"], ["boots", "Boots"]])}{range("footScale", "Foot size", 75, 140)}{range("footSpacing", "Foot spacing", 75, 135)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Foot color")}</legend>{colors("footColor", "Foot color", DUCK_BILL_COLORS, value.billColor)}</fieldset>
      </> : active === "tail" ? <>
        <fieldset disabled={disabled}><legend>{t("Tail shape")}</legend>{options("tailStyle", [["round", "Rounded"], ["fan", "Fan"], ["pointed", "Pointed"]])}{range("tailScale", "Tail size", 60, 150)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Tail color")}</legend>{colors("tailColor", "Tail color", DUCK_FEATHER_COLORS, value.featherColor)}</fieldset>
      </> : <>
        <fieldset disabled={disabled}><legend>{t("Outfit")}</legend>{options("outfit", [["none", "None"], ["vest", "Utility vest"], ["jacket", "Flight jacket"], ["scarf", "Scarf"]])}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Equipment color")}</legend>{colors("outfitColor", "Equipment color", DUCK_EQUIPMENT_COLORS)}</fieldset>
        <fieldset disabled={disabled}><legend>{t("Accessories")}</legend>{toggle("backpack", "Backpack")}</fieldset>
      </>}
    </div>
    <div className="duck-character-part-actions"><button type="button" disabled={disabled} onClick={() => replacePart(createDuckAppearanceFromSeed(randomUUID()))}><Shuffle size={13} />{t("Randomize part")}</button>
      <button type="button" disabled={disabled} onClick={() => replacePart(DEFAULT_DUCK_APPEARANCE)}><RotateCcw size={13} />{t("Reset part")}</button></div>
  </div>;
}
