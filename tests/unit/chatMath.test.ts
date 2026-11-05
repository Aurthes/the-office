import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionMarkdown } from "@/features/office/components/SessionMarkdown";
import { normalizeMathDelimiters } from "@/lib/text/math-markdown";

afterEach(cleanup);
describe("chat math", () => {
  it("renders Codex inline and display formulas, including the reported Chinese PnL expression", () => {
    const content = String.raw`对应数字：\(15.11775246-40.59425825-1.13571471=\boxed{-26.61222050}\)

\[
\boxed{\text{Total PnL}=\text{配对成交 edge}+\text{配对期末估值}+\text{其余成交 / 持仓 PnL}-\text{手续费}}
\]`;
    const { container } = render(createElement(SessionMarkdown, { content }));
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector("math annotation")?.textContent).toContain("26.61222050");
    expect(container.querySelector(".katex-display math annotation")?.textContent).toContain("手续费");
    expect(container.querySelectorAll(".markdown-code-copy")).toHaveLength(0);
  });
  it("supports dollar formulas without changing normal markdown, lone currency or escaped dollars", () => {
    const { container } = render(createElement(SessionMarkdown, { content: "**Result** $x^2 + y^2$\n\n$$\n\\frac{1}{2}\n$$\n\nCost: $15.00. Escaped: \\$5 and \\$10. `appId`" }));
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("Result");
    expect(container.textContent).toContain("Cost: $15.00. Escaped: $5 and $10.");
    expect(container.querySelector("code")?.textContent).toBe("appId");
  });
  it("keeps multiple monetary amounts literal alongside formulas", () => {
    const { container } = render(createElement(SessionMarkdown, { content: "Costs $5 and $10, then $20. Formula: $x+1$." }));
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(container.textContent).toContain("Costs $5 and $10, then $20.");
  });
  it.each([
    String.raw`\(\frac{1}{`,
    String.raw`\[\frac{1}{`,
    String.raw`$\frac{1}{$`,
    String.raw`$$
\frac{1}{`,
  ])("keeps an incomplete streamed expression readable: %s", content => {
    const view = render(createElement(SessionMarkdown, { content }));
    expect(view.container.textContent).toContain("frac");
    view.rerender(createElement(SessionMarkdown, { content: String.raw`完成：\(\frac{1}{2}\)` }));
    expect(view.container.querySelectorAll(".katex")).toHaveLength(1);
    expect(view.container.querySelector(".katex-error")).toBeNull();
  });
  it.each([
    '`\\(x\\)`',
    '`` ` \\[x\\] ``',
    '```tex\n\\[x\\]\n```',
    '```tex\n\\[x\\]',
    '~~~tex\n\\(x\\)\n~~~',
    '~~~tex\n\\(x\\)',
    '    \\(x\\)\n    \\[y\\]',
    '> ~~~tex\n> \\[x\\]\n> ~~~',
    '- Code:\n\n  ~~~tex\n  \\[x\\]\n  ~~~',
  ])("preserves source and copyable code: %s", content => {
    expect(normalizeMathDelimiters(content)).toBe(content);
    const { container } = render(createElement(SessionMarkdown, { content }));
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain("\\");
  });
  it("preserves escaped delimiters and link destinations", () => {
    const content = String.raw`literal \\(x\\) and [file](./file\(1\).md)`;
    expect(normalizeMathDelimiters(content)).toBe(content);
  });
  it("keeps multiline formulas inside lists and blockquotes", () => {
    const content = "- Result:\n  \\[\n  \\frac{1}{2}\n  \\]\n- Next\n\n> \\[\n> x^2\n> \\]";
    const { container } = render(createElement(SessionMarkdown, { content }));
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("li .katex-display")).not.toBeNull();
    expect(container.querySelector("blockquote .katex-display")).not.toBeNull();
  });
  it("blocks trusted HTML and unsafe link commands inside formulas", () => {
    const { container } = render(createElement(SessionMarkdown, { content: String.raw`\(\href{javascript:alert(1)}{click}\) \(\htmlClass{injected}{x}\)` }));
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector(".injected")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
