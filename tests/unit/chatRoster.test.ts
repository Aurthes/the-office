import { describe, expect, it } from "vitest";
import { organizeChatRoster, type ChatRosterEntry } from "../../src/features/office/operations/chatRoster";
import { getAgentActivity } from "../../src/features/retro-office/core/agentActivity";

const activity = getAgentActivity({ status: "idle" });
const entry = (id: string, updatedAt: number | null, projectId: string | null, projectName: string): ChatRosterEntry =>
  ({ id, name: id, activity, updatedAt, projectId, projectName });
const entries = [entry("Old Alpha", 10, "a", "alpha"), entry("New Zebra", 40, "z", "Zebra"),
  entry("New Alpha", 30, "a", "alpha"), entry("No department", 20, null, "Open Workspace")];

describe("chat roster ordering", () => {
  it("puts the latest activity first across departments without changing the source", () => {
    const result = organizeChatRoster(entries, "activity");
    expect(result).toHaveLength(1);
    expect(result[0].agents.map(agent => agent.id)).toEqual(["New Zebra", "New Alpha", "No department", "Old Alpha"]);
    expect(entries[0].id).toBe("Old Alpha");
    expect(organizeChatRoster([{ ...entries[0], updatedAt: 50 }, ...entries.slice(1)], "activity")[0].agents[0].id).toBe("Old Alpha");
  });
  it("groups by project identity, sorts department names A–Z, and keeps recent agents first inside each", () => {
    const result = organizeChatRoster(entries, "project");
    expect(result.map(group => group.name)).toEqual(["alpha", "Open Workspace", "Zebra"]);
    expect(result[0].agents.map(agent => agent.id)).toEqual(["New Alpha", "Old Alpha"]);
    expect(organizeChatRoster([entry("one", 1, "a", "Same"), entry("two", 2, "b", "Same")], "project")).toHaveLength(2);
  });
  it.each(["activity", "project"] as const)("keeps name and department search working in %s order", order => {
    expect(organizeChatRoster(entries, order, " ALPHA ").flatMap(group => group.agents).map(agent => agent.id)).toEqual(["New Alpha", "Old Alpha"]);
    expect(organizeChatRoster(entries, order, "zebra").flatMap(group => group.agents).map(agent => agent.id)).toEqual(["New Zebra"]);
    expect(organizeChatRoster(entries, order, "not found").flatMap(group => group.agents)).toEqual([]);
  });
  it("puts missing or invalid timestamps last and uses stable ties", () => {
    const result = organizeChatRoster([entry("z", null, null, ""), entry("b", 2, null, ""),
      entry("a", 2, null, ""), entry("x", Number.NaN, null, "")], "activity");
    expect(result[0].agents.map(agent => agent.id)).toEqual(["a", "b", "x", "z"]);
  });
});
