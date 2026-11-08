export type AgentInterfacePreset = "standard" | "teaser";
export type AgentInterfaces = Record<string, "teaser">;
export type AgentInterfacePatch = Record<string, AgentInterfacePreset | null> | null;
export type AgentInterfaceCapability = "teaser-board";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function resolveAgentInterface(value: unknown): { preset: AgentInterfacePreset; capabilities: readonly AgentInterfaceCapability[] } {
  return value === "teaser" ? { preset: "teaser", capabilities: ["teaser-board"] } : { preset: "standard", capabilities: [] };
}
export function normalizeAgentInterfaces(value: unknown): AgentInterfaces {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, preset]) => uuid.test(id) && preset === "teaser"));
}
export function mergeAgentInterfaces(current: unknown, patch: unknown): AgentInterfaces {
  const next = normalizeAgentInterfaces(current);
  if (patch === null) return {};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return next;
  for (const [id, preset] of Object.entries(patch)) {
    if (!uuid.test(id)) continue;
    if (preset === "teaser") next[id] = "teaser"; else delete next[id];
  }
  return next;
}
export type InterfaceAgent = { id: string; name: string; status?: string; archived?: boolean; needsInput?: boolean };
export function resolveTeaserTarget(agents: readonly InterfaceAgent[], interfaces: unknown, loaded: boolean) {
  const ids = Object.keys(normalizeAgentInterfaces(interfaces));
  if (!loaded) return { target: null, reason: "Interface settings or roster are unavailable." };
  if (!ids.length) return { target: null, reason: "Choose a Teaser interface preset before sending a solution." };
  if (ids.length !== 1) return { target: null, reason: "More than one agent has the Teaser preset. Keep one target to send solutions." };
  const matches = agents.filter(agent => agent.id === ids[0] && !agent.archived);
  if (matches.length !== 1) return { target: null, reason: "The configured Teaser agent is unavailable or archived." };
  return { target: matches[0], reason: null };
}
