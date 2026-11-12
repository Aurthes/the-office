import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExistingSessionPanel } from "../../src/features/office/components/ExistingSessionPanel";

const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const metadata = (id = "original") => ({ id, name: `Name ${id}`, workspace: "/repo", project: "Project", status: "idle" });
const page = (text: string, nextCursor: string | null, threadId = "original") => ({ threadId, nextCursor, messages: [{ id: text, content: text, role: "assistant" }] });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function sessionEvents() {
  // Match the real client: account, roster and transcript observers coexist.
  const handlers = new Set<(event: { event: string; payload?: unknown }) => void>();
  return {
    emit: (event: { event: string; payload?: unknown }) => { handlers.forEach(handler => handler(event)); },
    onEvent: (handler: (event: { event: string; payload?: unknown }) => void) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
  };
}

it("offers Fork agent through the cloning scene without archiving or sending to the source",async()=>{
  const call=vi.fn(async(method:string)=>method==="session.inspect"?{...metadata(),controlsAvailable:true}:page("History",null));
  const onFork=vi.fn(),view=render(React.createElement(ExistingSessionPanel,{client:{call},threadId:"original",onFork}));
  const button=await screen.findByRole("button",{name:"Fork agent"});await waitFor(()=>expect(button).toBeEnabled());
  fireEvent.click(button);expect(onFork).toHaveBeenCalledOnce();
  expect(call.mock.calls.some(([method])=>["session.fork","session.send","session.archive"].includes(method))).toBe(false);
  view.rerender(React.createElement(ExistingSessionPanel,{client:{call},threadId:"original",onFork,forkDisabled:true}));
  expect(screen.getByRole("button",{name:"Fork agent"})).toBeDisabled();
});

it("passes the chosen historical turn from a reply into the shared cloning workflow",async()=>{
  const messages=[{id:"a",turnId:"turn-a",role:"assistant",phase:"final_answer",content:"Earlier reply"},{id:"b",turnId:"turn-b",role:"assistant",phase:"final_answer",content:"Later reply"}];
  const call=vi.fn(async(method:string)=>method==="session.inspect"?{...metadata(),controlsAvailable:true}:{threadId:"original",messages,nextCursor:null});
  const onFork=vi.fn();render(React.createElement(ExistingSessionPanel,{client:{call},threadId:"original",onFork}));
  const buttons=await screen.findAllByRole("button",{name:"Fork from here"});fireEvent.click(buttons[0]);
  expect(onFork).toHaveBeenCalledWith(undefined,"turn-a");expect(call.mock.calls.some(([method])=>method==="session.fork")).toBe(false);
});

it("uses live turn state to open work and folds it as the official response begins", async () => {
  const events = sessionEvents();
  let subscriptionId = "";
  const messages = [
    { id: "c", turnId: "working", role: "assistant", phase: "commentary", content: "Live progress update" },
    { id: "tool", turnId: "working", role: "tool", content: "command\nTOOL_RESULT" },
  ];
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.inspect") return { ...metadata(), controlsAvailable: true };
    if (method === "session.history") return { threadId: "original", messages, nextCursor: null };
    if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
    return {};
  });
  const client = { call, onEvent: events.onEvent };
  render(React.createElement(ExistingSessionPanel, { client, threadId: "original" }));
  await waitFor(() => expect(subscriptionId).not.toBe(""));
  const push = async (version: number, items: unknown[]) => act(async () => {
    const event = { event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: "working", approvals: [], items, features: { dictation: false, voice: false, prediction: false } } };
    events.emit(event);
  });
  await push(1, []);
  await screen.findByText("Live progress update");
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(true);
  expect(screen.queryByText("TOOL_RESULT")).toBeNull();
  const final = { id: "f", turnId: "working", role: "assistant", phase: "final_answer", content: "" };
  await push(2, [final]);
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(false);
  expect(screen.queryByText("Live progress update")).toBeNull();
  await push(3, [{ ...final, content: "The official response" }]);
  expect(screen.getByText("The official response")).toBeVisible();
});

it("keeps streamed work below the steer message in the same turn and preserves that order after reload", async () => {
  const events = sessionEvents(); let subscriptionId = "";
  let messages = [
    { id: "before", turnId: "working", role: "assistant", phase: "commentary", content: "Before steering" },
    { id: "call", turnId: "working", role: "tool", content: "Original call" },
  ];
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "session.inspect") return { ...metadata(), controlsAvailable: true };
    if (method === "session.history") return { threadId: "original", messages, nextCursor: null };
    if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
    return {};
  });
  const props = { client: { call, onEvent: events.onEvent }, threadId: "original" };
  const push = (version: number, items: unknown[]) => act(async () => events.emit({ event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: "working", approvals: [], items, features: { dictation: false, voice: false, prediction: false } } }));
  const view = render(React.createElement(ExistingSessionPanel, props));
  await waitFor(() => expect(subscriptionId).not.toBe("")); await push(0, []);
  await screen.findByText("Before steering");
  const steered = [
    { id: "steer", turnId: "working", role: "user", content: "Use the mobile layout" },
    { id: "after", turnId: "working", role: "assistant", phase: "commentary", content: "After steering" },
    { id: "call-2", turnId: "working", role: "tool", content: "Mobile check" },
  ];
  await push(1, steered);
  const assertOrder = () => {
    const groups = screen.getAllByLabelText("Work process") as HTMLDetailsElement[];
    expect(groups.map(group => group.open)).toEqual([false, true]);
    expect(screen.getByText("Use the mobile layout").closest("article")?.nextElementSibling).toBe(groups[1]);
    expect(screen.getByText("After steering").closest("details")).toBe(groups[1]);
  };
  assertOrder();
  messages = [...messages, ...steered]; view.unmount(); subscriptionId = "";
  render(React.createElement(ExistingSessionPanel, props));
  await waitFor(() => expect(subscriptionId).not.toBe("")); await push(0, []);
  await screen.findByText("After steering"); assertOrder();
});

describe("existing session history pagination", () => {
  it("keeps a received steer and its work in place when resubscription reads history before it is persisted", async () => {
    const events = sessionEvents(); let subscriptionId = "";
    const original = { id: "original", turnId: "t", role: "user", content: "Original request" };
    const steer = { id: "steer", turnId: "t", role: "user", content: "Visible steer request", status: "completed" };
    const work = { id: "work", turnId: "t", role: "assistant", phase: "commentary", content: "Work after steer" };
    let persisted = [original];
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === "session.inspect") return { ...metadata(), controlsAvailable: true };
      if (method === "session.history") return { threadId: "original", messages: persisted, nextCursor: null };
      if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
      return {};
    });
    render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId: "original" }));
    await screen.findByText("Original request");
    const push = (version: number, items: unknown[]) => act(async () => events.emit({ event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: "t", approvals: [], items, features: { prediction: false, voice: false, dictation: false } } }));
    await push(0, []); await push(1, [steer, work]); await screen.findByText("Visible steer request");
    await act(async () => fireEvent(document, new Event("visibilitychange")));
    await push(1, [steer, work]);
    await waitFor(() => expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(2));
    expect(screen.getByText("Visible steer request")).toBeVisible();
    expect(screen.getByText("Work after steer")).toBeVisible();
    expect(screen.getByText("Visible steer request").closest("article")?.nextElementSibling).toHaveAttribute("aria-label", "Work process");
    const bubble = screen.getByText("Visible steer request").closest("article");
    persisted = [original, steer, work];
    await act(async () => fireEvent(document, new Event("visibilitychange"))); await push(1, [steer, work]);
    await waitFor(() => expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(3));
    expect(screen.getAllByText("Visible steer request")).toHaveLength(1);
    expect(screen.getByText("Visible steer request").closest("article")).toBe(bubble);
  });

  it.each([true, false])("reconciles accepted steer from history without an item notification; success=%s", async success => {
    const events = sessionEvents(); let subscriptionId = ""; const threadId = `steer-ack-${success}`;
    const messages: { id: string; turnId: string; role: string; content: string; clientId?: string }[] = [{ id: "original", turnId: "t", role: "user", content: "Initial prompt" }];
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === "session.inspect") return { ...metadata(threadId), controlsAvailable: true };
      if (method === "session.history") return { threadId, messages: [...messages], nextCursor: null };
      if (method === "session.subscribe") subscriptionId = (params as { subscriptionId: string }).subscriptionId;
      if (method === "session.send") {
        if (!success) throw new Error("Send outcome uncertain");
        messages.push({ id: "native-steer-id", clientId: (params as { requestId: string }).requestId, turnId: "t", role: "user", content: "My steered prompt" });
        return { status: "steered", turnId: "t" };
      }
      return {};
    });
    render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId }));
    await screen.findByText("Initial prompt");
    await act(async () => events.emit({ event: "session.stream", payload: { connected: true, version: 0, threadId, subscriptionId, activeTurnId: "t", approvals: [], items: [], features: { prediction: false, voice: false, dictation: false } } }));
    const input = screen.getByRole("textbox", { name: "Send to session" });
    fireEvent.change(input, { target: { value: "My steered prompt" } }); fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    if (success) { await screen.findByText("My steered prompt"); expect(input).toHaveValue(""); }
    else { await screen.findByText(/Delivery not confirmed/); expect(input).toHaveValue("My steered prompt"); expect(screen.getByText("My steered prompt", { selector: "p" })).toBeInTheDocument(); }
    expect(call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(1);
    expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(2);
  });

  it("exposes return-to-Earth for an interactive original session and disables it while busy", async () => {
    const call=vi.fn(async(method:string)=>method==="session.inspect"?{...metadata(),controlsAvailable:true}:method==="session.history"?page("latest",null):{connected:true,version:1,activeTurnId:null,items:[],approvals:[]});
    const onReturnToEarth=vi.fn(), client={call};
    const view=render(React.createElement(ExistingSessionPanel,{client,threadId:"original",onReturnToEarth}));
    await screen.findByRole("heading",{name:"Name original"});
    fireEvent.click(screen.getByRole("button",{name:/Return to Earth/}));expect(onReturnToEarth).toHaveBeenCalledTimes(1);
    view.rerender(React.createElement(ExistingSessionPanel,{client,threadId:"original",onReturnToEarth,returnDisabled:true}));
    expect((screen.getByRole("button",{name:/Return to Earth/}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:/Return to Earth/}));expect(onReturnToEarth).toHaveBeenCalledTimes(1);
  });
  it("does not append old bootstrap cache after the latest page, and catches up from canonical history", async () => {
    const second = deferred(); const events = sessionEvents(); let subscriptionId = "", reads = 0;
    const latest = { threadId: "original", nextCursor: "older", messages: [{ id: "apk", role: "assistant", content: "APK download is ready" }] };
    const call = vi.fn((method: string, params: unknown) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.subscribe") { subscriptionId = (params as { subscriptionId: string }).subscriptionId; return Promise.resolve({}); }
      if (method === "session.history") return ++reads === 1 ? Promise.resolve(latest) : second.promise;
      return Promise.resolve({});
    });
    render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId: "original" }));
    await screen.findByText("APK download is ready");
    await act(async () => events.emit({ event: "session.stream", payload: { connected: true, version: 10, threadId: "original", subscriptionId, activeTurnId: null, items: [
      { id: "old", role: "assistant", content: "Old wrapper discussion", status: "completed" },
      { id: "start", role: "user", content: "Build it", status: "completed" },
      { ...latest.messages[0], status: "completed" },
    ], approvals: [] } }));
    expect(screen.getByText("APK download is ready")).toBeTruthy();
    expect(screen.queryByText("Old wrapper discussion")).toBeNull();
    expect(screen.queryByText("Build it")).toBeNull();
    expect(reads).toBe(2);
    await act(async () => second.resolve(latest));
    expect(screen.getAllByRole("article").at(-1)?.textContent).toContain("APK download is ready");
  });
  it("keeps genuinely new live messages while canonical history is still loading", async () => {
    const history = deferred(); const events = sessionEvents(); let subscriptionId = "";
    const call = vi.fn((method: string, params: unknown) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.subscribe") { subscriptionId = (params as { subscriptionId: string }).subscriptionId; return Promise.resolve({}); }
      return history.promise;
    });
    render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId: "original" }));
    await screen.findByRole("heading", { name: "Name original" });
    const push = (version: number, items: unknown[]) => events.emit({ event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: null, approvals: [], items } });
    await act(async () => push(1, []));
    await act(async () => push(2, [{ id: "live", role: "assistant", content: "live reply" }]));
    await screen.findByText("live reply");
    await act(async () => history.resolve(page("earlier reply", null)));
    expect(screen.getByText("live reply")).toBeTruthy();
    expect(screen.getByText("earlier reply")).toBeTruthy();
  });
  it("keeps an existing live message that completes during history catch-up", async () => {
    const catchUp = deferred(); const events = sessionEvents(); let subscriptionId = "", reads = 0;
    const call = vi.fn((method: string, params: unknown) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.subscribe") { subscriptionId = (params as { subscriptionId: string }).subscriptionId; return Promise.resolve({}); }
      if (method === "session.history") return ++reads === 1 ? Promise.resolve(page("earlier reply", null)) : catchUp.promise;
      return Promise.resolve({});
    });
    render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId: "original" }));
    await screen.findByText("earlier reply");
    const push = (version: number, items: unknown[]) => events.emit({ event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: null, approvals: [], items } });
    const draft = { id: "live", role: "assistant", content: "draft reply", status: "inProgress" };
    const older = { id: "old", role: "assistant", content: "older live reply", status: "completed" };
    await act(async () => push(0, []));
    await act(async () => push(1, [older, draft]));
    await screen.findByText("draft reply");
    const previousSubscription = subscriptionId;
    await act(async () => fireEvent(document, new Event("visibilitychange")));
    expect(subscriptionId).not.toBe(previousSubscription);
    await act(async () => push(2, [older, draft]));
    expect(reads).toBe(2);
    await act(async () => push(3, [{ ...draft, content: "final reply", status: "completed" }]));
    expect(screen.getByText("final reply")).toBeTruthy();
    // The read started before this reply was persisted, so its page lacks the ID.
    await act(async () => catchUp.resolve(page("earlier reply", null)));
    expect(screen.getAllByText("final reply")).toHaveLength(1);
    expect(screen.getAllByRole("article").at(-1)?.textContent).toContain("final reply");
    expect(screen.queryByText("draft reply")).toBeNull();
    // An older persisted page cannot revoke a genuinely received live item.
    expect(screen.getByText("older live reply")).toBeVisible();
  });
  it("shows metadata before history finishes and never polls metadata or history", async () => {
    const first = deferred();
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : first.promise);
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByRole("heading", { name: "Name original" });
    expect(call).toHaveBeenCalledWith("session.inspect", { threadId: "original", includeHistory: false });
    expect(screen.getByRole("status").textContent).toContain("Loading messages");
    await act(async () => first.resolve(page("latest", "older")));
    expect(screen.getByText("latest")).toBeTruthy();
    vi.useFakeTimers();
    // Re-mount under fake timers to prove no background polling is scheduled.
    cleanup(); call.mockClear();
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(15000));
    expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(1);
    expect(call.mock.calls.filter(([method]) => method === "session.inspect")).toHaveLength(1);
  });
  it("recovers once after reconnect, queues catch-up behind an in-flight page and never overlaps chunks", async () => {
    const initial = deferred(); let status!: (value: "connected" | "disconnected") => void, reads = 0;
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : ++reads === 1 ? initial.promise : Promise.resolve(page("caught up", null)));
    const client = { call, onStatus: (handler: typeof status) => { status = handler; handler("connected"); return () => {}; } };
    render(React.createElement(ExistingSessionPanel, { client, threadId: "original" }));
    await act(async () => {}); expect(reads).toBe(1);
    await act(async () => status("disconnected")); await act(async () => status("connected")); expect(reads).toBe(1);
    await act(async () => initial.resolve(page("before reconnect", null)));
    await screen.findByText("caught up"); expect(reads).toBe(2);
    expect(call.mock.calls.filter(([method]) => method === "session.inspect")).toHaveLength(2);
  });
  it("keeps a shorter authoritative live completion when stale history finishes later", async () => {
    const history = deferred(); const events = sessionEvents(); let subscriptionId = "";
    const call = vi.fn((method: string, params: unknown) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.subscribe") { subscriptionId = (params as { subscriptionId: string }).subscriptionId; return Promise.resolve({}); }
      return history.promise;
    });
    render(React.createElement(ExistingSessionPanel, { client: { call, onEvent: events.onEvent }, threadId: "original" }));
    await screen.findByRole("heading", { name: "Name original" });
    const push = (version: number, items: unknown[]) => events.emit({ event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: null, approvals: [], items } });
    await act(async () => push(0, []));
    await act(async () => push(1, [{ id: "m", role: "assistant", status: "completed", content: "final" }]));
    await screen.findByText("final");
    await act(async () => history.resolve({ threadId: "original", nextCursor: null, messages: [{ id: "m", role: "assistant", content: "older longer intermediate text" }] }));
    expect(screen.getByText("final")).toBeTruthy();expect(screen.queryByText("older longer intermediate text")).toBeNull();
  });
  it("loads one older chunk on upward scroll, blocks overlapping requests, and preserves the viewport when prepending", async () => {
    const older = deferred(); let pages = 0;
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : ++pages === 1 ? Promise.resolve(page("latest", "older")) : older.promise);
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByText("latest");
    const scroller = screen.getByLabelText("Session history"); let height = 1000;
    Object.defineProperty(scroller, "scrollHeight", { get: () => height });
    Object.defineProperty(scroller, "clientHeight", { value: 400 });
    fireEvent.wheel(scroller, { deltaY: -100 });
    fireEvent.wheel(scroller, { deltaY: -100 });
    expect(pages).toBe(2);
    height = 1300;
    await act(async () => older.resolve(page("previous", null)));
    expect(scroller.scrollTop).toBe(300);
    expect(screen.getByText("previous").compareDocumentPosition(screen.getByText("latest")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(call).toHaveBeenLastCalledWith("session.history", { threadId: "original", cursor: "older" });
  });
  it("offers a jump back to latest while reading history and resumes following without another history read", async () => {
    const events = sessionEvents(); let subscriptionId = "", height = 1400;
    const call = vi.fn((method: string, params: unknown) => {
      if (method === "session.inspect") return Promise.resolve({ ...metadata(), controlsAvailable: true });
      if (method === "session.subscribe") { subscriptionId = (params as { subscriptionId: string }).subscriptionId; return Promise.resolve({ subscribed: true }); }
      return Promise.resolve(page("latest", null));
    });
    const client = { call, onEvent: events.onEvent };
    render(React.createElement(ExistingSessionPanel, { client, threadId: "original" }));
    await screen.findByText("latest");
    await act(async () => events.emit({ event: "session.stream", payload: { connected: true, version: 0, threadId: "original", subscriptionId, activeTurnId: null, approvals: [], items: [] } }));
    const scroller = screen.getByLabelText("Session history");
    Object.defineProperty(scroller, "scrollHeight", { get: () => height });Object.defineProperty(scroller, "clientHeight", { value: 400 });
    scroller.scrollTop = 400;fireEvent.scroll(scroller);
    const push = (version: number) => events.emit({ event: "session.stream", payload: { connected: true, version, threadId: "original", subscriptionId, activeTurnId: null, approvals: [], items: [{ id: "live", content: `live ${version}`, role: "assistant", phase: "final_answer", status: "inProgress" }] } });
    await act(async () => push(1));expect(scroller.scrollTop).toBe(400);
    expect(screen.getByRole("button", { name: "Go to latest message" })).toBeTruthy();
    const reads = call.mock.calls.filter(([method]) => method === "session.history").length;
    fireEvent.click(screen.getByRole("button", { name: "Go to latest message" }));
    expect(scroller.scrollTop).toBe(1000);expect(screen.queryByRole("button", { name: "Go to latest message" })).toBeNull();
    height = 1600;await act(async () => push(2));expect(scroller.scrollTop).toBe(1200);
    expect(call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(reads);
  });
  it("ignores a previous session's late history response", async () => {
    const late = deferred(); const call = vi.fn((method: string, p: unknown) => {
      const { threadId } = p as { threadId: string };
      return method === "session.inspect" ? Promise.resolve(metadata(threadId)) : threadId === "original" ? late.promise : Promise.resolve(page("new session", null, threadId));
    });
    const client = { call };
    const view = render(React.createElement(ExistingSessionPanel, { client, threadId: "original" }));
    view.rerender(React.createElement(ExistingSessionPanel, { client, threadId: "other" }));
    await screen.findByText("new session");
    await act(async () => late.resolve(page("stale", "older")));
    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("Name other");
  });
  it("does not auto-scan tool-only pages and supports deliberate loading and retry", async () => {
    let pages = 0;
    const call = vi.fn((method: string) => method === "session.inspect" ? Promise.resolve(metadata()) : ++pages === 1 ? Promise.resolve({ threadId: "original", messages: [], nextCursor: "older" }) : pages === 2 ? Promise.reject(new Error("temporary failure")) : Promise.resolve(page("recovered", null)));
    render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original" }));
    await screen.findByText(/No chat text on this page/);
    expect(pages).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Load older messages/ }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("recovered")).toBeTruthy());
    expect(pages).toBe(3);
  });
});

it("uses a confirmed interface preset for shared header actions and keeps failed selections local", async () => {
  const call = vi.fn(async (method: string) => method === "session.inspect" ? metadata() : { threadId: "original", messages: [], nextCursor: null });
  const onOpen = vi.fn(), save = deferred(), onSave = vi.fn(async () => { await save.promise; });
  const props = { client: { call }, threadId: "original", interfacePreset: "standard" as const, onOpenTeaserBoard: onOpen, onSaveInterfacePreset: onSave };
  const view = render(React.createElement(ExistingSessionPanel, props)); await screen.findByRole("heading", { name: "Name original" });
  fireEvent.click(screen.getByRole("group", { name: "Session information" }).querySelector("summary")!);
  fireEvent.change(screen.getByRole("combobox", { name: "Interface preset" }), { target: { value: "teaser" } });
  expect(screen.queryByRole("button", { name: "Teaser board" })).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Save interface preset" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith("teaser"); expect(screen.getByRole("combobox", { name: "Interface preset" })).toBeDisabled();
  await act(async () => save.resolve(undefined));
  view.rerender(React.createElement(ExistingSessionPanel, { ...props, interfacePreset: "teaser" }));
  const actions = screen.getAllByRole("button", { name: "Teaser board" }); expect(actions).toHaveLength(2); fireEvent.click(actions[0]); expect(onOpen).toHaveBeenCalledOnce();
  expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
});

it("keeps a failed preset edit visible without granting header capability", async () => {
  const call = vi.fn(async (method: string) => method === "session.inspect" ? metadata() : { threadId: "original", messages: [], nextCursor: null });
  render(React.createElement(ExistingSessionPanel, { client: { call }, threadId: "original", interfacePreset: "standard", onSaveInterfacePreset: async () => { throw Error("offline"); } }));
  await screen.findByRole("heading", { name: "Name original" }); fireEvent.click(screen.getByRole("group", { name: "Session information" }).querySelector("summary")!);
  fireEvent.change(screen.getByRole("combobox", { name: "Interface preset" }), { target: { value: "teaser" } }); fireEvent.click(screen.getByRole("button", { name: "Save interface preset" }));
  await screen.findByText("Interface preset could not be saved. Your selection is kept."); expect(screen.getByRole("combobox", { name: "Interface preset" })).toHaveValue("teaser"); expect(screen.queryByRole("button", { name: "Teaser board" })).toBeNull();
});

it("merges external echoes only on exact clientId and reports a matching native receipt once", async () => {
  let history: { id: string; role: string; content: string; clientId?: string }[] = [];
  const call = vi.fn(async (method: string) => method === "session.inspect" ? metadata() : { threadId: "original", messages: [...history], nextCursor: null });
  const onReceipt = vi.fn(), sending = { id: "local-send:external-id", clientId: "external-id", role: "user", content: "External solution", delivery: "sending" as const };
  const props = { client: { call }, threadId: "original", externalSends: [sending], onExternalReceipt: onReceipt };
  const view = render(React.createElement(ExistingSessionPanel, props)); await screen.findByText("External solution");
  history = [{ id: "other-id", role: "user", content: "External solution", clientId: "not-the-request" }];
  view.rerender(React.createElement(ExistingSessionPanel, { ...props, externalSends: [{ ...sending, delivery: "unknown" }] }));
  await waitFor(() => expect(screen.getAllByText("External solution")).toHaveLength(2)); expect(onReceipt).not.toHaveBeenCalledWith("original", "external-id");
  history.push({ id: "native-id", role: "user", content: "External solution", clientId: "external-id" });
  view.rerender(React.createElement(ExistingSessionPanel, { ...props, externalSends: [{ ...sending, delivery: "accepted" }] }));
  await waitFor(() => expect(onReceipt).toHaveBeenCalledWith("original", "external-id"));
  expect(screen.getAllByText("External solution")).toHaveLength(2); expect(screen.queryByText(/Delivery not confirmed/)).toBeNull();
});

it("keeps only the More progress action and Workspace tab while preserving the real composer draft and attachment",async()=>{
  const state={connected:true,version:1,activeTurnId:null,items:[],approvals:[],features:{prediction:false,dictation:false,voice:false}};
  const call=vi.fn(async(method:string)=>method==="session.inspect"?{...metadata("workspace-progress-head"),controlsAvailable:true}:method==="session.history"?page("Synthetic history",null,"workspace-progress-head"):method==="session.workspace.list"?{path:"",entries:[]}:state);
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({ref:"synthetic-attachment"})})));
  try{
    render(React.createElement(ExistingSessionPanel,{client:{call},threadId:"workspace-progress-head",taskProgress:React.createElement("p",null,"Actual progress content"),onOpenWorkspace:vi.fn()}));
    const input=await screen.findByRole("textbox",{name:"Send to session"});await waitFor(()=>expect(input).toBeEnabled());
    fireEvent.change(input,{target:{value:"Draft with @reference remains"}});
    fireEvent.change(screen.getByLabelText("Choose attachments"),{target:{files:[new File(["fixture"],"retained.txt",{type:"text/plain"})]}});
    await screen.findByRole("button",{name:"Remove attachment retained.txt"});
    const triggers=screen.getAllByRole("button",{name:"Task progress"});expect(triggers).toHaveLength(1);expect(triggers[0]).toHaveClass("session-interface-overflow");expect(document.querySelector(".session-interface-inline[data-interface-capability=task-progress]")).toBeNull();fireEvent.click(triggers[0]);
    expect(screen.getByRole("tab",{name:"Task progress"})).toHaveAttribute("aria-selected","true");
    expect(screen.getByText("Actual progress content")).toBeVisible();expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox",{name:"Send to session"})).toBe(input);expect(input).toHaveValue("Draft with @reference remains");
    expect(screen.getByRole("button",{name:"Remove attachment retained.txt"})).toBeTruthy();
    fireEvent.click(screen.getByRole("tab",{name:"Files"}));fireEvent.click(triggers.at(-1)!);
    expect(screen.getByRole("tab",{name:"Task progress"})).toHaveAttribute("aria-selected","true");
    fireEvent.click(screen.getAllByRole("button",{name:"Close workspace"}).at(-1)!);
    expect(input).toHaveValue("Draft with @reference remains");expect(screen.queryByRole("tab",{name:"Task progress"})).toBeNull();
    expect(call.mock.calls.some(([method])=>method==="session.send")).toBe(false);
  }finally{vi.unstubAllGlobals()}
});
it("does not carry a previous Head's progress into a worker on thread switch or a late metadata result",async()=>{
  const pending=deferred();const call=vi.fn(async(method:string,params:unknown)=>{const id=(params as {threadId?:string}).threadId;if(method==="session.inspect")return id==="old-head"?pending.promise:{...metadata(id),controlsAvailable:true};if(method==="session.history")return page("New history",null,id);if(method==="session.workspace.list")return {path:"",entries:[]};return {connected:true,items:[],approvals:[],activeTurnId:null};});
  const view=render(React.createElement(ExistingSessionPanel,{client:{call},threadId:"old-head",taskProgress:React.createElement("p",null,"Old Head private progress")}));
  fireEvent.click(screen.getAllByRole("button",{name:"Task progress"})[0]);
  view.rerender(React.createElement(ExistingSessionPanel,{client:{call},threadId:"ordinary-worker"}));
  await act(async()=>pending.resolve({...metadata("old-head"),controlsAvailable:true}));
  await waitFor(()=>expect(screen.queryByText("Old Head private progress")).toBeNull());
  expect(screen.queryByRole("tab",{name:"Task progress"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Task progress"})).toBeNull();
});
