import { safeMermaidSource } from "./mermaid-markdown";

let engine: Promise<typeof import("mermaid")["default"]> | undefined;
export async function renderMermaidSvg(id: string, source: string, dark: boolean) {
  if (!safeMermaidSource(source)) throw new Error("Passive diagram source required");
  engine ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false,
      flowchart: { htmlLabels: false }, suppressErrorRendering: true, maxTextSize: 50000, maxEdges: 500,
      fontFamily: "system-ui, sans-serif" });
    return mermaid;
  }).catch(error => { engine = undefined; throw error; });
  const mermaid = await engine;
  // The user cannot supply frontmatter. Theme belongs to this render request,
  // not a mutable initialize() call that could change another diagram's theme.
  const definition = `---\nconfig:\n  theme: ${dark ? "dark" : "default"}\n---\n${source}`;
  const { svg } = await mermaid.render(id, definition);
  return svg;
}
