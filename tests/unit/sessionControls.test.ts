import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionControls } from "../../src/features/office/components/SessionControls";
const snapshot = { connected: true, version: 1, activeTurnId: "turn", items: [], approvals: [] };
afterEach(cleanup);
describe("shared-session composer", () => {
  it("sends to the original thread once while a submission is pending", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(r => { resolve = r; });
    const call = vi.fn((method: string) => method === "session.send" ? pending : Promise.resolve(snapshot));
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    const input = screen.getByLabelText("发送到原会话");
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "hello" } });
    const button = screen.getByRole("button", { name: "追加消息" });
    fireEvent.click(button); fireEvent.click(button);
    expect(call.mock.calls.filter(([method]) => method === "session.send")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("session.send", expect.objectContaining({ threadId: "original", message: "hello", requestId: expect.any(String) }));
    await act(async () => resolve({ status: "steered" }));
    expect((input as HTMLTextAreaElement).value).toBe("");
  });
  it("uses the exact cancel decision offered by the original server", async () => {
    const call = vi.fn(async () => ({ ...snapshot, approvals: [{ requestId: "approval", method: "item/commandExecution/requestApproval", params: { command: "echo fixture" }, decisions: ["accept", "cancel"], supported: true }] }));
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "取消本轮" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.approval.reply", { threadId: "original", requestId: "approval", decision: "cancel" }));
  });
  it("stops the original thread and leaves uncertain send text available for reconciliation", async () => {
    const call = vi.fn(async (method: string) => { if (method === "session.send") throw new Error("结果未确认"); return snapshot; });
    render(React.createElement(SessionControls, { client: { call }, threadId: "original", onItems: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("session.stop", { threadId: "original" }));
    const input = screen.getByLabelText("发送到原会话");
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: "keep draft" } });
    fireEvent.click(screen.getByRole("button", { name: "追加消息" }));
    await screen.findByRole("alert");
    expect((input as HTMLTextAreaElement).value).toBe("keep draft");
  });
});
