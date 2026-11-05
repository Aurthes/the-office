import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

// Normalize TeX delimiters before Markdown consumes the escaped brackets.
// Use Markdown's own source ranges to preserve every form of code (including
// unfinished streamed fences), links and literal HTML without a second lexer.
export function normalizeMathDelimiters(text: string): string {
  if (!text.includes("\\(") && !text.includes("\\[") && !text.includes("$")) return text;
  const protectedRanges: Array<{ start: number; end: number }> = [];
  const collect = (node: Nodes) => {
    if (["code", "inlineCode", "link", "image", "definition", "html"].includes(node.type)) {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
    } else if ("children" in node) node.children.forEach(collect);
  };
  collect(fromMarkdown(text));
  let range = 0;
  return text.replace(
    /\\\\|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|(?<![\\$])\$(?![\s$])([^\n$]+?)(?<!\s)\$(?![\d$])/g,
    (match, inline: string | undefined, display: string | undefined, dollar: string | undefined, offset: number) => {
      while (protectedRanges[range]?.end <= offset) range++;
      if (match === "\\\\" || (protectedRanges[range] && protectedRanges[range].start < offset + match.length)) return match;
      // Accept a complete $formula$ with non-space edges, not currency pairs
      // such as "$5 and $10". Remark then only needs its unambiguous $$ form.
      if (inline !== undefined || dollar !== undefined) return `$$${inline ?? dollar}$$`;
      const prefix = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
      // Keep existing indentation / quote markers on ordinary multi-line
      // display formulas so they remain inside their list or blockquote.
      if (/^[ \t>]*$/.test(prefix) && display?.startsWith("\n") && display.endsWith("\n" + prefix)) return `$$${display}$$`;
      return `\n\n$$\n${display?.trim()}\n$$\n\n`;
    },
  );
}
