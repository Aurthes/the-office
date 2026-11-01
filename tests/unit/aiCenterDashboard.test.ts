import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiCenterDashboard } from "@/features/ring-ship/AiCenterDashboard";
import type { AiCenterSnapshot } from "@/features/ring-ship/ai-center";
import { UI_LANGUAGE_KEY } from "@/lib/i18n/ui-language";

const snapshot: AiCenterSnapshot = {
  fetchedAt: "2026-11-01T00:00:00Z", account: { type: "chatgpt", plan: "pro" },
  limits: [{ id: "codex", name: "Codex", plan: "pro", primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 },
    secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: null }, credits: { balance: "0", unlimited: false } }],
  usage: { lifetimeTokens: 12345, peakDailyTokens: null, daily: [{ date: "2026-10-31", tokens: 0 }] },
  api: { status: "available", models: [{ model: "model-a", rpm: 0, tpm: 1000, rpd: null }] },
};
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

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
  const call = vi.fn().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce({ ...snapshot, limits: null, usage: null, api: { status: "not_configured", models: [] } });
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
