export type QuotaWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null };
export type ResetCredit = { id: string; title: string | null; resetType: "codexRateLimits" | "unknown"; expiresAt?: number | null };
export type ResetCredits = { availableCount: number; credits: ResetCredit[] | null };
export type ResetCreditResult = { outcome: "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit" };
export type AiProviderSnapshot = {
  id: string;
  name: string;
  accountLabel: string;
  links: { limits?: string; usage?: string };
  account: { type: string | null; plan: string | null } | null;
  resetCredits?: ResetCredits | null;
  limits: Array<{ id: string; name: string; plan: string | null; windows: QuotaWindow[];
    credits: { balance: string | null; unlimited: boolean } | null }> | null;
  usage: { lifetimeTokens: number | null; peakDailyTokens: number | null; daily: Array<{ date: string; tokens: number }> | null } | null;
  api: { status: "not_configured" | "available" | "unavailable"; models: Array<{ model: string; rpm: number | null; tpm: number | null; rpd: number | null }> };
};
export type AiCenterSnapshot = { fetchedAt: string; providers: AiProviderSnapshot[] };
export type ResponseUsage = { input: number; cachedInput: number; uncachedInput: number; cacheWriteInput: number; output: number; reasoningOutput: number; otherOutput: number; total: number };
export type ObservedResponse = {
  id: string; nativeThreadId: string; officeAgentId: string; agentName: string; responseId: string; turnId: string; rootTurnId: string | null;
  observedAt: string; usage: ResponseUsage; configuredModel: string | null; configuredEffort: string | null; modelBasis: "turnContext" | "unknown";
  actualModel: null; status: "unknown"; taskId: string | null; phaseId: string | null; questionIds: string[]; attributionBasis: "turnDispatch" | "unknown";
  conflict: boolean; sameTurnResponses: number;
  previousObservedInput: { responseId: string; input: number; change: number; basis: string } | null;
};
export type UsageDetail = {
  date: string; timeZone: string; rows: ObservedResponse[]; count: number; totals: ResponseUsage | null; nextCursor: string | null;
  outsideRetention: boolean; scope: string;
  coverage: { source: string; supportedVersion: string; apiStability: string; partial: boolean; indexing: boolean; unavailable: boolean; storageLimit: boolean;
    knownSources: number; scannedSources: number; readySources: number; unsupportedSources: number; partialLines: number;
    retainedFrom: string; retainedFromUtc: string; firstObservedAt: string | null; indexedThrough: string | null; knownGaps: Record<string, number> };
  filters: { agents: { id: string; name: string }[]; configuredModels: string[]; taskIds: string[] };
};

export function expiringResetCredits(snapshot: AiCenterSnapshot | null, now: number): ResetCredit[] {
  const inventory = snapshot?.providers.find(provider => provider.id === "openai")?.resetCredits;
  if (!inventory?.availableCount) return [];
  return (inventory.credits ?? []).filter(coupon => typeof coupon.expiresAt === "number"
    && coupon.expiresAt * 1000 > now && coupon.expiresAt * 1000 <= now + 3 * 86400_000)
    .sort((a, b) => a.expiresAt! - b.expiresAt!);
}
