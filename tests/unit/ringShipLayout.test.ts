import { describe, expect, it } from "vitest";
import { buildShipLayout, DECKS, shipDeck, parseShipAllocation, PUBLIC_CABINS, RING_CAPACITIES, RING_RADII, routeBetweenCabins, type ShipLayout } from "@/features/ring-ship/layout";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";

function roster(counts: number[]): CompanyRoster {
  return { projects: counts.map((_, i) => ({ id: `p${i}`, name: `Project ${i}` })),
    members: counts.flatMap((count, i) => Array.from({ length: count }, (_, n) => ({ id: `agent-${i}-${n}`, projectId: `p${i}` }))) };
}
function checkSeats(layout: ShipLayout, expected: number) {
  expect(Object.keys(layout.seats)).toHaveLength(expected);
  for (const seat of Object.values(layout.seats)) {
    const ring = layout.rings[seat.ring], distance = Math.hypot(seat.x, seat.z);
    expect(distance).toBeGreaterThan(ring.radius - ring.depth / 2);
    expect(distance).toBeLessThan(ring.radius + ring.depth / 2);
    expect(layout.cabins.find(c => c.id === seat.cabinId)?.agentIds).toContain(seat.agentId);
  }
}
describe("three-ring ship allocation", () => {
  it("places small, medium and large teams in appropriately sized cabins", () => {
    const layout = buildShipLayout(roster([2, 5, 8]));
    expect(layout.allocation.projects.p0.ring).toBe(0);
    expect(layout.allocation.projects.p1.ring).toBe(1);
    expect(layout.allocation.projects.p2.ring).toBe(2);
    checkSeats(layout, 15);
    for (const ring of layout.rings) expect(layout.cabins.some(c => c.ring === ring.index && c.kind === "reserve")).toBe(true);
  });
  it("activates existing reserve bays before enlarging the ship", () => {
    const before = buildShipLayout(roster([2]));
    const after = buildShipLayout(roster([2, 1]), before.allocation);
    expect(after.allocation.sectors).toBe(before.allocation.sectors);
    expect(after.allocation.projects.p0).toEqual(before.allocation.projects.p0);
    expect(after.cabins.filter(c => c.kind === "reserve")).toHaveLength(before.cabins.filter(c => c.kind === "reserve").length - 1);
  });
  it("adds one bay to all rings and preserves physical bay size when full", () => {
    let layout = buildShipLayout(roster([]));
    const projectCount = layout.cabins.filter(c=>c.kind==="reserve").length;
    for (let i = 1; i <= projectCount; i++) layout = buildShipLayout(roster(Array(i).fill(0)), layout.allocation);
    expect(layout.allocation.sectors).toBe(8);
    expect(layout.cabins.filter(c => c.kind === "reserve")).toHaveLength(0);
    const after = buildShipLayout(roster(Array(projectCount + 1).fill(0)), layout.allocation);
    expect(after.allocation.sectors).toBe(9);
    expect(after.cabins.length - layout.cabins.length).toBe(3 * DECKS.length);
    expect(after.cabins.filter(c => c.kind === "reserve")).toHaveLength(3 * DECKS.length - 1);
    after.rings.forEach((ring, i) => {
      expect(ring.radius / layout.rings[i].radius).toBeCloseTo(9 / 8);
      expect(ring.radius / after.allocation.sectors).toBeCloseTo(layout.rings[i].radius / layout.allocation.sectors);
      expect(ring.depth).toBe(layout.rings[i].depth);
    });
  });
  it("keeps all rings closed with a common angular division and unequal cabin lengths", () => {
    const layout = buildShipLayout(roster([2, 7]));
    const angle = 2 * Math.PI / layout.allocation.sectors;
    expect(angle * layout.allocation.sectors).toBeCloseTo(2 * Math.PI);
    expect(layout.rings.map(r => r.radius / layout.rings[0].radius)).toEqual(RING_RADII.map(r => r / RING_RADII[0]));
    expect(layout.rings[2].radius * angle).toBeGreaterThan(layout.rings[0].radius * angle);
  });
  it("keeps public amenities available during substantial project growth", () => {
    const layout = buildShipLayout(roster(Array(50).fill(2)));
    for (const p of PUBLIC_CABINS) {
      const cabin = layout.cabins.find(c => c.id === p.id);
      expect(cabin?.kind).toBe(p.kind); expect(cabin?.projectId).toBeUndefined();
    }
    expect(layout.cabins.filter(c => c.kind !== "work" && c.kind !== "reserve")).toHaveLength(PUBLIC_CABINS.length * DECKS.length - (DECKS.length-1) + 1);
    checkSeats(layout, 100);
  });
  it("uses contiguous outer cabins for teams larger than one bay without shrinking furniture", () => {
    const layout = buildShipLayout(roster([40])), assignment = layout.allocation.projects.p0;
    expect(assignment.ring).toBe(2);
    expect(assignment.span).toBe(Math.ceil(40 / RING_CAPACITIES[2]));
    const cabins = layout.cabins.filter(c => c.projectId === "p0");
    expect(cabins.map(c => c.slot)).toEqual(Array.from({ length: assignment.span }, (_, i) => assignment.slot + i));
    for (const cabin of cabins) expect(cabin.agentIds.length).toBeLessThanOrEqual(RING_CAPACITIES[2]);
    checkSeats(layout, 40);
  });
  it("resizes a team's allocation when people join or leave and retains spare hulls", () => {
    const small = buildShipLayout(roster([1]));
    const large = buildShipLayout(roster([17]), small.allocation);
    expect(large.allocation.projects.p0.ring).toBe(2);
    expect(large.allocation.projects.p0.span).toBe(3);
    const again = buildShipLayout(roster([1]), large.allocation);
    expect(again.allocation.projects.p0.ring).toBe(0);
    expect(again.allocation.sectors).toBe(large.allocation.sectors);
    checkSeats(again, 1);
  });
  it("preserves saved placement after refresh and ignores incoming project order", () => {
    const data = roster([2, 5, 7]); const before = buildShipLayout(data);
    const saved = parseShipAllocation(JSON.stringify(before.allocation));
    const after = buildShipLayout({ ...data, projects: data.projects.slice().reverse(), members: data.members.slice().reverse() }, saved);
    expect(after.allocation).toEqual(before.allocation);
    expect(after.seats).toEqual(before.seats);
  });
  it("keeps empty projects, unassigned sessions, and every unique worker", () => {
    const data = roster([0, 2]); data.members.push({ id: "unassigned", projectId: "unknown" }, { id: "agent-1-0", projectId: "p1" });
    const layout = buildShipLayout(data);
    expect(layout.cabins.some(c => c.projectId === "p0")).toBe(true);
    expect(layout.seats.unassigned.projectId).toBe("open-workspace");
    checkSeats(layout, 3);
  });
  it("rejects invalid browser allocation data", () => {
    for (const input of ["oops", "null", JSON.stringify({ version: 1, sectors: 999999, projects: {} }), JSON.stringify({ version: 1, sectors: 8, projects: { p: { ring: 4, slot: 1, span: 1 } } }), JSON.stringify({ version: 1, sectors: 8, projects: { p: { ring: 0, slot: 7, span: 2 } } })]) expect(parseShipAllocation(input)).toBeUndefined();
  });
  it("routes workers between rings along occupied decks and radial spokes", () => {
    const layout = buildShipLayout(roster([2])); const seat = layout.seats["agent-0-0"];
    for (const cabin of layout.cabins.filter(c => c.deck === seat.deck && (c.kind === "garden" || c.kind === "gym"))) {
      const route = routeBetweenCabins(layout, seat, cabin);
      expect(route.length).toBeGreaterThan(2);
      const path = [{ x: seat.x, z: seat.z }, ...route];
      for (let i = 1; i < path.length; i++) for (let n = 0; n <= 10; n++) {
        const x = path[i - 1].x + (path[i].x - path[i - 1].x) * n / 10, z = path[i - 1].z + (path[i].z - path[i - 1].z) * n / 10;
        const radius = Math.hypot(x, z);
        const onRing = layout.rings.some(r => Math.abs(radius - r.radius) <= r.depth / 2);
        const onSpoke = layout.spokes.some(angle => Math.abs(x * Math.cos(angle) - z * Math.sin(angle)) < 0.63);
        expect(onRing || onSpoke).toBe(true);
      }
    }
  });
});

it("fills ready decks before expanding and assigns every worker to exactly one deck", () => {
  const layout = buildShipLayout(roster(Array(32).fill(2)));
  expect(layout.allocation.sectors).toBe(8);
  expect(new Set(Object.values(layout.seats).map(s => s.deck))).toEqual(new Set(DECKS));
  const cabins = layout.cabins.filter(c => c.kind === "work");
  const ids = cabins.flatMap(c => c.agentIds);
  expect(ids).toHaveLength(64); expect(new Set(ids).size).toBe(64);
  for (const deck of DECKS) {
    const floor = shipDeck(layout, deck);
    expect(floor.cabins).toHaveLength(24);
    expect(floor.cabins.every(c => c.deck === deck)).toBe(true);
    expect(floor.rings).toBe(layout.rings);
    expect(floor.cabins.filter(c => c.kind !== "work" && c.kind !== "reserve")).toHaveLength(PUBLIC_CABINS.length - (deck===0?0:1) + (layout.allocation.monitorRoom?.deck === deck ? 1 : 0));
    for (const seat of Object.values(floor.seats)) expect(floor.cabins.find(c => c.id === seat.cabinId)?.deck).toBe(deck);
  }
  checkSeats(layout, 64);
});
it("upgrades an existing single-deck allocation without moving its projects", () => {
  const data = roster([2, 5, 8]), before = buildShipLayout(data);
  for (const assignment of Object.values(before.allocation.projects)) delete assignment.deck;
  const saved = parseShipAllocation(JSON.stringify(before.allocation));
  const after = buildShipLayout(data, saved);
  for (const [id, assignment] of Object.entries(before.allocation.projects)) {
    expect(after.allocation.projects[id]).toEqual({ ...assignment, deck: 0 });
  }
  expect(parseShipAllocation(JSON.stringify({ ...after.allocation, projects: { p: { deck: 3, ring: 0, slot: 1, span: 1 } } }))).toBeUndefined();
});

it("adopts one existing reserve cabin and keeps its location without moving saved projects", () => {
  const data = roster([2, 5, 8]), original = buildShipLayout(data);
  const legacy = { ...original.allocation, monitorRoom: undefined };
  const upgraded = buildShipLayout(data, legacy);
  expect(upgraded.allocation.projects).toEqual(legacy.projects);
  expect(upgraded.allocation.sectors).toBe(legacy.sectors);
  expect(upgraded.cabins).toHaveLength(original.cabins.length);
  const room = upgraded.cabins.find(c => c.kind === "monitor")!;
  expect(room).toMatchObject({ id: "public:monitor", agentIds: [] });
  expect(PUBLIC_CABINS.some(c => c.ring === room.ring && c.slot === room.slot)).toBe(false);
  const grown = buildShipLayout(roster([2, 5, 8, 5]), parseShipAllocation(JSON.stringify(upgraded.allocation)));
  expect(grown.allocation.monitorRoom).toEqual(upgraded.allocation.monitorRoom);
  expect(grown.cabins.find(c => c.id === room.id)).toEqual(room);
  for (const [id, assignment] of Object.entries(upgraded.allocation.projects)) expect(grown.allocation.projects[id]).toEqual(assignment);
  expect(parseShipAllocation(JSON.stringify({ ...upgraded.allocation, monitorRoom: { deck: 3, ring: 1, slot: 0 } }))).toBeUndefined();
});
