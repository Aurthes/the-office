import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResetCouponNotice } from "@/features/ring-ship/ResetCouponNotice";
import { SpaceTrafficNotice } from "@/features/ring-ship/SpaceTrafficNotice";
import { expiringResetCredits, type AiCenterSnapshot, type ResetCredit } from "@/features/ring-ship/ai-center";
import { emptySpaceEncounter, emptySpaceMotion, sampleSpaceEncounter } from "@/features/ring-ship/space-activity";

const now = Date.parse("2026-11-06T00:00:00Z"), day = 86400;
const coupon = (id: string, expiresAt: number | null | undefined): ResetCredit => ({ id, title: id, resetType: "codexRateLimits", expiresAt });
const snapshot = (credits: ResetCredit[] | null = [coupon("soon", now / 1000 + day)], availableCount = credits?.length ?? 1): AiCenterSnapshot => ({
  fetchedAt: new Date(now).toISOString(), providers: [{ id: "openai", name: "OpenAI", accountLabel: "ChatGPT / Codex", links: {}, account: null,
    limits: null, usage: null, api: { status: "not_configured", models: [] }, resetCredits: { availableCount, credits } }],
});
const flush = () => act(async () => { await Promise.resolve(); });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("starts at exactly 72 hours, excludes expired or undated coupons, and orders by nearest expiry", () => {
  const data = snapshot([coupon("boundary", now / 1000 + 3 * day), coupon("too-late", now / 1000 + 3 * day + 1),
    coupon("soon", now / 1000 + 1), coupon("expired", now / 1000), coupon("forever", null), coupon("unknown", undefined)]);
  expect(expiringResetCredits(data, now).map(c => c.id)).toEqual(["soon", "boundary"]);
  expect(expiringResetCredits(data, now + 1000).map(c => c.id)).toEqual(["boundary", "too-late"]);
  expect(expiringResetCredits(snapshot(data.providers[0].resetCredits!.credits, 0), now)).toEqual([]);
  expect(expiringResetCredits(snapshot(null), now)).toEqual([]);
  expect(expiringResetCredits(null, now)).toEqual([]);
});

it("does not mistake another provider's inventory for Codex coupons", () => {
  const data = snapshot(); data.providers[0].id = "another-provider";
  expect(expiringResetCredits(data, now)).toEqual([]);
});

it("only reads inventory; clicking opens AI Center without applying any coupon", async () => {
  const call = vi.fn().mockResolvedValue(snapshot()), onOpen = vi.fn();
  render(createElement(ResetCouponNotice, { client: { call }, onOpen })); await flush();
  expect(screen.getByRole("status")).toHaveTextContent("Reset coupons expiring soon");
  expect(screen.getByText("1 expiring within 3 days")).toBeInTheDocument();
  expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-11-07T00:00:00.000Z");
  fireEvent.click(screen.getByRole("button", { name: "View expiring reset coupons" }));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledExactlyOnceWith("office.usage", {});
});

it("removes a redeemed coupon on refresh and an expired coupon as time passes", async () => {
  const call = vi.fn().mockResolvedValueOnce(snapshot([coupon("nearly-expired", now / 1000 + 30)]))
    .mockResolvedValueOnce(snapshot([coupon("nearly-expired", now / 1000 + 30)]))
    .mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot([], 0));
  render(createElement(ResetCouponNotice, { client: { call }, onOpen: vi.fn() })); await flush();
  expect(screen.getByRole("status")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.getByRole("status")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(call.mock.calls.every(([method]) => method === "office.usage")).toBe(true);
});

it("pauses hidden-tab reads and refreshes immediately when the tab returns", async () => {
  const call = vi.fn().mockResolvedValue(snapshot());
  render(createElement(ResetCouponNotice, { client: { call }, onOpen: vi.fn() })); await flush();
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  expect(call).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  fireEvent(document, new Event("visibilitychange")); await flush();
  expect(call).toHaveBeenCalledTimes(2);
});

it("avoids overlapping reads, ignores late replies, and clears polling on unmount", async () => {
  let resolve: (value: AiCenterSnapshot) => void = () => {};
  const call = vi.fn().mockImplementation(() => new Promise<AiCenterSnapshot>(done => { resolve = done; }));
  const view = render(createElement(ResetCouponNotice, { client: { call }, onOpen: vi.fn() }));
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  fireEvent(document, new Event("visibilitychange"));
  expect(call).toHaveBeenCalledTimes(1);
  view.unmount(); await act(async () => { resolve(snapshot()); });
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  expect(call).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it("recovers after a read failure without showing stale inventory or spending coupons", async () => {
  const call = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(snapshot());
  render(createElement(ResetCouponNotice, { client: { call }, onOpen: vi.fn() })); await flush();
  expect(screen.getByRole("status")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(call.mock.calls.every(([method]) => method === "office.usage")).toBe(true);
});

it("keeps the reminder beside fleet traffic and preserves it when traffic is dismissed", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const motion = { current: emptySpaceMotion() };
  motion.current.elapsed = sampleSpaceEncounter(0, 1, emptySpaceEncounter()).trafficStartsIn + 1;
  render(createElement("div", { className: "ship-alerts" },
    createElement(ResetCouponNotice, { client: { call: vi.fn().mockResolvedValue(snapshot()) }, onOpen: vi.fn() }),
    createElement(SpaceTrafficNotice, { seed: 1, paused: false, motion })));
  await flush();
  expect(screen.getByLabelText("Reset coupon expiry reminder")).toBeInTheDocument();
  expect(screen.getByLabelText("Space traffic alert")).toHaveTextContent("Fleet passing by");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss traffic alert" }));
  expect(screen.queryByLabelText("Space traffic alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Reset coupon expiry reminder")).toBeInTheDocument();
});
