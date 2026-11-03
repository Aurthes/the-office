import type { PoolHost } from "./types";

const LOCAL_FAMILY = { id: "local", label: "Local machine", color: "#9fb5c7" };
const OTHER_FAMILY = { id: "other", label: "Other servers", color: "#aeb8c2" };

export function serverFamily(host: PoolHost) {
  if (host.group === "local") return LOCAL_FAMILY;
  // Infer the series from the configured alias, including numbered variants
  // with a suffix. Example inventories must never become a runtime whitelist.
  const prefix = host.alias.trim().match(/^([a-z][a-z_-]*?)[-_]?\d/i)?.[1].replace(/[-_]+$/, "").toLowerCase();
  if (!prefix) return OTHER_FAMILY;
  let hue = 0;
  for (const char of prefix) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return { id: `series:${prefix}`, label: prefix.toUpperCase(), color: `hsl(${hue},55%,68%)` };
}

export function groupServers<T extends PoolHost>(hosts: readonly T[]) {
  const groups = new Map<string, ReturnType<typeof serverFamily> & { hosts: T[] }>();
  for (const host of hosts) {
    const family = serverFamily(host);
    let group = groups.get(family.id);
    if (!group) { group = { ...family, hosts: [] }; groups.set(family.id, group); }
    group.hosts.push(host);
  }
  const order = (id: string) => id === "local" ? 1 : id === "other" ? 2 : 0;
  return [...groups.values()].sort((a, b) => order(a.id) - order(b.id) || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }))
    .map(group => ({ ...group, hosts: group.hosts.sort((a, b) => a.alias.localeCompare(b.alias, undefined, { numeric: true, sensitivity: "base" })) }));
}
