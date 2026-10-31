import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionWorkspace } from "@/features/office/components/SessionWorkspace";
import { SessionMarkdown } from "@/features/office/components/SessionMarkdown";
import { SessionPreviewContext } from "@/features/office/components/SessionPreviewContext";

afterEach(cleanup);

describe("session side workspace", () => {
  it("browses native project files and previews full text without changing the chat", async () => {
    const client = { call: vi.fn(async (method: string) => method === "session.workspace.list" ? { path: "", entries: [{ name: "code.ts", directory: false }] } : { path: "code.ts", content: "const nativeFile = 42;" }) };
    render(React.createElement(SessionWorkspace, { client, threadId: "original", asset: null, assets: [], onSelectAsset: vi.fn(), onClose: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "code.ts" }));
    expect(await screen.findByText("const nativeFile = 42;")).toBeTruthy();
    expect(client.call).toHaveBeenCalledWith("session.workspace.read", { threadId: "original", path: "code.ts" });
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    expect(client.call.mock.calls.every(([method]) => method.startsWith("session.workspace."))).toBe(true);
  });
  it("uses the original desktop entry for browser pages, without a replacement iframe", async () => {
    const client = { call: vi.fn(async () => ({ path: "", entries: [] })) };
    render(React.createElement(SessionWorkspace, { client, threadId: "original", asset: null, assets: [], onSelectAsset: vi.fn(), onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
    expect(screen.getByRole("link", { name: "Open in Codex" })).toHaveAttribute("href", "codex://threads/original");
    expect(document.querySelector("iframe")).toBeNull();
    await waitFor(() => expect(client.call).toHaveBeenCalledTimes(1));
  });
  it("routes chat attachments to the shared side preview instead of opening another dialog", () => {
    const open = vi.fn(), asset = { source: "image.png", url: "/api/session-assets?ref=image", name: "image.png", kind: "image" as const, attached: true };
    render(React.createElement(SessionPreviewContext.Provider, { value: open }, React.createElement(SessionMarkdown, { content: "An attached image", assets: [asset], user: true })));
    fireEvent.click(screen.getByRole("img", { name: "image.png" }));
    expect(open).toHaveBeenCalledWith(asset); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("offers a download for unsupported attachments instead of loading indefinitely", () => {
    const asset = { source: "report.pdf", url: "/api/session-assets?ref=file", name: "report.pdf", kind: "file" as const };
    const client = { call: vi.fn(async () => ({})) };
    render(React.createElement(SessionWorkspace, { client, threadId: "original", asset, assets: [asset], onSelectAsset: vi.fn(), onClose: vi.fn() }));
    expect(screen.getByText("Download this file to open it.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("download", "report.pdf");
    expect(screen.queryByText("Reading file…")).toBeNull();
  });
});
