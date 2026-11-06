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

export function expiringResetCredits(snapshot: AiCenterSnapshot | null, now: number): ResetCredit[] {
  const inventory = snapshot?.providers.find(provider => provider.id === "openai")?.resetCredits;
  if (!inventory?.availableCount) return [];
  return (inventory.credits ?? []).filter(coupon => typeof coupon.expiresAt === "number"
    && coupon.expiresAt * 1000 > now && coupon.expiresAt * 1000 <= now + 3 * 86400_000)
    .sort((a, b) => a.expiresAt! - b.expiresAt!);
}
