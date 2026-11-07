import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  await within(dialog).findByRole("heading", { name: "finished question" });
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
  await screen.findByRole("heading", { name: "finished question" });
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
  const title = await screen.findByRole("button", { name: "finished question" });
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
