import type { AgentActivity } from "@/features/retro-office/core/agentActivity";

export type ChatRosterOrder = "activity" | "project";
export type ChatRosterEntry = {
  id: string;
  name: string;
  activity: AgentActivity;
  hasPendingSchedule?: boolean;
  updatedAt: number | null;
  projectId: string | null;
  projectName: string;
};
type Group = { id: string | null; name: string; agents: ChatRosterEntry[] };
const alphabet = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const time = (value: number | null) => value !== null && Number.isFinite(value) ? value : 0;
const recentFirst = (a: ChatRosterEntry, b: ChatRosterEntry) => time(b.updatedAt) - time(a.updatedAt)
  || alphabet.compare(a.name, b.name) || a.id.localeCompare(b.id);

export function organizeChatRoster(entries: ChatRosterEntry[], order: ChatRosterOrder, search = ""): Group[] {
  const query = search.trim().toLocaleLowerCase();
  const agents = entries.filter(agent => !query || [agent.name, agent.id, agent.projectName]
    .some(value => value.toLocaleLowerCase().includes(query))).sort(recentFirst);
  if (order === "activity") return [{ id: null, name: "", agents }];
  const groups = new Map<string | null, Group>();
  for (const agent of agents) {
    let group = groups.get(agent.projectId);
    if (!group) { group = { id: agent.projectId, name: agent.projectName || "Open Workspace", agents: [] }; groups.set(agent.projectId, group); }
    group.agents.push(agent);
  }
  return [...groups.values()].sort((a, b) => alphabet.compare(a.name, b.name)
    || (a.id || "").localeCompare(b.id || ""));
}
