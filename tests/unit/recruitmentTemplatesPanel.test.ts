import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanyActions } from "@/features/office/components/CompanyActions";
import { setUiLanguage } from "@/lib/i18n/ui-language";
beforeEach(() => setUiLanguage("en"));
afterEach(cleanup);
function fixture(options: { fullAllowed?: boolean; failList?: boolean; openWorkspace?: boolean } = {}) {
  type Template = { id: string; name: string; model: string; effort: string | null; accessMode: string };
  let templates: Template[] = [{ id: "safe", name: "Careful", model: "model-a", effort: "high", accessMode: ":workspace" }, { id: "full", name: "Builder", model: "model-b", effort: "medium", accessMode: ":danger-full-access" }];
  const defaults: Record<string, string> = { a: "safe", b: "full", "open-workspace": "safe" };
  let fail = !!options.failList, serial = 0;
  const choices = { models: [{ id: "model-a", name: "Model A", efforts: ["low", "high"], defaultEffort: "high" }, { id: "model-b", name: "Model B", efforts: ["medium"], defaultEffort: "medium" }], accessModes: [{ id: ":workspace", name: "Default permissions", allowed: true }, { id: ":read-only", name: "Read only", allowed: true }, { id: ":danger-full-access", name: "Full access", allowed: options.fullAllowed !== false }] };
  const call = vi.fn(async (method: string, raw: unknown) => {
    const input = raw as Record<string, string | null>;
    if (method === "office.account") return { loggedIn: true };
    if (method === "project.folders.list") return { directory: "/fixture/work", parent: "/fixture", entries: [] };
    if (method === "recruitment.list") { if (fail) throw Error("Cannot load options"); return { templates: templates.map(row => ({ ...row })), defaults: { ...defaults } }; }
    if (method === "recruitment.choices") return choices;
    if (method === "recruitment.save") { const template = { id: input.id || "new-template", name: input.name!, model: input.model!, effort: input.effort, accessMode: input.accessMode! }; templates = [...templates.filter(row => row.id !== template.id), template]; return { template }; }
    if (method === "recruitment.default") { const key = input.projectId ?? "open-workspace"; if (input.templateId === null) delete defaults[key]; else defaults[key] = input.templateId; return { updated: true }; }
    if (method === "recruitment.delete") { templates = templates.filter(row => row.id !== input.id); for (const key of Object.keys(defaults)) if (defaults[key] === input.id) delete defaults[key]; return { deleted: true }; }
    if (method === "session.create") return { threadId: `new-${++serial}` };
    throw Error("Unexpected RPC: " + method);
  });
  const onCreated = vi.fn(async () => {});
  const view = render(React.createElement(CompanyActions, { client: { call }, projects: [{ id: "a", name: "A" }, { id: "b", name: "B" }], ...(options.openWorkspace ? { selectedProjectId: null } : {}), disabled: false, onCreated }));
  const open = async () => { fireEvent.click(screen.getByRole("button", { name: "+ Recruit agent" })); await act(async () => {}); };
  return { ...view, call, onCreated, open, recover: () => { fail = false; } };
}
it("collects explicit named/fresh selections and omitted department defaults while only refreshing the created employee", async () => {
  const f = fixture();
  for (const [selection, expected] of [["__department__", undefined], ["full", "full"], ["__fresh__", null]] as const) {
    await f.open(); await screen.findByLabelText("Template configuration");
    fireEvent.change(screen.getByLabelText("Recruitment template"), { target: { value: selection } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New employee" } });
    fireEvent.click(screen.getByRole("button", { name: "Recruit and create session" })); await act(async () => {});
    const params = f.call.mock.calls.filter(([method]) => method === "session.create").at(-1)![1];
    expect(params).toMatchObject({ projectId: "a", name: "New employee" });
    if (expected === undefined) expect(params).not.toHaveProperty("templateId"); else expect(params).toHaveProperty("templateId", expected);
  }
  expect(f.onCreated.mock.calls).toEqual([["new-1"], ["new-2"], ["new-3"]]);
  expect(f.call.mock.calls.some(([method]) => method === "session.settings.update")).toBe(false);
});
it("saves, previews, defaults, edits and deletes independent templates without creating an employee, confirming Full access first", async () => {
  const f = fixture(); await f.open(); await screen.findByLabelText("Template configuration");
  fireEvent.click(screen.getByText("Manage recruitment templates"));
  fireEvent.click(screen.getByRole("button", { name: "New template" }));
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Focused" } });
  fireEvent.change(screen.getByLabelText("Template model"), { target: { value: "model-b" } });
  expect(screen.getByLabelText("Template effort")).toHaveValue("medium");
  fireEvent.change(screen.getByLabelText("Template access"), { target: { value: ":danger-full-access" } });
  expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Confirm full access" }));
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("recruitment.save", expect.objectContaining({ name: "Focused", model: "model-b", effort: "medium", accessMode: ":danger-full-access", confirmFullAccess: true, projectId: "a" })));
  await waitFor(() => expect(screen.getByLabelText("Recruitment template")).toHaveValue("new-template"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Set department default" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Set department default" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("recruitment.default", expect.objectContaining({ projectId: "a", templateId: "new-template" })));
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit template" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  expect(screen.getByLabelText("Template name")).toHaveValue("Focused");
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Safer" } });
  fireEvent.change(screen.getByLabelText("Template access"), { target: { value: ":read-only" } });
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("recruitment.save", expect.objectContaining({ id: "new-template", name: "Safer", accessMode: ":read-only" })));
  await waitFor(() => expect(screen.getByRole("button", { name: "Delete template" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
  await waitFor(() => expect(screen.queryByRole("option", { name: "Safer" })).toBeNull());
  expect(f.call.mock.calls.some(([method]) => method === "session.create")).toBe(false);
});
it("loads workspace options only after choosing a real Open Workspace folder and uses that target for template and create calls", async () => {
  const f = fixture({ openWorkspace: true }); await f.open();
  expect(f.call.mock.calls.some(([method]) => method === "recruitment.choices")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Choose a working folder" })); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
  await screen.findByLabelText("Template configuration");
  expect(f.call).toHaveBeenCalledWith("recruitment.choices", { projectId: null, workspace: "/fixture/work" });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Shared helper" } });
  fireEvent.change(screen.getByLabelText("Recruitment template"), { target: { value: "safe" } });
  fireEvent.click(screen.getByRole("button", { name: "Recruit and create session" })); await act(async () => {});
  expect(f.call).toHaveBeenCalledWith("session.create", expect.objectContaining({ projectId: null, workspace: "/fixture/work", templateId: "safe" }));
});
it("keeps departmental defaults separate, respects unavailable permissions and recovers an options error", async () => {
  const f = fixture({ fullAllowed: false, failList: true }); await f.open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot load options"); f.recover();
  fireEvent.click(screen.getByRole("button", { name: "Retry options" }));
  expect(await screen.findByLabelText("Template configuration")).toHaveTextContent("model-a · high");
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "b" } });
  await waitFor(() => expect(screen.getByLabelText("Template configuration")).toHaveTextContent("model-b · medium"));
  expect(f.call).toHaveBeenCalledWith("recruitment.choices", { projectId: "b" });
  fireEvent.click(screen.getByText("Manage recruitment templates")); fireEvent.click(screen.getByRole("button", { name: "Edit template" }));
  expect(screen.getByRole("option", { name: "Full access" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Confirm full access" }));
  expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
});
it("describes Full access for future template recruits and their tasks in English and Chinese", async () => {
  const f = fixture(); await f.open(); await screen.findByLabelText("Template configuration");
  fireEvent.click(screen.getByText("Manage recruitment templates"));
  fireEvent.click(screen.getByRole("button", { name: "New template" }));
  fireEvent.change(screen.getByLabelText("Template access"), { target: { value: ":danger-full-access" } });
  const label = screen.getByRole("checkbox", { name: "Confirm full access" }).closest("label");
  expect(label).toHaveTextContent("employees recruited with it later and their future tasks");
  expect(label).not.toHaveTextContent("future tasks in this session");
  act(() => setUiLanguage("zh-CN"));
  expect(screen.getByRole("checkbox").closest("label")).toHaveTextContent("保存此模板后");
  expect(screen.getByRole("checkbox").closest("label")).toHaveTextContent("新员工及其后续任务");
});
it("prevents Enter in a template input from implicitly submitting the outer Recruit form", async () => {
  const f = fixture(); await f.open(); await screen.findByLabelText("Template configuration");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Employee name already entered" } });
  fireEvent.click(screen.getByText("Manage recruitment templates"));
  fireEvent.click(screen.getByRole("button", { name: "New template" }));
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Only a template" } });
  expect(fireEvent.keyDown(screen.getByLabelText("Template name"), { key: "Enter" })).toBe(false);
  expect(f.call.mock.calls.some(([method]) => method === "session.create")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(f.call).toHaveBeenCalledWith("recruitment.save", expect.objectContaining({ name: "Only a template" })));
  expect(f.call.mock.calls.some(([method]) => method === "session.create")).toBe(false);
});
