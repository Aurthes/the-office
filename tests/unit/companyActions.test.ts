import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyActions } from "../../src/features/office/components/CompanyActions";
afterEach(cleanup);
const projects = [{ id: "p", name: "Native project" }];
describe("company creation controls", () => {
  it.each([{ available: [] }, { available: projects }])("recruits into Open Space without creating or assigning a project", async ({ available }) => {
    const call = vi.fn(async (method: string) => method === "office.account" ? { loggedIn: true } : method === "project.folders.list" ? { directory: "/existing/work", parent: "/existing", entries: [] } : { threadId: "unassigned" }), onCreated = vi.fn(async () => {});
    render(React.createElement(CompanyActions, { client: { call }, projects: available, disabled: false, onCreated }));
    expect(screen.getByRole("button", { name: "+ Recruit agent" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "+ Recruit agent" }));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    expect(screen.getByLabelText("Project")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Explorer" } });
    expect(screen.getByRole("button", { name: "Recruit and create session" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(screen.getByLabelText("Working folder")).toHaveTextContent("/existing/work");
    fireEvent.click(screen.getByRole("button", { name: "Recruit and create session" }));
    await act(async () => {});
    expect(call).toHaveBeenCalledWith("session.create", { name: "Explorer", projectId: null, workspace: "/existing/work", requestId: expect.any(String) });
    expect(call.mock.calls.some(([method]) => method === "project.create")).toBe(false);
    expect(onCreated).toHaveBeenCalledWith("unassigned", expect.objectContaining({ seed: "unassigned", duck: expect.any(Object) }));
  });
  it("opens the folder picker directly and creates a project with its folder name", async () => {
    const call = vi.fn(async (method: string) => method === "project.folders.list" ? { directory: "/existing/repo", parent: "/existing", entries: [] } : { project: { id: "new" } }), onCreated = vi.fn(async () => {});
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated }));
    fireEvent.click(screen.getByRole("button", { name: "+ Project" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("dialog"));
    expect(call.mock.calls.some(([method]) => method === "project.create")).toBe(false);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(screen.getByLabelText("Name")).toHaveValue("repo");
    expect(screen.getByLabelText("Project folder 1")).toHaveTextContent("/existing/repo");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove folder" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.create", { name: "repo", rootPaths: ["/existing/repo"], requestId: expect.any(String) });
    expect(onCreated).toHaveBeenCalledWith();
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
    expect(onCreated).toHaveBeenCalledWith("native-id", expect.objectContaining({ seed: "native-id", duck: expect.any(Object) }));
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
    const call = vi.fn(async (method: string, params: unknown) => {
      const { path } = params as { path?: string };
      return method === "project.folders.list" ? { directory: path || "/host", parent: "/", entries: path ? [] : ["repo-a", "repo-b"] } : {};
    });
    render(React.createElement(CompanyActions, { client: { call }, projects: [], disabled: false, onCreated: async () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "+ Project" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "▸ repo-a" })); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Multi repo" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add folder" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "▸ repo-b" })); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Multi repo");
    fireEvent.click(screen.getByRole("button", { name: "Make primary" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" })); await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.create", expect.objectContaining({ name: "Multi repo", rootPaths: ["/host/repo-b", "/host/repo-a"] }));
  });

  it("cancels folder selection without creating a project or adding an empty folder", async () => {
    const call = vi.fn(async () => ({ directory: "/host/repo", parent: "/host", entries: [] }));
    render(React.createElement(CompanyActions, { client: { call }, projects: [], disabled: false, onCreated: async () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "+ Project" })); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Project" })); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add folder" })); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Name")).toHaveValue("repo");
    expect(screen.queryByLabelText("Project folder 2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create project" })); await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.create", expect.objectContaining({ rootPaths: ["/host/repo"] }));
  });

  it("changes an existing folder through the picker and preserves a custom name", async () => {
    const call = vi.fn(async (method: string) => method === "project.inspect" ? { project: { id: "p", name: "Custom", rootPaths: ["/host/old"] }, sessions: [] } : { directory: "/host/new", parent: "/host", entries: [] });
    render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated: async () => {} }));
    fireEvent.click(screen.getByRole("button", { name: "Edit project" })); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Change folder" })); await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.folders.list", { path: "/host/old" });
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Custom");
    fireEvent.click(screen.getByRole("button", { name: "Save project" })); await act(async () => {});
    expect(call).toHaveBeenCalledWith("project.update", expect.objectContaining({ name: "Custom", rootPaths: ["/host/new"] }));
  });

});

// Creation uses the existing avatar settings contract; the gateway needs no new field or RPC.
it("creates distinct recruit styles and keeps them through the existing settings reload", async () => {
  const { createDuckAppearanceFromSeed } = await import("@/lib/avatars/duck");
  const { normalizeStudioSettings } = await import("@/lib/studio/settings");
  const { loadCompanySnapshot } = await import("@/features/office/operations/loadCompanySnapshot");
  type Profile = ReturnType<typeof import("@/lib/avatars/profile").createDefaultAgentAvatarProfile>;
  const profiles: Record<string, Profile> = {};
  const onCreated = vi.fn(async (id?: string, profile?: Profile) => { if (id && profile) profiles[id] = profile; });
  let next = 0;
  const call = vi.fn(async (method: string) => method === "office.account" ? { loggedIn: true } : { threadId: `recruit-${++next}` });
  render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated }));
  for (const name of ["Scout", "Navigator"]) {
    fireEvent.click(screen.getByRole("button", { name: "+ Recruit agent" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Recruit and create session" }));
    await act(async () => {});
  }
  expect(call.mock.calls.filter(([method]) => method === "session.create")).toHaveLength(2);
  expect(profiles["recruit-1"].duck).toEqual(createDuckAppearanceFromSeed("recruit-1"));
  expect(profiles["recruit-1"].duck).not.toEqual(profiles["recruit-2"].duck);
  const settings = normalizeStudioSettings(JSON.parse(JSON.stringify({ avatars: { "ws://office": profiles } })));
  const agents = ["recruit-1", "recruit-2", "older"].map(id => ({ id, name: id, role: "Project", status: "idle", updatedAt: 0 }));
  const reloaded = await loadCompanySnapshot({ client: { call: async () => ({ mainKey: "main", agents, projects: [], creationAvailable: true }) }, gatewayUrl: "ws://office", loadSettings: async () => settings });
  expect(reloaded.hydration.seeds[0].avatarProfile).toEqual(profiles["recruit-1"]);
  expect(reloaded.hydration.seeds[1].avatarProfile).toEqual(profiles["recruit-2"]);
  expect(reloaded.hydration.seeds[2].avatarProfile?.duck).toBeUndefined();
});

it("does not duplicate a session when saving its appearance fails", async () => {
  const call = vi.fn(async (method: string) => method === "office.account" ? { loggedIn: true } : { threadId: "created" });
  const onCreated = vi.fn(async () => { throw new Error("settings unavailable"); });
  render(React.createElement(CompanyActions, { client: { call }, projects, disabled: false, onCreated }));
  fireEvent.click(screen.getByRole("button", { name: "+ Recruit agent" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Scout" } });
  fireEvent.click(screen.getByRole("button", { name: "Recruit and create session" }));
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent("Saved, but the page could not finish updating");
  expect(call.mock.calls.filter(([method]) => method === "session.create")).toHaveLength(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
