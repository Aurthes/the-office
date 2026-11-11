export const USAGE_TIME_ZONE = "UTC";
export const currentUsageDate = () => new Date().toISOString().slice(0, 10);

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
export type UsagePurpose = "chat_work" | "suggestion" | "dictation" | "automation" | "operational_task" | "collaboration_mixed" | "mixed" | "unknown";
export type ResponseUsage = { input: number | null; cachedInput: number | null; uncachedInput: number | null; cacheWriteInput: number | null; output: number | null; reasoningOutput: number | null; otherOutput: number | null; total: number | null };
export type UsageComponents = Record<keyof ResponseUsage, { knownSubtotal: number | null; reportedRows: number; unknownRows: number }>;
export type PurposeBucket = { id: UsagePurpose; knownTokens: number | null; share: number | null; observedResponses: number; measuredResponses: number; meanTokens: number | null; unknownUsageResults: number; components: UsageComponents };
export type PurposeSummary = { basis: string; denominatorTokens: number | null; observedResponses: number; measuredResponses: number; unknownPurposeResponses: number; unknownUsageResults: number; purposesRecordedFrom: string | null; components: UsageComponents; purposes: PurposeBucket[];
  unmeasured: { id: string; status: string; tokens: null; share: null; measuredResponses: null }[] };
export type UsageTaskLabel = { id: string; code: string | null; title: string | null };
export type ResponseCost = { status: "point" | "range" | "unpriced"; minUsd: number | null; maxUsd: number | null; pricingVersion: string; priceModelId: string | null; configuredModelBasis: string; longContext: boolean | null; reasons: string[]; components: { cacheReadUsd: number; outputUsd: number; remainingInputMinUsd: number; remainingInputMaxUsd: number } | null };
export type CostSummary = { pointResponses: number; rangeResponses: number; unpricedResponses: number; estimatedKnownTokens: number | null; unpricedKnownTokens: number | null; unknownUsageResults: number; minUsd: number | null; maxUsd: number | null };
export type UsageContributor = { id: string; name: string; knownTokens: number | null; observedResponses: number; measuredResponses: number; unknownUsageResults: number; cost: CostSummary };
export type TokenBreakdown = { basis: "measuredResponseSnapshot"; denominatorTokens: number | null; measuredComponents: UsageComponents;
  contributors: Record<"agents" | "tasks" | "sources", UsageContributor[]>; cost: CostSummary;
  activity: { status: "notRecorded"; reason: "noReliableResponseActionJoin" };
  pricing: { version: string; checkedAt: string; currency: string; basis: string; sources: string[]; models: { id: string; input: number; cachedInput: number; write30m: number; write12h: number; output: number; longContextThreshold: number; longInputMultiplier: number; longOutputMultiplier: number }[] } };
export const apiCostLabel = (cost: Pick<ResponseCost, "minUsd" | "maxUsd"> | CostSummary | undefined) => {
  if (cost?.minUsd == null || cost.maxUsd == null) return "—";
  const usd = (value: number) => value === 0 ? "$0" : value < 0.000001 ? `$${value.toExponential(2)}` : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
  return cost.minUsd === cost.maxUsd ? usd(cost.minUsd) : `${usd(cost.minUsd)} – ${usd(cost.maxUsd)}`;
};
export function topContributors(groups: UsageContributor[], order: "tokens" | "cost", all: boolean) {
  const sorted = [...groups].sort((a, b) => ((order === "cost" ? b.cost.minUsd : b.knownTokens) ?? -1) - ((order === "cost" ? a.cost.minUsd : a.knownTokens) ?? -1) || a.id.localeCompare(b.id));
  if (all || sorted.length <= 5) return sorted;
  const rest = sorted.slice(5), cost: CostSummary = { pointResponses: 0, rangeResponses: 0, unpricedResponses: 0, estimatedKnownTokens: 0, unpricedKnownTokens: 0, unknownUsageResults: 0, minUsd: null, maxUsd: null };
  for (const row of rest) {
    for (const key of ["pointResponses", "rangeResponses", "unpricedResponses", "unknownUsageResults"] as const) cost[key] += row.cost[key];
    for (const key of ["estimatedKnownTokens", "unpricedKnownTokens"] as const) { const sum = cost[key] == null || row.cost[key] == null ? null : cost[key]! + row.cost[key]!; cost[key] = sum !== null && Number.isSafeInteger(sum) ? sum : null; }
    if (row.cost.minUsd != null) { cost.minUsd = (cost.minUsd ?? 0) + row.cost.minUsd; cost.maxUsd = (cost.maxUsd ?? 0) + row.cost.maxUsd!; }
  }
  const sum = rest.reduce((sum, row) => sum + (row.knownTokens ?? 0), 0), measured = rest.reduce((sum, row) => sum + row.measuredResponses, 0);
  return [...sorted.slice(0, 5), { id: "other", name: "Other", cost, knownTokens: !measured || !Number.isSafeInteger(sum) || rest.some(row => row.measuredResponses && row.knownTokens == null) ? null : sum, observedResponses: rest.reduce((sum, row) => sum + row.observedResponses, 0), measuredResponses: measured, unknownUsageResults: rest.reduce((sum, row) => sum + row.unknownUsageResults, 0) }];
}
export type ObservedResponse = {
  id: string; cost?: ResponseCost; nativeThreadId: string | null; officeAgentId: string | null; agentName: string; responseId: string | null; turnId: string | null; rootTurnId: string | null;
  observedAt: string; usage: ResponseUsage; configuredModel: string | null; configuredEffort: string | null; modelBasis: "turnContext" | "requestConfiguration" | "unknown";
  actualModel: null; status: "unknown" | "completed" | "failed" | "interrupted";
  unit?: "tokens" | "seconds" | "unknown"; durationSeconds?: number | null; usageReason?: string | null; providerKind?: string | null; providerRequestId?: string | null; attemptId?: string | null; ownershipBasis?: string; taskId: string | null; task: UsageTaskLabel | null; phaseId: string | null; questionIds: string[]; attributionBasis: "turnDispatch" | "unknown";
  sourceKind: "nativeRollout" | "threadSample" | "dictation"; sourceKinds: string[]; contextNativeThreadId: string | null; sourceTurnId: string | null; totalBasis: string;
  purpose: UsagePurpose; purposeBasis: string; trigger: string; conflict: boolean; sameTurnResponses: number | null;
  previousObservedInput: { responseId: string; input: number; change: number; basis: string } | null;
};
export type UsageWindow = { kind: "rolling24h"; start: string; end: string; timeZone: "UTC" };
export type MessageChain = { nativeThreadId: string; turnId: string; recipientId: string | null; entries: { itemId?: string | null; requestId: string; senderId: string | null; recipientId: string | null; mode: "start" | "steer"; trigger: string; acceptedAt: number }[]; truncatedEntries: number; activities: { itemId: string; type: string }[]; activityTruncated: boolean; observedResponses: number; components: UsageComponents; activityBasis: string };
export type UsageDetail = {
  messageChains?: { scope: string; incrementalMessageTokens: null; historicalLedger: string; turns: MessageChain[] };
  window?: UsageWindow | null; serverNow?: string; windowPartial?: boolean;
  date: string | null; timeZone: string; rows: ObservedResponse[]; count: number; totals: ResponseUsage | null; nextCursor: string | null;
  snapshot: string; purposeSummary: PurposeSummary; selectedPurpose: UsagePurpose | null; breakdown?: TokenBreakdown;
  outsideRetention: boolean; scope: string;
  coverage: { source: string; supportedVersion: string; apiStability: string; partial: boolean; indexing: boolean; unavailable: boolean; storageLimit: boolean;
    adaptersEnabledAt?: string; producerDurability?: string; knownSources: number; scannedSources: number; readySources: number; unsupportedSources: number; partialLines: number;
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
