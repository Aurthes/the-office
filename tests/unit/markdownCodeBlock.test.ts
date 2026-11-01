import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownCodeComponents } from "@/components/markdown-code-block";
import { SessionMarkdown } from "@/features/office/components/SessionMarkdown";
import { setUiLanguage } from "@/lib/i18n/ui-language";

const clipboard = vi.fn();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
beforeEach(() => {
  setUiLanguage("en");
  clipboard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
});
afterEach(() => {
  cleanup(); setUiLanguage("en"); vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

it("copies only the nested command block, keeping indentation and line breaks", async () => {
  const command = 'cd /tmp/project\nnode scripts/setup.js\n  echo "<ready> & done"\n';
  const content = "1. Run this:\n\n   ```sh\n" + command.split("\n").map(line => "   " + line).join("\n") + "```\n\nThen continue. Inline `appId` stays inline.";
  const { container } = render(createElement(SessionMarkdown, { content }));
  expect(screen.getAllByRole("button", { name: "Copy code" })).toHaveLength(1);
  expect(container.querySelector("pre code")?.className).toBe("language-sh");
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(command);
});

it.each([
  ["```\nplain code\n```", "plain code\n"],
  ["~~~text\noutput\n~~~", "output\n"],
  ["    indented code\n    second line", "indented code\nsecond line\n"],
])("adds a copy button without requiring a language or backtick fence: %s", async (content, expected) => {
  render(createElement(SessionMarkdown, { content }));
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(expected));
});

it("copies the current streamed block and keeps feedback separate for each block", async () => {
  const view = render(createElement(SessionMarkdown, { content: "```sh\necho par" }));
  view.rerender(createElement(SessionMarkdown, { content: "```sh\necho complete\n```\n\n```json\n{}\n```" }));
  const buttons = screen.getAllByRole("button", { name: "Copy code" });
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(buttons[0]).toHaveTextContent("Copied"));
  expect(buttons[1]).toHaveTextContent("Copy");
  expect(clipboard).toHaveBeenLastCalledWith("echo complete\n");
  fireEvent.click(buttons[1]);
  await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith("{}\n"));
});

it("reports a clipboard rejection honestly and allows retry", async () => {
  clipboard.mockRejectedValueOnce(new Error("Permission denied"));
  render(createElement(SessionMarkdown, { content: "```sh\nnpm test\n```" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(screen.getByText("Copy failed")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
});

it("supports HTTP without Clipboard API and restores focus inside the chat dialog", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const exec = vi.fn(() => {
    const input = document.querySelector("dialog textarea") as HTMLTextAreaElement;
    expect(input.value).toBe("npm test\n");
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
  try {
    render(createElement("dialog", { open: true }, createElement(SessionMarkdown, { content: "```sh\nnpm test\n```" })));
    const button = screen.getByRole("button", { name: "Copy code" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(button).toHaveFocus();
  } finally {
    Reflect.deleteProperty(document, "execCommand");
  }
});

it("localizes the shared renderer used by agent chat", async () => {
  setUiLanguage("zh-CN");
  render(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: markdownCodeComponents }, "```ts\nconst answer = 42;\n```"));
  fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
  await waitFor(() => expect(screen.getByText("已复制")).toBeInTheDocument());
  expect(clipboard).toHaveBeenCalledWith("const answer = 42;\n");
});
