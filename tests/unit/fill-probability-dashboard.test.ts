import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FillProbabilityDashboard } from "@/features/fill-probability/FillProbabilityDashboard";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";
import { FILL_NOW, fillQuote, fillRow, fillSnapshot } from "../fixtures/fill-probability";

beforeEach(() => { localStorage.setItem("claw3d:ui-language", "en"); vi.spyOn(document, "hidden", "get").mockReturnValue(false); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("shows signed probability gaps, native C_A units, and honest missing stages", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot())));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const actual = within(table).getByRole("row", { name: /Actual EMA/ });
  expect(within(actual).getByText("0.0004")).toBeInTheDocument();
  expect(within(actual).getByText("-0.0006")).toBeInTheDocument();
  expect(within(actual).getByText("-60%")).toBeInTheDocument();
  expect(actual.querySelector(".fill-gap")).toHaveStyle({ color: "#a8b5bd" });
  const ca = within(table).getByRole("row", { name: /C_A · arrival-rate multiplier/ });
  expect(within(ca).getByText("0.8")).toBeInTheDocument();
  expect(within(ca).getByText("×")).toBeInTheDocument();
  expect(within(ca).getByText("—")).toBeInTheDocument();
  for (const stage of ["ca-probability", "before-normalize", "after-normalize", "before-guard", "guard", "final"]) {
    const element = table.querySelector(`[data-stage="${stage}"]`)!;
    expect(within(element as HTMLElement).getByText("N/A")).toBeInTheDocument();
    expect(element).toHaveAttribute("data-state", "unknown");
  }
  expect(screen.getByText(/EMA scope: symbol \+ side, shared across accounts/)).toBeInTheDocument();
  expect(screen.getByText("Not exported; unknown")).toBeInTheDocument();
  expect(screen.getByText("100 / 100 exposure seconds")).toBeInTheDocument();
});
it("filters account, symbol and side without inventing per-account EMA samples", async () => {
  const second = fillRow({ id: "second", account: "account-two", symbol: "venue.perp.b_usdt", side: "ask", schema: 9, clock: "trials" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow(), second]))));
  render(createElement(FillProbabilityDashboard));
  await screen.findByText(/venue.perp.a_usdt · Buy/);
  fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "account-two" } });
  expect(screen.getByRole("heading", { name: "venue.perp.b_usdt · Sell / ask" })).toBeInTheDocument();
  expect(screen.getByText("100 / 100 trials")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), { target: { value: "missing" } });
  expect(screen.getByText("No matching probability records.")).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "Fill probability stages" })).toBeNull();
});
it("marks retained snapshots stale when refresh stalls and stops exposing current EMA numbers", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(fillSnapshot())).mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(FillProbabilityDashboard)); await act(async () => {});
  expect(screen.getByText("0.0004")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(30_001));
  expect(screen.queryByText("0.0004")).toBeNull();
  expect(screen.getByText("Snapshot expired or read failed")).toBeInTheDocument();
  expect(document.querySelector('[data-state="reference"]')).toBeNull();
});
it("pauses while hidden, resumes when visible, and aborts on unmount", async () => {
  vi.useFakeTimers(); let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const fetcher = vi.fn(async () => Response.json(fillSnapshot())); vi.stubGlobal("fetch", fetcher);
  const view = render(createElement(FillProbabilityDashboard)); await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  hidden = true; fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(20_000)); expect(fetcher).toHaveBeenCalledTimes(1);
  hidden = false; fireEvent(document, new Event("visibilitychange")); await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount(); await act(() => vi.advanceTimersByTimeAsync(20_000)); expect(fetcher).toHaveBeenCalledTimes(2);
  const signal = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].signal;
  expect(signal?.aborted).toBe(true);
});
it("opens the built-in probability view inside the control room on demand", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("/fill-probability") ? fillSnapshot() : { links: [] }));
  vi.stubGlobal("fetch", fetcher); const open = vi.spyOn(window, "open");
  render(createElement(MonitorDashboard, { open: true, onClose: vi.fn() }));
  expect(fetcher.mock.calls.some(([url]) => url.includes("/fill-probability"))).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "Open monitor: Fill probability" }));
  await screen.findByRole("table", { name: "Fill probability stages" }); expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to monitors" }));
  expect(screen.queryByRole("region", { name: "Fill probability" })).toBeNull();
});

it("shows offline candidate observation fields and colors original-ready EMA and current quote distances", async () => {
  const row = fillRow({ ready: true, observedAt: FILL_NOW, quote: fillQuote() });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([row]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const stage = (key: string) => table.querySelector(`[data-stage="${key}"]`)! as HTMLElement;
  for (const key of ["base", "model", "actual", "ca-probability", "before-normalize", "after-normalize", "p1", "post-only", "p2", "final"]) {
    expect(stage(key)).toHaveAttribute("data-state", "current");
    expect(stage(key).querySelector(".fill-gap")).not.toHaveStyle({ color: "#a8b5bd" });
  }
  expect(within(stage("before-normalize")).getByText("0.0015")).toBeInTheDocument();
  expect(within(stage("after-normalize")).getByText("0.0012")).toBeInTheDocument();
  expect(within(stage("after-normalize")).getByText("Normalization: Enabled · scale 0.8")).toBeInTheDocument();
  expect(within(stage("ca-probability")).getByText("Reference price: 99.8")).toBeInTheDocument();
  expect(within(stage("p1")).getByText("Changed price")).toBeInTheDocument();
  expect(within(stage("final")).getByText("0.0009")).toBeInTheDocument();
  expect(screen.queryByText(/Quote observation has not been exported/)).toBeNull();
  expect(screen.getByText(/Quote and EMA clocks are separate/)).toBeInTheDocument();
});

it("distinguishes unchanged and not-run guards, disabled normalization and absent Pmax", async () => {
  const quote = fillQuote({ normalizationEnabled: false, normalizationScale: 1, pmax: null, beforeNormalize: .0015, afterNormalize: .0015, p1State: "unchanged", postOnlyState: "unchanged", p2State: "not-run", p2AfterProbability: null });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="pmax"] .fill-value')).toHaveTextContent("N/A");
  expect(table.querySelector('[data-stage="after-normalize"]')).toHaveTextContent("Normalization: Disabled · scale 1");
  expect(table.querySelector('[data-stage="post-only"]')).toHaveTextContent("Passed without price change");
  expect(table.querySelector('[data-stage="p2"]')).toHaveTextContent("Not run");
});

it("shows a rejected or disabled side as no quote, never zero final probability", async () => {
  const quote = fillQuote({ quoted: false, finalProbability: .0009, finalPrice: 99.5, p2State: "rejected", guardReason: "p2_ratio_unreachable", disabledMask: 4 });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const final = table.querySelector('[data-stage="final"]')! as HTMLElement;
  expect(final.querySelector(".fill-value")).toHaveTextContent("N/A");
  expect(final).toHaveTextContent("No near quote");
  expect(final).toHaveTextContent("p2_ratio_unreachable · Risk blocked · Disable mask: 4");
  expect(table.querySelector('[data-stage="p2"]')).toHaveTextContent("Rejected");
});

it("keeps underflow targets distinct from an explicit disabled side", async () => {
  const quote = fillQuote({ underflow: true, afterNormalize: 0, logAfterNormalize: -800, quoted: true });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="after-normalize"]')).toHaveTextContent("Positive target below floating-point range");
  expect(table.querySelector('[data-stage="after-normalize"]')).toHaveTextContent("ln(p) -800");
  expect(screen.queryByText("No near quote")).toBeNull();
});

it("does not mix an expired quote with a current ready EMA", async () => {
  const row = fillRow({ ready: true, observedAt: FILL_NOW, quote: fillQuote({ at: FILL_NOW - 30_000 }) });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([row]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="actual"]')).toHaveAttribute("data-state", "current");
  expect(table.querySelector('[data-stage="final"] .fill-value')).toHaveTextContent("N/A");
  expect(screen.getByText("Quote observation expired or read failed")).toBeInTheDocument();
});

it("distinguishes an observed but not-ready quote from telemetry that was never exported", async () => {
  const quote = fillQuote({ available: false, guardReason: "spread_not_ready", baseTarget: null, quoted: false });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  await screen.findByRole("table", { name: "Fill probability stages" });
  expect(screen.getByText(/Quote was observed, but quote stages are unavailable/)).toHaveTextContent("spread_not_ready");
  expect(screen.queryByText(/Quote observation has not been exported by this producer/)).toBeNull();
  const sourceReason = screen.getByText("Quote source reason").parentElement!;
  expect(sourceReason).toHaveTextContent("spread_not_ready");
  expect(screen.getByText("Quote calculation time").parentElement).not.toHaveTextContent("N/A");
  expect(document.querySelector('[data-stage="final"] .fill-value')).toHaveTextContent("N/A");
});

it("does not describe an explicit zero target with no log target as positive underflow", async () => {
  const quote = fillQuote({ underflow: true, beforeNormalize: 0, afterNormalize: 0, logAfterNormalize: null, quoted: false, disabledMask: 1, guardReason: "side_disabled" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  expect(table.querySelector('[data-stage="after-normalize"]')).not.toHaveTextContent("Positive target below floating-point range");
  expect(table.querySelector('[data-stage="after-normalize"]')).not.toHaveTextContent("ln(p)");
  expect(table.querySelector('[data-stage="final"]')).toHaveTextContent("Model disabled this side");
  expect(table.querySelector('[data-stage="final"]')).toHaveTextContent("No near quote");
});

it("maps all reported disable bits to their original meanings without inferring a blocker", async () => {
  const quote = fillQuote({ quoted: false, disabledMask: 31, guardReason: "side_disabled" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fillSnapshot([fillRow({ quote })]))));
  render(createElement(FillProbabilityDashboard));
  const table = await screen.findByRole("table", { name: "Fill probability stages" });
  const final = table.querySelector('[data-stage="final"]')!;
  for (const reason of ["Model disabled this side", "Fee unavailable", "Risk blocked", "EV blocked", "Anti-arbitrage blocked", "Disable mask: 31"])
    expect(final).toHaveTextContent(reason);
});


it("accepts a cold producer response beyond one refresh interval without a false read failure", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const response = setTimeout(() => resolve(Response.json(fillSnapshot())), 12_000);
    options.signal?.addEventListener("abort", () => {
      clearTimeout(response);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(FillProbabilityDashboard));
  await act(() => vi.advanceTimersByTimeAsync(12_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("table", { name: "Fill probability stages" })).toBeInTheDocument();
  expect(screen.getByText("0.0004")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});
