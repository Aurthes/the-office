import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyActions } from "../../src/features/office/components/CompanyActions";
afterEach(cleanup);
const projects = [{ id: "p", name: "Native project" }];
describe("company creation controls", () => {
  it("creates a native Project from a name and existing directory", async () => {
    const call = vi.fn(async () => ({ project: { id: "new" } })), onCreated = vi.fn(async () => {});
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated }));
    fireEvent.click(screen.getByRole("button", { name: "+ Project" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New project" } });
    fireEvent.change(screen.getByLabelText("Project directory"), { target: { value: "/existing/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.create", { name: "New project", workspace: "/existing/repo", requestId: expect.any(String) });
    expect(onCreated).toHaveBeenCalledWith(undefined);
  });
  it("recruits once, then opens the original newly created session", async () => {
    let finish!: (result: unknown) => void;
    const call = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => new Promise(resolve => { finish = resolve; })), onCreated = vi.fn(async () => {});
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated }));
    fireEvent.click(screen.getByRole("button", { name: "+ Recruit agent" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Recruit and create session" }));
    fireEvent.submit(screen.getByRole("dialog"));
    expect(call.mock.calls.filter(([method]) => method === "session.create")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("session.create", { name: "Research", projectId: "p", requestId: expect.any(String) });
    await act(async () => finish({ threadId: "native-id" }));
    expect(onCreated).toHaveBeenCalledWith("native-id");
  });
  it("keeps input and shows uncertain creation errors without automatic retry", async () => {
    const call = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => { throw new Error("请求超时"); });
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated: async () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "+ Recruit agent" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Recruit and create session" })); await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("check the result");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Keep me");
    expect(call.mock.calls.filter(([method]) => method === "session.create")).toHaveLength(1);
  });
});
