import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { Builder, disposeShipGeometry } from "@/features/ring-ship/geometry";
import { buildShipLayout } from "@/features/ring-ship/layout";
import { addMachineRoom } from "@/features/ring-ship/ship-biomes";
import { serverConsoleScreenPose } from "@/features/ring-ship/machineRoomLayout";

describe("dense machine-room equipment", () => {
  it("fills the main-deck room with racks and cooling, while keeping one shared console", () => {
    const layout = buildShipLayout({ projects: [], members: [] });
    const cabin = layout.cabins.find(c => c.id === "public:server-room")!;
    const builder = new Builder({}); builder.cabin = cabin;
    addMachineRoom(builder, layout, cabin);
    const group = builder.finish(), objects = builder.objects;
    expect(objects.filter(o => o.kind === "serverRack").length).toBeGreaterThanOrEqual(36);
    expect(objects.filter(o => o.kind === "machineConsole")).toHaveLength(1);
    expect(objects.some(o => o.kind === "waterTank")).toBe(true);
    const screen = serverConsoleScreenPose(layout, cabin);
    expect(objects.find(o => o.kind === "machineConsole")!.bounds.containsPoint(new Vector3(screen.point.x, screen.height, screen.point.z))).toBe(true);
    const phases = group.children.flatMap(object => {
      const material = (object as import("three").Mesh).material as import("three").MeshStandardMaterial;
      return typeof material.userData.serverActivityPhase === "number" ? [material.userData.serverActivityPhase] : [];
    });
    expect(new Set(phases).size).toBe(4);
    disposeShipGeometry(group);
  });
});
