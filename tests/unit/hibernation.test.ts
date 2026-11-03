import { describe, expect, it } from "vitest";
import { advanceCrew, canvasPoint, crewBodies, syncCrew, worldPoint, type MovingAgent } from "@/features/ring-ship/crewMotion";
import { buildShipLayout, cabinAngle, DECKS, shipPoint, type ShipLayout } from "@/features/ring-ship/layout";
import { HIBERNATION_CAPACITY, HIBERNATION_IDLE_MS, hibernationPod } from "@/features/ring-ship/hibernationLayout";
import { insideHibernation, sleepLid, sleepPose } from "@/features/ring-ship/hibernationMotion";
import { isWalkable, walkableSegment } from "@/features/ring-ship/walkableSurface";

const EPOCH = 1_800_000_000_000, NOW = EPOCH + HIBERNATION_IDLE_MS + 1;
function fixture() {
  const layout = buildShipLayout({ projects: [{ id: "p", name: "Project" }], members: [{ id: "sleeper", projectId: "p" }] });
  const a = syncCrew([{ id: "sleeper", name: "Sleeper", color: "#abc", item: "", status: "idle", lastActivityAt: EPOCH }], layout, new Map(), 0)[0];
  const cabin = layout.cabins.find(c => c.kind === "quarters" && c.deck === a.deck)!;
  return { layout, a, cabin };
}
function tick(a: MovingAgent, layout: ShipLayout, wall = NOW) { advanceCrew([a], layout, 1000 + a.frame * 16, .05, undefined, [], wall); }
function until(a: MovingAgent, layout: ShipLayout, done: () => boolean, limit = 4500) {
  for (let i = 0; i < limit && !done(); i++) {
    const before = worldPoint(a); tick(a, layout);
    const after = worldPoint(a);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(.14);
    if (!insideHibernation(a.hibernation)) expect(isWalkable(after, layout, .35, a.deck)).toBe(true);
  }
  expect({ done: done(), phase: a.hibernation?.phase, at: worldPoint(a), next: a.route[a.routeIndex] }).toMatchObject({ done: true });
}
function atPod() {
  const f = fixture(); Object.assign(f.a, canvasPoint(hibernationPod(f.layout, f.cabin, 0).entry));
  f.a.hibernation = { cabinId: f.cabin.id, pod: 0, phase: "entering", time: 0 };
  return f;
}

describe("hibernation bay", () => {
  it("keeps every pod approach and the central aisle on usable floor on every deck", () => {
    const { layout } = fixture();
    for (const deck of DECKS) {
      const cabin = layout.cabins.find(c => c.kind === "quarters" && c.deck === deck)!;
      for (let i = 0; i < HIBERNATION_CAPACITY; i++) {
        const pod = hibernationPod(layout, cabin, i);
        expect(isWalkable(pod.entry, layout, .4, deck)).toBe(true);
        expect(isWalkable(pod.center, layout, 0, deck)).toBe(false);
        const middle = shipPoint(layout.rings[cabin.ring].radius, pod.angle);
        const arrival = shipPoint(layout.rings[cabin.ring].radius, cabinAngle(layout, cabin.slot));
        expect(walkableSegment(arrival, middle, layout, .4, deck)).toBe(true);
        expect(walkableSegment(middle, pod.entry, layout, .4, deck)).toBe(true);
      }
    }
  });
  it("waits strictly over one hour, ignores unknown history, and excludes busy or waiting crew", () => {
    const { a, layout } = fixture(); tick(a, layout, EPOCH + HIBERNATION_IDLE_MS);
    expect(a.hibernation).toBeUndefined(); tick(a, layout); expect(a.hibernation?.phase).toBe("travelling");
    for (const patch of [{ status: "working" as const }, { status: "error" as const }, { needsInput: true }, { lastActivityAt: undefined }]) {
      const f = fixture(); Object.assign(f.a, patch); tick(f.a, f.layout); expect(f.a.hibernation).toBeUndefined();
    }
  });
  it("reserves distinct pods before arrival and leaves a full bay alone", () => {
    const { a, layout, cabin } = fixture();
    const crew = Array.from({ length: HIBERNATION_CAPACITY + 1 }, (_, i) => ({ ...a, id: `sleeper-${i}`, route: [] }));
    const seats = Object.fromEntries(crew.map(person => [person.id, { ...layout.seats[a.id], agentId: person.id }]));
    const filled = { ...layout, seats };
    advanceCrew(crew, filled, 1000, .05, undefined, [], NOW);
    const claims = crew.flatMap(person => person.hibernation ? [person.hibernation.pod] : []);
    expect(new Set(claims).size).toBe(HIBERNATION_CAPACITY);
    expect(claims).toHaveLength(HIBERNATION_CAPACITY); expect(crew.at(-1)?.hibernation).toBeUndefined();
    expect(crew[0].hibernation?.cabinId).toBe(cabin.id);
  });
  it("walks from the desk into a capsule, keeps its real identity, then jogs back to work", () => {
    const { a, layout } = fixture();
    until(a, layout, () => a.hibernation?.phase === "sleeping");
    expect(a.sleepPose?.tilt).toBe(-Math.PI / 2); expect(crewBodies([a], layout)).toEqual([]);
    const synced = syncCrew([{ ...a, name: "Still me" }], layout, new Map([[a.id, a]]), 3000)[0];
    expect(synced.hibernation).toBe(a.hibernation); expect(synced.sleepPose).toBe(a.sleepPose);
    synced.status = "working"; tick(synced, layout);
    expect(synced.hibernation?.phase).toBe("waking"); expect(sleepLid({ ...synced.hibernation!, time: .25 })).toBe(1);
    until(synced, layout, () => !synced.hibernation && synced.interactionTarget === "desk");
    expect(synced.sleepPose).toBeUndefined(); expect(synced.state).toBe("sitting");
    expect(Math.hypot(worldPoint(synced).x - synced.home.x, worldPoint(synced).z - synced.home.z)).toBeLessThan(.01);
  });
  it("wakes without a jump even if a task arrives halfway through climbing in", () => {
    const { a, layout, cabin } = atPod(); a.hibernation!.time = .35;
    a.sleepPose = sleepPose(a.hibernation!, hibernationPod(layout, cabin, 0)); Object.assign(a, canvasPoint(a.sleepPose!));
    const before = { ...a.sleepPose! }; a.needsInput = true; tick(a, layout);
    expect(a.hibernation?.phase).toBe("waking"); expect(a.sleepPose).toEqual(before);
    until(a, layout, () => !a.hibernation && a.interactionTarget === "desk");
  });
  it("cancels the trip from its current position and returns along the floor", () => {
    const { a, layout } = fixture(); for (let i = 0; i < 150; i++) tick(a, layout);
    expect(a.hibernation?.phase).toBe("travelling"); a.status = "working";
    until(a, layout, () => !a.hibernation && a.interactionTarget === "desk");
  });
  it("hands a woken builder to the existing device route, including another deck", () => {
    const { a, layout } = atPod(); until(a, layout, () => a.hibernation?.phase === "sleeping");
    a.constructionWorker = true; a.status = "working"; a.worksite = layout.cabins.find(c => c.kind === "garden" && c.deck === 1);
    until(a, layout, () => !a.hibernation && !!a.fieldwork?.geared);
    expect(a.deck).toBe(1); expect(a.fieldwork?.cabinId).toBe(a.worksite?.id);
  });
  it("resets the idle clock after activity and does not instantly sleep after work", () => {
    const { a, layout } = fixture(); a.status = "working"; tick(a, layout); a.status = "idle"; tick(a, layout);
    expect(a.hibernation).toBeUndefined(); expect(a.idleSince).toBe(NOW);
    a.lastActivityAt = NOW + 1000; tick(a, layout, NOW + 2000); expect(a.idleSince).toBe(NOW + 1000);
  });
  it("still rests when its chat is selected, and wakes on a new activity timestamp", () => {
    const { a, layout } = atPod();
    for (let i = 0; i < 40; i++) advanceCrew([a], layout, i * 50, .05, a.id, [], NOW);
    expect(a.hibernation?.phase).toBe("sleeping");
    a.lastActivityAt = NOW; tick(a, layout); expect(a.hibernation?.phase).toBe("waking");
  });
  it("lets an aisle passer-by through before stepping out", () => {
    const { a, layout, cabin } = atPod();
    until(a, layout, () => a.hibernation?.phase === "sleeping"); a.status = "working";
    const pod = hibernationPod(layout, cabin, 0);
    for (let i = 0; i < 70; i++) advanceCrew([a], layout, i * 50, .05, undefined, [{ id: "passer", position: pod.entry, radius: .6, deck: a.deck }], NOW);
    expect(a.hibernation?.phase).toBe("leaving");
    expect(Math.hypot(worldPoint(a).x - pod.entry.x, worldPoint(a).z - pod.entry.z)).toBeGreaterThan(.6);
    until(a, layout, () => !a.hibernation && a.interactionTarget === "desk");
  });
  it.each([9, 10, 19])("leaves the far inner and outer berths along safe routes: %s", index => {
    const { a, layout, cabin } = fixture();
    const pod = hibernationPod(layout, cabin, index);
    a.hibernation = { cabinId: cabin.id, pod: index, phase: "sleeping", time: 0 };
    a.sleepPose = sleepPose(a.hibernation, pod); Object.assign(a, canvasPoint(a.sleepPose!)); a.status = "working";
    until(a, layout, () => !a.hibernation && a.interactionTarget === "desk");
  });
});
