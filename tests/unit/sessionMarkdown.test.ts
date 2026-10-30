import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionMarkdown, visibleUserText } from "../../src/features/office/components/SessionMarkdown";
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("renders referenced images through the protected route and opens HTML in an isolated preview", () => {
  const image = { source: "/local/chart.png", name: "chart.png", kind: "image" as const, url: "/api/session-assets?ref=image" };
  const html = { source: "/local/report.html", name: "report.html", kind: "html" as const, url: "/api/session-assets?ref=html" };
  render(React.createElement(SessionMarkdown, { content: "![Chart](/local/chart.png)\n\n[Report](/local/report.html)", assets: [image, html] }));
  expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe(image.url);
  fireEvent.click(screen.getByRole("img", { name: "Chart" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByTitle("放大图片"));
  expect(within(screen.getByRole("dialog")).getByTitle("还原图片")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /返回对话/ }));
  fireEvent.click(screen.getByRole("link", { name: /Report/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  const iframe = screen.getByTitle("report.html"); expect(iframe.getAttribute("src")).toBe(html.url); expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  fireEvent.click(screen.getByRole("button", { name: /返回对话/ })); expect(screen.queryByRole("dialog")).toBeNull();
});
it("renders native image attachments and Markdown files, including file-relative images", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ content: "# File title\n![relative](chart.png)", assets: [{ source: "chart.png", name: "chart.png", kind: "image", url: "/api/session-assets?ref=relative" }] }) })));
  const md = { source: "/local/REPORT.md:29", name: "REPORT.md", kind: "markdown" as const, url: "/api/session-assets?ref=md" };
  render(React.createElement(SessionMarkdown, { content: "[Read](/local/REPORT.md:29)", assets: [md, { source: "attachment:1", name: "Upload", kind: "image", url: "/api/session-assets?ref=upload", inline: true }] }));
  expect(screen.getByRole("img", { name: "Upload" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: /Read/ }));
  await screen.findByRole("heading", { name: "File title" });
  await waitFor(() => expect(screen.getByRole("img", { name: "relative" }).getAttribute("src")).toBe("/api/session-assets?ref=relative"));
});
it("displays the actual user request instead of native ambient transport metadata", () => {
  expect(visibleUserText('# Applications mentioned by the user:\n<appshot>large context</appshot>\n## My request:\nThis is crowded')).toBe("This is crowded");
  expect(visibleUserText('<in-app-browser-context>meta</in-app-browser-context>\n## My request:\nHello')).toBe("Hello");
  expect(visibleUserText('Discuss ## My request: in this code')).toBe('Discuss ## My request: in this code');
});
it("keeps actionable file and image nodes mounted as streamed text grows", () => {
  const assets = [{ source: "/report.md", name: "report.md", kind: "markdown" as const, url: "/api/session-assets?ref=md" }, { source: "/chart.png", name: "chart.png", kind: "image" as const, url: "/api/session-assets?ref=image" }];
  const content = "[Report](/report.md)\n\n![Chart](/chart.png)";
  const view = render(React.createElement(SessionMarkdown, { content, assets }));
  const link = screen.getByRole("link", { name: /Report/ }); const image = screen.getByRole("img", { name: "Chart" });
  view.rerender(React.createElement(SessionMarkdown, { content: content + "\n\nMore live text", assets }));
  expect(screen.getByRole("link", { name: /Report/ })).toBe(link);
  expect(screen.getByRole("img", { name: "Chart" })).toBe(image);
});
it("shows loading and slow feedback for HTML, offers a separate window, and allows a manual retry", () => {
  vi.useFakeTimers();
  try {
    const html = { source: "/report.html", name: "report.html", kind: "html" as const, url: "/api/session-assets?ref=html" };
    render(React.createElement(SessionMarkdown, { content: "[Report](/report.html)", assets: [html] }));
    fireEvent.click(screen.getByRole("link", { name: /Report/ }));
    expect(screen.getByRole("status").textContent).toContain("正在加载");
    const external = screen.getByRole("link", { name: /单独打开/ });
    expect(external.getAttribute("href")).toBe(html.url); expect(external.getAttribute("target")).toBe("_blank");
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole("status").textContent).toContain("继续等待");
    const original = screen.getByTitle("report.html");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(screen.getByTitle("report.html")).not.toBe(original);
    expect(screen.getByTitle("report.html").getAttribute("sandbox")).toBe("allow-scripts");
    fireEvent.load(screen.getByTitle("report.html")); expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /单独打开/ })); expect(screen.queryByRole("dialog")).toBeNull();
  } finally { vi.useRealTimers(); }
});
