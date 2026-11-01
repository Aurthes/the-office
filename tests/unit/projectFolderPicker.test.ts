import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectFolderPicker } from "../../src/features/office/components/ProjectFolderPicker";

afterEach(cleanup);

it("navigates folders without typing paths and recovers from a failed directory read", async () => {
  let fail = true;
  const call = vi.fn(async (_method: string, params: unknown) => {
    const { path } = params as { path?: string };
    if (path === "/host/repo" && fail) { fail = false; throw new Error("Cannot read folder"); }
    return { directory: path || "/host", parent: path ? "/host" : "/", entries: path ? [] : ["repo"] };
  });
  const onPick = vi.fn();
  render(React.createElement(ProjectFolderPicker, { client: { call }, initialPath: "", onPick, onCancel: vi.fn() }));
  await act(async () => {});
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "▸ repo" })); await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent("Cannot read folder");
  expect(screen.getByLabelText("Folder path")).toHaveTextContent("/host");
  fireEvent.click(screen.getByRole("button", { name: "Retry" })); await act(async () => {});
  expect(screen.getByLabelText("Folder path")).toHaveTextContent("/host/repo");
  fireEvent.click(screen.getByRole("button", { name: "↑ Parent folder" })); await act(async () => {});
  expect(screen.getByLabelText("Folder path")).toHaveTextContent("/host");
  fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
  expect(onPick).toHaveBeenCalledWith("/host");
});

it("disables selection until the initial folder loads and permits retry after failure", async () => {
  const call = vi.fn().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce({ directory: "/host", parent: "/", entries: [] });
  render(React.createElement(ProjectFolderPicker, { client: { call }, initialPath: "", onPick: vi.fn(), onCancel: vi.fn() }));
  expect(screen.getByRole("button", { name: "Use this folder" })).toBeDisabled();
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Use this folder" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" })); await act(async () => {});
  expect(call).toHaveBeenLastCalledWith("project.folders.list", { path: undefined });
  expect(screen.getByRole("button", { name: "Use this folder" })).toBeEnabled();
});
