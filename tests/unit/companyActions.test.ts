import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyActions } from "../../src/features/office/components/CompanyActions";
afterEach(cleanup);
const projects = [{ id: "p", name: "Native project" }];
describe("company creation controls", () => {
  it("creates an Office project referencing existing folders", async () => {
    const call = vi.fn(async () => ({ project: { id: "new" } })), onCreated = vi.fn(async () => {});
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated }));
    fireEvent.click(screen.getByRole("button", { name: "+ Project" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New project" } });
    fireEvent.change(screen.getByLabelText("Project folder 1"), { target: { value: "/existing/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.create", { name: "New project", rootPaths: ["/existing/repo"], requestId: expect.any(String) });
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
  it("edits multiple folders and asks for a replacement when a chat's cwd is removed", async () => {
    const call = vi.fn(async (method: string) => method === "project.inspect" ? { project: { id: "p", name: "Work", rootPaths: ["/repo-a", "/repo-b"] }, sessions: [{ id: "chat", name: "Existing chat", workspace: "/repo-a" }] } : {});
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated: async () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "Edit project" })); await act(async () => {});
    fireEvent.click(screen.getAllByRole("button", { name: "Remove folder" })[0]);
    expect(screen.getByLabelText("Working folder: Existing chat")).toBeRequired();
    fireEvent.change(screen.getByLabelText("Working folder: Existing chat"), { target: { value: "/repo-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Save project" })); await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.update", expect.objectContaining({ projectId: "p", rootPaths: ["/repo-b"], workspaces: { chat: "/repo-b" } }));
  });
  it("browses folders on the Office host and can make an additional folder primary", async () => {
    const call = vi.fn(async () => ({ directory: "/host/repo-b", parent: "/host", entries: [] }));
    render(React.createElement(CompanyActions, { client: { call }, projects: [], disabled: false, onCreated: async () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "+ Project" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Multi repo" } });
    fireEvent.change(screen.getByLabelText("Project folder 1"), { target: { value: "/host/repo-a" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add folder" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Browse" })[1]); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Make primary" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" })); await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.create", expect.objectContaining({ rootPaths: ["/host/repo-b", "/host/repo-a"] }));
  });

});
