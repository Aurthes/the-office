import { expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { Builder } from "@/features/ring-ship/geometry";
import { buildShipLayout, cabinAngle } from "@/features/ring-ship/layout";
import { addMonitorRoom } from "@/features/ring-ship/monitor-room-geometry";
import { NAVIGATION_TABLE_RADIUS, navigationConsolePose } from "@/features/ring-ship/StarNavigation";

vi.mock("@react-three/drei", () => ({ Html: () => null, Line: () => null }));

it.each([8, 12, 20])("leaves clearance from every monitor machine and stays inside the cabin at %s sectors", sectors => {
  const layout = buildShipLayout({ projects: [], members: [] }, { version: 1, sectors, projects: {} });
  const room = layout.cabins.find(cabin => cabin.kind === "monitor")!;
  for (const slot of [room.slot, (room.slot + 3) % sectors]) {
    const cabin = { ...room, slot }, pose = navigationConsolePose(layout, cabin), builder = new Builder({});
    const boxes: Array<{ size: number[]; point: number[]; angle: number }> = [];
    vi.spyOn(builder, "box").mockImplementation((...args) => {
      const [size, point, , angle = 0] = args;
      boxes.push({ size, point, angle });
    });
    addMonitorRoom(builder, layout, cabin);
    expect(boxes.length).toBeGreaterThan(20);
    const gaps = boxes.map(box => {
      const delta = new Vector3(pose.point.x - box.point[0], 0, pose.point.z - box.point[2]).applyAxisAngle(new Vector3(0, 1, 0), -box.angle);
      return Math.hypot(Math.max(0, Math.abs(delta.x) - box.size[0] / 2), Math.max(0, Math.abs(delta.z) - box.size[2] / 2)) - NAVIGATION_TABLE_RADIUS;
    });
    expect(Math.min(...gaps)).toBeGreaterThan(.5);
    const ring = layout.rings[cabin.ring], angle = cabinAngle(layout, cabin.slot);
    for (let i = 0; i < 64; i++) {
      const x = pose.point.x + Math.cos(i * Math.PI / 32) * NAVIGATION_TABLE_RADIUS;
      const z = pose.point.z + Math.sin(i * Math.PI / 32) * NAVIGATION_TABLE_RADIUS;
      expect(Math.hypot(x, z)).toBeGreaterThan(ring.radius - ring.depth / 2);
      expect(Math.hypot(x, z)).toBeLessThan(ring.radius + ring.depth / 2);
      const offset = Math.atan2(Math.sin(Math.atan2(x, z) - angle), Math.cos(Math.atan2(x, z) - angle));
      expect(Math.abs(offset)).toBeLessThan(Math.PI / sectors);
    }
    expect(Math.cos(pose.angle - Math.atan2(pose.point.x, pose.point.z))).toBeCloseTo(1, 12);
  }
});
