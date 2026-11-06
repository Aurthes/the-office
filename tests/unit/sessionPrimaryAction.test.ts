import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionControls } from "@/features/office/components/SessionControls";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const snapshot = { connected: true, version: 1, activeTurnId: "turn", items: [], approvals: [], features: { dictation: false, voice: false, prediction: false } };

it.each([true, false])("uses one primary button for the current draft and run state (running=%s)", async running => {
  const call = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ ...snapshot, activeTurnId: running ? "turn" : null }));
  render(React.createElement(SessionControls, { client: { call }, threadId: `primary-${running}`, onItems: vi.fn() }));
  const input = screen.getByRole("textbox", { name: "Send to session" });
  await waitFor(() => expect(input).toBeEnabled());
  const submit = screen.getByRole("button", { name: running ? "Stop" : "Send" }).parentElement!;
  expect(within(submit as HTMLElement).getAllByRole("button")).toHaveLength(3);
  expect(within(submit as HTMLElement).getByRole("button", { name: "Dictation" })).toBeDisabled();
  expect(within(submit as HTMLElement).getByRole("button", { name: "Voice chat" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Voice settings" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Voice settings" })).toBeNull();
  fireEvent.change(input, { target: { value: "Follow up" } });
  expect(screen.getByRole("button", { name: running ? "Steer" : "Send" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  fireEvent.change(input, { target: { value: "  " } });
  const primary = screen.getByRole("button", { name: running ? "Stop" : "Send" });
  if (running) expect(primary).toBeEnabled(); else expect(primary).toBeDisabled();
  // Empty Enter must not accidentally stop a running task.
  fireEvent.keyDown(input, { key: "Enter" });
  expect(call.mock.calls.some(([method]) => method === "session.stop")).toBe(false);
  expect(call.mock.calls.some(([method]) => method === "session.send")).toBe(false);
  if (running) {
    fireEvent.click(primary); fireEvent.click(primary);
    expect(primary.querySelector("svg")).not.toBeNull();
    expect(call.mock.calls.filter(([method]) => method === "session.stop")).toHaveLength(1);
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.stop", { threadId: "primary-true" }));
  }
});

it("treats an attachment-only message as a draft and returns to Stop when it is removed", async () => {
  const call = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => snapshot);
  let uploaded!: (response: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { uploaded = resolve; })));
  render(React.createElement(SessionControls, { client: { call }, threadId: "primary-attachment", onItems: vi.fn() }));
  await screen.findByRole("button", { name: "Stop" });
  fireEvent.change(screen.getByLabelText("Choose attachments"), { target: { files: [new File(["notes"], "notes.txt")] } });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Steer" })).toBeDisabled();
  uploaded({ ok: true, json: async () => ({ ref: "office-upload/notes.txt" }) });
  await waitFor(() => expect(screen.getByRole("button", { name: "Steer" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove attachment notes.txt" }));
  expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
});
