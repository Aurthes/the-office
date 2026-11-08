import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiCenterDashboard } from "@/features/ring-ship/AiCenterDashboard";
import type { AiCenterSnapshot, AiProviderSnapshot } from "@/features/ring-ship/ai-center";
import { UI_LANGUAGE_KEY } from "@/lib/i18n/ui-language";
// Account-control regressions stay focused here; purpose-preview integration
// and the complete three-level navigation are exercised in aiUsageDetail.
vi.mock("@/features/ring-ship/AiPurposeSummary", async importOriginal => ({ ...await importOriginal<typeof import("@/features/ring-ship/AiPurposeSummary")>(), AiPurposePreview: () => null }));

const provider: AiProviderSnapshot = {
  id: "openai", name: "OpenAI", accountLabel: "ChatGPT / Codex", links: { limits: "https://platform.openai.com/settings/organization/limits", usage: "https://platform.openai.com/usage" },
  account: { type: "chatgpt", plan: "pro" },
  limits: [{ id: "codex", name: "Codex", plan: "pro", windows: [{ usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 },
    { usedPercent: 0, windowDurationMins: 10080, resetsAt: null }], credits: { balance: "0", unlimited: false } }],
  usage: { lifetimeTokens: 12345, peakDailyTokens: null, daily: [{ date: "2026-10-31", tokens: 0 }] },
  api: { status: "available", models: [{ model: "model-a", rpm: 0, tpm: 1000, rpd: null }] },
};
const snapshot: AiCenterSnapshot = { fetchedAt: "2026-11-01T00:00:00Z", providers: [provider] };
const couponSnapshot = (count = 3, ids = ["soon", "later", "forever"]): AiCenterSnapshot => ({ ...snapshot, providers: [{ ...provider,
  resetCredits: { availableCount: count, credits: ids.map((id, index) => ({ id, title: `${id} coupon`, resetType: "codexRateLimits", expiresAt: id === "forever" ? null : Math.floor(Date.now() / 1000) + 86400 * (index + 1) })) },
}] });
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("lists unused coupons and expiration details without consuming one on load", async () => {
  const call = vi.fn().mockResolvedValue(couponSnapshot());
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  await screen.findByRole("region", { name: "Quota reset coupons" });
  expect(screen.getByText("3 available")).toBeInTheDocument();
  expect(screen.getByText("No expiration")).toBeInTheDocument();
  expect(screen.getAllByText(/^Expires /)).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Apply reset" })).toHaveLength(3);
  expect(call).toHaveBeenCalledExactlyOnceWith("office.usage", {});
});

it("uses the selected coupon once, blocks duplicate clicks, and reads the actual new quotas", async () => {
  let resolve: (value: { outcome: string }) => void = () => {};
  let reads = 0;
  const call = vi.fn().mockImplementation((method: string) => method === "office.usage" ? Promise.resolve(++reads === 1 ? couponSnapshot() : {
    ...couponSnapshot(2, ["later", "forever"]), providers: [{ ...couponSnapshot(2, ["later", "forever"]).providers[0], limits: [{ ...provider.limits![0], windows: [{ usedPercent: 0, windowDurationMins: 300, resetsAt: 1800000000 }] }] }],
  }) : new Promise<{ outcome: string }>(done => { resolve = done; }));
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  const row = (await screen.findByText("soon coupon")).closest("li")!;
  const button = within(row).getByRole("button", { name: "Apply reset" });
  fireEvent.click(button); fireEvent.click(button);
  expect(call.mock.calls.filter(([method]) => method === "office.resetCredit.consume")).toHaveLength(1);
  expect(screen.getByRole("progressbar", { name: "5-hour window" })).toHaveAttribute("aria-valuenow", "25");
  expect(screen.getAllByRole("button", { name: /Apply reset|Applying/ }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  await act(async () => { resolve({ outcome: "reset" }); });
  await screen.findByText("2 available");
  expect(screen.queryByText("soon coupon")).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "5-hour window" })).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByRole("status")).toHaveTextContent("Quota reset applied.");
});

it("reuses the same attempt ID after an ambiguous failure and a manual refresh", async () => {
  let attempts = 0, completed = false;
  const call = vi.fn().mockImplementation((method: string) => {
    if (method === "office.usage") return Promise.resolve(completed ? couponSnapshot(2, ["later", "forever"]) : couponSnapshot());
    if (++attempts === 1) return Promise.reject(new Error("Private provider error"));
    completed = true; return Promise.resolve({ outcome: "alreadyRedeemed" });
  });
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  const click = () => fireEvent.click(within(screen.getByText("soon coupon").closest("li")!).getByRole("button", { name: "Apply reset" }));
  await screen.findByText("soon coupon"); click();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm the reset");
  fireEvent.click(screen.getByRole("button", { name: "Refresh AI usage" }));
  await screen.findByText("soon coupon"); click();
  await screen.findByText("2 available");
  const redeem = call.mock.calls.filter(([method]) => method === "office.resetCredit.consume");
  expect(redeem).toHaveLength(2);
  expect(redeem[0][1]).toEqual(redeem[1][1]);
  expect(redeem[0][1]).toMatchObject({ creditId: "soon", idempotencyKey: expect.any(String) });
  expect(screen.getByRole("status")).toHaveTextContent("already applied");
});

it.each(["nothingToReset", "noCredit"])("handles the provider's %s outcome and refreshes inventory", async outcome => {
  let redeemed = false;
  const call = vi.fn().mockImplementation((method: string) => {
    if (method === "office.usage") return Promise.resolve(redeemed && outcome === "noCredit" ? couponSnapshot(0, []) : couponSnapshot());
    redeemed = true; return Promise.resolve({ outcome });
  });
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  fireEvent.click(within((await screen.findByText("soon coupon")).closest("li")!).getByRole("button", { name: "Apply reset" }));
  await waitFor(() => expect(call.mock.calls.filter(([method]) => method === "office.usage")).toHaveLength(2));
  expect(screen.getByRole("status")).toHaveTextContent(outcome === "noCredit" ? "No reset coupon is available" : "No coupon was used");
});

it("does not consume a coupon that expired after it was rendered", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
  const initial = couponSnapshot(1, ["soon"]); initial.providers[0].resetCredits!.credits![0].expiresAt = Date.now() / 1000 + 1;
  const call = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(couponSnapshot(0, []));
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  await act(async () => {});
  vi.setSystemTime(new Date("2026-11-06T00:00:02Z"));
  fireEvent.click(screen.getByRole("button", { name: "Apply reset" }));
  await act(async () => {});
  expect(call.mock.calls.every(([method]) => method === "office.usage")).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("expired");
});

it("keeps count-only inventory honest and disables expired or unknown coupon types", async () => {
  const initial = couponSnapshot(4, ["expired", "unknown"]);
  initial.providers[0].resetCredits!.credits![0].expiresAt = Date.now() / 1000 - 1;
  initial.providers[0].resetCredits!.credits![1].resetType = "unknown";
  const call = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue({ ...snapshot, providers: [{ ...provider, resetCredits: { availableCount: 3, credits: null } }] });
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  await screen.findByText("4 available");
  expect(screen.getAllByRole("button", { name: "Apply reset" }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.getByText(/Showing 2 of 4/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh AI usage" }));
  await screen.findByText("3 available");
  expect(screen.getByText(/Coupon details are not available/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Apply reset" })).not.toBeInTheDocument();
});

it("shows actual quota windows, real zeroes and unknown values, and closes through its controls", async () => {
  const call = vi.fn().mockResolvedValue(snapshot), onClose = vi.fn();
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose }));
  await screen.findByText("12,345");
  expect(screen.getByRole("progressbar", { name: "5-hour window" })).toHaveAttribute("aria-valuenow", "25");
  expect(screen.getByRole("progressbar", { name: "7-day window" })).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByText("75% remaining")).toBeInTheDocument();
  expect(screen.getByText("Reset time not provided")).toBeInTheDocument();
  expect(screen.getAllByRole("cell").map(cell => cell.textContent)).toEqual(["model-a", "0", "1,000", "—"]);
  fireEvent.click(screen.getByRole("button", { name: "Close AI Center" })); expect(onClose).toHaveBeenCalledOnce();
});
it("does not read usage while closed, stops polling on close, and ignores late responses", async () => {
  vi.useFakeTimers();
  let resolve: (value: AiCenterSnapshot) => void = () => {};
  const client = { call: vi.fn().mockImplementation(() => new Promise<AiCenterSnapshot>(done => { resolve = done; })) }, onClose = vi.fn();
  const view = render(createElement(AiCenterDashboard, { open: false, connected: true, client, onClose }));
  expect(client.call).not.toHaveBeenCalled();
  view.rerender(createElement(AiCenterDashboard, { open: true, connected: true, client, onClose }));
  expect(client.call).toHaveBeenCalledOnce();
  view.rerender(createElement(AiCenterDashboard, { open: false, connected: true, client, onClose }));
  await act(async () => { resolve(snapshot); await vi.advanceTimersByTimeAsync(120_000); });
  expect(client.call).toHaveBeenCalledOnce(); expect(screen.queryByText("12,345")).not.toBeInTheDocument();
});
it("shows clear unavailable states and recovers after a manual refresh", async () => {
  const call = vi.fn().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce({ ...snapshot, providers: [{ ...provider, limits: null, usage: null, api: { status: "not_configured", models: [] } }] });
  render(createElement(AiCenterDashboard, { open: true, client: { call }, connected: true, onClose: vi.fn() }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Usage could not be refreshed");
  fireEvent.click(screen.getByRole("button", { name: "Refresh AI usage" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByText("Subscription limits are not available for this account.")).toBeInTheDocument();
  expect(screen.getByText("API quota is not connected")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("shows the account panel in Chinese with the same quota values", async () => {
  localStorage.setItem(UI_LANGUAGE_KEY, "zh-CN");
  render(createElement(AiCenterDashboard, { open: true, client: { call: vi.fn().mockResolvedValue(snapshot) }, connected: true, onClose: vi.fn() }));
  await screen.findByRole("progressbar", { name: "5 小时额度" });
  expect(screen.getByRole("dialog", { name: "AI 用量，一目了然。" })).toBeInTheDocument();
  expect(screen.getByText("剩余 75%")).toBeInTheDocument();
});

it("renders another provider without OpenAI labels, URLs, or a fixed number of quota windows", async () => {
  const other: AiProviderSnapshot = { ...provider, id: "other", name: "Other AI", accountLabel: "Other AI account", account: { type: "subscription", plan: "team" },
    links: { limits: "https://example.com/limits", usage: "https://example.com/usage" },
    limits: [{ id: "requests", name: "Request capacity", plan: null, credits: null, windows: [
      { usedPercent: 10, windowDurationMins: 60, resetsAt: null },
      { usedPercent: 20, windowDurationMins: 1440, resetsAt: null },
      { usedPercent: 30, windowDurationMins: 10080, resetsAt: null },
    ] }], usage: { lifetimeTokens: 99, peakDailyTokens: null, daily: null }, api: { status: "not_configured", models: [] } };
  render(createElement(AiCenterDashboard, { open: true, client: { call: vi.fn().mockResolvedValue({ ...snapshot, providers: [provider, other] }) }, connected: true, onClose: vi.fn() }));
  const selector = await screen.findByRole("combobox", { name: "AI provider" });
  fireEvent.change(selector, { target: { value: "other" } });
  expect(screen.getByText("Other AI account")).toBeInTheDocument();
  expect(screen.getByText("99")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Other AI limits" })).toHaveAttribute("href", "https://example.com/limits");
  expect(screen.getByRole("link", { name: "API usage & billing" })).toHaveAttribute("href", "https://example.com/usage");
  expect(screen.getAllByRole("progressbar")).toHaveLength(3);
  expect(screen.queryByText("ChatGPT / Codex")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "OpenAI limits" })).not.toBeInTheDocument();
});
