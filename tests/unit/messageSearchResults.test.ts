import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageSearchResults, type MessageSearchGroup } from "@/features/office/components/MessageSearchResults";
import { setUiLanguage } from "@/lib/i18n/ui-language";
const group: MessageSearchGroup = { threadId: "old", name: "Old agent", archived: true, project: "Research", matches: [{ messageId: "t:a", itemId: "a", turnId: "t", turnCursor: "position", snippet: "Hello 丛林", snippetMatchRange: { start: 6, end: 8 } }], nextCursor: null };
const advance = () => act(async () => { vi.advanceTimersByTime(300); });
beforeEach(() => { setUiLanguage("en"); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("debounces typing, includes archive by default and opens the exact highlighted result", async () => {
  const call = vi.fn(async () => ({ groups: [group], nextCursor: null })), client = { call }, onOpenMessage = vi.fn();
  const props = { client, query: "", onOpenMessage }, view = render(createElement(MessageSearchResults, props));
  view.rerender(createElement(MessageSearchResults, { ...props, query: "丛" }));
  view.rerender(createElement(MessageSearchResults, { ...props, query: "丛林" })); expect(call).not.toHaveBeenCalled();
  await advance(); expect(call).toHaveBeenCalledExactlyOnceWith("session.search", { query: "丛林", includeArchived: true });
  expect(screen.getByText("Archived")).toBeVisible();
  const button = screen.getByRole("button", { name: "Hello 丛林" }); expect(within(button).getByText("丛林").tagName).toBe("MARK");
  fireEvent.click(button); expect(onOpenMessage).toHaveBeenCalledWith(expect.objectContaining({ threadId: "old", archived: true, itemId: "a", turnId: "t", turnCursor: "position", requestId: expect.any(String) }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Include archived conversations" })); await advance();
  expect(call).toHaveBeenLastCalledWith("session.search", { query: "丛林", includeArchived: false });
});
it("ignores late results after changing the query or archive setting", async () => {
  let finish!: (value: unknown) => void;
  const call = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ groups: [{ ...group, name: "New result" }], nextCursor: null });
  const client = { call }, onOpenMessage = vi.fn(), view = render(createElement(MessageSearchResults, { client, query: "first", onOpenMessage }));
  await advance(); view.rerender(createElement(MessageSearchResults, { client, query: "second", onOpenMessage })); await advance();
  expect(screen.getByText("New result")).toBeVisible();
  await act(async () => finish({ groups: [group], nextCursor: null })); expect(screen.queryByText("Old agent")).toBeNull();
});
it("pages occurrences within a session and merges global pages without duplicate messages", async () => {
  const next = { ...group.matches[0], messageId: "t:b", itemId: "b", snippet: "Second hit", snippetMatchRange: { start: 0, end: 6 } };
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { threadId?: string; cursor?: string };
    if (p.threadId) return { ...group, matches: [group.matches[0], next] };
    if (p.cursor) return { groups: [group, { ...group, threadId: "another", name: "Another", matches: [next] }], nextCursor: null };
    return { groups: [{ ...group, nextCursor: "more-hits" }], nextCursor: "more-sessions" };
  });
  render(createElement(MessageSearchResults, { client: { call }, query: "hello", onOpenMessage: vi.fn() })); await advance();
  fireEvent.click(screen.getByRole("button", { name: "More matches in Old agent" })); await act(async () => {});
  expect(screen.getAllByRole("button", { name: "Hello 丛林" })).toHaveLength(1); expect(screen.getByRole("button", { name: "Second hit" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "More conversations" })); await act(async () => {});
  expect(screen.getAllByText("Old agent")).toHaveLength(1); expect(screen.getByText("Another")).toBeVisible();
});
it("offers retry after a failed lookup without requiring a different query", async () => {
  const call = vi.fn().mockRejectedValueOnce(new Error("Could not search messages. Please retry.")).mockResolvedValue({ groups: [group], nextCursor: null });
  render(createElement(MessageSearchResults, { client: { call }, query: "hello", onOpenMessage: vi.fn() })); await advance();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not search messages");
  fireEvent.click(screen.getByRole("button", { name: "Retry" })); await advance(); expect(screen.getByText("Old agent")).toBeVisible();
});
it("rejects an old pagination response even after typing away and returning to the same query", async () => {
  let finish!: (value: unknown) => void;
  const call = vi.fn().mockResolvedValueOnce({ groups: [group], nextCursor: "next" })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ groups: [{ ...group, name: "Fresh result" }], nextCursor: null });
  const client = { call }, onOpenMessage = vi.fn(), view = render(createElement(MessageSearchResults, { client, query: "first", onOpenMessage }));
  await advance(); fireEvent.click(screen.getByRole("button", { name: "More conversations" }));
  view.rerender(createElement(MessageSearchResults, { client, query: "second", onOpenMessage })); await advance();
  view.rerender(createElement(MessageSearchResults, { client, query: "first", onOpenMessage })); await advance();
  await act(async () => finish({ groups: [{ ...group, threadId: "ghost", name: "Ghost old page" }], nextCursor: null }));
  expect(screen.getByText("Fresh result")).toBeVisible(); expect(screen.queryByText("Ghost old page")).toBeNull();
});
