import { createRequire } from "node:module";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiCenterDashboard } from "@/features/ring-ship/AiCenterDashboard";
import { AiUsageDetail } from "@/features/ring-ship/AiUsageDetail";
import { AiPurposePreview } from "@/features/ring-ship/AiPurposeSummary";
import type { AiCenterSnapshot, UsageDetail } from "@/features/ring-ship/ai-center";
import { UI_LANGUAGE_KEY } from "@/lib/i18n/ui-language";
const { purposeSummary } = createRequire(import.meta.url)("../../server/office-usage-purpose.js");
const date = "2026-11-08", timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const detail = (patch: Partial<UsageDetail> = {}): UsageDetail => { const value = { date, timeZone, rows: [{ id: "origin:response", nativeThreadId: "origin", officeAgentId: "agent", agentName: "Big consumer", responseId: "response", turnId: "turn", rootTurnId: null, observedAt: "2026-11-08T01:00:00Z",
  usage: { input: 100, cachedInput: 60, uncachedInput: 40, cacheWriteInput: 0, output: 20, reasoningOutput: 5, otherOutput: 15, total: 120 },
  sourceKind: "nativeRollout", sourceKinds: ["nativeRollout"], contextNativeThreadId: null, sourceTurnId: null, totalBasis: "reported", purpose: "chat_work", purposeBasis: "businessEntry", trigger: "userMessage",
  configuredModel: "model-a", configuredEffort: "high", modelBasis: "turnContext", actualModel: null, status: "unknown", taskId: null, task: null, phaseId: null, questionIds: [], attributionBasis: "unknown", conflict: false, sameTurnResponses: 3,
  previousObservedInput: { responseId: "previous-response", input: 80, change: 20, basis: "adjacentObservedSameTurnConfiguredModel" } }], count: 1,
  snapshot: "stable-snapshot", selectedPurpose: null, totals: { input: 100, cachedInput: 60, uncachedInput: 40, cacheWriteInput: 0, output: 20, reasoningOutput: 5, otherOutput: 15, total: 120 }, nextCursor: null, outsideRetention: false, scope: "Office observed subset",
  coverage: { source: "office-rollout-compatibility", supportedVersion: "0.166.0", apiStability: "internal-format", partial: true, indexing: false, unavailable: false, storageLimit: false, knownSources: 2, scannedSources: 2, readySources: 1, unsupportedSources: 1, partialLines: 0, retainedFrom: "2026-10-26", retainedFromUtc: "2026-10-24", retainedFromPartial: false, capacityLimited: false, firstObservedAt: "2026-11-08T01:00:00Z", indexedThrough: "2026-11-08T01:00:00Z", knownGaps: { unsupportedVersion: 1 } },
  filters: { agents: [{ id: "agent", name: "Big consumer" }], configuredModels: ["model-a"], taskIds: ["task-1"], tasks: [{ id: "task-1", code: "T98", title: "Token profiling" }] }, ...patch } as UsageDetail; value.purposeSummary = patch.purposeSummary || purposeSummary(value.rows, "2026-11-08T00:00:00Z"); return value; };
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
  render(createElement(AiUsageDetail, { date: value.date, accountTokens: null, client: { call: vi.fn().mockResolvedValue(value) }, onBack: vi.fn(), onDateChange: vi.fn() }));
  expect(await screen.findByText("This date is outside the currently retained detail range (age or capacity limit).")).toBeInTheDocument();
  expect(screen.getByText(/Local dates retained from 2026-11-02/)).toBeInTheDocument();
  expect(screen.getByText(/The first retained local day \(2026-11-02\) is partial/)).toBeInTheDocument();
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
  const preview = await screen.findByRole("region", { name: "Today's usage by purpose" });
  fireEvent.click(await within(preview).findByRole("button", { name: "Gray suggestions" }));
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
