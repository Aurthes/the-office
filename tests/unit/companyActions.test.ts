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
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "New project" } });
    fireEvent.change(screen.getByLabelText("项目目录"), { target: { value: "/existing/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 Project" }));
    await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.create", { name: "New project", workspace: "/existing/repo", requestId: expect.any(String) });
    expect(onCreated).toHaveBeenCalledWith(undefined);
  });
  it("recruits once, then opens the original newly created session", async () => {
    let finish!: (result: unknown) => void;
    const call = vi.fn(() => new Promise(resolve => { finish = resolve; })), onCreated = vi.fn(async () => {});
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated }));
    fireEvent.click(screen.getByRole("button", { name: "+ 招募 agent" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "招募并新建会话" }));
    fireEvent.submit(screen.getByRole("dialog"));
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("session.create", { name: "Research", projectId: "p", requestId: expect.any(String) });
    await act(async () => finish({ threadId: "native-id" }));
    expect(onCreated).toHaveBeenCalledWith("native-id");
  });
  it("keeps input and shows uncertain creation errors without automatic retry", async () => {
    const call = vi.fn(async () => { throw new Error("请求超时"); });
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated: async () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "+ 招募 agent" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "招募并新建会话" })); await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("先核对");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("Keep me");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
