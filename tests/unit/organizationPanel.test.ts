import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationPanel } from "@/features/ring-ship/OrganizationPanel";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { setUiLanguage } from "@/lib/i18n/ui-language";
beforeEach(() => setUiLanguage("en")); afterEach(cleanup);
const fixture = (): OrganizationView => ({ ceoAvatar: null, focusPerson: vi.fn(), savePosition: vi.fn(async () => {}), people: [
  { id: CEO_ID, name: "CEO", title: "CEO", department: "Company", departmentId: null, reportsTo: [] },
  { id: "head", name: "Ranger", title: "Head", department: "Open Workspace", departmentId: null, reportsTo: [CEO_ID] },
  { id: "worker", name: "Firefighter", title: "Worker", department: "Open Workspace", departmentId: null, reportsTo: ["head"] },
] });
it("shows the CEO's heads and lets the owner browse a department's reporting relationships", () => {
  render(createElement(OrganizationPanel, { organization: fixture(), personId: CEO_ID, browse: true }));
  expect(screen.getByText("Ranger (Head · Open Workspace)")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "head" } });
  expect(screen.getByText("Firefighter (Worker · Open Workspace)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Focus on CEO" })).toBeInTheDocument();
});
it("saves a title and multiple managers while excluding the person from the manager choices", async () => {
  const organization = fixture(); render(createElement(OrganizationPanel, { organization, personId: "worker" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit organization" }));
  expect(screen.queryByRole("checkbox", { name: /Firefighter/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Engineer" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /CEO/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save organization" }));
  await waitFor(() => expect(organization.savePosition).toHaveBeenCalledWith("worker", { title: "Engineer", reportsTo: ["head", CEO_ID] }));
});
it("retains a failed edit and allows canceling without saving again", async () => {
  const organization = fixture(); vi.mocked(organization.savePosition).mockRejectedValue(new Error("Reporting relationships cannot contain a cycle."));
  render(createElement(OrganizationPanel, { organization, personId: "head" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit organization" })); fireEvent.click(screen.getByRole("button", { name: "Save organization" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("cycle");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(organization.savePosition).toHaveBeenCalledTimes(1);
  expect(within(screen.getByRole("region", { name: "Organization" })).queryByRole("textbox")).toBeNull();
});
it("focuses managers and direct reports from a character's organization details", () => {
  const organization = fixture(); render(createElement(OrganizationPanel, { organization, personId: "head" }));
  fireEvent.click(screen.getByRole("button", { name: "Focus on CEO" }));
  fireEvent.click(screen.getByRole("button", { name: "Focus on Firefighter" }));
  expect(organization.focusPerson).toHaveBeenNthCalledWith(1, CEO_ID);
  expect(organization.focusPerson).toHaveBeenNthCalledWith(2, "worker");
  expect(organization.savePosition).not.toHaveBeenCalled();
});
it("focuses every manager independently when a worker has multiple reporting lines", () => {
  const organization = fixture(); organization.people[2].reportsTo = ["head", CEO_ID];
  render(createElement(OrganizationPanel, { organization, personId: "worker" }));
  fireEvent.click(screen.getByRole("button", { name: "Focus on Ranger" }));
  fireEvent.click(screen.getByRole("button", { name: "Focus on CEO" }));
  expect(organization.focusPerson).toHaveBeenNthCalledWith(1, "head");
  expect(organization.focusPerson).toHaveBeenNthCalledWith(2, CEO_ID);
});
it("focuses people from the CEO's tree and person selector", () => {
  const organization = fixture(); render(createElement(OrganizationPanel, { organization, personId: CEO_ID, browse: true }));
  const tree = screen.getByRole("list", { name: "Department reporting structure" });
  fireEvent.click(within(tree).getByRole("button", { name: "Focus on Ranger" }));
  fireEvent.click(within(tree).getByRole("button", { name: "Focus on Firefighter" }));
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "head" } });
  expect(organization.focusPerson).toHaveBeenNthCalledWith(1, "head");
  expect(organization.focusPerson).toHaveBeenNthCalledWith(2, "worker");
  expect(organization.focusPerson).toHaveBeenNthCalledWith(3, "head");
});
it("renders restored layers deeper than two levels in the CEO tree", () => {
  const organization = fixture();
  organization.people.push({ id: "trainee", name: "Trainee", title: "Worker", department: "Open Workspace", departmentId: null, reportsTo: ["worker"] });
  render(createElement(OrganizationPanel, { organization, personId: CEO_ID, browse: true }));
  const tree = screen.getByRole("list", { name: "Department reporting structure" });
  const trainee = within(tree).getByRole("button", { name: "Focus on Trainee" });
  fireEvent.click(trainee); expect(organization.focusPerson).toHaveBeenCalledWith("trainee");
  expect(trainee.closest("ul")?.closest("li")?.textContent).toContain("Firefighter");
});
