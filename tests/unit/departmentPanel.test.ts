import { createElement as h, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DepartmentPanel, openDepartmentTab, type DepartmentPanelState } from "@/features/ring-ship/DepartmentPanel";
import { OrganizationPanel } from "@/features/ring-ship/OrganizationPanel";
import { AgentDirectory } from "@/features/office/components/AgentDirectory";
import { DepartmentOverviewButton } from "@/features/ring-ship/MonitorRoom";
import { buildShipLayout } from "@/features/ring-ship/layout";
import { organizationDepartments } from "@/lib/office/departments";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";
import { setUiLanguage } from "@/lib/i18n/ui-language";

vi.mock("@react-three/drei", () => ({ Html: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/features/office/components/CharacterPortrait", () => ({ CharacterPortrait: () => null }));
beforeEach(() => {
  setUiLanguage("en");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const projects = [{ id: "a", name: "Research" }, { id: "b", name: "Research" }];
function fixture(): OrganizationView {
  const people = [
    { id: CEO_ID, name: "CEO", title: "CEO", departmentId: null, department: "Company", reportsTo: [] },
    { id: "head", name: "Leader", title: "Head", departmentId: "a", department: "Research", reportsTo: [CEO_ID] },
    { id: "worker", name: "Builder", title: "Worker", departmentId: "a", department: "Research", reportsTo: ["head"] },
  ];
  return { people, ceoAvatar: null, savePosition: vi.fn(), saveDepartmentDescription: vi.fn(async () => {}), departments: organizationDepartments(projects, people, { a: "Initial scope" }) };
}
const agents = [{ id: "worker", name: "Builder", color: "#abc", activity: getAgentActivity({ status: "idle" }), updatedAt: 0, projectId: "a", projectName: "Research" }];
const layout = buildShipLayout({ projects: [], members: [] });
function Harness({ organization, view = "project" }: { organization: OrganizationView; view?: "project" | "organization" }) {
  const [state, setState] = useState<DepartmentPanelState>({ open: false, selectedId: null, tabs: [] });
  const openDepartment = (id?: string) => setState(previous => openDepartmentTab(previous, id));
  const full = { ...organization, openDepartment };
  return h("div", {},
    h(DepartmentOverviewButton, { layout, cabin: layout.cabins.find(c => c.kind === "monitor")!, onOpen: () => openDepartment() }),
    h(OrganizationPanel, { organization: full, personId: "worker", browse: true }),
    h(AgentDirectory, { organization: full, agents, view, onViewChange: vi.fn(), search: "", onSearchChange: vi.fn(), selectedId: null, onOpenChat: vi.fn(), onOpenTask: vi.fn() }),
    h(DepartmentPanel, { organization: full, state, onSelect: openDepartment, onClose: () => setState(s => ({ ...s, open: false })) }));
}
it("routes the control room, person details and department groups into one ID-based tab", async () => {
  render(h(Harness, { organization: fixture() }));
  fireEvent.click(screen.getByRole("button", { name: "Open departments" }));
  const dialog = await screen.findByRole("dialog", { name: "Departments" });
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Research" })[0]);
  expect(within(dialog).getByRole("tab", { name: "Research" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close departments" }));
  const person = screen.getByRole("region", { name: "Organization" });
  fireEvent.click(within(person).getAllByRole("button", { name: "Research" })[0]);
  expect(within(dialog).getAllByRole("tab", { name: "Research" })).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close departments" }));
  fireEvent.click(within(screen.getByRole("heading", { level: 3 })).getByRole("button", { name: "Research" }));
  expect(within(dialog).getAllByRole("tab", { name: "Research" })).toHaveLength(1);
  expect(document.querySelector("button button")).toBeNull();
});
it("keeps failed drafts across refreshes and tab switches, then allows retrying and clearing", async () => {
  const organization = fixture(), save = vi.mocked(organization.saveDepartmentDescription!);save.mockRejectedValueOnce(new Error("Offline"));
  const { rerender } = render(h(Harness, { organization }));
  fireEvent.click(screen.getAllByRole("button", { name: "Research" })[0]);
  const dialog = await screen.findByRole("dialog", { name: "Departments" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Edit responsibilities" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Responsibilities" }), { target: { value: "Draft to keep" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save responsibilities" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Offline");
  const refreshed = { ...organization, departments: organizationDepartments(projects, organization.people, { a: "Server refresh" }) };
  rerender(h(Harness, { organization: refreshed }));
  expect(within(dialog).getByRole("textbox")).toHaveValue("Draft to keep");
  fireEvent.click(within(dialog).getByRole("tab", { name: "Company overview" }));
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Research" })[1]);
  expect(within(dialog).getAllByRole("tab", { name: "Research" })).toHaveLength(2);
  fireEvent.click(within(dialog).getAllByRole("tab", { name: "Research" })[0]);
  expect(within(dialog).getByRole("textbox")).toHaveValue("Draft to keep");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save responsibilities" }));
  await waitFor(() => expect(within(dialog).queryByRole("textbox")).toBeNull());
  expect(save).toHaveBeenLastCalledWith("a", "Draft to keep");
  fireEvent.click(within(dialog).getByRole("button", { name: "Edit responsibilities" }));
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save responsibilities" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith("a", ""));
});
it("opens the organization-tree department without opening a session and derives changed roles and vacancies", async () => {
  const organization = fixture();
  const { rerender } = render(h(Harness, { organization, view: "organization" }));
  const tree = screen.getByRole("list", { name: "Reporting lines" });
  fireEvent.click(within(tree).getAllByRole("button", { name: "Research" })[0]);
  const dialog = await screen.findByRole("dialog", { name: "Departments" });
  expect(within(dialog).getByRole("tabpanel", { name: "Research" })).toHaveTextContent("Leader · Head");
  const people = organization.people.filter(p => p.id !== "head").map(p => p.id === "worker" ? { ...p, title: "Engineer", reportsTo: [CEO_ID] } : p);
  rerender(h(Harness, { organization: { ...organization, people, departments: organizationDepartments(projects, people) }, view: "organization" }));
  expect(within(dialog).getByRole("tabpanel", { name: "Research" })).toHaveTextContent("Head position vacant");
  expect(within(dialog).getByRole("tabpanel", { name: "Research" })).toHaveTextContent("Engineer");
});
