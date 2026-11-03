import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { Builder, disposeShipGeometry } from "@/features/ring-ship/geometry";
import { buildShipLayout } from "@/features/ring-ship/layout";
import { addMachineRoom } from "@/features/ring-ship/ship-biomes";
import type { PoolHost } from "@/lib/monitoring/types";
import { serverConsoleScreenPose } from "@/features/ring-ship/machineRoomLayout";

describe("dense machine-room equipment", () => {
  it("maps every registered host to one rack while keeping cooling and one shared console", () => {
    const layout = buildShipLayout({ projects: [], members: [] });
    const cabin = layout.cabins.find(c => c.id === "public:server-room")!;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), fillText: vi.fn() } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
    const builder = new Builder({}); builder.cabin = cabin;
    const hosts: PoolHost[] = ["cluster-a-03", "cluster-a-01", "cluster-a-02", "cluster-b-01", "cluster-b-02", "cluster-c-01", "cluster-c-02-arm", "cluster-d-01", "cluster-d-02"].map(alias => ({ alias, group: "offline", active: alias !== "cluster-a-02" }));
    addMachineRoom(builder, layout, cabin, hosts);
    const group = builder.finish(), objects = builder.objects;
    expect(objects.filter(o => o.kind === "serverRack")).toHaveLength(hosts.length);
    expect(objects.filter(o => o.kind === "serverRack").map(o => o.serverAlias).sort()).toEqual(hosts.map(host => host.alias).sort());
    const reversed = new Builder({}); reversed.cabin = cabin; addMachineRoom(reversed, layout, cabin, hosts.slice().reverse());
    expect(reversed.objects.filter(o => o.serverAlias).map(o => [o.serverAlias, o.id]).sort()).toEqual(objects.filter(o => o.serverAlias).map(o => [o.serverAlias, o.id]).sort());
    disposeShipGeometry(reversed.finish());
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
