import type { PoolHost } from "./types";

export const SERVER_FAMILIES = [
  { id: "s", label: "S series", color: "#73c7df" },
  { id: "ystko", label: "YSTKO series", color: "#c5a0ec" },
  { id: "preprod", label: "preprod series", color: "#e6b77e" },
  { id: "nju", label: "NJU series", color: "#7cd3aa" },
  { id: "local", label: "Local machine", color: "#9fb5c7" },
  { id: "other", label: "Other servers", color: "#aeb8c2" },
] as const;
export function serverFamily(host: PoolHost) {
  const alias = host.alias.toLowerCase();
  const id = host.group === "local" ? "local" : /^s\d/.test(alias) ? "s" : alias.startsWith("ystko") ? "ystko"
    : alias.startsWith("preprod") ? "preprod" : alias.startsWith("nju") ? "nju" : "other";
  return SERVER_FAMILIES.find(family => family.id === id)!;
}
export function groupServers<T extends PoolHost>(hosts: readonly T[]) {
  return SERVER_FAMILIES.map(family => ({ ...family, hosts: hosts.filter(host => serverFamily(host).id === family.id)
    .sort((a, b) => a.alias.localeCompare(b.alias, undefined, { numeric: true, sensitivity: "base" })) })).filter(group => group.hosts.length);
}
