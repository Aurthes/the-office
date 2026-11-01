import { deriveHydrateAgentFleetResult } from "@/features/agents/operations/agentFleetHydrationDerivation";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import type { StudioSettings, StudioSettingsPublic } from "@/lib/studio/settings";

export type CompanySnapshot = {
  defaultId?: string; mainKey: string; projects: CompanyRoster["projects"]; creationAvailable: boolean;
  agents: Array<CompanyRoster["members"][number] & {
    avatarSeed?: string; name: string; role: string; status: string; model?: string | null; modelProvider?: string | null; effort?: string | null;
    completedResult?: { key: string; unread: boolean } | null; needsInput?: boolean;
    updatedAt: number; identity?: { name?: string; emoji?: string };
  }>;
};

// Native session rows already contain the metadata needed by the office. Reuse
// avatar/seed derivation without one sessions.list RPC for every person.
export async function loadCompanySnapshot({ client, gatewayUrl, loadSettings }: {
  client: { call: (method: string, params: unknown) => Promise<unknown> };
  gatewayUrl: string; loadSettings: () => Promise<StudioSettings | StudioSettingsPublic | null>;
}) {
  const [snapshot, settings] = await Promise.all([
    client.call("office.snapshot", {}).then(value => value as CompanySnapshot),
    loadSettings().catch(() => null), // Optional appearance settings must not block the live roster.
  ]);
  const mainKey = snapshot.mainKey || "main";
  const hydration = deriveHydrateAgentFleetResult({
    gatewayUrl, settings,
    configSnapshot: { config: {
      agents: { list: snapshot.agents.map(agent => ({ id: agent.id, model: agent.model ?? undefined })) },
    } },
    execApprovalsSnapshot: null,
    agentsResult: { ...snapshot, defaultId: snapshot.defaultId || "", mainKey },
    mainSessionByAgentId: new Map(snapshot.agents.map(agent => [agent.id, {
      key: `agent:${agent.id}:${mainKey}`, displayName: agent.name, updatedAt: agent.updatedAt,
      model: agent.model ?? undefined, modelProvider: agent.modelProvider ?? undefined, thinkingLevel: agent.effort ?? undefined,
      execHost: "gateway", execSecurity: "deny", execAsk: "always",
    }])),
    statusSummary: null, previewResult: null,
  });
  return { snapshot, hydration };
}
