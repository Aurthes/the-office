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
  fireEvent.click(within(screen.getByRole("dialog")).getByTitle("Enlarge image"));
  expect(within(screen.getByRole("dialog")).getByTitle("Restore image")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Back to chat/ }));
  fireEvent.click(screen.getByRole("link", { name: /Report/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  const iframe = screen.getByTitle("report.html"); expect(iframe.getAttribute("src")).toBe(html.url); expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  fireEvent.click(screen.getByRole("button", { name: /Back to chat/ })); expect(screen.queryByRole("dialog")).toBeNull();
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
    expect(screen.getByRole("status").textContent).toContain("Loading HTML");
    const external = screen.getByRole("link", { name: /Open separately/ });
    expect(external.getAttribute("href")).toBe(html.url); expect(external.getAttribute("target")).toBe("_blank");
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole("status").textContent).toContain("keep waiting");
    const original = screen.getByTitle("report.html");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByTitle("report.html")).not.toBe(original);
    expect(screen.getByTitle("report.html").getAttribute("sandbox")).toBe("allow-scripts");
    fireEvent.load(screen.getByTitle("report.html")); expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /Open separately/ })); expect(screen.queryByRole("dialog")).toBeNull();
  } finally { vi.useRealTimers(); }
});
it("unwraps native file prompts while preserving ordinary Markdown headings", () => {
  const prompt = '# Files mentioned by the user:\n\n## image.png: /Users/me/uploads/image.png\nImage attachment: true\n\n## My request for Codex:\n\n大概这个样子，嘴是有形状的';
  expect(visibleUserText(prompt)).toBe('大概这个样子，嘴是有形状的');
  expect(visibleUserText(prompt.replaceAll('\n', '\r\n'))).toBe('大概这个样子，嘴是有形状的');
  expect(visibleUserText('<in-app-browser-context>context</in-app-browser-context>\n## My request:\n'+prompt)).toBe('大概这个样子，嘴是有形状的');
  expect(visibleUserText('Please explain this heading:\n## My request for Codex:\nKeep it')).toBe('Please explain this heading:\n## My request for Codex:\nKeep it');
  expect(visibleUserText('# Files mentioned by the user:\n## example.txt: /tmp/example.txt')).toBe('# Files mentioned by the user:\n## example.txt: /tmp/example.txt');
});
it("shows a user's attached image separately before the clean request and preserves full preview", () => {
  const prompt = '# Files mentioned by the user:\n\n## image.png: /Users/me/uploads/image.png\n\n## My request for Codex:\n\n看看鸭嘴';
  const { container } = render(React.createElement(SessionMarkdown, { user: true, content: prompt, assets: [{ source: 'attachment:1', name: 'image.png', kind: 'image', url: '/api/session-assets?ref=image', inline: true }] }));
  expect(screen.queryByText(/Files mentioned|My request|\/Users\/me/)).toBeNull();
  const image = screen.getByRole('img', { name: 'image.png' }), request = screen.getByText('看看鸭嘴');
  expect(image.closest('button')?.className).toContain('session-image-thumbnail');
  expect(image.compareDocumentPosition(request) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(image);
  const enlarged = within(screen.getByRole('dialog')).getByRole('img', { name: 'image.png' });
  expect(enlarged.closest('button')?.className).not.toContain('session-image-thumbnail');
  expect(container.querySelectorAll('.session-image-thumbnail')).toHaveLength(1);
});

it("folds sent long text until explicitly expanded and keeps expansion while history is refreshed", () => {
  const prefix = "说明。".repeat(180), ending = "最终必须看到的完整要求";
  const view = render(React.createElement(SessionMarkdown, { user: true, content: prefix + ending }));
  const expand = screen.getByRole("button", { name: "Expand message" });
  expect(expand).toHaveAttribute("aria-expanded", "false"); expect(screen.queryByText(ending, { exact: false })).toBeNull();
  fireEvent.click(expand);
  expect(screen.getByText(ending, { exact: false })).toBeTruthy();
  view.rerender(React.createElement(SessionMarkdown, { user: true, content: prefix + ending + "，新增同步内容" }));
  expect(screen.getByRole("button", { name: "Collapse message" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("新增同步内容", { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Collapse message" }));
  expect(screen.queryByText(ending, { exact: false })).toBeNull();
});
it("folds many short lines while leaving short sent text and assistant replies fully visible", () => {
  const view = render(React.createElement(SessionMarkdown, { user: true, content: Array.from({ length: 12 }, (_, i) => `第${i + 1}行`).join("\n") }));
  expect(screen.getByRole("button", { name: "Expand message" })).toBeTruthy();
  expect(screen.queryByText("第12行", { exact: false })).toBeNull();
  view.rerender(React.createElement(SessionMarkdown, { user: true, content: "短消息，保持正常展示。" }));
  expect(screen.queryByRole("button", { name: "Expand message" })).toBeNull();
  view.rerender(React.createElement(SessionMarkdown, { content: "完整回复。".repeat(200) }));
  expect(screen.queryByRole("button", { name: "Expand message" })).toBeNull();
  expect(screen.getByText("完整回复。".repeat(200))).toBeTruthy();
});
it("counts the cleaned request and leaves attached thumbnails available outside a folded text bubble", () => {
  const asset = { source: "attachment:1", name: "image.png", kind: "image" as const, url: "/api/session-assets?ref=image", attached: true };
  const wrapper = "# Files mentioned by the user:\n" + "metadata ".repeat(200) + "\n## My request for Codex:\n";
  const view = render(React.createElement(SessionMarkdown, { user: true, content: wrapper + "只显示正文", assets: [asset] }));
  expect(screen.queryByRole("button", { name: "Expand message" })).toBeNull();
  view.rerender(React.createElement(SessionMarkdown, { user: true, content: wrapper + "长正文。".repeat(150), assets: [asset] }));
  expect(screen.getByRole("button", { name: "Expand message" })).toBeTruthy();
  const image = screen.getByRole("img", { name: "image.png" });
  expect(image.closest(".session-user-text")).toBeNull();
  fireEvent.click(image); expect(screen.getByRole("dialog")).toBeTruthy();
});
it("does not leave hidden trailing links focusable in a collapsed message", () => {
  const content = "长文本。".repeat(130) + "\n[末尾链接](https://example.com/details)";
  render(React.createElement(SessionMarkdown, { user: true, content }));
  expect(screen.queryByRole("link", { name: "末尾链接" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand message" }));
  expect(screen.getByRole("link", { name: "末尾链接" })).toHaveAttribute("href", "https://example.com/details");
});

it("shows spoken input without voice transport tags or repeated context", () => {
  const input = "Can you confirm how voice is handled in the office?";
  const raw = `<realtime_delegation>\n  <input>${input}</input>\n  <transcript_delta>${"user: Earlier context\nassistant: Still checking.\n".repeat(120)}</transcript_delta>\n</realtime_delegation>`;
  render(React.createElement(SessionMarkdown, { user: true, content: raw }));
  expect(screen.getByText(input)).toBeTruthy();
  expect(screen.queryByText(/realtime_delegation|transcript_delta|Earlier context/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Expand message" })).toBeNull();
  expect(visibleUserText(raw.replaceAll("\n", "\r\n"))).toBe(input);
});
it("cleans a completed voice input even when an older gateway clipped the transcript suffix", () => {
  const raw = '<realtime_delegation><input>Keep this complete question.</input><transcript_delta>' + 'old context '.repeat(7000);
  expect(visibleUserText(raw.slice(0, 65536))).toBe("Keep this complete question.");
});
it("keeps the full spoken request available when the actual input is long", () => {
  const input = "请保留完整提问。".repeat(80) + "最后一句要求";
  render(React.createElement(SessionMarkdown, { user: true, content: `<realtime_delegation><input>${input}</input><transcript_delta>old context</transcript_delta></realtime_delegation>` }));
  fireEvent.click(screen.getByRole("button", { name: "Expand message" }));
  expect(screen.getByText(input)).toBeTruthy();
});
it("hides a synthetic call-end handoff and preserves literal or unknown markup", () => {
  expect(visibleUserText('<realtime_delegation><source>transcript_tail_flush</source><input>The user just ended their realtime session.</input><transcript_delta>user: Already delegated</transcript_delta></realtime_delegation>')).toBe("");
  for (const literal of ['Explain <realtime_delegation><input>example</input></realtime_delegation>', '```xml\n<realtime_delegation><input>example</input></realtime_delegation>\n```', '<realtime_delegation><unknown>Keep this</unknown></realtime_delegation>']) expect(visibleUserText(literal)).toBe(literal);
});
