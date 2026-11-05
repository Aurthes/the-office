import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ParticipationDashboard } from "@/features/participation/ParticipationDashboard";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";
import { participationSeries, type ParticipationHour } from "@/lib/participation/model";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const H = 3_600_000;
const fixture = (): ParticipationHour => ({ version: 1, hour: 0, updatedAt: 1, startedAt: 0,
  market: [{ exchange: "venue", symbol: "btc", type: "rpi", notional: 100, count: 10, ready: true, reason: "" }],
  own: [{ exchange: "venue", account: "one", symbol: "btc", type: "rpi", notional: 25, count: 1, ready: true, reason: "" }],
});
const data = (h = fixture()) => ({ configured: true, updatedAt: Date.now(), ...participationSeries([h], 24, H, "exchange") });
it("defaults to bar time series and switches count/notional without a new fetch", async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json(data())); vi.stubGlobal("fetch", fetcher);
  render(createElement(ParticipationDashboard));
  const bar = await screen.findByRole("button", { name: /01\/01 08:00 RPI 25%/ });
  expect(bar).toHaveAttribute("data-share", "0.25");
  expect(screen.getByRole("button", { name: "成交额" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByLabelText("小时")).toBeNull();
  expect(screen.queryByText(/数据更新已延迟/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "成交笔数" }));
  expect(await screen.findByRole("button", { name: /01\/01 08:00 RPI 10%/ })).toHaveAttribute("data-share", "0.1");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /01\/01 08:00 RPI 10%/ }));
  await waitFor(() => expect(document.querySelector("details")).toHaveAttribute("open"));
  expect(screen.getByRole("cell", { name: "25%" })).toBeInTheDocument(); expect(screen.getByRole("cell", { name: "10%" })).toBeInTheDocument();
});
it("renders missing/partial bars as unknown rather than zero and explains the gap on focus", async () => {
  const h = fixture(); h.market[0].ready = false; h.market[0].reason = "行情缺失";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data(h))));
  render(createElement(ParticipationDashboard));
  const bar = await screen.findByRole("button", { name: /01\/01 08:00 RPI —/ });
  expect(bar).toHaveAttribute("data-share", "unknown");
  fireEvent.focus(bar); expect(screen.getByRole("status")).toHaveTextContent("行情缺失");
  expect(screen.queryByRole("button", { name: /RPI 0%/ })).toBeNull();
});
it("requests the chosen range, scope and filters", async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json(data())); vi.stubGlobal("fetch", fetcher);
  render(createElement(ParticipationDashboard)); await screen.findByRole("button", { name: /RPI 25%/ });
  fireEvent.change(screen.getByRole("combobox", { name: "时间范围" }), { target: { value: "168" } });
  fireEvent.click(screen.getByRole("button", { name: "Account 汇总" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "one" } });
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("window=168") && String(url).includes("level=account") && String(url).includes("account=one"))).toBe(true));
});
it("loads charts only when the control-room tile opens and aborts on back", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  const link = { id: "participation", label: "小时参与度", url: "/market-participation/", visual: "chart" };
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("/participation") ? data() : { links: [link] }));
  vi.stubGlobal("fetch", fetcher); const open = vi.spyOn(window, "open");
  render(createElement(MonitorDashboard, { open: true, onClose: vi.fn() }));
  const tile = await screen.findByRole("button", { name: "Open monitor: 小时参与度" }); expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(tile); await screen.findByRole("button", { name: /RPI 25%/ }); expect(open).not.toHaveBeenCalled();
  const signal = (fetcher.mock.calls.find(([url]) => String(url).includes("/participation")) as unknown as [string, RequestInit])[1].signal;
  fireEvent.click(screen.getByRole("button", { name: "Back to monitors" }));
  expect(screen.queryByLabelText("小时市场参与度")).toBeNull(); expect(signal?.aborted).toBe(true);
});
