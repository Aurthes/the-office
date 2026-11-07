import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeaserDashboard } from "@/features/ring-ship/TeaserDashboard";
import { setUiLanguage } from "@/lib/i18n/ui-language";
import type { Teaser, TeaserWhiteboard } from "@/lib/office/teasers";

const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
const question = (id: string, title: string): Teaser => ({ id, title, prompt: "Synthetic question", author: "fixture", revision: 1, status: "open", answer: "", summary: "", createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", completedAt: null });
beforeEach(() => {
  setUiLanguage("en"); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const notes = new Map<string, TeaserWhiteboard>();
  let rows = [question(a, "First"), question(b, "Second")];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/office/teasers") return { ok: true, status: 200, json: async () => ({ teasers: rows }) };
    const id = url.split("/")[4];
    const current = notes.get(id) || { id, text: "", revision: 0, updatedAt: null };
    if (init?.method === "PUT") { const value = JSON.parse(init.body as string); notes.set(id, { id, text: value.text, revision: current.revision + 1, updatedAt: "2026-11-07T00:01:00Z" }); }
    return { ok: true, status: 200, json: async () => ({ whiteboard: notes.get(id) || current }) };
  });
  vi.stubGlobal("fetch", fetcher);
  return { notes, fetcher, updateRows: () => { rows = rows.map(row => ({ ...row, title: row.title + " updated" })); } };
}
const open = async (title = "First") => {
  fireEvent.click(await screen.findByRole("button", { name: `Open whiteboard: ${title}` }));
  const input = screen.getByRole("textbox", { name: "Your notes" });
  await waitFor(() => expect(input).toBeEnabled()); return input;
};

it("opens without chat availability and keeps two notes, exact text and empty saves after remount/reopen", async () => {
  const f = fixture(), props = { onClose: vi.fn() };
  let view = render(h(TeaserDashboard, props));
  const input = await open();
  expect(screen.queryByRole("button", { name: "First" })).toBeNull();
  const text = "\n  <script>not executable</script>\t\n";
  fireEvent.change(input, { target: { value: text } }); fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" }));
  await screen.findByText("Whiteboard saved."); expect(f.notes.get(a)?.text).toBe(text); expect(document.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to teasers" }));
  const second = await open("Second"); expect(second).toHaveValue("");
  fireEvent.change(second, { target: { value: "Second note" } }); fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" })); await screen.findByText("Whiteboard saved.");
  view.unmount(); view = render(h(TeaserDashboard, props));
  expect(await open()).toHaveValue(text);
  fireEvent.change(screen.getByRole("textbox", { name: "Your notes" }), { target: { value: "" } }); fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" })); await screen.findByText("Whiteboard saved.");
  expect(f.notes.get(a)?.text).toBe(""); expect(f.notes.get(b)?.text).toBe("Second note");
  view.unmount();
});

it("keeps dirty text on Back, close, Escape/cancel and outside dismissal until discard is confirmed", async () => {
  fixture(); const close = vi.fn(), confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(h(TeaserDashboard, { onClose: close })); const input = await open(); fireEvent.change(input, { target: { value: "Unsent" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to teasers" }));
  fireEvent.click(screen.getByRole("button", { name: "Close teaser board" }));
  const dialog = screen.getByRole("dialog"); fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true })); fireEvent.click(dialog);
  expect(input).toHaveValue("Unsent"); expect(close).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledTimes(4);
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole("button", { name: "Back to teasers" }));
  expect(await screen.findByRole("button", { name: "Open whiteboard: First" })).toBeEnabled(); expect(close).not.toHaveBeenCalled();
  expect(await open()).toHaveValue("");
});

it("never clobbers an editor draft when the board polls or receives updated questions", async () => {
  const f = fixture(); render(h(TeaserDashboard, { onClose: vi.fn() })); const input = await open();
  fireEvent.change(input, { target: { value: "Keep during poll" } }); const before = f.fetcher.mock.calls.length;
  f.updateRows(); fireEvent.focus(window);
  await waitFor(() => expect(f.fetcher.mock.calls.length).toBeGreaterThan(before));
  expect(screen.getByRole("textbox", { name: "Your notes" })).toBe(input); expect(input).toHaveValue("Keep during poll");
  expect(f.fetcher.mock.calls.filter(([url]) => url.endsWith("/whiteboard"))).toHaveLength(1);
});

it("recovers failed loads and retains text after failed saves", async () => {
  const f = fixture(), original = f.fetcher.getMockImplementation()!; let failLoad = true, failSave = true;
  f.fetcher.mockImplementation(async (url, init) => {
    if (url.endsWith("/whiteboard") && (!init?.method || init.method === "GET") && failLoad) return { ok: false, status: 503, json: async () => ({ whiteboard: undefined }) } as never;
    if (init?.method === "PUT" && failSave) throw Error("Offline");
    return original(url, init);
  });
  render(h(TeaserDashboard, { onClose: vi.fn() })); fireEvent.click(await screen.findByRole("button", { name: "Open whiteboard: First" }));
  await screen.findByRole("alert"); expect(screen.getByRole("textbox", { name: "Your notes" })).toBeDisabled();
  failLoad = false; fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  const input = screen.getByRole("textbox", { name: "Your notes" }); await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Retry this draft" } }); fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your text is kept"); expect(input).toHaveValue("Retry this draft");
  failSave = false; fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" })); await screen.findByText("Whiteboard saved.");
  expect(f.notes.get(a)?.text).toBe("Retry this draft");
});

it("requires explicit conflict reload/discard and never silently overwrites another revision", async () => {
  const f = fixture(), original = f.fetcher.getMockImplementation()!; let stale = true;
  f.fetcher.mockImplementation(async (url, init) => init?.method === "PUT" && stale ? { ok: false, status: 409, json: async () => ({ whiteboard: undefined }) } as never : original(url, init));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(h(TeaserDashboard, { onClose: vi.fn() })); const input = await open(); fireEvent.change(input, { target: { value: "My draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" })); await screen.findByRole("button", { name: "Reload whiteboard" });
  expect(input).toHaveValue("My draft"); expect(screen.getByRole("button", { name: "Save whiteboard" })).toBeDisabled();
  const before = f.fetcher.mock.calls.length; fireEvent.click(screen.getByRole("button", { name: "Reload whiteboard" })); expect(f.fetcher).toHaveBeenCalledTimes(before);
  f.notes.set(a, { id: a, text: "Other editor", revision: 2, updatedAt: "2026-11-07T00:02:00Z" }); confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload whiteboard" })); await waitFor(() => expect(input).toHaveValue("Other editor"));
  stale = false; fireEvent.change(input, { target: { value: "Merged note" } }); fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" })); await screen.findByText("Whiteboard saved.");
  expect(JSON.parse(f.fetcher.mock.calls.at(-1)![1]!.body as string)).toEqual({ text: "Merged note", revision: 2 });
});

it("blocks all dismissal and duplicate submission while saving", async () => {
  const f = fixture(), original = f.fetcher.getMockImplementation()!; let finish!: () => void;
  f.fetcher.mockImplementation(async (url, init) => {
    if (init?.method === "PUT") await new Promise<void>(resolve => { finish = resolve; });
    return original(url, init);
  });
  const close = vi.fn(), confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(h(TeaserDashboard, { onClose: close })); const input = await open(); fireEvent.change(input, { target: { value: "Saving draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" }));
  expect(screen.getByRole("button", { name: "Back to teasers" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Close teaser board" })).toBeDisabled(); expect(input).toBeDisabled();
  const dialog = screen.getByRole("dialog"); fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true })); fireEvent.click(dialog);
  expect(close).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  finish(); await screen.findByText("Whiteboard saved.");
  expect(f.fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});
