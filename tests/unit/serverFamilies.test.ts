import { expect, it } from "vitest";
import { groupServers, serverFamily } from "@/lib/monitoring/families";

it("groups by case-insensitive machine prefix without changing production purpose or losing disabled hosts", () => {
  const hosts = [
    { alias: "s13", group: "offline" as const, active: true },
    { alias: "S2", group: "offline" as const, active: false },
    { alias: "YSTKO01", group: "online" as const, active: true },
    { alias: "preprod00-arm", group: "online" as const, active: true },
    { alias: "nju11", group: "offline" as const, active: true },
    { alias: "Local Mac", group: "local" as const, active: true },
    { alias: "new-host", group: "offline" as const, active: true },
  ];
  const groups = groupServers(hosts);
  expect(groups.map(g => g.id)).toEqual(["s", "ystko", "preprod", "nju", "local", "other"]);
  expect(groups[0].hosts.map(h => h.alias)).toEqual(["S2", "s13"]);
  expect(groups.flatMap(g => g.hosts)).toHaveLength(hosts.length);
  expect(serverFamily(hosts[2]).id).toBe("ystko");
  expect(hosts[2].group).toBe("online");
});
