import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeaserDashboard } from "@/features/ring-ship/TeaserDashboard";
import { setUiLanguage } from "@/lib/i18n/ui-language";
import type { Teaser } from "@/lib/office/teasers";
beforeEach(() => {
  setUiLanguage("en");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const row = (status: Teaser["status"], id: string): Teaser => ({ id, revision: 1, status, author: "teaser", title: `${status} question`, prompt: "Find the invariant.", answer: "The answer is 42.", summary: "Pair the terms; each pair has the same sum.", createdAt: "2026-11-07T10:00:00Z", updatedAt: "2026-11-07T10:00:00Z", completedAt: status === "finished" ? "2026-11-07T10:00:00Z" : null });
it("filters completion status and reveals only finished answers and key ideas", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ teasers: [row("open", "a"), row("in_progress", "b"), row("finished", "c")] }) })));
  const close = vi.fn(), openSession = vi.fn(); render(h(TeaserDashboard, { onClose: close, agents: [{ id: "existing-teaser", name: "teaser" }], onOpenSession: openSession }));
  const dialog = await screen.findByRole("dialog", { name: "Teaser board" });
  await within(dialog).findByRole("heading", { name: "open question" });
  expect(within(dialog).getByRole("button", { name: "Open 1" })).toHaveAttribute("aria-pressed", "true");
  expect(within(dialog).getAllByRole("article")).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "All 3" }));
  expect(within(dialog).getAllByRole("article")).toHaveLength(3);
  expect(within(dialog).getByLabelText("Teasers finished")).toHaveTextContent("1 / 3");
  expect(within(dialog).getAllByText("View answer & key idea")).toHaveLength(1);
  expect(within(dialog).getByText("The answer is 42.")).not.toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Finished 1" }));
  expect(within(dialog).getAllByRole("article")).toHaveLength(1);
  fireEvent.click(within(dialog).getByText("View answer & key idea"));
  expect(within(dialog).getByText("Pair the terms; each pair has the same sum.")).toBeVisible();
  expect(within(dialog).getByText("The answer is 42.")).toBeVisible();
  expect(openSession).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close teaser board" })); expect(close).toHaveBeenCalledOnce();
});
it("shows a real empty state and allows a failed initial load to recover", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true, json: async () => ({ teasers: [] }) });
  vi.stubGlobal("fetch", fetcher); render(h(TeaserDashboard, { onClose: vi.fn() }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  fireEvent.click(screen.getByRole("button", { name: "Refresh teasers" }));
  expect(await screen.findByText("The next good question belongs here.")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetcher).toHaveBeenCalledWith("/api/office/teasers", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});
it("keeps existing cards on refresh failure, then accepts the next real update", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ teasers: [row("open", "a")] }) }).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => ({ teasers: [row("finished", "a")] }) });
  vi.stubGlobal("fetch", fetcher); const view = render(h(TeaserDashboard, { onClose: vi.fn() }));
  await screen.findByRole("heading", { name: "open question" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh teasers" }));
  await screen.findByRole("alert"); expect(screen.getByRole("heading", { name: "open question" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh teasers" }));
  await screen.findByText("No teasers with this status.");
  fireEvent.click(screen.getByRole("button", { name: "Finished 1" }));
  expect(screen.getByRole("heading", { name: "finished question" })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  const signal = fetcher.mock.calls.at(-1)?.[1].signal as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
});

it("closes the board before opening the unique current teaser employee without sending anything", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ teasers: [row("open", "a")] }) }));
  vi.stubGlobal("fetch", fetcher);
  const events: string[] = [];
  function Board() {
    const [open, setOpen] = useState(true);
    return open ? h(TeaserDashboard, {
      agents: [{ id: "unrelated", name: "teaser clone" }, { id: "current-session", name: " TeAsEr " }],
      onClose: () => { events.push("close"); setOpen(false); },
      onOpenSession: id => events.push(id),
    }) : h("p", null, "Board closed");
  }
  render(h(Board));
  const title = await screen.findByRole("button", { name: "open question" });
  expect(title).toBeEnabled();
  fireEvent.click(title);
  expect(events).toEqual(["close", "current-session"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith("/api/office/teasers", { cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) });
});

it.each([
  ["missing", []],
  ["duplicate", [{ id: "one", name: "teaser" }, { id: "two", name: "TEASER" }]],
])("disables title navigation for a %s teaser target while keeping answers available", async (_reason, agents) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ teasers: [row("finished", "a")] }) })));
  const close = vi.fn(), openSession = vi.fn();
  render(h(TeaserDashboard, { onClose: close, onOpenSession: openSession, agents: agents as { id: string; name: string }[] }));
  fireEvent.click(await screen.findByRole("button", { name: "Finished 1" }));
  const title = screen.getByRole("button", { name: "finished question" });
  expect(title).toBeDisabled();
  expect(title).toHaveAccessibleDescription("Teaser chat is unavailable.");
  fireEvent.click(title);
  fireEvent.click(screen.getByText("View answer & key idea"));
  expect(screen.getByText("The answer is 42.")).toBeVisible();
  expect(close).not.toHaveBeenCalled(); expect(openSession).not.toHaveBeenCalled();
});

it("uses refreshed employee identity and disables navigation when the host cannot open chats", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ teasers: [row("open", "a")] }) })));
  const close = vi.fn(), openSession = vi.fn();
  const view = render(h(TeaserDashboard, { onClose: close, agents: [{ id: "old", name: "teaser" }], onOpenSession: openSession }));
  const title = await screen.findByRole("button", { name: "open question" });
  view.rerender(h(TeaserDashboard, { onClose: close, agents: [{ id: "new", name: "teaser" }], onOpenSession: openSession }));
  fireEvent.click(title);
  expect(openSession).toHaveBeenCalledExactlyOnceWith("new");
  view.rerender(h(TeaserDashboard, { onClose: close, agents: [{ id: "new", name: "teaser" }] }));
  expect(title).toBeDisabled();
});


it("defaults to Open, sorts by actual creation instants with stable ID ties, and preserves other filters' input order", async () => {
  const oldest = { ...row("open", "oldest"), createdAt: "2026-11-07T10:00:00+08:00", updatedAt: "2026-11-08T12:00:00Z" };
  const tieA = { ...row("open", "tie-a"), createdAt: "2026-11-07T03:00:00Z", updatedAt: "2026-11-07T03:00:00Z" };
  const tieB = { ...row("open", "tie-b"), createdAt: "2026-11-07T11:00:00+08:00", updatedAt: "2026-11-08T10:00:00Z" };
  const newest = { ...row("open", "newest"), createdAt: "2026-11-07T04:00:00Z", updatedAt: "2026-11-07T04:00:00Z" };
  const records = [newest, row("finished", "done-z"), tieB, row("in_progress", "work-z"), oldest, tieA, row("finished", "done-a"), row("in_progress", "work-a")];
  records.forEach(Object.freeze); Object.freeze(records);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ teasers: records }) })));
  render(h(TeaserDashboard, { onClose: vi.fn() }));
  const ids = () => screen.getAllByRole("article").map(card => card.getAttribute("data-teaser-id"));
  await screen.findByRole("button", { name: "Open 4" });
  expect(screen.getByRole("button", { name: "Open 4" })).toHaveAttribute("aria-pressed", "true");
  expect(ids()).toEqual(["oldest", "tie-a", "tie-b", "newest"]);
  fireEvent.click(screen.getByRole("button", { name: "All 8" })); expect(ids()).toEqual(records.map(record => record.id));
  fireEvent.click(screen.getByRole("button", { name: "Finished 2" })); expect(ids()).toEqual(["done-z", "done-a"]);
  fireEvent.click(screen.getByRole("button", { name: "In progress 2" })); expect(ids()).toEqual(["work-z", "work-a"]);
  fireEvent.click(screen.getByRole("button", { name: "Open 4" })); expect(ids()).toEqual(["oldest", "tie-a", "tie-b", "newest"]);
});

it("keeps creation order through polling and status changes, then resets to Open after a real close/reopen", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const interval = vi.spyOn(globalThis, "setInterval");
  const old = { ...row("open", "old"), createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z" };
  const recent = { ...row("open", "recent"), createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z" };
  let records = [recent, old];
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ teasers: records }) }));
  vi.stubGlobal("fetch", fetcher);
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? h(TeaserDashboard, { onClose: () => setOpen(false) }) : h("button", { onClick: () => setOpen(true) }, "Reopen board");
  }
  render(h(Host)); const ids = () => screen.getAllByRole("article").map(card => card.getAttribute("data-teaser-id"));
  await screen.findByRole("button", { name: "Open 2" }); expect(ids()).toEqual(["old", "recent"]);
  const poll = interval.mock.calls.find(([, delay]) => delay === 15000)![0] as () => void;
  const middle = { ...row("open", "middle"), createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-09T00:00:00Z" };
  records = [middle, { ...recent, updatedAt: "2026-11-10T00:00:00Z" }, { ...old, updatedAt: "2026-11-11T00:00:00Z" }];
  await act(async () => poll());
  await waitFor(() => expect(ids()).toEqual(["old", "middle", "recent"]));
  records = [{ ...old, status: "finished" }, middle, recent];
  await act(async () => poll());
  await waitFor(() => expect(ids()).toEqual(["middle", "recent"]));
  expect(screen.getByRole("button", { name: "Open 2" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "All 3" })); expect(ids()).toEqual(["old", "middle", "recent"]);
  fireEvent.click(screen.getByRole("button", { name: "Close teaser board" })); expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reopen board" }));
  await screen.findByRole("button", { name: "Open 2" });
  expect(screen.getByRole("button", { name: "Open 2" })).toHaveAttribute("aria-pressed", "true"); expect(ids()).toEqual(["middle", "recent"]);
  expect(fetcher.mock.calls.length).toBe(4);
});
