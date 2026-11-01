import { describe, expect, it, vi } from "vitest";
import { loadCompanySnapshot } from "../../src/features/office/operations/loadCompanySnapshot";
import { agentStoreReducer, initialAgentStoreState } from "../../src/features/agents/state/store";

describe("one-read company snapshot", () => {
  it("hydrates all native sessions, names and project membership in one RPC", async () => {
    const agents = Array.from({ length: 150 }, (_, i) => ({ id: `original-${i}`, name: `Person ${i}`,
      role: "Project", projectId: "p", status: i === 0 ? "running" : "idle", model: "native-model", modelProvider: "openai", effort: "high", updatedAt: i }));
    const call = vi.fn(async () => ({ defaultId: agents[0].id, mainKey: "main", agents,
      projects: [{ id: "p", name: "Project" }], creationAvailable: true }));
    const result = await loadCompanySnapshot({ client: { call }, gatewayUrl: "ws://office", loadSettings: async () => null });
    expect(call).toHaveBeenCalledExactlyOnceWith("office.snapshot", {});
    expect(result.hydration.seeds).toHaveLength(150);
    expect(result.hydration.seeds[0]).toMatchObject({ agentId: "original-0", name: "Person 0", role: "Project",
      sessionKey: "agent:original-0:main", model: "openai/native-model", thinkingLevel: "high" });
    expect(result.snapshot.agents[0].status).toBe("running");
    expect(result.hydration.sessionCreatedAgentIds).toHaveLength(150);
  });
  it("accepts an empty office instead of resurrecting a stale hello roster", async () => {
    const result = await loadCompanySnapshot({ client: { call: async () => ({ mainKey: "main", agents: [], projects: [], creationAvailable: true }) },
      gatewayUrl: "ws://office", loadSettings: async () => null });
    expect(result.hydration.seeds).toEqual([]);
  });
  it("clears a stale running marker when the restarted owner has not confirmed a live turn", async () => {
    const agent = { id: "original", name: "Person", role: "Project", status: "unknown", updatedAt: 0 };
    const call = vi.fn(async () => ({ mainKey: "main", agents: [agent], projects: [], creationAvailable: true }));
    const load = () => loadCompanySnapshot({ client: { call }, gatewayUrl: "ws://office", loadSettings: async () => null });
    const result = await load();
    let state = agentStoreReducer(initialAgentStoreState, { type: "hydrateAgents", agents: result.hydration.seeds });
    state = agentStoreReducer(state, { type: "updateAgent", agentId: agent.id, patch: { status: "running", runId: "before-restart" } });
    state = agentStoreReducer(state, { type: "hydrateAgents", agents: result.hydration.seeds });
    expect(state.agents[0]).toMatchObject({ status: "running", runId: "before-restart" });
    const status = result.snapshot.agents[0].status;
    if (status === "running" || status === "idle" || status === "error") {
      state = agentStoreReducer(state, { type: "updateAgent", agentId: agent.id, patch: { status, runId: null } });
    }
    expect(state.agents[0]).toMatchObject({ status: "idle", runId: null });
    expect(agent.status).toBe("unknown");
    agent.status = "running";
    expect((await load()).snapshot.agents[0].status).toBe("running");
    agent.status = "error";
    expect((await load()).snapshot.agents[0].status).toBe("error");
  });
  it("preserves read errors without falling back to the request fan-out", async () => {
    const call = vi.fn(async () => { throw new Error("temporarily offline"); });
    await expect(loadCompanySnapshot({ client: { call }, gatewayUrl: "ws://office", loadSettings: async () => null })).rejects.toThrow("temporarily offline");
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("still shows native sessions when optional appearance settings are unavailable", async () => {
    const call = vi.fn(async () => ({ mainKey: "main", agents: [{ id: "original", name: "Person", role: "Project", status: "idle", updatedAt: 0 }], projects: [], creationAvailable: true }));
    const result = await loadCompanySnapshot({ client: { call }, gatewayUrl: "ws://office", loadSettings: async () => { throw new Error("HTTP temporarily offline"); } });
    expect(result.hydration.seeds[0]).toMatchObject({ agentId: "original", name: "Person" });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
