import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ServerRegistryEditor, parseMachineRows } from "@/features/ring-ship/ServerRegistryEditor";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("accepts a simple batch with default purpose and disabled registrations", () => {
  expect(parseMachineRows("worker01, Research\nworker02, Other, production, no")).toEqual([
    { alias: "worker01", family: "Research", group: "offline", active: true }, { alias: "worker02", family: "Other", group: "online", active: false },
  ]);
  expect(() => parseMachineRows("host, Group, unknown")).toThrow();
  expect(() => parseMachineRows("host, Group, __proto__")).toThrow();
});
it("combines individual and bulk registrations into one instance save", async () => {
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.body ? JSON.parse(String(options.body)) : { hosts: [] } }));
  vi.stubGlobal("fetch", fetch);
  const saved = vi.fn(); render(createElement(ServerRegistryEditor, { onClose: vi.fn(), onSaved: saved }));
  fireEvent.click(await screen.findByRole("button", { name: "Add machine" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 alias" }), { target: { value: "worker01" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 group" }), { target: { value: "Custom" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Bulk machines" }), { target: { value: "database, Custom, production, no" } });
  fireEvent.click(screen.getByRole("button", { name: "Add rows" }));
  fireEvent.click(screen.getByRole("button", { name: "Save machines" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const request = fetch.mock.calls.find(call => call[1]?.method === "PUT")!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({ hosts: [
    { alias: "worker01", family: "Custom", group: "offline", active: true }, { alias: "database", family: "Custom", group: "online", active: false },
  ] });
});
it("keeps an invalid save visible and does not close or report success", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => ({ ok: !options?.method, json: async () => options?.method ? { error: "Each machine alias must be unique." } : { hosts: [] } })));
  const saved = vi.fn(); render(createElement(ServerRegistryEditor, { onClose: vi.fn(), onSaved: saved }));
  fireEvent.click(await screen.findByRole("button", { name: "Save machines" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Each machine alias must be unique."); expect(saved).not.toHaveBeenCalled();
});
