"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { remarkMermaidBlocks } from "@/lib/text/mermaid-markdown";
import { normalizeMathDelimiters } from "@/lib/text/math-markdown";

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, remarkMermaidBlocks, [remarkMath, { singleDollarTextMath: false }]];
const rehypePlugins: Options["rehypePlugins"] = [[rehypeKatex, {
  strict: "ignore", trust: false, maxSize: 20, maxExpand: 1000,
  errorColor: "#cbd5e1",
}]];

export function ChatMarkdown({ children, ...props }: Pick<Options, "children" | "components" | "urlTransform">) {
  const text = useMemo(() => normalizeMathDelimiters(children || ""), [children]);
  return <ReactMarkdown {...props} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{text}</ReactMarkdown>;
}
