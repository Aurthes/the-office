import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionMessageLocation } from "@/features/office/components/SessionMessageLocation";
import { ExistingSessionPanel } from "@/features/office/components/ExistingSessionPanel";
import type { MessageSearchTarget } from "@/features/office/components/MessageSearchResults";
const target: MessageSearchTarget = { requestId: "request", threadId: "session", name: "Researcher", project: "Research", archived: true, itemId: "a", turnId: "past", turnCursor: "past-position", messageId: "past:a", snippet: "A past answer", snippetMatchRange: { start: 2, end: 6 } };
const context = { threadId: "session", name: "Researcher", project: "Research", archived: true, messageId: "past:a", messages: [{ id: "past:u", turnId: "past", role: "user", content: "A past question" }, { id: "past:a", turnId: "past", role: "assistant", phase: "final_answer", content: "A past answer" }], olderOffset: null, newerOffset: null };
afterEach(cleanup);

it("opens a reply's exact question while preserving the current chat and scroll", async () => {
  const source = { threadId: "archived-parent", turnId: "origin", itemId: "question", excerpt: "What is the department responsible for?" };
  const call = vi.fn(async (method: string) => {
    if (method === "session.inspect") return { id: "head", name: "Office Head", project: "Office", workspace: "/repo" };
    if (method === "session.messageContext") return { threadId: "archived-parent", name: "CEO", project: "Open Workspace", archived: true, messageId: "origin:question", messages: [{ id: "origin:question", turnId: "origin", role: "user", content: "Full original question and constraints" }], olderOffset: null, newerOffset: null };
    return { threadId: "head", nextCursor: null, messages: [{ id: "answer", role: "assistant", content: "Department answer", replyContext: { taskTitle: "Departments", sources: [source] } }] };
  });
  render(createElement(ExistingSessionPanel, { client: { call }, threadId: "head" }));
  const quote = await screen.findByRole("button", { name: "Original message" });
  const history = screen.getByLabelText("Session history"); history.scrollTop = 123;
  fireEvent.click(quote);
  const viewer = await screen.findByRole("region", { name: "Message location" });
  expect(await within(viewer).findByText("Full original question and constraints")).toBeVisible();
  expect(history.closest("[inert]")).not.toBeNull();
  expect(call).toHaveBeenCalledWith("session.messageContext", expect.objectContaining({ ...source, messageId: "origin:question" }));
  expect((call.mock.calls.find(([method]) => method === "session.messageContext") as unknown[])[1]).not.toHaveProperty("turnCursor");
  fireEvent.click(within(viewer).getByRole("button", { name: "Back to conversation" }));
  expect(screen.getByLabelText("Session history")).toBe(history);
  expect(history.scrollTop).toBe(123);
  expect(screen.getByText("Department answer")).toBeVisible();
  expect(call.mock.calls.every(([method]) => !["session.send", "session.attach", "session.archive"].includes(method))).toBe(true);
});
it("opens and focuses an archived message with context without attaching or starting any agent", async () => {
  const call = vi.fn(async () => context), onClose = vi.fn();
  const view = render(createElement(SessionMessageLocation, { client: { call }, target, onClose }));
  const message = await screen.findByRole("article", { name: "Codex" });
  expect(message).toHaveAttribute("data-search-match", "true"); expect(message).toHaveAttribute("data-message-id", "past:a"); expect(message).toHaveFocus();
  expect(screen.getByText(/Archived · Read only/)).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull(); expect(view.container.querySelector("[aria-label='Terminal input']")).toBeNull();
  expect(call).toHaveBeenCalledExactlyOnceWith("session.messageContext", target);
  fireEvent.click(screen.getByRole("button", { name: "Back to conversation" })); expect(onClose).toHaveBeenCalledOnce();
});
it("does not let an old location response overwrite a newly selected message", async () => {
  let finish!: (value: unknown) => void;
  const call = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ...context, messageId: "past:b", messages: [{ ...context.messages[1], id: "past:b", content: "New selected answer" }] });
  const client = { call }, onClose = vi.fn(), view = render(createElement(SessionMessageLocation, { client, target, onClose }));
  view.rerender(createElement(SessionMessageLocation, { client, target: { ...target, requestId: "next", itemId: "b", messageId: "past:b", snippet: "New selected answer" }, onClose }));
  await screen.findByRole("article", { name: "Codex" });
  await act(async () => finish(context));
  expect(screen.getByRole("article", { name: "Codex" })).toHaveTextContent("New selected answer"); expect(screen.queryByText("A past question")).toBeNull();
});
it("loads earlier and later context around a match without duplicate messages", async () => {
  const call = vi.fn(async (_method: string, params: unknown) => {
    const p = params as { offset?: number };
    if (p.offset === 0) return { ...context, messages: [{ id: "past:earlier", role: "user", content: "Earlier context" }, ...context.messages], newerOffset: 40 };
    if (p.offset === 40) return { ...context, messages: [{ id: "past:later", role: "assistant", content: "Later context" }] };
    return { ...context, olderOffset: 0, newerOffset: 40 };
  });
  render(createElement(SessionMessageLocation, { client: { call }, target, onClose: vi.fn() }));
  fireEvent.click(await screen.findByRole("button", { name: "Load earlier context" })); await screen.findByText("Earlier context");
  expect(screen.getAllByRole("article", { name: "Codex" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Load later context" })); await screen.findByText("Later context");
  expect(screen.getAllByRole("article").map(article => article.textContent)).toEqual(["Earlier context", "A past question", "CodexQuestion not identifiedA past answer", "CodexQuestion not identifiedLater context"]);
});
it("preserves the live history DOM, loaded older pages and scroll while viewing a historical match", async () => {
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { cursor?: string };
    if (method === "session.inspect") return { id: "session", name: "Researcher", project: "Research", workspace: "/repo", controlsAvailable: true };
    if (method === "session.messageContext") return { ...context, archived: false };
    if (method === "session.history") return { threadId: "session", nextCursor: p.cursor ? "oldest" : "older", messages: [{ id: p.cursor ? "older-page" : "latest", role: "assistant", content: p.cursor ? "Already loaded history" : "Live latest message" }] };
    return { connected: true, version: 1, activeTurnId: null, items: [], approvals: [], features: { prediction: false, voice: false, dictation: false } };
  });
  const client = { call }, props = { client, threadId: "session", onCloseMessage: vi.fn() }, view = render(createElement(ExistingSessionPanel, props));
  await screen.findByText("Live latest message");
  const history = screen.getByLabelText("Session history"); Object.defineProperty(history, "scrollHeight", { value: 1000 }); Object.defineProperty(history, "clientHeight", { value: 400 });
  fireEvent.click(screen.getByRole("button", { name: /Load older messages/ })); await screen.findByText("Already loaded history");
  history.scrollTop = 300; fireEvent.scroll(history);
  const input = screen.getByRole("textbox", { name: "Send to session" });
  view.rerender(createElement(ExistingSessionPanel, { ...props, messageTarget: { ...target, archived: false } }));
  await screen.findByRole("region", { name: "Message location" });
  expect(history).toBeInTheDocument(); expect(history.closest("[inert]")).not.toBeNull(); expect(input).toBeDisabled();
  expect(within(screen.getByRole("region", { name: "Message location" })).getByRole("article", { name: "Codex" })).toHaveAttribute("data-search-match", "true");
  view.rerender(createElement(ExistingSessionPanel, props));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Send to session" })).toBeEnabled());
  expect(screen.getByLabelText("Session history")).toBe(history); expect(history.scrollTop).toBe(300);
  expect(screen.getByText("Already loaded history")).toBeVisible(); expect(screen.getByText("Live latest message")).toBeVisible();
});
