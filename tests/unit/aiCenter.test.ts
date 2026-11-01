import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { buildShipLayout } from "@/features/ring-ship/layout";
import { aiCorePose } from "@/features/ring-ship/ai-center-geometry";
const require = createRequire(import.meta.url);
const { readAiCenter } = require("../../server/ai-center.js");
const { readOpenAiUsage } = require("../../server/ai-center-openai.js");
const { officeEnvironment } = require("../../server/codex-office-client.js");
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function client(responses: Record<string, unknown>) {
  return { call: vi.fn(async (method: string) => {
    const value = responses[method];
    if (value instanceof Error || value === undefined) throw value || new Error("Not supported");
    return value;
  }) };
}

describe("AI Center account telemetry", () => {
  it("retains real zeroes, unknown fields, and every metered subscription bucket without exposing auth", async () => {
    const native = client({
      "account/read": { account: { type: "chatgpt", planType: "pro", email: "private@example.com", accessToken: "secret" } },
      "account/rateLimits/read": { rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1234 }, secondary: { usedPercent: 32, windowDurationMins: 10080 }, credits: { balance: "0", unlimited: false } },
        extra: { limitName: "Extra models", primary: null },
      } },
      "account/usage/read": { summary: { lifetimeTokens: 0, peakDailyTokens: null }, dailyUsageBuckets: [{ startDate: "2026-11-01", tokens: 0 }] },
    });
    const fetchImpl = vi.fn();
    const result = await readOpenAiUsage(native, { env: {}, fetchImpl });
    expect(result.account).toEqual({ type: "chatgpt", plan: "pro" });
    expect(result.limits).toHaveLength(2);
    expect(result.limits[0]).toMatchObject({ windows: [{ usedPercent: 0, resetsAt: 1234 }, { usedPercent: 32, resetsAt: null }], credits: { balance: "0" } });
    expect(result.limits[1].windows).toEqual([]);
    expect(result.usage).toEqual({ lifetimeTokens: 0, peakDailyTokens: null, daily: [{ date: "2026-11-01", tokens: 0 }] });
    expect(result.api.status).toBe("not_configured"); expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/secret|private@example/);
    expect(native.call.mock.calls.map(([method]: string[]) => method).sort()).toEqual(["account/rateLimits/read", "account/read", "account/usage/read"]);
  });
  it("supports the single-bucket response and keeps unavailable token activity separate", async () => {
    const result = await readOpenAiUsage(client({ "account/rateLimits/read": { rateLimits: { limitId: "codex", primary: { usedPercent: 101.5 } } } }), { env: {} });
    expect(result.limits[0].windows[0].usedPercent).toBe(101.5);
    expect(result.usage).toBeNull(); expect(result.account).toBeNull();
  });
  it("keeps provider failures unknown and does not expose provider error text", async () => {
    const native = client({ "account/usage/read": { summary: { lifetimeTokens: -1, peakDailyTokens: Infinity } } });
    const fetchImpl = vi.fn(async () => { throw new Error("secret admin credential rejected"); });
    const result = await readOpenAiUsage(native, { env: { OPENAI_ADMIN_KEY: "secret", OPENAI_PROJECT_ID: "proj_test" }, fetchImpl });
    expect(result.limits).toBeNull(); expect(result.usage.lifetimeTokens).toBeNull();
    expect(result.usage.peakDailyTokens).toBeNull(); expect(result.usage.daily).toBeNull();
    expect(result.api).toEqual({ status: "unavailable", models: [] });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("reads every API quota page with one shared timeout and returns only model quota fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ model: "model-a", id: "rl-a", max_requests_per_1_minute: 0, max_tokens_per_1_minute: 1000 }], has_more: true, last_id: "rl-a" }))
      .mockResolvedValueOnce(Response.json({ data: [{ model: "model-b", max_requests_per_1_minute: 20, max_tokens_per_1_minute: 2000, max_requests_per_1_day: 100 }], has_more: false }));
    const result = await readOpenAiUsage(client({}), { env: { OPENAI_ADMIN_KEY: "test-admin", OPENAI_PROJECT_ID: "proj_test" }, fetchImpl });
    expect(result.api).toEqual({ status: "available", models: [
      { model: "model-a", rpm: 0, tpm: 1000, rpd: null }, { model: "model-b", rpm: 20, tpm: 2000, rpd: 100 },
    ] });
    expect(String(fetchImpl.mock.calls[1][0])).toContain("after=rl-a");
    expect(fetchImpl.mock.calls[0][1].signal).toBe(fetchImpl.mock.calls[1][1].signal);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer test-admin");
    expect(JSON.stringify(result)).not.toContain("test-admin");
  });
  it("does not report a partial quota list as complete", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ model: "model-a" }], has_more: true, last_id: "a" }))
      .mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const result = await readOpenAiUsage(client({}), { env: { OPENAI_ADMIN_KEY: "test", OPENAI_PROJECT_ID: "proj_test" }, fetchImpl });
    expect(result.api).toEqual({ status: "unavailable", models: [] });
  });
  it("keeps the administrator credential out of the Codex execution environment", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ai-center-env-"));
    try {
      const value = officeEnvironment(root, { OPENAI_ADMIN_KEY: "admin", OPENAI_PROJECT_ID: "project", PATH: "/bin" });
      expect(value.env.OPENAI_ADMIN_KEY).toBeUndefined(); expect(value.env.PATH).toBe("/bin");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

it("reuses the main-deck server bay and keeps the core footprint outside the walking lane", () => {
  const roster = { projects: [{ id: "p", name: "P" }], members: [{ id: "a", projectId: "p" }] };
  const before = buildShipLayout(roster), layout = buildShipLayout(roster, before.allocation);
  const ai = layout.cabins.filter(c => c.kind === "ai"); expect(ai).toHaveLength(1);
  expect(ai[0]).toMatchObject({ id: "public:servers", deck: 0, ring: 0, slot: 4 });
  expect(layout.cabins.filter(c => c.kind === "servers")).toHaveLength(2);
  expect(layout.allocation.projects).toEqual(before.allocation.projects);
  const radius = Math.hypot(aiCorePose(layout, ai[0]).point.x, aiCorePose(layout, ai[0]).point.z);
  expect(radius - .93).toBeGreaterThan(layout.rings[0].radius + .65);
  expect(radius + .93).toBeLessThan(layout.rings[0].radius + layout.rings[0].depth / 2);
});

it("publishes a provider-neutral snapshot with only the implemented OpenAI provider", async () => {
  const result = await readAiCenter(client({}), { env: {} });
  expect(result.providers).toHaveLength(1);
  expect(result.providers[0]).toMatchObject({ id: "openai", name: "OpenAI", accountLabel: "ChatGPT / Codex", limits: null, usage: null });
  expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
});
