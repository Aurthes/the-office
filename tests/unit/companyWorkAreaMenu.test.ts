import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyWorkAreaMenu } from "@/features/office/components/CompanyWorkAreaMenu";
import { CompanyActions } from "@/features/office/components/CompanyActions";
afterEach(cleanup);
const areas = [{ id: "project-a", name: "Project A", agentIds: ["native-thread"] }];
const defaults = { areas, activeId: "", sessionCount: 1, open: false, onOpenChange: vi.fn(), onSelect: vi.fn() };

describe("company work area menu", () => {
  it("drives project actions from the area selection and clears forms belonging to the previous area", async () => {
    const available = [{ id: "project-a", name: "Project A" }, { id: "project-b", name: "Project B" }];
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === "project.inspect") {
        const { projectId } = params as { projectId: string };
        return { project: { ...available.find(project => project.id === projectId), rootPaths: ["/host/repo"] }, sessions: [] };
      }
      return { loggedIn: true };
    });
    function Controls() {
      const [activeId, setActiveId] = React.useState("");
      return React.createElement(CompanyWorkAreaMenu, { ...defaults, areas: available.map(project => ({ ...project, agentIds: [] })), activeId, onSelect: setActiveId,
        actions: areaId => React.createElement(CompanyActions, { key: areaId, client: { call }, projects: available, selectedProjectId: areaId, disabled: false, onCreated: async () => {} }),
      });
    }
    render(React.createElement(Controls));
    fireEvent.change(screen.getByRole("combobox", { name: "Go to work area" }), { target: { value: "project-b" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Recruit agent" }));
    expect(screen.getByLabelText("Project")).toHaveTextContent("Project B");
    expect(screen.queryByRole("combobox", { name: "Project" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit project" })); await act(async () => {});
    expect(screen.getByLabelText("Name")).toHaveValue("Project B");
    fireEvent.change(screen.getByRole("combobox", { name: "Go to work area" }), { target: { value: "project-a" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit project" })); await act(async () => {});
    expect(screen.getByLabelText("Name")).toHaveValue("Project A");
    expect(call).toHaveBeenLastCalledWith("project.inspect", { projectId: "project-a" });
  });
  it("opens from the compact trigger and exposes its expanded state", () => {
    const onOpenChange = vi.fn();
    const view = render(React.createElement(CompanyWorkAreaMenu, { ...defaults, onOpenChange }));
    fireEvent.click(screen.getByRole("button", { name: "Expand work areas" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    view.rerender(React.createElement(CompanyWorkAreaMenu, { ...defaults, open: true, onOpenChange }));
    expect(screen.getByRole("button", { name: "Collapse work areas" })).toHaveAttribute("aria-expanded", "true");
  });
  it("focuses the requested original area, closes the menu, and returns keyboard focus", () => {
    const onSelect = vi.fn(), onOpenChange = vi.fn();
    render(React.createElement(CompanyWorkAreaMenu, { ...defaults, open: true, onSelect, onOpenChange }));
    fireEvent.change(screen.getByRole("combobox", { name: "Go to work area" }), { target: { value: "project-a" } });
    expect(onSelect).toHaveBeenCalledWith("project-a");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Collapse work areas" })).toHaveFocus();
  });
  it("supports both Escape and the visible close action without changing areas", () => {
    const onSelect = vi.fn(), onOpenChange = vi.fn();
    render(React.createElement(CompanyWorkAreaMenu, { ...defaults, open: true, onSelect, onOpenChange }));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close work area panel" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
