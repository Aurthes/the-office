import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionTerminal } from "@/features/office/components/SessionTerminal";

vi.mock("@xterm/xterm", () => { throw new Error("ChunkLoadError: Failed to load chunk /_next/static/chunks/old-terminal.js"); });
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("offers a page reload when terminal code cannot load, before any server connection is made", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = { call: vi.fn() };
  render(createElement(SessionTerminal, { client, threadId: "server-a" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The terminal could not load. Reload this page and try again.");
  expect(screen.getByRole("button", { name: "Reload page" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(client.call).not.toHaveBeenCalled();
});
