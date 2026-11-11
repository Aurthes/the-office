import { createRequire } from "node:module";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiCenterDashboard } from "@/features/ring-ship/AiCenterDashboard";
import { AiUsageDetail } from "@/features/ring-ship/AiUsageDetail";
import { AiPurposePreview } from "@/features/ring-ship/AiPurposeSummary";
import { AiTokenBreakdown } from "@/features/ring-ship/AiTokenBreakdown";
import { apiCostLabel, topContributors } from "@/features/ring-ship/ai-center";
import type { AiCenterSnapshot, UsageDetail } from "@/features/ring-ship/ai-center";
import { UI_LANGUAGE_KEY } from "@/lib/i18n/ui-language";
const { components, purposeSummary } = createRequire(import.meta.url)("../../server/office-usage-purpose.js");
const { PRICING, estimateResponseCost, emptyCostSummary, addCost } = createRequire(import.meta.url)("../../server/office-token-pricing.js");
const date = "2026-11-08", timeZone = "UTC";
const detail = (patch: Partial<UsageDetail> = {}): UsageDetail => { const value = { date, timeZone, rows: [{ id: "origin:response", nativeThreadId: "origin", officeAgentId: "agent", agentName: "Big consumer", responseId: "response", turnId: "turn", rootTurnId: null, observedAt: "2026-11-08T01:00:00Z",
  usage: { input: 100, cachedInput: 60, uncachedInput: 40, cacheWriteInput: 0, output: 20, reasoningOutput: 5, otherOutput: 15, total: 120 },
  sourceKind: "nativeRollout", sourceKinds: ["nativeRollout"], contextNativeThreadId: null, sourceTurnId: null, totalBasis: "reported", purpose: "chat_work", purposeBasis: "businessEntry", trigger: "userMessage",
  configuredModel: "model-a", configuredEffort: "high", modelBasis: "turnContext", actualModel: null, status: "unknown", taskId: null, task: null, phaseId: null, questionIds: [], attributionBasis: "unknown", conflict: false, sameTurnResponses: 3,
  previousObservedInput: { responseId: "previous-response", input: 80, change: 20, basis: "adjacentObservedSameTurnConfiguredModel" } }], count: 1,
  window: { kind: "rolling24h", start: "2026-11-07T12:00:00.000Z", end: "2026-11-08T12:00:00.000Z", timeZone: "UTC" }, serverNow: "2026-11-08T12:00:00.000Z", snapshot: "stable-snapshot", selectedPurpose: null, totals: { input: 100, cachedInput: 60, uncachedInput: 40, cacheWriteInput: 0, output: 20, reasoningOutput: 5, otherOutput: 15, total: 120 }, nextCursor: null, outsideRetention: false, scope: "Office observed subset",
  coverage: { source: "office-rollout-compatibility", supportedVersion: "0.166.0", apiStability: "internal-format", partial: true, indexing: false, unavailable: false, storageLimit: false, knownSources: 2, scannedSources: 2, readySources: 1, unsupportedSources: 1, partialLines: 0, retainedFrom: "2026-10-26", retainedFromUtc: "2026-10-24", retainedFromPartial: false, capacityLimited: false, firstObservedAt: "2026-11-08T01:00:00Z", indexedThrough: "2026-11-08T01:00:00Z", knownGaps: { unsupportedVersion: 1 } },
  filters: { agents: [{ id: "agent", name: "Big consumer" }], configuredModels: ["model-a"], taskIds: ["task-1"], tasks: [{ id: "task-1", code: "T98", title: "Token profiling" }] }, ...patch } as UsageDetail; value.purposeSummary = patch.purposeSummary || purposeSummary(value.rows, "2026-11-08T00:00:00Z");
  if (!Object.hasOwn(patch, "breakdown")) {
    const cost = emptyCostSummary(); for (const row of value.rows) { row.cost = estimateResponseCost(row); addCost(cost, row, row.cost); }
    const summary = value.purposeSummary;
    value.breakdown = { basis: "measuredResponseSnapshot", denominatorTokens: summary.denominatorTokens, measuredComponents: components(value.rows.filter(row => row.usage.total !== null)), cost, pricing: PRICING, activity: { status: "notRecorded", reason: "noReliableResponseActionJoin" }, contributors: {
      agents: [{ id: "agent", name: "Big consumer", knownTokens: summary.denominatorTokens, measuredResponses: summary.measuredResponses, observedResponses: summary.observedResponses, unknownUsageResults: summary.unknownUsageResults, cost }],
      tasks: [{ id: "unattributed", name: "Unattributed", knownTokens: summary.denominatorTokens, measuredResponses: summary.measuredResponses, observedResponses: summary.observedResponses, unknownUsageResults: summary.unknownUsageResults, cost }],
      sources: summary.purposes.filter(bucket => bucket.observedResponses).map(bucket => ({ ...bucket, name: bucket.id, cost })),
    } };
  }
  return value; };
const account: AiCenterSnapshot = { fetchedAt: "2026-11-08T01:00:00Z", providers: [{ id: "openai", name: "OpenAI", accountLabel: "Codex", links: {}, account: null, limits: null,
  usage: { lifetimeTokens: null, peakDailyTokens: null, daily: [{ date, tokens: 0 }] }, api: { status: "not_configured", models: [] } }] };
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function openRecords() {
  fireEvent.click(await screen.findByRole("button", { name: "Chat and user work" }));
  fireEvent.click(await screen.findByRole("button", { name: "View response records" }));
  await screen.findByText("Big consumer", { selector: "b" });
}
it("opens the selected day in the same dialog, keeps account zero distinct, expands four parts, and returns focus", async () => {
  const call = vi.fn().mockImplementation((method: string) => Promise.resolve(method === "office.usage" ? account : detail()));
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  const bar = await screen.findByRole("button", { name: `${date}: 0 tokens` });
  expect(bar.tagName).toBe("BUTTON"); expect(within(bar).getByRole("tooltip")).toHaveTextContent(date);
  fireEvent.click(bar);
  await screen.findByRole("heading", { name: "Usage by purpose", level: 1 });
  expect(call).toHaveBeenCalledWith("office.usage.detail", expect.objectContaining({ date, timeZone, sort: "total", includeRecords: false, refresh: true }));
  const region = screen.getByRole("region", { name: "Daily response detail" });
  expect(within(region).queryByText("Big consumer", { selector: "b" })).not.toBeInTheDocument();
  await openRecords();
  expect(await within(region).findByText("Big consumer", { selector: "b" })).toBeInTheDocument();
  expect(within(region).getByText("Account date total: " + date).parentElement).toHaveTextContent("0");
  const row = within(region).getByText("Big consumer", { selector: "b" }).closest("details")!; fireEvent.click(row.querySelector("summary")!);
  expect(within(row).getByText("Cached input").nextElementSibling).toHaveTextContent("60");
  expect(within(row).getByText("Uncached input").nextElementSibling).toHaveTextContent("40");
  expect(within(row).getByText("Reasoning output").nextElementSibling).toHaveTextContent("5");
  expect(within(row).getByText("Other output").nextElementSibling).toHaveTextContent("15");
  expect(within(row).getByText("Unknown / unknown — not reported by this source")).toBeInTheDocument();
  expect(within(row).getByText(/No historical task binding/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to daily usage" }));
  await waitFor(() => expect(bar).toHaveFocus()); expect(screen.getByRole("button", { name: `${date}: 0 tokens` })).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
it("preserves the chart when detail fails, and exposes retry and back", async () => {
  let failed = true;
  const call = vi.fn().mockImplementation((method: string) => method === "office.usage" ? Promise.resolve(account) : failed ? Promise.reject(new Error("private path")) : Promise.resolve(detail()));
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  fireEvent.click(await screen.findByRole("button", { name: `${date}: 0 tokens` }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Response detail is unavailable"); expect(screen.queryByText("private path")).not.toBeInTheDocument();
  failed = false; fireEvent.click(screen.getByRole("button", { name: "Refresh response detail" }));
  await openRecords();
  fireEvent.click(screen.getByRole("button", { name: "Back to daily usage" }));
  expect(screen.getByRole("button", { name: `${date}: 0 tokens` })).toBeVisible();
});
it("filters configured model/agent/unattributed task, paginates with the cursor and resets on sorting", async () => {
  const call = vi.fn().mockResolvedValue(detail({ nextCursor: "stable-cursor" }));
  render(createElement(AiUsageDetail, { date, accountTokens: null, client: { call }, onBack: vi.fn(), onDateChange: vi.fn() }));
  await openRecords();
  for (const [name, value] of [["Office agent", "agent"], ["Configured model", "model-a"], ["Task", "unattributed"]]) {
    fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Next page" })).not.toBeDisabled());
  }
  expect(call.mock.lastCall?.[1]).toMatchObject({ date, timeZone, sort: "total", agentId: "agent", configuredModel: "model-a", taskId: "unattributed", purpose: "chat_work", includeRecords: true, refresh: false });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(call.mock.lastCall?.[1]).toMatchObject({ cursor: "stable-cursor" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Previous page" })).not.toBeDisabled());
  fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "uncachedInput" } });
  await waitFor(() => expect(call.mock.lastCall?.[1]).toMatchObject({ sort: "uncachedInput" }));
  expect(call.mock.lastCall?.[1]).not.toHaveProperty("cursor"); expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
});
it("shows empty coverage as unknown, not zero, and translates detail controls", async () => {
  localStorage.setItem(UI_LANGUAGE_KEY, "zh-CN");
  const call = vi.fn().mockResolvedValue(detail({ rows: [], totals: null, count: 0 }));
  render(createElement(AiUsageDetail, { date, accountTokens: null, client: { call }, onBack: vi.fn(), onDateChange: vi.fn() }));
  expect(await screen.findByText("当前筛选下没有可回补的响应记录，不代表没有消耗。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回每日用量" })).toBeInTheDocument();
  expect(screen.getByText("Office 已观测小计").parentElement).toHaveTextContent("—");
});
it("polls only the derived index during backfill and stops after unmount", async () => {
  vi.useFakeTimers(); const value = detail(); value.coverage.indexing = true;
  const call = vi.fn().mockResolvedValue(value);
  const view = render(createElement(AiUsageDetail, { date, accountTokens: null, client: { call }, onBack: vi.fn(), onDateChange: vi.fn() }));
  await act(async () => {}); expect(call.mock.calls[0][1].refresh).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(call).toHaveBeenCalledTimes(2); expect(call.mock.calls[1][1].refresh).toBe(false);
  view.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(call).toHaveBeenCalledTimes(2);
});
it("ignores a late response for a previously selected date", async () => {
  let release: (value: UsageDetail) => void = () => {};
  const call = vi.fn().mockImplementationOnce(() => new Promise<UsageDetail>(resolve => { release = resolve; })).mockResolvedValue(detail({ date: "2026-11-07", rows: [], count: 0, totals: null }));
  const props = { accountTokens: null, client: { call }, onBack: vi.fn(), onDateChange: vi.fn() };
  const view = render(createElement(AiUsageDetail, { ...props, date }));
  view.rerender(createElement(AiUsageDetail, { ...props, date: "2026-11-07" }));
  await screen.findByText(/No recoverable response records/);
  await act(async () => { release(detail()); });
  expect(screen.queryByText("Big consumer", { selector: "b" })).not.toBeInTheDocument();
  expect(screen.getByText("Account date total: 2026-11-07")).toBeInTheDocument();
});
it("displays a bound task's code/title while submitting its immutable ID as the filter", async () => {
  const value = detail(); value.rows[0] = { ...value.rows[0], taskId: "task-1", task: { id: "task-1", code: "T98", title: "Token profiling" }, attributionBasis: "turnDispatch" };
  const call = vi.fn().mockResolvedValue(value);
  render(createElement(AiUsageDetail, { date, accountTokens: null, client: { call }, onBack: vi.fn(), onDateChange: vi.fn() }));
  const option = await screen.findByRole("option", { name: "T98 · Token profiling" }); expect(option).toHaveValue("task-1");
  await openRecords();
  const row = screen.getByText("Big consumer", { selector: "b" }).closest("details")!; fireEvent.click(row.querySelector("summary")!);
  expect(within(row).getByText("T98 · Token profiling")).toBeInTheDocument(); expect(within(row).getByText("task-1")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Task" }), { target: { value: "task-1" } });
  await waitFor(() => expect(call.mock.lastCall?.[1]).toMatchObject({ taskId: "task-1" }));
});
it("shows the raised retention boundary and a partial first local day without claiming nominal 14-day retention", async () => {
  const value = detail({ date: "2026-11-01", rows: [], count: 0, totals: null, outsideRetention: true });
  value.coverage = { ...value.coverage, retainedFrom: "2026-11-02", retainedFromUtc: "2026-11-02", retainedFromPartial: true, capacityLimited: true };
  render(createElement(AiUsageDetail, { date: value.date!, accountTokens: null, client: { call: vi.fn().mockResolvedValue(value) }, onBack: vi.fn(), onDateChange: vi.fn() }));
  expect(await screen.findByText("This date is outside the currently retained detail range (age or capacity limit).")).toBeInTheDocument();
  expect(screen.getByText(/UTC dates retained from 2026-11-02/)).toBeInTheDocument();
  expect(screen.getByText(/The first retained UTC day \(2026-11-02\) is partial/)).toBeInTheDocument();
  expect(screen.queryByText(/outside the 14 local-day/)).not.toBeInTheDocument();
  expect(screen.queryByText(/No recoverable response records/)).not.toBeInTheDocument();
});
it("starts with a purpose overview, then composition, then optional nullable sample records using the same S", async () => {
  const native = detail().rows[0];
  const sample = { ...native, id: "sample:s", responseId: "sample-response", agentName: "Sampler consumer", nativeThreadId: null, turnId: null, contextNativeThreadId: "origin", sourceTurnId: "source-parent-turn", sourceKind: "threadSample" as const, sourceKinds: ["threadSample"], purpose: "suggestion" as const, totalBasis: "derivedInputOutput", sameTurnResponses: null,
    usage: { input: 100, cachedInput: 60, uncachedInput: 40, output: 10, total: 110, reasoningOutput: null, cacheWriteInput: null, otherOutput: null }, previousObservedInput: null };
  const value = detail({ rows: [native, sample], count: 2 });
  const call = vi.fn().mockImplementation((method: string, p: { date: string; purpose?: string; includeRecords?: boolean }) => {
    if (method === "office.usage") return Promise.resolve(account);
    const rows = value.rows.filter(row => !p.purpose || row.purpose === p.purpose);
    return Promise.resolve({ ...value, date: p.date, rows: p.includeRecords ? rows : [], count: rows.length, selectedPurpose: p.purpose || null });
  });
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  const preview = await screen.findByRole("region", { name: "Office rolling 24-hour usage" });
  fireEvent.click(await within(preview).findByRole("button", { name: "View token breakdown" }));
  fireEvent.click(await screen.findByRole("button", { name: "Trigger source" }));
  fireEvent.click(await screen.findByRole("button", { name: "Gray suggestions" }));
  const composition = await screen.findByRole("region", { name: "Purpose composition" });
  expect(composition).toHaveTextContent("The share denominator stays S = 230 across all purposes.");
  expect(screen.queryByText("Sampler consumer", { selector: "b" })).not.toBeInTheDocument();
  expect(call.mock.lastCall?.[1]).toMatchObject({ snapshot: "stable-snapshot", purpose: "suggestion", includeRecords: false });
  fireEvent.click(screen.getByRole("button", { name: "View response records" }));
  const row = (await screen.findByText("Sampler consumer", { selector: "b" })).closest("details")!;
  fireEvent.click(row.querySelector("summary")!);
  expect(within(row).getByText("Reasoning output").nextElementSibling).toHaveTextContent("—");
  expect(within(row).getByText("Actual sample thread/turn is not reported")).toBeInTheDocument();
  expect(within(row).getByText(/source-parent-turn/)).toHaveTextContent("Context reference, not the sample's actual turn");
  expect(row.querySelectorAll(".ai-response-parts i")).toHaveLength(2);
  expect(call.mock.lastCall?.[1]).toMatchObject({ snapshot: "stable-snapshot", purpose: "suggestion", includeRecords: true });
  fireEvent.click(screen.getByRole("button", { name: "Back to composition" }));
  expect(screen.queryByText("Sampler consumer", { selector: "b" })).not.toBeInTheDocument();
});
it("keeps overview links fresh with minute-level derived-only reads and stops while closed", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
  const call = vi.fn().mockResolvedValue(detail());
  const view = render(createElement(AiPurposePreview, { client: { call }, refresh: 0, onSelect: vi.fn() }));
  await act(async () => {}); expect(call).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(call).toHaveBeenCalledTimes(2); expect(call.mock.lastCall?.[1]).toMatchObject({ includeRecords: false, refresh: false });
  view.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(120000); }); expect(call).toHaveBeenCalledTimes(2);
});
it("freezes the chosen purpose snapshot during backfill until the user refreshes", async () => {
  vi.useFakeTimers(); const value = detail(); value.coverage.indexing = true;
  const call = vi.fn().mockResolvedValue(value);
  render(createElement(AiUsageDetail, { date, accountTokens: null, client: { call }, onBack: vi.fn(), onDateChange: vi.fn() }));
  await act(async () => {}); fireEvent.click(screen.getByRole("button", { name: "Chat and user work" })); await act(async () => {});
  const count = call.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(call.mock.calls.length).toBe(count);
  fireEvent.click(screen.getByRole("button", { name: "Refresh response detail" })); await act(async () => {});
  expect(call.mock.lastCall?.[1]).toMatchObject({ purpose: "chat_work", refresh: true }); expect(call.mock.lastCall?.[1]).not.toHaveProperty("snapshot");
});

it("keeps an anchored rolling snapshot through filters and resets every pane at the server hour, ignoring a late old page", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2099-01-01T01:59:30Z"));
  let serverNow = "2026-11-08T12:59:30.000Z", resolveOld: (v: UsageDetail) => void = () => {};
  const call = vi.fn().mockImplementation((method: string, p: { window?: string; end?: string; date?: string; cursor?: string }) => {
    if (method === "office.usage") return Promise.resolve(account);
    if (p.cursor) return new Promise<UsageDetail>(resolve => { resolveOld = resolve; });
    const end = p.end || new Date(Math.floor(Date.parse(serverNow) / 3600000) * 3600000).toISOString();
    return Promise.resolve(detail({ date: p.window ? null : p.date!, serverNow, window: { kind: "rolling24h", start: new Date(Date.parse(end) - 86400000).toISOString(), end, timeZone: "UTC" }, nextCursor: "old-page" }));
  });
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() })); await act(async () => {});
  fireEvent.click(within(screen.getByRole("region", { name: "Office rolling 24-hour usage" })).getByRole("button", { name: "View token breakdown" })); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "View response records" })); await act(async () => {});
  expect(call.mock.lastCall?.[1]).toMatchObject({ window: "rolling24h", end: "2026-11-08T12:00:00.000Z", snapshot: "stable-snapshot", includeRecords: true });
  expect(screen.queryByText("Account date total: " + date)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" })); await act(async () => {});
  const before = call.mock.calls.length; serverNow = "2026-11-08T13:00:01.000Z";
  await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
  const fresh = call.mock.calls.slice(before).filter(([method]) => method === "office.usage.detail");
  expect(fresh.some(([, p]) => p.window === "rolling24h" && !p.cursor && !p.snapshot && !p.end)).toBe(true);
  expect(screen.getByRole("heading", { name: "Token breakdown", level: 1 })).toBeInTheDocument();
  await act(async () => { resolveOld(detail()); });
  expect(screen.queryByText("Big consumer", { selector: "b" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Token breakdown" }).querySelector('time[datetime="2026-11-08T13:00:00.000Z"]')).not.toBeNull();
});
it("keeps account bars as an independent historical UTC day view", async () => {
  const call = vi.fn().mockImplementation((method: string) => Promise.resolve(method === "office.usage" ? account : detail()));
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  fireEvent.click(await screen.findByRole("button", { name: `${date}: 0 tokens` }));
  expect(call.mock.lastCall?.[1]).toMatchObject({ date, timeZone: "UTC" });
  expect(call.mock.lastCall?.[1]).not.toHaveProperty("window");
  expect(await within(screen.getByRole("region", { name: "Daily response detail" })).findByText(/Provider account days are an independent reference/)).toBeInTheDocument();
});

it("opens a dedicated breakdown from a compact Overview, explicitly drills a group, then returns focus", async () => {
  const value = detail(); value.rows[0].configuredModel = "gpt-6.1-sol";
  const call = vi.fn().mockImplementation(async (method: string) => method === "office.usage" ? account : detail({ rows: value.rows }));
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  const preview = await screen.findByRole("region", { name: "Office rolling 24-hour usage" });
  expect(within(preview).queryByRole("button", { name: "Chat and user work" })).toBeNull();
  const entry = await within(preview).findByRole("button", { name: "View token breakdown" }); fireEvent.click(entry);
  const pane = await screen.findByRole("region", { name: "Token breakdown" });
  expect(within(pane).getByText(/This is not your subscription bill/)).toBeVisible(); expect(within(pane).getByText(/Work versus communication: not collected/)).toBeVisible();
  expect(within(pane).queryByText("Big consumer", { selector: "b" })).toBeNull(); expect(call.mock.lastCall?.[1]).toMatchObject({ snapshot: "stable-snapshot", includeRecords: false });
  fireEvent.click(within(pane).getByRole("button", { name: "Unattributed" }));
  await waitFor(() => expect(call.mock.lastCall?.[1]).toMatchObject({ taskId: "unattributed", end: value.window!.end, includeRecords: false })); expect(call.mock.lastCall?.[1]).not.toHaveProperty("snapshot");
  fireEvent.click(within(pane).getByRole("button", { name: "View response records" })); await within(pane).findByText("Big consumer", { selector: "b" });
  fireEvent.click(screen.getByRole("button", { name: "Back to overview" })); await waitFor(() => expect(screen.getByRole("button", { name: "View token breakdown" })).toHaveFocus()); expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

it("keeps Top5+Other equal to the full grouping, exposes every group, and never turns tiny prices into free", () => {
  const value = detail(), base = value.breakdown!.contributors.agents[0];
  const groups = Array.from({ length: 12 }, (_, i) => ({ ...base, id: `group-${i}`, name: `Worker ${i}`, knownTokens: i + 1, cost: { ...base.cost, minUsd: (12 - i) / 1e8, maxUsd: (12 - i) / 1e7 } }));
  const top = topContributors(groups, "tokens", false); expect(top).toHaveLength(6); expect(top.reduce((s, r) => s + r.knownTokens!, 0)).toBe(78);
  expect(top.reduce((s, r) => s + r.cost.minUsd!, 0)).toBeCloseTo(78 / 1e8, 12); expect(top.reduce((s, r) => s + r.cost.maxUsd!, 0)).toBeCloseTo(78 / 1e7, 12);
  expect(apiCostLabel({ minUsd: 1e-9, maxUsd: 1e-9 })).not.toBe("$0.00");
  value.breakdown!.contributors.tasks = groups;
  const select = vi.fn(); render(createElement(AiTokenBreakdown, { value, onSelect: select, onRecords: vi.fn() }));
  expect(screen.getAllByRole("button", { name: /Worker/ })).toHaveLength(5); fireEvent.click(screen.getByRole("button", { name: "Show all groups" })); expect(screen.getAllByRole("button", { name: /Worker/ })).toHaveLength(12);
  fireEvent.change(screen.getByRole("combobox", { name: "Group order" }), { target: { value: "cost" } }); expect(screen.getAllByRole("button", { name: /Worker/ })[0]).toHaveTextContent("Worker 0");
  fireEvent.click(screen.getAllByRole("button", { name: /Worker/ })[0]); expect(select).toHaveBeenCalledWith("tasks", "group-0");
});

it("does not draw complete proportions from partial fields or fall back to old all-row components", () => {
  const value = detail(); value.breakdown!.measuredComponents.input = { knownSubtotal: 50, reportedRows: 0, unknownRows: 1 };
  const view = render(createElement(AiTokenBreakdown, { value, onSelect: vi.fn(), onRecords: vi.fn() }));
  expect(screen.queryByLabelText("Input and output share")).toBeNull(); expect(screen.queryByLabelText("Cached share of input")).toBeNull();
  view.rerender(createElement(AiTokenBreakdown, { value: { ...value, breakdown: undefined }, onSelect: vi.fn(), onRecords: vi.fn() }));
  expect(screen.getByRole("status")).toHaveTextContent("unavailable on this gateway"); expect(screen.queryByLabelText("Token composition")).toBeNull();
});

it("makes snapshot expiry explicit and refreshes the same anchor without reusing its stale token", async () => {
  let failed = true;
  const value = detail(), call = vi.fn().mockImplementation(async () => { if (failed) throw Error("Usage page expired or filters changed"); return value; });
  render(createElement(AiUsageDetail, { rolling: true, initialWindow: value.window!, initialSnapshot: "expired", date: "rolling24h", accountTokens: null, client: { call }, onBack: vi.fn(), onDateChange: vi.fn() }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This snapshot expired"); failed = false; fireEvent.click(screen.getByRole("button", { name: "Refresh response detail" }));
  await screen.findByRole("region", { name: "Token composition" }); expect(call.mock.lastCall?.[1]).toMatchObject({ end: value.window!.end, refresh: true }); expect(call.mock.lastCall?.[1]).not.toHaveProperty("snapshot");
});

it('drills sender-linked shared-turn responses without multiplying messages and opens the receiving session', async () => {
  const value=detail(),onOpenSession=vi.fn();
  value.messageChains={scope:'sharedTurnObservedResponses',incrementalMessageTokens:null,historicalLedger:'notBackfilled',turns:[{nativeThreadId:'native',turnId:'turn',recipientId:'agent',entries:[{itemId:'native-user',requestId:'one',senderId:'a',recipientId:'agent',mode:'start',trigger:'agentMessage',acceptedAt:0},{requestId:'two',senderId:'b',recipientId:'agent',mode:'steer',trigger:'agentMessage',acceptedAt:1}],truncatedEntries:0,activities:[],activityTruncated:false,observedResponses:1,components:value.purposeSummary.components,activityBasis:'observedTurnToolsOnly'}]};
  const call=vi.fn().mockImplementation(async method=>method==='session.messageContext'?{messages:[{id:'turn:native-user',role:'user',content:'Fixture original text'}]}:value);
  render(createElement(AiUsageDetail,{rolling:true,date:'rolling24h',accountTokens:null,client:{call},onBack:vi.fn(),onDateChange:vi.fn(),onOpenSession}));
  const chain=await screen.findByRole('region',{name:'Agent message chains'});fireEvent.click(chain.querySelector('summary')!);
  expect(chain).toHaveTextContent('1 new receiving turns / 1 same-turn additions');expect(chain).toHaveTextContent('does not prove waste');
  expect(call.mock.calls.some(([method])=>method==='session.messageContext')).toBe(false);
  fireEvent.click(within(chain).getByRole('button',{name:'Read original message'}));await screen.findByText('Fixture original text');
  fireEvent.click(within(chain).getByRole('button',{name:'Open receiving session and tool history'}));expect(onOpenSession).toHaveBeenCalledWith('agent');
  fireEvent.click(within(chain).getByRole('button',{name:'View response records'}));
  await waitFor(()=>expect(call.mock.lastCall?.[1]).toMatchObject({nativeThreadId:'native',turnId:'turn',includeRecords:true,snapshot:'stable-snapshot'}));
});
