import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeaserDashboard } from "@/features/ring-ship/TeaserDashboard";
import { useTeaserSolutions, type TeaserSolutionSender } from "@/features/office/hooks/useTeaserSolutions";
import { SessionControls } from "@/features/office/components/SessionControls";
import { setUiLanguage } from "@/lib/i18n/ui-language";
import type { InterfaceAgent } from "@/lib/office/agent-interface";
const qid = "00000000-0000-4000-8000-000000000001", targetId = "00000000-0000-4000-8000-000000000002";
const deferred = () => { let resolve!: (value?: unknown) => void, reject!: (cause: unknown) => void; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
beforeEach(() => {
  setUiLanguage("en"); vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(options: { initialText?: string; saveMode?: string; saveGate?: ReturnType<typeof deferred>; sendGate?: ReturnType<typeof deferred>; drafts?: boolean; editing?: boolean } = {}) {
  const question = { id: qid, title: "Fixture puzzle", prompt: "Visible question", author: "fixture", status: "open", revision: 1,
    answer: "OFFICIAL_SECRET", summary: "OFFICIAL_SUMMARY", createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", completedAt: null };
  const f = { text: options.initialText || "", revision: options.initialText ? 1 : 0, target: { id: targetId, name: "Configured worker", status: "running" } as InterfaceAgent | null, saveMode: options.saveMode || "ok", opened: vi.fn(), controller: null as ReturnType<typeof useTeaserSolutions> | null };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/session-uploads")) return { ok: true, status: 200, json: async () => ({ ref: "fixture-upload" }) };
    if (url === "/api/office/teasers") return { ok: true, status: 200, json: async () => ({ teasers: [question] }) };
    if (init?.method === "PUT") {
      if (options.saveGate) await options.saveGate.promise;
      const value = JSON.parse(init.body as string);
      if (value.revision !== f.revision || f.saveMode === "stale") return { ok: false, status: 409, json: async () => ({}) };
      if (f.saveMode === "failed") return { ok: false, status: 503, json: async () => ({}) };
      if (f.saveMode === "unconfirmed") return { ok: true, status: 200, json: async () => ({ whiteboard: { id: qid, text: "Wrong text", revision: f.revision + 1, updatedAt: "2026-11-08T00:00:00Z" } }) };
      if (f.saveMode === "same-revision") return { ok: true, status: 200, json: async () => ({ whiteboard: { id: qid, text: value.text, revision: f.revision, updatedAt: null } }) };
      f.text = value.text; f.revision++;
    }
    return { ok: true, status: 200, json: async () => ({ whiteboard: { id: qid, text: f.text, revision: f.revision, updatedAt: f.revision ? "2026-11-08T00:00:00Z" : null } }) };
  });
  vi.stubGlobal("fetch", fetcher);
  const call = vi.fn(async (method: string, params?: unknown) => {
    if (method === "session.send") return options.sendGate ? options.sendGate.promise : { status: "steered", turnId: "actual-turn" };
    if (method === "session.composer.options") return { options: [{ kind: "chat", id: "reference-worker", name: "Reference worker", description: "Fixture" }] };
    if (method === "session.edit.prepare") return { token: "fixture-edit", turnId: "interrupted", text: "Uncommitted edited input", inputCount: 1 };
    const editing = options.editing && (params as { threadId?: string })?.threadId === targetId;
    return { connected: true, version: 1, activeTurnId: null, turnStatus: editing ? "interrupted" : "completed", items: [], approvals: [], features: { composer: true, chatReferences: true, prediction: false, voice: false, dictation: false } };
  });
  const client = { call };
  function Host() {
    const [open, setOpen] = useState(true), sender = useTeaserSolutions(client, "ws://fixture", () => f.target); f.controller = sender;
    return h("div", null,
      options.drafts ? h("div", null, h("section", { "aria-label": "Target composer" }, h(SessionControls, { client, threadId: targetId, onItems: () => {} })), h("section", { "aria-label": "Other composer" }, h(SessionControls, { client, threadId: "other-fixture", onItems: () => {} }))) : null,
      open ? h(TeaserDashboard, { onClose: () => setOpen(false), target: f.target, solutionSender: sender as TeaserSolutionSender, onOpenSession: f.opened }) : h("button", { onClick: () => setOpen(true) }, "Reopen board"));
  }
  const view = render(h(Host));
  const openNotes = async () => { fireEvent.click(await screen.findByRole("button", { name: question.title })); const input = screen.getByRole("textbox", { name: "Your notes" }); await waitFor(() => expect(input).toBeEnabled()); return input; };
  return { f, call, fetcher, view, Host, openNotes, sendButton: () => screen.getByRole("button", { name: "Save and send solution" }), puts: () => fetcher.mock.calls.filter(([, init]) => init?.method === "PUT"), sends: () => call.mock.calls.filter(([method]) => method === "session.send") };
}

it("locks CAS through RPC, sends only frozen user text with exact identity and no refs/attachments, then opens the original chat with dirty guards", async () => {
  const saveGate = deferred(), sendGate = deferred(), x = setup({ saveGate, sendGate }); const input = await x.openNotes();
  const text = "\n  用户当前解答 <script>text</script>\t\n"; fireEvent.change(input, { target: { value: text } });
  const send = x.sendButton(); fireEvent.click(send); fireEvent.click(send); expect(x.puts()).toHaveLength(1); expect(x.sends()).toHaveLength(0);
  expect(input).toBeDisabled(); expect(screen.getByRole("button", { name: "Close teaser board" })).toBeDisabled();
  await act(async () => saveGate.resolve()); await waitFor(() => expect(x.sends()).toHaveLength(1));
  const payload = x.sends()[0][1] as { requestId: string; message: string; references: unknown[]; attachments: unknown[]; threadId: string };
  expect(payload.threadId).toBe(targetId); expect(payload.requestId).toBeTruthy(); expect(payload.message).toContain(qid); expect(payload.message).toContain("Fixture puzzle"); expect(payload.message.endsWith(text)).toBe(true);
  expect(payload.message).not.toMatch(/OFFICIAL_SECRET|OFFICIAL_SUMMARY/); expect(payload.attachments).toEqual([]); expect(payload.references).toEqual([]);
  expect(screen.getByRole("button", { name: "Back to teasers" })).toBeDisabled();
  await act(async () => sendGate.resolve({ status: "steered", turnId: "actual-turn" })); await screen.findByText("Solution sent as additional input to the running task.");
  expect(input).toHaveValue(text); expect(x.sendButton()).toBeDisabled(); expect(x.puts()).toHaveLength(1); expect(x.sends()).toHaveLength(1);
  fireEvent.change(input, { target: { value: "New unsaved notes" } }); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Open Teaser chat" })); expect(x.f.opened).not.toHaveBeenCalled(); expect(input).toHaveValue("New unsaved notes");
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole("button", { name: "Open Teaser chat" })); expect(x.f.opened).toHaveBeenCalledExactlyOnceWith(targetId); expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["stale", "failed", "unconfirmed", "same-revision"])("does not send clean-but-unconfirmed notes after %s save", async saveMode => {
  const x = setup({ initialText: "Saved current solution", saveMode }); const input = await x.openNotes();
  expect(screen.getByRole("button", { name: "Save whiteboard" })).toBeDisabled(); fireEvent.click(x.sendButton());
  await screen.findByRole("alert"); expect(x.puts()).toHaveLength(1); expect(x.sends()).toHaveLength(0); expect(input).toHaveValue("Saved current solution");
});

it("keeps empty and oversized Unicode text unsent while allowing notes-only save without truncation", async () => {
  const x = setup(); const input = await x.openNotes(); fireEvent.change(input, { target: { value: " \n\t " } }); expect(x.sendButton()).toBeDisabled();
  const text = "汉".repeat(11000); fireEvent.change(input, { target: { value: text } }); expect(x.sendButton()).toBeDisabled();
  await screen.findByText(/exceeds 32,000 UTF-8 bytes/); fireEvent.click(screen.getByRole("button", { name: "Save whiteboard" })); await screen.findByText("Whiteboard saved.");
  expect(x.f.text).toBe(text); expect(input).toHaveValue(text); expect(x.sends()).toHaveLength(0);
});

it("stops after CAS if the configured identity changes, without switching recipients", async () => {
  const saveGate = deferred(), x = setup({ initialText: "Ready text", saveGate }); await x.openNotes(); fireEvent.click(x.sendButton());
  x.f.target = { id: "00000000-0000-4000-8000-000000000003", name: "Replacement", status: "idle" }; x.view.rerender(h(x.Host));
  await act(async () => saveGate.resolve()); await screen.findByText(/target changed or is unavailable/); expect(x.sends()).toHaveLength(0);
});

it("keeps unknown identity/request across closing and reopening and never automatically retries; only exact native receipt confirms", async () => {
  const sendGate = deferred(), x = setup({ initialText: "Current solution", sendGate }); await x.openNotes(); fireEvent.click(x.sendButton()); await waitFor(() => expect(x.sends()).toHaveLength(1));
  const requestId = (x.sends()[0][1] as { requestId: string }).requestId;
  await act(async () => sendGate.reject(Error("Lost connection"))); await screen.findByText(/Delivery is unconfirmed/); expect(x.sendButton()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close teaser board" })); fireEvent.click(screen.getByRole("button", { name: "Reopen board" })); const input = await x.openNotes();
  expect(input).toHaveValue("Current solution"); expect(x.sendButton()).toBeDisabled(); expect(x.puts()).toHaveLength(1); expect(x.sends()).toHaveLength(1);
  await act(async () => x.f.controller!.reconcile(targetId, "wrong-request")); expect(x.sendButton()).toBeDisabled();
  await act(async () => x.f.controller!.reconcile(targetId, requestId)); await screen.findByText("Solution delivery confirmed in chat.");
  expect(x.f.controller!.getAttempt(qid)!.requestId).toBe(requestId); expect(x.sends()).toHaveLength(1);
});

it("does not downgrade a matching native receipt when a late RPC failure arrives", async () => {
  const sendGate = deferred(), x = setup({ initialText: "Current solution", sendGate }); await x.openNotes(); fireEvent.click(x.sendButton()); await waitFor(() => expect(x.sends()).toHaveLength(1));
  const id = (x.sends()[0][1] as { requestId: string }).requestId;
  await act(async () => x.f.controller!.reconcile(targetId, id)); await act(async () => sendGate.reject(Error("Timeout")));
  await screen.findByText("Solution delivery confirmed in chat."); expect(x.f.controller!.getAttempt(qid)!.status).toBe("accepted"); expect(x.sends()).toHaveLength(1);
});

it("leaves both existing composer drafts untouched when sending externally", async () => {
  const x = setup({ drafts: true }); const target = within(screen.getByRole("region", { name: "Target composer" })).getByRole("textbox", { name: "Send to session" }); const other = within(screen.getByRole("region", { name: "Other composer" })).getByRole("textbox", { name: "Send to session" });
  await waitFor(() => expect(target).toBeEnabled());
  fireEvent.change(target, { target: { value: "@Reference" } }); fireEvent.click(await screen.findByRole("option", { name: /Reference worker/ }));
  const targetRegion = within(screen.getByRole("region", { name: "Target composer" }));
  fireEvent.change(targetRegion.getByLabelText("Choose attachments"), { target: { files: [new File(["fixture"], "keep.txt")] } });
  await waitFor(() => expect(targetRegion.getByRole("button", { name: "Send" })).toBeEnabled()); fireEvent.change(other, { target: { value: "Existing other draft" } });
  const input = await x.openNotes(); fireEvent.change(input, { target: { value: "Only whiteboard text" } }); fireEvent.click(x.sendButton()); await screen.findByText("Solution sent as additional input to the running task.");
  expect(target).toHaveValue("@Reference worker "); expect(other).toHaveValue("Existing other draft"); expect(targetRegion.getByLabelText("Remove attachment keep.txt")).toBeVisible();
  const payload = x.sends()[0][1] as { message: string; attachments: unknown[]; references: unknown[] }; expect(payload.message).not.toContain("Reference worker"); expect(payload.attachments).toEqual([]); expect(payload.references).toEqual([]);
  // Rich copy carries the stable reference ID after the external send.
  (target as HTMLTextAreaElement).setSelectionRange(0, 17); fireEvent.select(target);
  const values = new Map<string, string>(); fireEvent.copy(target, { clipboardData: { setData: (type: string, value: string) => values.set(type, value) } });
  expect(values.get("text/react-mentions")).toContain("reference-worker");
});

it("does not change an existing interrupted-turn edit or commit it when sending a whiteboard solution", async () => {
  const x = setup({ drafts: true, editing: true }), region = within(screen.getByRole("region", { name: "Target composer" }));
  const input = region.getByRole("textbox", { name: "Send to session" });
  fireEvent.click(await region.findByRole("button", { name: "Edit interrupted turn" })); await waitFor(() => expect(input).toHaveValue("Uncommitted edited input"));
  fireEvent.change(input, { target: { value: "My edited input remains here" } });
  const notes = await x.openNotes(); fireEvent.change(notes, { target: { value: "Whiteboard solution" } }); fireEvent.click(x.sendButton()); await screen.findByText("Solution sent as additional input to the running task.");
  expect(input).toHaveValue("My edited input remains here"); expect(region.getByRole("button", { name: "Confirm resend" })).toBeVisible(); expect(region.getByRole("button", { name: "Cancel edit" })).toBeVisible();
  expect(x.call.mock.calls.some(([method]) => method === "session.edit.commit")).toBe(false);
});
