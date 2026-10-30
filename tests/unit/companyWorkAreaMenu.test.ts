import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyWorkAreaMenu } from "@/features/office/components/CompanyWorkAreaMenu";
afterEach(cleanup);
const areas = [{ id: "project-a", name: "Project A", agentIds: ["native-thread"] }];
const defaults = { areas, activeId: "", sessionCount: 1, open: false, onOpenChange: vi.fn(), onSelect: vi.fn() };

describe("company work area menu", () => {
  it("opens from the compact trigger and exposes its expanded state", () => {
    const onOpenChange = vi.fn();
    const view = render(React.createElement(CompanyWorkAreaMenu, { ...defaults, onOpenChange }));
    fireEvent.click(screen.getByRole("button", { name: "展开公司工区" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    view.rerender(React.createElement(CompanyWorkAreaMenu, { ...defaults, open: true, onOpenChange }));
    expect(screen.getByRole("button", { name: "收起公司工区" })).toHaveAttribute("aria-expanded", "true");
  });
  it("focuses the requested original area, closes the menu, and returns keyboard focus", () => {
    const onSelect = vi.fn(), onOpenChange = vi.fn();
    render(React.createElement(CompanyWorkAreaMenu, { ...defaults, open: true, onSelect, onOpenChange }));
    fireEvent.change(screen.getByRole("combobox", { name: "前往工区" }), { target: { value: "project-a" } });
    expect(onSelect).toHaveBeenCalledWith("project-a");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "收起公司工区" })).toHaveFocus();
  });
  it("supports both Escape and the visible close action without changing areas", () => {
    const onSelect = vi.fn(), onOpenChange = vi.fn();
    render(React.createElement(CompanyWorkAreaMenu, { ...defaults, open: true, onSelect, onOpenChange }));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "关闭工区面板" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
