import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ParticipationDashboard } from "@/features/participation/ParticipationDashboard";
import { MonitorDashboard } from "@/features/ring-ship/MonitorDashboard";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const data = () => ({ configured: true, updatedAt: Date.now(), hours: [0], hour: {
  version: 1, hour: 0, updatedAt: 1, startedAt: 0,
  market: [{ exchange: "venue", symbol: "btc", type: "rpi", notional: 100, count: 10, ready: true, reason: "" }],
  own: [{ exchange: "venue", account: "one", symbol: "btc", type: "rpi", notional: 25, count: 1, ready: true, reason: "" }],
} });

it("shows independent notional/count shares and uses the source heartbeat for old hours", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data())));
  render(createElement(ParticipationDashboard));
  expect(await screen.findByText("25%")).toBeInTheDocument();
  expect(screen.getByText("10%")).toBeInTheDocument();
  expect(screen.queryByText(/数据更新已延迟/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Account × Symbol 明细" }));
  expect(screen.getByText("btc")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("搜索 symbol"), { target: { value: "eth" } });
  expect(screen.getByText("该筛选条件下暂无数据。")).toBeInTheDocument();
});

it("keeps incomplete shares unknown while displaying raw facts", async () => {
  const value = data(); value.hour.market[0].ready = false; value.hour.market[0].reason = "行情缺失";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(value)));
  render(createElement(ParticipationDashboard));
  expect(await screen.findByText("行情缺失")).toBeInTheDocument();
  expect(screen.queryByText("25%")).toBeNull();
  expect(screen.getAllByText("—")).toHaveLength(2);
});

it("loads participation only when its control-room tile opens, and aborts on back", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  const link = { id: "participation", label: "小时参与度", url: "/market-participation/", visual: "chart" };
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("/participation") ? data() : { links: [link] }));
  vi.stubGlobal("fetch", fetcher);
  const open = vi.spyOn(window, "open");
  render(createElement(MonitorDashboard, { open: true, onClose: vi.fn() }));
  const tile = await screen.findByRole("button", { name: "Open monitor: 小时参与度" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(tile);
  expect(await screen.findByText("25%")).toBeInTheDocument();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to monitors" }));
  expect(screen.queryByLabelText("小时市场参与度")).toBeNull();
});
