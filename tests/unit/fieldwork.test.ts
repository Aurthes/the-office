import { describe, expect, it } from "vitest";
import { buildShipLayout, type ShipLayout } from "@/features/ring-ship/layout";
import { advanceCrew, syncCrew, worldPoint, type MovingAgent } from "@/features/ring-ship/crewMotion";
import { resolveWorksite } from "@/features/ring-ship/fieldwork";
import { latestSiteTask } from "@/lib/office/fieldworkTask";
import { isWalkable } from "@/features/ring-ship/walkableSurface";
import { createDuckCrewFigure } from "@/features/ring-ship/duckCrewFigure";
import { DEFAULT_DUCK_APPEARANCE } from "@/lib/avatars/duck";
import * as THREE from "three";

function fixture(task = "调整 rainforest section 里的灯光") {
  const layout = buildShipLayout({ projects: [{ id: "office", name: "Office" }], members: [{ id: "builder", projectId: "office" }] });
  const a = syncCrew([{ id: "builder", name: "Builder", color: "#abc", item: "", status: "working", constructionWorker: true, siteTask: task }], layout, new Map(), 0)[0];
  return { layout, a };
}
function change(a: MovingAgent, layout: ShipLayout, patch: Partial<MovingAgent>) { return syncCrew([{ ...a, ...patch }], layout, new Map([[a.id, a]]), 0)[0]; }
function until(a: MovingAgent, layout: ShipLayout, done: () => boolean, limit = 4000) {
  for (let i = 0; i < limit && !done(); i++) {
    const before = worldPoint(a); advanceCrew([a], layout, i * 50, .05);
    const after = worldPoint(a);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThanOrEqual(.05 * 1.05 * 2.15 + 1e-5);
    expect(isWalkable(after, layout, .35, a.deck)).toBe(true);
  }
  expect({ done: done(), phase: a.fieldwork?.phase, point: worldPoint(a), route: a.route.slice(a.routeIndex, a.routeIndex + 2) }).toMatchObject({ done: true });
}
describe("worksite assignment", () => {
  it("recognizes room aliases, deck hints and ambiguous/unlocated requests", () => {
    const { layout } = fixture();
    expect(resolveWorksite("调整 RainforestHabitat 的树", layout, 0)?.kind).toBe("garden");
    expect(resolveWorksite("给吧台换一台留声机", layout, 0)?.kind).toBe("bar");
    expect(resolveWorksite("调整 L2 雨林的灯光", layout, 0)?.deck).toBe(1);
    expect(resolveWorksite("检查 rainforest 和 gym", layout, 0)).toBeUndefined();
    expect(resolveWorksite("更新依赖并修复登录", layout, 0)).toBeUndefined();
    expect(resolveWorksite("为区域任务（比如调整 rainforest）增加施工动作", layout, 0)).toBeUndefined();
  });
  it("keeps the substantive task through short continuations and deployment receipts", () => {
    expect(latestSiteTask([{ role: "user", content: "调整雨林的灯光" }, { role: "assistant", content: "去 gym 吗" }, { role: "user", content: "继续" }, { role: "user", content: "Automatic deployment receipt: done" }])).toBe("调整雨林的灯光");
    expect(latestSiteTask([{ role: "user", content: "调整雨林" }, { role: "user", content: "现在更新所有依赖" }])).toBe("现在更新所有依赖");
  });
  it("leaves ordinary employees and unlocated Office work at their desks", () => {
    const initial = fixture(); let a = initial.a; const layout = initial.layout; a = change(a, layout, { constructionWorker: false }); advanceCrew([a], layout, 0, .05);
    expect(a.fieldwork).toBeUndefined(); expect(a.state).toBe("sitting");
    a = change(a, layout, { constructionWorker: true, siteTask: "整理所有依赖" }); advanceCrew([a], layout, 0, .05);
    expect(a.fieldwork).toBeUndefined(); expect(a.interactionTarget).toBe("desk");
  });
});
it.each(["调整 rainforest 的灯光", "调整吧台留声机", "调整克隆舱的部件", "调整机房里的平台"])("runs to the real site, changes clothes and works there: %s", task => {
  const { a, layout } = fixture(task); until(a, layout, () => !!a.fieldwork?.geared);
  expect(a.interactionTarget).toBeUndefined(); expect(a.state).toBe("standing");
  const field = a.fieldwork; const before = worldPoint(a);
  const refreshed = change(a, layout, { name: "Still building" });
  expect(refreshed.fieldwork).toBe(field); expect(worldPoint(refreshed)).toEqual(before);
  const phases = new Set<string>(); for (let i = 0; i < 700; i++) { advanceCrew([refreshed], layout, i * 50, .05); phases.add(refreshed.fieldwork!.phase); }
  for (const phase of ["blueprint", "notes", "survey", "measure", "patrol"]) expect(phases.has(phase)).toBe(true);
});
it.each(["idle", "generic", "error"])("packs up and walks home when the task ends or changes: %s", reason => {
  const initial = fixture(); let a = initial.a; const layout = initial.layout; until(a, layout, () => !!a.fieldwork?.geared);
  a = change(a, layout, reason === "generic" ? { siteTask: "更新依赖" } : { status: reason as "idle" | "error" });
  until(a, layout, () => !a.fieldwork && Math.hypot(worldPoint(a).x - a.home.x, worldPoint(a).z - a.home.z) < .001);
  if (reason !== "idle") expect(a.interactionTarget).toBe("desk");
});
it("uses the central lift for work on another deck, then comes home", () => {
  const initial = fixture("调整 L2 雨林的灯光"); let a = initial.a; const layout = initial.layout; const decks = new Set<number>(); let lift = false;
  until(a, layout, () => { decks.add(a.deck); lift ||= a.fieldwork?.phase === "lift"; return !!a.fieldwork?.geared; });
  expect(lift).toBe(true); expect(decks.has(1)).toBe(true); expect(a.deck).toBe(1);
  a = change(a, layout, { status: "idle" }); until(a, layout, () => !a.fieldwork);
  expect(a.deck).toBe(layout.seats[a.id].deck);
});
it("constructs a temporary reflective kit with tools while keeping the saved character unchanged", () => {
  const saved = { ...DEFAULT_DUCK_APPEARANCE, featherColor: "#aab8d4" };
  const figure = createDuckCrewFigure(saved, true);
  expect(saved.headwear).toBe("none"); expect(figure.root.getObjectByName("construction-hard-hat")).toBeDefined();
  expect(figure.fieldTools?.blueprint).toBeDefined(); expect(figure.fieldTools?.notebook).toBeDefined();
  let calls = 0, triangles = 0;
  figure.root.traverse(node => { if (node instanceof THREE.Mesh) { calls++; triangles += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3; expect(Array.from(node.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true); } });
  expect(calls).toBeLessThan(25); expect(triangles).toBeLessThan(20000); figure.dispose();
});
it("redirects a walking builder without jumping across a corridor gap", () => {
  const initial = fixture(); let a = initial.a; const layout = initial.layout; until(a, layout, () => !!a.fieldwork && Math.hypot(worldPoint(a).x - a.home.x, worldPoint(a).z - a.home.z) > 3);
  a = change(a, layout, { siteTask: "调整吧台的留声机" }); until(a, layout, () => !!a.fieldwork?.geared);
  expect(layout.cabins.find(c => c.id === a.fieldwork!.cabinId)?.kind).toBe("bar");
});
it("keeps camp while waiting for input and can retarget an equipped builder", () => {
  const initial = fixture(); let a = initial.a; const layout = initial.layout; until(a, layout, () => !!a.fieldwork?.geared);
  a = change(a, layout, { needsInput: true }); const field = a.fieldwork;
  for (let i = 0; i < 160; i++) advanceCrew([a], layout, i * 50, .05);
  expect(a.fieldwork).toBe(field); expect(a.interactionTarget).toBeUndefined();
  a = change(a, layout, { needsInput: false, siteTask: "调整克隆舱" }); until(a, layout, () => a.fieldwork?.phase === "blueprint" && a.fieldwork?.cabinId === layout.cabins.find(c => c.kind === "cloning")!.id);
  expect(a.fieldwork?.geared).toBe(true);
});
