import { expect, it, vi } from "vitest";
import { createSpaceActivityResources } from "@/features/ring-ship/SpaceActivity";
import { SPACE_ACTIVITY_BUDGET } from "@/features/ring-ship/space-activity";

vi.mock("@react-three/fiber", () => ({ useFrame: () => {} }));

it("fits all ambient content into four draw calls, fewer than 1000 triangles, and small geometry buffers", () => {
  const r = createSpaceActivityResources(), geometries = [r.rock, r.hull, r.engines, r.dust];
  const triangles = (geometry: typeof r.hull) => (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  const total = triangles(r.rock) * SPACE_ACTIVITY_BUDGET.asteroids + (triangles(r.hull) + triangles(r.engines)) * SPACE_ACTIVITY_BUDGET.ships;
  const bytes = geometries.reduce((sum, geometry) => sum + Object.values(geometry.attributes).reduce((n, attribute) => n + attribute.array.byteLength, 0) + (geometry.index?.array.byteLength ?? 0), 0);
  expect(SPACE_ACTIVITY_BUDGET.drawCalls).toBe(4);
  expect(total).toBeLessThan(1000);
  expect(bytes).toBeLessThan(65536);
  expect(r.dust.attributes.position.count).toBe(SPACE_ACTIVITY_BUDGET.dust);
  for (const material of [r.rockMaterial, r.hullMaterial, r.engineMaterial, r.dustMaterial]) expect(material.map).toBeNull();
  const disposed = vi.fn();
  for (const resource of [...geometries, r.rockMaterial, r.hullMaterial, r.engineMaterial, r.dustMaterial]) resource.addEventListener("dispose", disposed);
  r.dispose(); expect(disposed).toHaveBeenCalledTimes(8);
});
