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
export type UsagePurpose = "chat_work" | "suggestion" | "automation" | "operational_task" | "collaboration_mixed" | "mixed" | "unknown";
export type ResponseUsage = { input: number | null; cachedInput: number | null; uncachedInput: number | null; cacheWriteInput: number | null; output: number | null; reasoningOutput: number | null; otherOutput: number | null; total: number | null };
export type UsageComponents = Record<keyof ResponseUsage, { knownSubtotal: number | null; reportedRows: number; unknownRows: number }>;
export type PurposeBucket = { id: UsagePurpose; knownTokens: number | null; share: number | null; observedResponses: number; measuredResponses: number; meanTokens: number | null; unknownUsageResults: number; components: UsageComponents };
export type PurposeSummary = { basis: string; denominatorTokens: number | null; observedResponses: number; measuredResponses: number; unknownPurposeResponses: number; unknownUsageResults: number; purposesRecordedFrom: string | null; components: UsageComponents; purposes: PurposeBucket[];
  unmeasured: { id: string; status: string; tokens: null; share: null; measuredResponses: null }[] };
export type UsageTaskLabel = { id: string; code: string | null; title: string | null };
export type ObservedResponse = {
  id: string; nativeThreadId: string | null; officeAgentId: string; agentName: string; responseId: string; turnId: string | null; rootTurnId: string | null;
  observedAt: string; usage: ResponseUsage; configuredModel: string | null; configuredEffort: string | null; modelBasis: "turnContext" | "unknown";
  actualModel: null; status: "unknown"; taskId: string | null; task: UsageTaskLabel | null; phaseId: string | null; questionIds: string[]; attributionBasis: "turnDispatch" | "unknown";
  sourceKind: "nativeRollout" | "threadSample"; sourceKinds: string[]; contextNativeThreadId: string | null; sourceTurnId: string | null; totalBasis: string;
  purpose: UsagePurpose; purposeBasis: string; trigger: string; conflict: boolean; sameTurnResponses: number | null;
  previousObservedInput: { responseId: string; input: number; change: number; basis: string } | null;
};
export type UsageDetail = {
  date: string; timeZone: string; rows: ObservedResponse[]; count: number; totals: ResponseUsage | null; nextCursor: string | null;
  snapshot: string; purposeSummary: PurposeSummary; selectedPurpose: UsagePurpose | null;
  outsideRetention: boolean; scope: string;
  coverage: { source: string; supportedVersion: string; apiStability: string; partial: boolean; indexing: boolean; unavailable: boolean; storageLimit: boolean;
    knownSources: number; scannedSources: number; readySources: number; unsupportedSources: number; partialLines: number;
    retainedFrom: string; retainedFromUtc: string; retainedFromPartial: boolean; capacityLimited: boolean; firstObservedAt: string | null; indexedThrough: string | null; knownGaps: Record<string, number> };
  filters: { agents: { id: string; name: string }[]; configuredModels: string[]; taskIds: string[]; tasks: UsageTaskLabel[] };
};

export function expiringResetCredits(snapshot: AiCenterSnapshot | null, now: number): ResetCredit[] {
  const inventory = snapshot?.providers.find(provider => provider.id === "openai")?.resetCredits;
  if (!inventory?.availableCount) return [];
  return (inventory.credits ?? []).filter(coupon => typeof coupon.expiresAt === "number"
    && coupon.expiresAt * 1000 > now && coupon.expiresAt * 1000 <= now + 3 * 86400_000)
    .sort((a, b) => a.expiresAt! - b.expiresAt!);
}
