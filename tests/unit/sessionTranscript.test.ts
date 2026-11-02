import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SessionTranscript } from "../../src/features/office/components/SessionTranscript";
afterEach(cleanup);

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
  await screen.findByText("Command 499");
  expect(view.container.querySelector("pre")).toBeNull();
  expect(view.container.querySelector("img")).not.toBeNull();
  fireEvent.click(screen.getByText("Work process · 501 items"));
  await waitFor(() => expect(view.container.querySelector("pre")).toBeNull());
  expect(view.container.querySelector("img")).toBeNull();
  view.rerender(React.createElement(SessionTranscript, { messages: [...messages.slice(0, -1), { ...messages[499], content: "Updated result" }, image] }));
  expect(screen.queryByText("Updated result")).toBeNull();
  fireEvent.click(screen.getByText("Work process · 501 items"));
  await screen.findByText("Updated result");
  expect(screen.queryByText("Command 499")).toBeNull();
  expect(view.container.querySelector("pre")).toBeNull();
});

it("shows only a one-line tool or command summary with status, omitting parameters and output", async () => {
  const view = render(React.createElement(SessionTranscript, { messages: [
    { id: "tool", turnId: "t", role: "tool", content: '\nfunctions.exec_command\n{"cmd":"FULL_ARGUMENTS_MARKER"}\nFULL_OUTPUT_MARKER', status: "inProgress", truncated: true },
    { id: "shell", turnId: "t", role: "tool", content: 'rg  -n "pattern" src\r\nSECOND_COMMAND_MARKER', status: "failed" },
  ] }));
  fireEvent.click(screen.getByText("Work process · 2 items"));
  await screen.findByText("functions.exec_command");
  expect(screen.getByText('rg -n "pattern" src')).toBeInTheDocument();
  expect(screen.getByText("· In progress")).toBeInTheDocument();
  expect(screen.getByText("· Failed")).toBeInTheDocument();
  expect(view.container.textContent).not.toMatch(/FULL_ARGUMENTS_MARKER|FULL_OUTPUT_MARKER|SECOND_COMMAND_MARKER|This message is long/);
  expect(view.container.querySelector("pre, code")).toBeNull();
});

it("bounds long single-line calls instead of hiding full payloads in the DOM or hover text", async () => {
  const full = `functions.exec ${"argument ".repeat(1000)}HIDDEN_TAIL_MARKER`;
  const view = render(React.createElement(SessionTranscript, { messages: [{ id: "long", role: "tool", content: full }] }));
  fireEvent.click(screen.getByText("Work process · 1 items"));
  const summary = await screen.findByText(/^functions\.exec/);
  expect(summary.textContent?.length).toBeLessThanOrEqual(120);
  expect(summary.textContent).toMatch(/…$/);
  expect(view.container.innerHTML).not.toContain("HIDDEN_TAIL_MARKER");
  expect(view.container.innerHTML).not.toContain(full);
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
