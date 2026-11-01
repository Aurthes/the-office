"use strict";

const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const text = value => typeof value === "string" ? value.slice(0, 160) : null;
function window(value) {
  if (!value || number(value.usedPercent) === null) return null;
  return { usedPercent: value.usedPercent, windowDurationMins: number(value.windowDurationMins), resetsAt: number(value.resetsAt) };
}
function limits(value) {
  const buckets = value?.rateLimitsByLimitId && Object.keys(value.rateLimitsByLimitId).length
    ? Object.entries(value.rateLimitsByLimitId) : value?.rateLimits ? [["codex", value.rateLimits]] : null;
  return buckets?.map(([id, bucket]) => ({ id, name: text(bucket.limitName) || text(bucket.limitId) || id,
    plan: text(bucket.planType), windows: [window(bucket.primary), window(bucket.secondary)].filter(Boolean),
    credits: bucket.credits ? { balance: text(bucket.credits.balance), unlimited: bucket.credits.unlimited === true } : null })) ?? null;
}
function usage(value) {
  if (!value?.summary) return null;
  return { lifetimeTokens: number(value.summary.lifetimeTokens), peakDailyTokens: number(value.summary.peakDailyTokens),
    daily: Array.isArray(value.dailyUsageBuckets) ? value.dailyUsageBuckets.flatMap(day =>
      /^\d{4}-\d{2}-\d{2}$/.test(day.startDate) && number(day.tokens) !== null ? [{ date: day.startDate, tokens: day.tokens }] : []).sort((a, b) => a.date.localeCompare(b.date)).slice(-14) : null };
}

async function apiQuota(env, fetchImpl) {
  if (!env.OPENAI_ADMIN_KEY || !env.OPENAI_PROJECT_ID) return { status: "not_configured", models: [] };
  try {
    let after = "", models = [];
    const signal = AbortSignal.timeout(6000);
    // The administrator credential stays on the gateway. Only model quotas leave it.
    for (let page = 0; page < 10; page++) {
      const url = new URL(`https://api.openai.com/v1/organization/projects/${encodeURIComponent(env.OPENAI_PROJECT_ID)}/rate_limits`);
      url.searchParams.set("limit", "100"); if (after) url.searchParams.set("after", after);
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.OPENAI_ADMIN_KEY}` }, signal, redirect: "error" });
      if (!response.ok) throw new Error("Quota unavailable");
      const body = await response.json();
      if (!Array.isArray(body.data)) throw new Error("Quota unavailable");
      models.push(...body.data.map(row => ({ model: text(row.model), rpm: number(row.max_requests_per_1_minute),
        tpm: number(row.max_tokens_per_1_minute), rpd: number(row.max_requests_per_1_day) })).filter(row => row.model));
      if (!body.has_more) return { status: "available", models };
      after = body.last_id;
      if (typeof after !== "string" || !after) break;
    }
  } catch { /* Never send provider error bodies or credentials to the browser. */ }
  return { status: "unavailable", models: [] };
}

async function readOpenAiUsage(native, { env = process.env, fetchImpl = fetch } = {}) {
  const [account, quota, tokens, api] = await Promise.allSettled([
    native.call("account/read", { refreshToken: false }, 8000),
    native.call("account/rateLimits/read", {}, 8000),
    native.call("account/usage/read", {}, 8000),
    apiQuota(env, fetchImpl),
  ]);
  const identity = account.status === "fulfilled" ? account.value.account : null;
  return { id: "openai", name: "OpenAI", accountLabel: identity?.type === "apiKey" ? "API key account" : "ChatGPT / Codex",
    links: { limits: "https://platform.openai.com/settings/organization/limits", usage: "https://platform.openai.com/usage" },
    account: identity ? { type: text(identity.type), plan: text(identity.planType) } : null,
    limits: quota.status === "fulfilled" ? limits(quota.value) : null,
    usage: tokens.status === "fulfilled" ? usage(tokens.value) : null,
    api: api.status === "fulfilled" ? api.value : { status: "unavailable", models: [] } };
}

module.exports = { readOpenAiUsage };
