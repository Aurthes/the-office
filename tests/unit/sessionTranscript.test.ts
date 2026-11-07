import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionTranscript } from "../../src/features/office/components/SessionTranscript";
afterEach(cleanup);

it("shows the task and concrete original/follow-up questions with stable clickable identities", () => {
  const sources = [
    { threadId: "ceo", turnId: "original", itemId: "q", excerpt: "Show maker markout" },
    { threadId: "head", turnId: "followup", itemId: "q2", excerpt: "Is capacity shared?" },
  ];
  const onOpenQuestion = vi.fn();
  render(React.createElement(SessionTranscript, { messages: [{ id: "reply", role: "assistant", phase: "final_answer", content: "Capacity is shared.", replyContext: { taskId: "task", taskTitle: "Maker markout", sources } }], onOpenQuestion }));
  expect(screen.getByText("Task: Maker markout")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Answering: Is capacity shared?" }));
  expect(onOpenQuestion).toHaveBeenCalledExactlyOnceWith(sources[1]);
  expect(screen.getByText("Capacity is shared.")).toBeVisible();
});

it("keeps legacy replies unlabelled and shows a known task without inventing its original question", () => {
  const view = render(React.createElement(SessionTranscript, { messages: [{ id: "old", role: "assistant", content: "Legacy answer" }] }));
  expect(screen.queryByLabelText("Answering")).toBeNull();
  view.rerender(React.createElement(SessionTranscript, { messages: [{ id: "task", role: "assistant", content: "Task answer", replyContext: { taskTitle: "Known task", sources: [] } }] }));
  expect(screen.getByText("Original question not recorded")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
});

it("continues below each steer in a new work box while updates stay with their original calls", async () => {
  const initial = [
    { id: "question", turnId: "t", role: "user", content: "Check the code" },
    { id: "before", turnId: "t", role: "assistant", phase: "commentary", content: "Inspecting the code" },
    { id: "call", turnId: "t", role: "tool", content: "First command", status: "inProgress" },
  ];
  const view = render(React.createElement(SessionTranscript, { messages: initial, activeTurnId: "t" }));
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(true);
  const steer = { id: "steer", turnId: "t", role: "user", content: "Check the tests too" };
  view.rerender(React.createElement(SessionTranscript, { messages: [...initial, steer], activeTurnId: "t" }));
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(false);
  const continued = [...initial, steer,
    { id: "after", turnId: "t", role: "assistant", phase: "commentary", content: "Inspecting the tests" },
    { id: "next-call", turnId: "t", role: "tool", content: "Second command" },
  ];
  view.rerender(React.createElement(SessionTranscript, { messages: continued, activeTurnId: "t" }));
  let groups = screen.getAllByLabelText("Work process") as HTMLDetailsElement[];
  expect(groups.map(group => group.open)).toEqual([false, true]);
  expect([...view.container.children].map(node => node.getAttribute("data-message-id") || node.getAttribute("aria-label"))).toEqual(["question", "Work process", "steer", "Work process"]);
  expect(within(groups[1]).getByText("Inspecting the tests")).toBeVisible();
  fireEvent.click(groups[0].querySelector("summary")!);
  fireEvent.click(await within(groups[0]).findByText("Tool calls · 1 items"));
  await within(groups[0]).findByText("First command");
  view.rerender(React.createElement(SessionTranscript, { messages: continued.map(item => item.id === "call" ? { ...item, status: "completed", content: "First command completed" } : item), activeTurnId: "t" }));
  groups = screen.getAllByLabelText("Work process") as HTMLDetailsElement[];
  expect(within(groups[0]).getByText("First command completed")).toBeVisible();
  expect(within(groups[1]).queryByText("First command completed")).toBeNull();
  // A user can fold the latest work without subsequent streaming reopening it.
  fireEvent.click(groups[1].querySelector("summary")!);
  await waitFor(() => expect(groups[1].open).toBe(false));
  view.rerender(React.createElement(SessionTranscript, { messages: [...continued,
    { id: "delta", turnId: "t", role: "assistant", phase: "commentary", content: "Tests checked" },
  ], activeTurnId: "t" }));
  expect(screen.queryByText("Tests checked")).toBeNull();
  view.rerender(React.createElement(SessionTranscript, { messages: [...continued,
    { id: "steer-2", turnId: "t", role: "user", content: "Now check mobile" },
    { id: "mobile", turnId: "t", role: "assistant", phase: "commentary", content: "Checking mobile" },
  ], activeTurnId: "t" }));
  groups = screen.getAllByLabelText("Work process") as HTMLDetailsElement[];
  expect(groups).toHaveLength(3);
  expect(within(groups[2]).getByText("Checking mobile")).toBeVisible();
  expect(screen.getByText("Now check mobile").closest("article")?.nextElementSibling).toBe(groups[2]);
});

it("keeps historical work in order around steers and visible answers, and opens only the searched work box", () => {
  const messages = [
    { id: "before", turnId: "t", role: "assistant", phase: "commentary", content: "Original work" },
    { id: "steer", turnId: "t", role: "user", content: "Change direction" },
    { id: "after", turnId: "t", role: "assistant", phase: "commentary", content: "Steered work" },
    { id: "partial", turnId: "t", role: "assistant", phase: "partial_answer", content: "Partial response" },
    { id: "last", turnId: "t", role: "assistant", phase: "commentary", content: "Last check" },
    { id: "final", turnId: "t", role: "assistant", phase: "final_answer", content: "Final response" },
  ];
  const view = render(React.createElement(SessionTranscript, { messages, activeTurnId: "t" }));
  expect([...view.container.children].map(node => node.getAttribute("data-message-id") || node.getAttribute("aria-label"))).toEqual(["Work process", "steer", "Work process", "partial", "Work process", "final"]);
  expect(screen.getAllByLabelText("Work process").every(group => !(group as HTMLDetailsElement).open)).toBe(true);
  view.rerender(React.createElement(SessionTranscript, { messages, highlightedMessageId: "after" }));
  expect(screen.getAllByLabelText("Work process").map(group => (group as HTMLDetailsElement).open)).toEqual([false, true, false]);
  expect(screen.getByText("Steered work").closest("[data-message-id]")).toHaveAttribute("data-search-match", "true");
});

it("forks at the last answer of a completed turn, excluding work logs, user messages and the active turn",()=>{
  const onForkFrom=vi.fn(),messages=[
    {id:"u",turnId:"past",role:"user",content:"Earlier question"},
    {id:"c",turnId:"past",role:"assistant",phase:"commentary",content:"Checking"},
    {id:"p",turnId:"past",role:"assistant",phase:"partial_answer",content:"Partial"},
    {id:"a",turnId:"past",role:"assistant",phase:"final_answer",content:"Earlier answer"},
    {id:"b",turnId:"current",role:"assistant",phase:"final_answer",content:"Still streaming"},
    {id:"v",source:"voice" as const,role:"assistant",content:"Voice without a turn boundary"},
  ];
  const view=render(React.createElement(SessionTranscript,{messages,activeTurnId:"current",onForkFrom}));
  const buttons=screen.getAllByRole("button",{name:"Fork from here"});expect(buttons).toHaveLength(1);
  expect(buttons[0].closest("article")).toHaveTextContent("Earlier answer");fireEvent.click(buttons[0]);expect(onForkFrom).toHaveBeenCalledWith("past");
  view.rerender(React.createElement(SessionTranscript,{messages,onForkFrom,forkDisabled:true}));
  expect(screen.getAllByRole("button",{name:"Fork from here"})).toHaveLength(2);
  for(const button of screen.getAllByRole("button",{name:"Fork from here"}))expect(button).toBeDisabled();
});

it("defers native commentary and tools until expansion while leaving user, partial and final answers visible", async () => {
  render(React.createElement(SessionTranscript, { messages: [
    { id: "u", turnId: "t", role: "user", content: "Question" },
    { id: "c", turnId: "t", role: "assistant", phase: "commentary", content: "Investigating" },
    { id: "tool", turnId: "t", role: "tool", content: "echo fixture" },
    { id: "p", turnId: "t", role: "assistant", phase: "partial_answer", content: "Stable answer" },
    { id: "f", turnId: "t", role: "assistant", phase: "final_answer", content: "**Final answer**" },
    { id: "legacy", turnId: "old", role: "assistant", content: "Legacy answer" },
  ] }));
  const details = screen.getByLabelText("Work process") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(screen.queryByText("Investigating")).toBeNull();
  expect(screen.queryByText("echo fixture")).toBeNull();
  for (const text of ["Question", "Stable answer", "Final answer", "Legacy answer"]) expect(screen.getByText(text).closest("details")).toBeNull();
  fireEvent.click(screen.getByText("Work process · 2 items"));
  await screen.findByText("Investigating");
  expect(screen.queryByText("echo fixture")).toBeNull();
  fireEvent.click(screen.getByText("Tool calls · 1 items"));
  await screen.findByText("echo fixture");
  expect(screen.getByText("echo fixture")).toBeTruthy();
  expect(screen.getAllByLabelText("Work process")).toHaveLength(1);
});

it("keeps large folded logs out of the DOM and renders the latest items when reopened", async () => {
  const messages = Array.from({ length: 500 }, (_, i) => ({ id: `tool-${i}`, turnId: "long-turn", role: "tool", content: `Command ${i}` }));
  const image = { id: "image", turnId: "long-turn", role: "assistant", phase: "commentary", content: "![work image](https://example.com/work.png)" };
  const view = render(React.createElement(SessionTranscript, { messages: [...messages, image] }));
  expect(view.container.querySelectorAll("*")).toHaveLength(2);
  expect(view.container.querySelector("img")).toBeNull();
  fireEvent.click(screen.getByText("Work process · 501 items"));
  await screen.findByText("Tool calls · 500 items");
  expect(screen.queryByText("Command 499")).toBeNull();
  fireEvent.click(screen.getByText("Tool calls · 500 items"));
  await screen.findByText("Command 499");
  expect(view.container.querySelector("pre")).toBeNull();
  expect(view.container.querySelector("img")).not.toBeNull();
  fireEvent.click(screen.getByText("Work process · 501 items"));
  await waitFor(() => expect(view.container.querySelector("pre")).toBeNull());
  expect(view.container.querySelector("img")).toBeNull();
  view.rerender(React.createElement(SessionTranscript, { messages: [...messages.slice(0, -1), { ...messages[499], content: "Updated result" }, image] }));
  expect(screen.queryByText("Updated result")).toBeNull();
  fireEvent.click(screen.getByText("Work process · 501 items"));
  await screen.findByText("Tool calls · 500 items");
  fireEvent.click(screen.getByText("Tool calls · 500 items"));
  await screen.findByText("Updated result");
  expect(screen.queryByText("Command 499")).toBeNull();
  expect(view.container.querySelector("pre")).toBeNull();
});

it("keeps tool parameters and output folded until their tool group is opened", async () => {
  const view = render(React.createElement(SessionTranscript, { messages: [
    { id: "tool", turnId: "t", role: "tool", content: '\nfunctions.exec_command\n{"cmd":"FULL_ARGUMENTS_MARKER"}\nFULL_OUTPUT_MARKER', status: "inProgress", truncated: true },
    { id: "shell", turnId: "t", role: "tool", content: 'rg  -n "pattern" src\r\nSECOND_COMMAND_MARKER', status: "failed" },
  ] }));
  fireEvent.click(screen.getByText("Work process · 2 items"));
  await screen.findByText("Tool calls · 2 items");
  expect(view.container.textContent).not.toMatch(/FULL_ARGUMENTS_MARKER|FULL_OUTPUT_MARKER|SECOND_COMMAND_MARKER|This message is long/);
  expect(view.container.querySelector("pre, code")).toBeNull();
  fireEvent.click(screen.getByText("Tool calls · 2 items"));
  await screen.findByText("functions.exec_command");
  expect(screen.getByText('rg -n "pattern" src')).toBeInTheDocument();
  expect(screen.getByText("· In progress")).toBeInTheDocument();
  expect(screen.getByText("· Failed")).toBeInTheDocument();
  expect(view.container.textContent).toContain("FULL_ARGUMENTS_MARKER");
  expect(view.container.textContent).toContain("FULL_OUTPUT_MARKER");
  expect(view.container.textContent).toContain("SECOND_COMMAND_MARKER");
  expect(view.container.querySelectorAll("pre")).toHaveLength(2);
});

it("defers long call payloads and keeps their headings short when expanded", async () => {
  const full = `functions.exec ${"argument ".repeat(1000)}HIDDEN_TAIL_MARKER`;
  const view = render(React.createElement(SessionTranscript, { messages: [{ id: "long", role: "tool", content: full }] }));
  fireEvent.click(screen.getByText("Work process · 1 items"));
  await screen.findByText("Tool calls · 1 items");
  expect(view.container.innerHTML).not.toContain("HIDDEN_TAIL_MARKER");
  expect(view.container.innerHTML).not.toContain(full);
  fireEvent.click(screen.getByText("Tool calls · 1 items"));
  const summary = await screen.findByText(/^functions\.exec.*…$/);
  expect(summary.textContent?.length).toBeLessThanOrEqual(120);
  expect(summary.textContent).toMatch(/…$/);
  expect(view.container.querySelector("pre")?.textContent).toBe(full);
});

it("opens current work, separates tool batches between commentary, and folds when the official answer starts", async () => {
  const messages = [
    { id: "c1", turnId: "running", role: "assistant", phase: "commentary", content: "Checking the files" },
    { id: "t1", turnId: "running", role: "tool", content: "First command\nFIRST_RESULT" },
    { id: "t2", turnId: "running", role: "tool", content: "Second command" },
    { id: "c2", turnId: "running", role: "assistant", phase: "commentary", content: "Now verifying the result" },
    { id: "t3", turnId: "running", role: "tool", content: "Third command" },
  ];
  const view = render(React.createElement(SessionTranscript, { messages, activeTurnId: "running" }));
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(true);
  expect(screen.getByText("Checking the files")).toBeVisible();
  expect(screen.getByText("Now verifying the result")).toBeVisible();
  expect(screen.getAllByLabelText("Tool calls").map(node => (node as HTMLDetailsElement).open)).toEqual([false, false]);
  expect(screen.queryByText("First command")).toBeNull();
  fireEvent.click(screen.getByText("Tool calls · 2 items"));
  await screen.findByText("First command");
  expect(view.container.textContent).toContain("FIRST_RESULT");
  expect(screen.queryByText("Third command")).toBeNull();
  const final = { id: "final", turnId: "running", role: "assistant", phase: "final_answer", content: "" };
  view.rerender(React.createElement(SessionTranscript, { messages: [...messages, final], activeTurnId: "running" }));
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(false);
  expect(screen.queryByText("Checking the files")).toBeNull();
  view.rerender(React.createElement(SessionTranscript, { messages: [...messages, { ...final, content: "Official response" }], activeTurnId: "running" }));
  expect(screen.getByText("Official response")).toBeVisible();
  fireEvent.click(screen.getByText("Work process · 5 items"));
  await screen.findByText("Checking the files");
  view.rerender(React.createElement(SessionTranscript, { messages: [...messages, { ...final, content: "Official response continues" }], activeTurnId: null }));
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(true);
});

it("respects a manual fold during streaming and closes unfinished work when the task stops", async () => {
  const messages = [{ id: "c", turnId: "t", role: "assistant", phase: "commentary", content: "In progress" }];
  const view = render(React.createElement(SessionTranscript, { messages, activeTurnId: "t" }));
  fireEvent.click(screen.getByText("Work process · 1 items"));
  await waitFor(() => expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(false));
  view.rerender(React.createElement(SessionTranscript, { messages: [{ ...messages[0], content: "Still in progress" }], activeTurnId: "t" }));
  expect(screen.queryByText("Still in progress")).toBeNull();
  fireEvent.click(screen.getByText("Work process · 1 items"));
  await screen.findByText("Still in progress");
  view.rerender(React.createElement(SessionTranscript, { messages, activeTurnId: null }));
  expect((screen.getByLabelText("Work process") as HTMLDetailsElement).open).toBe(false);
});

it("leaves historical turns folded when a different turn is running", () => {
  render(React.createElement(SessionTranscript, { activeTurnId: "new", messages: [
    { id: "old", turnId: "old", role: "assistant", phase: "commentary", content: "Old work" },
    { id: "new", turnId: "new", role: "assistant", phase: "commentary", content: "Current work" },
  ] }));
  expect(screen.getAllByLabelText("Work process").map(node => (node as HTMLDetailsElement).open)).toEqual([false, true]);
  expect(screen.queryByText("Old work")).toBeNull();
  expect(screen.getByText("Current work")).toBeVisible();
});

it("shows voice questions without protocol wrappers or a duplicate call-end bubble", () => {
  const input = "Confirm how this works in the office.";
  render(React.createElement(SessionTranscript, { messages: [
    { id: "voice", role: "user", content: `<realtime_delegation><input>${input}</input><transcript_delta>assistant: Still checking.</transcript_delta></realtime_delegation>` },
    { id: "flush", role: "user", content: '<realtime_delegation><source>transcript_tail_flush</source><input>The user just ended their realtime session.</input><transcript_delta>user: Confirm how this works in the office.</transcript_delta></realtime_delegation>' },
    { id: "image", role: "user", content: "", assets: [{ source: "attachment:1", name: "image.png", url: "/api/session-assets?ref=image", kind: "image", attached: true }] },
  ] }));
  expect(screen.getByText(input)).toBeTruthy();
  expect(screen.getAllByRole("article", { name: "You" })).toHaveLength(2);
  expect(screen.getByRole("img", { name: "image.png" })).toBeTruthy();
  expect(screen.queryByText(/realtime_delegation|Handoff|just ended|Still checking/)).toBeNull();
});

it("shows each message's own time below its content, with the full date on hover", () => {
  const sent = Date.UTC(2026, 10, 2, 8, 12, 3), replied = sent + 95000;
  const view = render(React.createElement(SessionTranscript, { messages: [
    { id: "timed-user", role: "user", content: "A timed question", timestamp: sent },
    { id: "timed-assistant", role: "assistant", content: "A timed answer", timestamp: replied },
    { id: "legacy-no-time", role: "assistant", content: "An older answer" },
    { id: "invalid-time", role: "assistant", content: "Unknown time", timestamp: Number.NaN },
  ] }));
  const times = [...view.container.querySelectorAll("time")];
  expect(times.map(time => time.dateTime)).toEqual(["2026-11-02T08:12:03.000Z", "2026-11-02T08:13:38.000Z"]);
  for (const time of times) { expect(time.textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/); expect(time.title).toContain("2026"); }
  expect(screen.getByText("A timed question").closest("article")).toContainElement(times[0]);
  expect(screen.getByText("A timed answer").closest("article")).toContainElement(times[1]);
  expect(screen.getByText("An older answer").closest("article")?.querySelector("time")).toBeNull();
});
