import type { PoolHost } from "./types";

export const SERVER_FAMILIES = [
  { id: "cluster-a", label: "Cluster A", color: "#73c7df" },
  { id: "cluster-b", label: "Cluster B", color: "#c5a0ec" },
  { id: "cluster-c", label: "Cluster C", color: "#e6b77e" },
  { id: "cluster-d", label: "Cluster D", color: "#7cd3aa" },
  { id: "local", label: "Local machine", color: "#9fb5c7" },
  { id: "other", label: "Other servers", color: "#aeb8c2" },
] as const;
export function serverFamily(host: PoolHost) {
  const alias = host.alias.toLowerCase();
  const id = host.group === "local" ? "local" : alias.startsWith("cluster-a-") ? "cluster-a" : alias.startsWith("cluster-b-") ? "cluster-b"
    : alias.startsWith("cluster-c-") ? "cluster-c" : alias.startsWith("cluster-d-") ? "cluster-d" : "other";
  return SERVER_FAMILIES.find(family => family.id === id)!;
}
export function groupServers<T extends PoolHost>(hosts: readonly T[]) {
  return SERVER_FAMILIES.map(family => ({ ...family, hosts: hosts.filter(host => serverFamily(host).id === family.id)
    .sort((a, b) => a.alias.localeCompare(b.alias, undefined, { numeric: true, sensitivity: "base" })) })).filter(group => group.hosts.length);
}
