import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { SessionMarkdown } from "@/features/office/components/SessionMarkdown";
import { remarkMermaidBlocks, safeMermaidSource } from "@/lib/text/mermaid-markdown";
import { renderMermaidSvg } from "@/lib/text/render-mermaid";
import { setUiLanguage } from "@/lib/i18n/ui-language";
vi.mock("@/lib/text/render-mermaid", () => ({ renderMermaidSvg: vi.fn() }));
const draw = vi.mocked(renderMermaidSvg);
const source = 'flowchart TD\n A["入口"]\n subgraph M["Manager：管理生命周期"]\n B["执行器"]\n C["保留区"]\n B -->|"结束时移交"| C\n end\n A --> B\n B -->|"正常回调"| D["统一记录"]\n C -->|"迟到回调"| D';
const fenced = (code = source) => `\`\`\`mermaid\n${code}\n\`\`\``;
const copy = vi.fn();
const createUrl = vi.fn();
const revokeUrl = vi.fn();
beforeEach(() => {
  setUiLanguage("en"); draw.mockReset().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><text>图</text></svg>');
  copy.mockReset().mockResolvedValue(undefined); createUrl.mockReset().mockReturnValue("blob:diagram"); revokeUrl.mockReset();
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard: { writeText: copy } }));
  vi.spyOn(URL, "createObjectURL").mockImplementation(createUrl); vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeUrl);
});
afterEach(() => { cleanup(); document.documentElement.classList.remove("dark"); setUiLanguage("en"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([
  [fenced(), "true"], ["```mermaid\nflowchart TD\n A-->B", "false"],
  ["1. Diagram\n\n   ~~~mermaid\n   flowchart TD\n    A-->B\n   ~~~", "true"],
  ["> ```mermaid\n> flowchart TD\n>  A-->B\n> ```", "true"],
])("marks only genuinely closed Mermaid fences: %s", (text, expected) => {
  const tree = fromMarkdown(text); remarkMermaidBlocks()(tree, { value: text });
  const found: unknown[] = [];
  function visit(node: typeof tree | (typeof tree.children)[number]) {
    if (node.type === "code") found.push(node.data?.hProperties?.["data-mermaid-closed"]);
    if ("children" in node) node.children.forEach(n => visit(n as (typeof tree.children)[number]));
  }
  visit(tree); expect(found).toEqual([expected]);
});
it("renders the shared Mermaid branch while copying the exact original source", async () => {
  const view = render(createElement(SessionMarkdown, { content: fenced() }));
  await screen.findByRole("img", { name: "Diagram" });
  expect(view.container.querySelector("pre")).not.toBeVisible();
  expect(draw).toHaveBeenCalledWith(expect.stringMatching(/^chat-diagram-/), source, false);
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith(source));
  view.unmount(); expect(revokeUrl).toHaveBeenCalledWith("blob:diagram");
});
it("keeps unclosed/ordinary/untagged/inline code as source and draws after closure", async () => {
  const view = render(createElement(SessionMarkdown, { content: "```mermaid\n" + source }));
  expect(draw).not.toHaveBeenCalled(); expect(view.container.querySelector("pre")).toBeVisible();
  view.rerender(createElement(SessionMarkdown, { content: fenced() })); await screen.findByRole("img", { name: "Diagram" });
  draw.mockClear();
  view.rerender(createElement(SessionMarkdown, { content: `\`flowchart TD\`\n\n\`\`\`sh\n${source}\n\`\`\`\n\n\`\`\`\n${source}\n\`\`\`` }));
  expect(draw).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull();
});
it.each(["render failed", "chunk import failed"])("leaves copyable source when %s", async message => {
  draw.mockRejectedValueOnce(Error(message));
  const view = render(createElement(SessionMarkdown, { content: fenced() }));
  await screen.findByText("Could not render diagram. Source shown.");
  expect(view.container.querySelector("pre")).toBeVisible(); expect(screen.queryByRole("img")).toBeNull();
});
it("ignores old source/theme completions and cleans up only its own image URL", async () => {
  const done: Array<(svg: string) => void> = [];
  draw.mockImplementation(() => new Promise(resolve => done.push(resolve)));
  const view = render(createElement(SessionMarkdown, { content: fenced("flowchart TD\n A-->B") }));
  view.rerender(createElement(SessionMarkdown, { content: fenced("flowchart TD\n C-->D") }));
  act(() => document.documentElement.classList.add("dark"));
  await waitFor(() => expect(done).toHaveLength(3));
  await act(async () => { done[0]("old"); done[1]("old-theme"); });
  expect(createUrl).not.toHaveBeenCalled();
  await act(async () => done[2]("current"));
  expect(createUrl).toHaveBeenCalledTimes(1); await screen.findByRole("img", { name: "Diagram" });
  view.unmount(); expect(revokeUrl).toHaveBeenCalledTimes(1);
});
it("gives simultaneous diagrams independent render IDs", async () => {
  render(createElement(SessionMarkdown, { content: fenced() + "\n\n" + fenced("sequenceDiagram\n A->>B: Hello") }));
  await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
  expect(draw.mock.calls[0][0]).not.toBe(draw.mock.calls[1][0]);
});
it.each([
  '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\n A-->B',
  '---\nconfig:\n securityLevel: loose\n---\nflowchart TD\n A-->B',
  'flowchart TD\n A["<img src=x onerror=alert(1)>"]',
  'flowchart TD\n A-->B\n click A "https://example.com"',
  'flowchart TD\n A@{img: "https://example.com/x"}',
  'flowchart TD\n classDef red fill:url(https://example.com/x)',
  'flowchart TD\n classDef red fill:\\75rl(x)',
  'flowchart TD\n A["&#60;script&#62;alert(1)&#60;/script&#62;"]',
  "x".repeat(50001),
])("keeps active or oversized input away from the engine", async code => {
  expect(safeMermaidSource(code)).toBe(false);
  const view = render(createElement(SessionMarkdown, { content: fenced(code) }));
  await act(async () => {}); expect(draw).not.toHaveBeenCalled(); expect(view.container.querySelector("pre")).toBeVisible();
  expect(view.container.querySelector("script, svg:not(.lucide), iframe, img")).toBeNull();
});
