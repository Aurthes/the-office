import { describe, expect, it } from "vitest";
import { buildShipLayout, type ShipLayout } from "@/features/ring-ship/layout";
import { advanceCrew, canvasPoint, syncCrew, worldPoint, type MovingAgent } from "@/features/ring-ship/crewMotion";
import { resolveWorksite, insideSite, sitePoint } from "@/features/ring-ship/fieldwork";
import { latestSiteTask, type SiteTask } from "@/lib/office/fieldworkTask";
import { isWalkable } from "@/features/ring-ship/walkableSurface";
import { createDuckCrewFigure } from "@/features/ring-ship/duckCrewFigure";
import { DEFAULT_DUCK_APPEARANCE } from "@/lib/avatars/duck";
import { registerFurniture } from "@/features/ring-ship/furnitureCollisions";
import { cabinAngle, shipPoint } from "@/features/ring-ship/layout";
import * as THREE from "three";

function fixture(task: SiteTask = "调整 rainforest section 里的灯光") {
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
    expect(resolveWorksite("检查 rainforest 和 gym", layout, 0)).toMatchObject({ kind: "work", projectId: "open-workspace" });
    expect(resolveWorksite("更新依赖并修复登录", layout, 0)).toMatchObject({ kind: "work", projectId: "open-workspace" });
    expect(resolveWorksite("为区域任务（比如调整 rainforest）增加施工动作", layout, 0)).toMatchObject({ projectId: "open-workspace" });
  });
  it("keeps the substantive task through short continuations and deployment receipts", () => {
    expect(latestSiteTask([{ role: "user", content: "调整雨林的灯光" }, { role: "assistant", content: "去 gym 吗" }, { role: "user", content: "继续" }, { role: "user", content: "Automatic deployment receipt: done" }])).toBe("调整雨林的灯光");
    expect(latestSiteTask([{ role: "user", content: "调整雨林" }, { role: "user", content: "现在更新所有依赖" }])).toBe("现在更新所有依赖");
  });
  it("keeps ordinary employees at their desks and camps unlocated Office work in shared workspace", () => {
    const initial = fixture(); let a = initial.a; const layout = initial.layout; a = change(a, layout, { constructionWorker: false }); advanceCrew([a], layout, 0, .05);
    expect(a.fieldwork).toBeUndefined(); expect(a.state).toBe("sitting");
    a = change(a, layout, { constructionWorker: true, siteTask: "整理所有依赖" }); advanceCrew([a], layout, 0, .05);
    expect(a.fieldwork).toBeDefined(); expect(a.worksite?.projectId).toBe("open-workspace");
  });
});
it.each(["调整 rainforest 的灯光", "调整吧台留声机", "调整克隆舱的部件", "调整机房里的平台", "调整茶水间的桌子"])("runs to the real site, changes clothes and works there: %s", task => {
  const { a, layout } = fixture(task); until(a, layout, () => !!a.fieldwork?.geared);
  expect(a.interactionTarget).toBeUndefined(); expect(a.state).toBe("standing");
  const field = a.fieldwork; const before = worldPoint(a);
  const refreshed = change(a, layout, { name: "Still building" });
  expect(refreshed.fieldwork).toBe(field); expect(worldPoint(refreshed)).toEqual(before);
  const phases = new Set<string>(); for (let i = 0; i < 700; i++) { advanceCrew([refreshed], layout, i * 50, .05); phases.add(refreshed.fieldwork!.phase); }
  for (const phase of ["blueprint", "notes", "survey", "measure", "patrol"]) expect(phases.has(phase)).toBe(true);
});
it.each(["idle", "error"])("packs up and walks home when the task ends or changes: %s", reason => {
  const initial = fixture(); let a = initial.a; const layout = initial.layout; until(a, layout, () => !!a.fieldwork?.geared);
  a = change(a, layout, { status: reason as "idle" | "error" });
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

it("leaves a break-room seat and releases its reservation before a site task", async () => {
  const { breakSeatPose } = await import("@/features/ring-ship/breakRoomLayout");
  const { a, layout } = fixture(); const room = layout.cabins.find(c => c.kind === "break")!;
  Object.assign(a, canvasPoint(breakSeatPose(layout, room, 0).point));
  a.breakVisit = { cabinId: room.id, seat: 0, action: "coffee", outward: [] }; a.visiting = true;
  until(a, layout, () => !!a.fieldwork?.geared);
  expect(a.breakVisit).toBeUndefined();
});


it("routes controlled Teaser work to break, keeps explicit clone work, and rejects incidental room words", () => {
  const { layout } = fixture();
  const header = "Work on delegated Office task 00000000-0000-4000-8000-000000000074: Teaser看板、会话入口与逐题白板\nTask update: {\"instructions\":\"保护其他/cloning/研究\"}";
  expect(resolveWorksite(latestSiteTask([{ role: "user", content: header }]), layout, 0)?.kind).toBe("break");
  const readable = "**From agent: Head**\n\n[T74 · Teaser看板、会话入口与逐题白板](task://00000000-0000-4000-8000-000000000074)\n\n保护其他/cloning/研究。修复rainforest示例。";
  expect(latestSiteTask([{ role: "user", content: readable }])).toMatchObject({ taskId: "00000000-0000-4000-8000-000000000074", title: "Teaser看板、会话入口与逐题白板" });
  expect(resolveWorksite(latestSiteTask([{ role: "user", content: readable }]), layout, 0)?.kind).toBe("break");
  expect(resolveWorksite(latestSiteTask([{ role: "user", content: `**From agent: Head**\n\n${header}` }]), layout, 0)?.kind).toBe("break");
  for (const task of ["Teaser board", "修改趣题看板", "Teaser白板；保护cloning", "Teaser，保留 /tmp/cloning/cache", "Teaser，cloning/cache", "Teaser，清理cloning目录", "Teaser，不修改克隆舱", "Teaser，例如 gym", "Teaser，do not change cloning", "Teaser，`cloning`", "Teaser，```text\ncloning\n```"])
    expect(resolveWorksite(task, layout, 0)?.kind, task).toBe("break");
  expect(resolveWorksite({ taskId: "task", title: "Teaser board", phase: "修复克隆舱内的Teaser展示" }, layout, 0)?.kind).toBe("cloning");
  for (const task of ["修改Teaser、rainforest 和 gym", "修改普通whiteboard", "调整sidebar2", "调整cloning2", "修复 /tmp/cloning/cache", "例如调整克隆舱"])
    expect(resolveWorksite(task, layout, 0)?.projectId, task).toBe("open-workspace");
  expect(resolveWorksite("修改 Observation deck", layout, 0)?.kind).toBe("lounge");
  expect(resolveWorksite("修复 clone lab", layout, 0)?.kind).toBe("cloning");
});
it("falls back to stable real shared work cabins when a room/deck is missing", () => {
  const { layout } = fixture();
  const missing = { ...layout, cabins: layout.cabins.filter(c => c.kind !== "garden") };
  expect(resolveWorksite("修复rainforest里的Teaser", missing, 0)?.projectId).toBe("open-workspace");
  expect(resolveWorksite("修改L3 Teaser board", layout, 0)?.projectId).toBe("open-workspace");
  const shared = layout.cabins.find(c => c.projectId === "open-workspace")!;
  const upstairs = { ...shared, id: "shared-upstairs", deck: 2 as const };
  const multiple = { ...layout, cabins: [...layout.cabins, upstairs] };
  expect(resolveWorksite(null, multiple, 2)?.id).toBe(upstairs.id);
  expect(resolveWorksite(null, { ...multiple, cabins: [...multiple.cabins].reverse() }, 0)?.id).toBe(shared.id);
});
it("never projects a camp out of its cabin and waits when every candidate is occupied", () => {
  const { layout } = fixture(); const cabin = resolveWorksite("更新依赖", layout, 0)!;
  for (let seed = 0; seed < 12; seed++) for (let patrol = 0; patrol < 5; patrol++) {
    const point = sitePoint(layout, cabin, seed, patrol)!;
    expect(insideSite(layout, cabin, point)).toBe(true); expect(isWalkable(point, layout, .4, cabin.deck)).toBe(true);
  }
  expect(sitePoint(layout, cabin, 1, 0, undefined, () => false)).toBeUndefined();
});
it("retargets generic work into shared camp while retaining kit and later goes home", () => {
  const initial = fixture(); let { a } = initial; const { layout } = initial;
  until(a, layout, () => !!a.fieldwork?.geared);
  a = change(a, layout, { siteTask: "更新依赖" });
  until(a, layout, () => a.fieldwork?.phase === "blueprint" && layout.cabins.find(c => c.id === a.fieldwork?.cabinId)?.projectId === "open-workspace");
  expect(a.fieldwork?.geared).toBe(true); expect(insideSite(layout, a.worksite!, a.fieldwork!.camp)).toBe(true);
  a = change(a, layout, { status: "idle" }); until(a, layout, () => !a.fieldwork);
  expect(a.deck).toBe(a.homeDeck);
});
it("uses the lift for a shared fallback on another deck", () => {
  const { layout, a: original } = fixture("未知施工");
  const shared = layout.cabins.find(c => c.projectId === "open-workspace")!;
  const target = layout.cabins.find(c => c.kind === "reserve" && c.deck === 1)!;
  Object.assign(shared, { projectId: undefined, kind: "reserve" });
  Object.assign(target, { projectId: "open-workspace", kind: "work", name: "Shared workspace" });
  const a = syncCrew([{ ...original, siteTask: "未知施工" }], layout, new Map(), 0)[0];
  let lift = false;
  until(a, layout, () => { lift ||= a.fieldwork?.phase === "lift"; return !!a.fieldwork?.geared; });
  expect(lift).toBe(true); expect(a.deck).toBe(1); expect(a.fieldwork?.cabinId).toBe(target.id);
});


it("waits for an occupied shared camp without jumping or camping in another room", () => {
  const { a, layout } = fixture("更新依赖"); const cabin = a.worksite!;
  const blocker = { id: "synthetic-blocker", position: shipPoint(layout.rings[cabin.ring].radius, cabinAngle(layout, cabin.slot)), radius: 4, deck: cabin.deck };
  const before = worldPoint(a);
  for (let i = 0; i < 50; i++) advanceCrew([a], layout, i * 50, .05, undefined, [blocker]);
  expect(worldPoint(a)).toEqual(before); expect(a.fieldwork?.geared).toBe(false); expect(a.fieldwork?.cabinId).toBe("");
  until(a, layout, () => !!a.fieldwork?.geared);
  expect(a.fieldwork?.cabinId).toBe(cabin.id); expect(insideSite(layout, cabin, a.fieldwork!.camp)).toBe(true);
});
it("can finish or change a task while waiting for a safe camp", () => {
  const initial = fixture("更新依赖"); let { a } = initial; const { layout } = initial;
  const cabin = a.worksite!, center = shipPoint(layout.rings[cabin.ring].radius, cabinAngle(layout, cabin.slot));
  const blocker = { id: "blocker", position: center, radius: 4, deck: cabin.deck };
  advanceCrew([a], layout, 0, .05, undefined, [blocker]);
  a = change(a, layout, { status: "idle" });
  expect(() => advanceCrew([a], layout, 50, .05, undefined, [blocker])).not.toThrow();
  expect(a.fieldwork).toBeUndefined();
});
it("does not project a furniture-blocked camp into the neighbouring room", () => {
  const { layout } = fixture("更新依赖"); const cabin = resolveWorksite(null, layout, 0)!;
  const center = shipPoint(layout.rings[cabin.ring].radius, cabinAngle(layout, cabin.slot));
  const unregister = registerFurniture(layout, [{ owner: "synthetic-wall", x: center.x, y: center.z, halfX: 8, halfY: 8, angle: 0, bottom: 0, top: 2, deck: cabin.deck }]);
  try { expect(sitePoint(layout, cabin, 1)).toBeUndefined(); } finally { unregister(); }
});
it("retargets safely during a lift and completes work on the new site", () => {
  const initial = fixture("调整L2雨林"); let { a } = initial; const { layout } = initial;
  until(a, layout, () => a.fieldwork?.phase === "lift");
  const before = worldPoint(a);
  a = change(a, layout, { siteTask: "更新依赖" }); expect(worldPoint(a)).toEqual(before);
  until(a, layout, () => !!a.fieldwork?.geared && a.fieldwork?.cabinId === a.worksite?.id);
  expect(a.worksite?.projectId).toBe("open-workspace"); expect(a.deck).toBe(a.homeDeck);
});

it("does not reuse an old room from history when the latest user message is unrelated or malformed", () => {
  expect(latestSiteTask([{ role: "user", content: "修改克隆舱" }, { role: "user", content: "cloning是什么意思？" }])).toBe("");
  expect(latestSiteTask([{ role: "user", content: "修改克隆舱" }, { role: "user", content: "Work on delegated Office task invalid: Teaser\nTask update: {}" }])).toBe("");
});
