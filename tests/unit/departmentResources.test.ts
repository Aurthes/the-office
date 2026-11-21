import * as THREE from "three";
import { expect, it } from "vitest";
import { Builder, disposeShipGeometry } from "@/features/ring-ship/geometry";
import { addCabinDetails } from "@/features/ring-ship/interior-details";
import { buildShipLayout, cabinAngle, shipPoint } from "@/features/ring-ship/layout";
import { departmentResourceAt, shipObjectAtHit } from "@/features/ring-ship/shipObjects";

it("keeps one usable resource pair in the assigned first bay and out of the central lane", () => {
  const projects = Array.from({ length: 62 }, (_, i) => ({ id: "d" + i, name: "Department " + i }));
  const members = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: "a" + i, projectId: "d0" })),
    ...Array.from({ length: 36 }, (_, i) => ({ id: "b" + i, projectId: "d1" })),
  ];
  const layout = buildShipLayout({ projects, members });
  const counts = new Map<string, number>();
  for (const cabin of layout.cabins.filter(c => c.kind === "work")) {
    const b = new Builder({});
    b.cabin = cabin;
    addCabinDetails(b, layout, cabin);
    const group = b.finish();
    try {
      const entries = b.objects.filter(o => o.kind === "departmentLibrary" || o.kind === "departmentToolbox");
      if (!entries.length) continue;
      expect(entries).toHaveLength(2);
      const shelf = entries.find(o => o.kind === "departmentLibrary")!;
      const toolbox = entries.find(o => o.kind === "departmentToolbox")!;
      const a = shelf.bounds.getCenter(new THREE.Vector3()), d = toolbox.bounds.getCenter(new THREE.Vector3());
      expect(Math.hypot(a.x - d.x, a.z - d.z)).toBeGreaterThan(.74);
      const p = shipPoint(layout.rings[cabin.ring].radius, cabinAngle(layout, cabin.slot));
      for (const [object, page] of [[shelf, "library"], [toolbox, "toolbox"]] as const) {
        expect(departmentResourceAt(layout, object, cabin.deck)).toEqual({ id: cabin.projectId, page });
        expect(departmentResourceAt(layout, object, cabin.deck === 0 ? 1 : 0)).toBeNull();
        expect(object.bounds.distanceToPoint(new THREE.Vector3(p.x, .22, p.z))).toBeGreaterThan(1.2);
        const part = object.parts[0];
        expect(shipObjectAtHit(part.mesh, part.start / 3)).toBe(object);
      }
      counts.set(cabin.projectId!, (counts.get(cabin.projectId!) || 0) + 1);
    } finally { disposeShipGeometry(group); }
  }
  expect(counts.size).toBe(projects.length + 1);
  expect([...counts.values()].every(count => count === 1)).toBe(true);
  expect(layout.allocation.projects.d1.span).toBeGreaterThan(1);
  expect(layout.cabins.some(cabin => cabin.kind === "work" && cabin.deck > 0)).toBe(true);
});
