import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DepartmentAssetsPanel } from "@/features/ring-ship/DepartmentAssetsPanel";
import { setUiLanguage } from "@/lib/i18n/ui-language";
const entry = { kind: "tool" as const, name: "Checker", summary: "Only when needed", instructions: "```sh\nexample --readonly\n```", source: "https://example.com/code", version: "1", status: "active" as const };
beforeEach(() => setUiLanguage("en"));afterEach(() => { cleanup();vi.restoreAllMocks(); });
function openCard(){const details=screen.getByText("Checker").closest("details")!;details.open=true;fireEvent(details,new Event("toggle"));return details;}
it("creates a complete asset, retains a failed draft and retries the same stable ID", async () => {
  const save=vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  render(h(DepartmentAssetsPanel,{departmentId:"dept",entries:{},save}));fireEvent.click(screen.getByRole("button",{name:"Add asset"}));
  for(const [label,value] of [["Asset name","A workflow"],["When to use","When a release is ready"],["Usage, scope and limitations","Review only"],["Source","inline"],["Version","1"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getByLabelText("Asset type"),{target:{value:"workflow"}});fireEvent.click(screen.getByRole("button",{name:"Save asset"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");expect(screen.getByLabelText("Asset name")).toHaveValue("A workflow");
  fireEvent.click(screen.getByRole("button",{name:"Save asset"}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0][0]).toBe("dept");expect(save.mock.calls[0][1]).toBe(save.mock.calls[1][1]);expect(save.mock.calls[1][2]).toMatchObject({kind:"workflow",name:"A workflow",status:"draft"});
  await waitFor(()=>expect(screen.queryByLabelText("Asset name")).toBeNull());
});
it("edits and deprecates by the original key, rendering read-only command text with existing Markdown", async () => {
  const save=vi.fn().mockResolvedValue(undefined);const {rerender}=render(h(DepartmentAssetsPanel,{departmentId:"dept",entries:{stable:entry},save}));
  expect(screen.queryByText("example --readonly")).toBeNull();openCard();expect(await screen.findByText("example --readonly")).toBeTruthy();
  expect(screen.getByRole("link",{name:entry.source})).toHaveAttribute("rel","noopener noreferrer");
  fireEvent.click(screen.getByRole("button",{name:"Edit asset"}));fireEvent.change(screen.getByLabelText("Asset name"),{target:{value:"Renamed"}});fireEvent.click(screen.getByRole("button",{name:"Save asset"}));
  await waitFor(()=>expect(save).toHaveBeenCalledWith("dept","stable",expect.objectContaining({name:"Renamed"})));
  await waitFor(()=>expect(screen.queryByLabelText("Asset name")).toBeNull());
  rerender(h(DepartmentAssetsPanel,{departmentId:"dept",entries:{stable:entry},save}));fireEvent.click(screen.getByRole("button",{name:"Deprecate asset"}));
  await waitFor(()=>expect(save).toHaveBeenCalledWith("dept","stable",expect.objectContaining({status:"deprecated"})));
});
it("groups all kinds, offers no execution action and treats a non-HTTP source as text", async () => {
  render(h(DepartmentAssetsPanel,{departmentId:"dept",entries:{tool:{...entry,source:"javascript:alert(1)"},guide:{...entry,kind:"guideline",name:"Safe guide"},workflow:{...entry,kind:"workflow",name:"SOP"}}}));
  for(const name of ["Guidelines","Workflows","Tools"])expect(screen.getByRole("region",{name})).toBeTruthy();
  openCard();expect(await screen.findByText("javascript:alert(1)")).toBeTruthy();expect(screen.queryByRole("link")).toBeNull();
  expect(within(screen.getByRole("region",{name:"Department assets"})).queryByRole("button",{name:/Run|Execute/})).toBeNull();expect(screen.queryByRole("button",{name:"Add asset"})).toBeNull();
});
