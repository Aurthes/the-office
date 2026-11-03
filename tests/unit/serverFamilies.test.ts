import { expect, it } from "vitest";
import { groupServers, serverFamily } from "@/lib/monitoring/families";

it("groups by case-insensitive machine prefix without changing production purpose or losing disabled hosts", () => {
  const hosts = [
    { alias: "cluster-a-13", group: "offline" as const, active: true },
    { alias: "CLUSTER-A-2", group: "offline" as const, active: false },
    { alias: "cluster-b-01", group: "online" as const, active: true },
    { alias: "cluster-c-01-arm", group: "online" as const, active: true },
    { alias: "cluster-d-11", group: "offline" as const, active: true },
    { alias: "Local Mac", group: "local" as const, active: true },
    { alias: "new-host", group: "offline" as const, active: true },
  ];
  const groups = groupServers(hosts);
  expect(groups.map(g => g.id)).toEqual(["cluster-a", "cluster-b", "cluster-c", "cluster-d", "local", "other"]);
  expect(groups[0].hosts.map(h => h.alias)).toEqual(["CLUSTER-A-2", "cluster-a-13"]);
  expect(groups.flatMap(g => g.hosts)).toHaveLength(hosts.length);
  expect(serverFamily(hosts[2]).id).toBe("cluster-b");
  expect(hosts[2].group).toBe("online");
});
