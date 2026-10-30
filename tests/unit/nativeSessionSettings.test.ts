import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSettings } from "../../src/features/office/components/SessionSettings";
const current = { model: "a", effort: "high", accessMode: ":workspace" };
const choices = { models: [{ id: "a", name: "Native A", efforts: ["medium", "high"], defaultEffort: "medium" }, { id: "b", name: "Native B", efforts: ["high"], defaultEffort: "high" }], accessModes: [{ id: ":workspace", name: "Default permissions", allowed: true }, { id: ":danger-full-access", name: "Full access", allowed: true }, { id: ":read-only", name: "Read only", allowed: false }] };
afterEach(cleanup);
describe("native chat setting selectors", () => {
  it("shows original values and sends model changes once without optimistic rewrites", async () => {
    const call = vi.fn(async () => choices), onBusyChange = vi.fn();
    render(React.createElement(SessionSettings, { client: { call }, threadId: "original", current, disabled: false, active: true, onBusyChange }));
    await act(async () => {});fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
    expect((screen.getByLabelText("选择模型") as HTMLSelectElement).value).toBe("a");
    fireEvent.change(screen.getByLabelText("选择模型"), { target: { value: "b" } });
    await act(async () => {});
    expect(call).toHaveBeenLastCalledWith("session.settings.update", { threadId: "original", settings: { model: "b" } });
    expect((screen.getByLabelText("选择模型") as HTMLSelectElement).value).toBe("a");
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);expect(screen.getByRole("status").textContent).toContain("下一轮生效");
  });
  it("does not enable Full access until confirmed and leaves denied profiles disabled", async () => {
    const call = vi.fn(async () => choices);
    render(React.createElement(SessionSettings, { client: { call }, threadId: "original", current, disabled: false, active: false, onBusyChange: vi.fn() }));
    await act(async () => {});
    expect((screen.getByRole("option", { name: "Read only" }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Select access mode"), { target: { value: ":danger-full-access" } });
    expect(screen.getByRole("dialog", { name: "确认 Full access" })).toBeTruthy();expect(call).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByLabelText("Select access mode"), { target: { value: ":danger-full-access" } });
    fireEvent.click(screen.getByRole("button", { name: "开启 Full access" }));await act(async () => {});
    expect(call).toHaveBeenLastCalledWith("session.settings.update", { threadId: "original", settings: { accessMode: ":danger-full-access", confirmFullAccess: true } });
  });
  it("preserves current values and provides an error when native saving fails", async () => {
    const call = vi.fn((method: string) => method === "session.settings.choices" ? Promise.resolve(choices) : Promise.reject(new Error("native denied")));
    render(React.createElement(SessionSettings, { client: { call }, threadId: "original", current, disabled: false, active: false, onBusyChange: vi.fn() }));
    await act(async () => {});fireEvent.click(screen.getByRole("button", { name: "模型设置" }));
    fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "medium" } });await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("native denied");expect((screen.getByLabelText("推理强度") as HTMLSelectElement).value).toBe("high");
  });
});
