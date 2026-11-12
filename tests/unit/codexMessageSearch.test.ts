import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
const { CodexMessageSearch } = createRequire(import.meta.url)("../../server/codex-message-search.js");
const hit = (id = "message") => ({ itemId: id, turnId: "turn", turnCursor: "native-position", snippet: "Hello 丛林", snippetMatchRange: { start: 6, end: 8 } });
function fixture() {
  const rows = [
    { id: "current", name: "Current", projectId: "p", codexThreadId: "native-current" },
    { id: "archived", name: "Old", archived: true, codexThreadId: "native-old" },
    { id: "title", name: "Title only", codexThreadId: "native-title" },
    { id: "empty", name: "Empty" },
  ];
  const call = vi.fn(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (method === "thread/search") return { data: params.archived ? [{ thread: { id: "native-old", updatedAt: 1 } }] : ["native-current", "not-an-office-thread", "native-title"].map(id => ({ thread: { id, updatedAt: 2 } })), nextCursor: null };
    if (method === "thread/searchOccurrences") return { data: params.threadId === "native-title" ? [] : [hit()], nextCursor: null };
    return { data: [{ id: "turn", items: [{ id: "message", type: "agentMessage", phase: "final_answer", text: "Answer 丛林" }] }] };
  });
  const store = { data: { sessions: rows }, client: { call }, projects: () => [{ id: "p", name: "Project" }] };
  return { search: new CodexMessageSearch(store), call, store };
}

it("finds active and archived messages through public search while excluding other threads and title-only matches", async () => {
  const { search, call } = fixture();
  const result = await search.search({ query: " 丛林 " });
  expect(result.groups.map((group: { threadId: string }) => group.threadId)).toEqual(["current", "archived"]);
  expect(result.groups[1]).toMatchObject({ name: "Old", archived: true, matches: [{ messageId: "turn:message" }] });
  expect(result.groups[0]).toMatchObject({ project: "Project", archived: false });
  expect(call.mock.calls.filter(([method]) => method === "thread/search").map(([, p]) => p.archived)).toEqual([false, true]);
  expect(call).toHaveBeenCalledWith("thread/search", expect.objectContaining({ searchTerm: "丛林", sourceKinds: expect.arrayContaining(["vscode"]) }));
  expect(call.mock.calls.some(([, p]) => p.threadId === "not-an-office-thread")).toBe(false);
  expect(call.mock.calls.every(([method]) => ["thread/search", "thread/searchOccurrences"].includes(method))).toBe(true);
});
it("can exclude archive reads entirely and continue a per-session occurrence page", async () => {
  const { search, call } = fixture();
  await search.search({ query: "hello", includeArchived: false });
  expect(call.mock.calls.filter(([method]) => method === "thread/search")).toHaveLength(1);
  expect(call.mock.calls.some(([, p]) => p.threadId === "native-old")).toBe(false);
  call.mockClear();
  expect(await search.search({ query: "hello", threadId: "archived", cursor: "next-hit" })).toMatchObject({ archived: true });
  expect(call).toHaveBeenCalledExactlyOnceWith("thread/searchOccurrences", { threadId: "native-old", searchTerm: "hello", cursor: "next-hit", limit: 20 });
});
it("retains independent native cursors and does not reread an exhausted archive page", async () => {
  const { search, call } = fixture();
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (method, params) => method === "thread/search" && !params.archived ? { data: [{ thread: { id: "native-current", updatedAt: 1 } }], nextCursor: params.cursor ? null : "active-next" } : original(method, params));
  const first = await search.search({ query: "hello" }); call.mockClear();
  const second = await search.search({ query: "hello", cursor: first.nextCursor });
  expect(second.nextCursor).toBeNull();
  expect(call.mock.calls.filter(([method]) => method === "thread/search")).toEqual([["thread/search", expect.objectContaining({ cursor: "active-next", archived: false })]]);
  call.mockClear();
  await expect(search.search({ query: "different", cursor: first.nextCursor })).rejects.toThrow("Invalid search cursor");
  expect(call).not.toHaveBeenCalled();
});
it("limits per-message lookup concurrency without resuming any session", async () => {
  const { search, call, store } = fixture();
  store.data.sessions = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: String(index), codexThreadId: `n-${index}` }));
  let concurrent = 0, peak = 0;
  call.mockImplementation(async (method, params) => {
    if (method === "thread/search") return { data: params.archived ? [] : store.data.sessions.map(row => ({ thread: { id: row.codexThreadId, updatedAt: 1 } })) };
    concurrent++; peak = Math.max(peak, concurrent); await new Promise(resolve => setTimeout(resolve, 1)); concurrent--;
    return { data: [hit()] };
  });
  expect((await search.search({ query: "hello" })).groups).toHaveLength(12); expect(peak).toBe(2);
});
it("reads an archived hit by its inclusive turn cursor without unarchiving, resuming or running a turn", async () => {
  const { search, call } = fixture();
  const result = await search.context({ threadId: "archived", ...hit() });
  expect(result).toMatchObject({ archived: true, messageId: "turn:message", messages: [{ id: "turn:message", content: "Answer 丛林" }] });
  expect(call).toHaveBeenCalledExactlyOnceWith("thread/turns/list", { threadId: "native-old", cursor: "native-position", limit: 1, sortDirection: "desc", itemsView: "summary" });
});
it("pages a long turn around the match and bounds text without cutting Unicode code points", async () => {
  const { search, call } = fixture();
  call.mockResolvedValue({ data: [{ id: "turn", items: Array.from({ length: 120 }, (_, index) => ({ type: "agentMessage", id: String(index), text: "汉🙂".repeat(10000) })) }] });
  const target = { threadId: "current", turnId: "turn", itemId: "50", turnCursor: "position" };
  const result = await search.context(target);
  expect(result).toMatchObject({ olderOffset: 0, newerOffset: 70 });
  expect(result.messages).toHaveLength(40); expect(result.messages[0].id).toBe("turn:30");
  expect(result.messages.some((item: { id: string }) => item.id === "turn:50")).toBe(true);
  expect(result.messages.reduce((size: number, item: { content: string }) => size + Buffer.byteLength(item.content), 0)).toBeLessThanOrEqual(128 * 1024);
  expect(result.messages.some((item: { content: string }) => item.content.includes("�"))).toBe(false);
  expect((await search.context({ ...target, offset: 70 })).messages[0].id).toBe("turn:70");
});
it("rejects invalid inputs, foreign or missing sessions and stale positions before presenting a wrong message", async () => {
  const { search, call } = fixture();
  for (const query of ["", " ", "a".repeat(1001), 123]) await expect(search.search({ query })).rejects.toThrow("Invalid search text");
  for (const threadId of ["foreign", "empty"]) await expect(search.search({ query: "hello", threadId })).rejects.toThrow("no longer available");
  expect(call).not.toHaveBeenCalled();
  call.mockResolvedValue({ data: [{ id: "wrong-turn", items: [] }] });
  await expect(search.context({ threadId: "current", ...hit() })).rejects.toThrow("no longer available");
});

it("opens an exact original question in an archived chat without searching or loading a whole turn", async () => {
  const { search, call } = fixture();
  call.mockResolvedValue({ data: [{ turnId: "original-turn", item: { id: "question", type: "userMessage", content: [{ type: "text", text: "Full original question" }] }, startedAtMs: 1000 }] });
  const result = await search.context({ threadId: "archived", turnId: "original-turn", itemId: "question" });
  expect(call).toHaveBeenCalledExactlyOnceWith("thread/items/read", { threadId: "native-old", turnId: "original-turn", itemIds: ["question"] });
  expect(result).toMatchObject({ archived: true, messageId: "original-turn:question", messages: [{ role: "user", content: "Full original question", timestamp: 1000 }], olderOffset: null, newerOffset: null });
  call.mockResolvedValue({ data: [{ turnId: "wrong-turn", item: { id: "question", type: "userMessage", content: [{ type: "text", text: "Wrong question" }] } }] });
  await expect(search.context({ threadId: "archived", turnId: "original-turn", itemId: "question" })).rejects.toThrow("no longer available");
});

it("reads an exact ordinary assistant output without exposing reasoning or tool items", async () => {
 const {search,call}=fixture();
 call.mockResolvedValue({data:[{turnId:"turn",item:{id:"ordinary",type:"agentMessage",text:"plain assistant output",phase:"commentary"}}]});
 const result=await search.context({threadId:"current",turnId:"turn",itemId:"ordinary"});expect(result.messages).toMatchObject([{id:"turn:ordinary",role:"assistant",content:"plain assistant output"}]);
 for(const type of ["reasoning","commandExecution","plan"]){call.mockResolvedValue({data:[{turnId:"turn",item:{id:"ordinary",type,text:"PRIVATE",summary:["PRIVATE"],command:"PRIVATE"}}]});await expect(search.context({threadId:"current",turnId:"turn",itemId:"ordinary"})).rejects.toThrow("no longer available")}
});
