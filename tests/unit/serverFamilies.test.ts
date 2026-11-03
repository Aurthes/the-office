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
  expect(groups.map(g => g.id)).toEqual(["series:cluster-a", "series:cluster-b", "series:cluster-c", "series:cluster-d", "local", "other"]);
  expect(groups[0].hosts.map(h => h.alias)).toEqual(["CLUSTER-A-2", "cluster-a-13"]);
  expect(groups.flatMap(g => g.hosts)).toHaveLength(hosts.length);
  expect(serverFamily(hosts[2]).id).toBe("series:cluster-b");
  expect(hosts[2].group).toBe("online");
});


it("discovers real numbered series beyond documentation examples, including suffixes", () => {
  const hosts = ["R13", "r2", "WORKER01", "worker02-arm", "lab-01", "LAB-09", "custom_node7"].map(alias => ({ alias, group: "offline" as const, active: true }));
  const groups = groupServers(hosts);
  expect(groups.map(group => [group.label, group.hosts.map(host => host.alias)])).toEqual([
    ["CUSTOM_NODE", ["custom_node7"]], ["LAB", ["lab-01", "LAB-09"]], ["R", ["r2", "R13"]], ["WORKER", ["WORKER01", "worker02-arm"]],
  ]);
  expect(groupServers(hosts.slice().reverse())).toEqual(groups);
  expect(serverFamily({ alias: "WORKER99", group: "online", active: false })).toEqual(serverFamily(hosts[2]));
});

it("keeps named remote series separate from the local and fallback groups", () => {
  const hosts = [
    { alias: "local01", group: "online" as const, active: true }, { alias: "other02", group: "offline" as const, active: true },
    { alias: "local01", group: "local" as const, active: true }, { alias: "standalone", group: "online" as const, active: true },
  ];
  expect(groupServers(hosts).map(group => group.id)).toEqual(["series:local", "series:other", "local", "other"]);
});
