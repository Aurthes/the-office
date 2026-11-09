import type { Root, Nodes } from "mdast";

// Markdown has already identified the code node; inspect only its original
// source range to keep unfinished streamed fences as ordinary copyable code.
export function remarkMermaidBlocks() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: Nodes) => {
      if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
        const lines = raw.split(/\r?\n/);
        const open = lines[0]?.match(/^(`{3,}|~{3,})/);
        const close = lines.at(-1)?.match(/^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})[ \t]*$/);
        const closed = Boolean(lines.length > 1 && open && close && open[1][0] === close[1][0] && close[1].length >= open[1].length);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, "data-mermaid-closed": String(closed) } };
      }
      if ("children" in node) node.children.forEach(visit);
    };
    visit(tree);
  };
}

export function safeMermaidSource(source: string) {
  if (!source.trim() || source.length > 50000) return false;
  const plain = source.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, hex: string, decimal: string) => {
    const code = parseInt(hex || decimal, hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
  // Diagrams are passive pictures. User config, HTML, links, images and resource
  // URLs stay source-only rather than reaching Mermaid's temporary render DOM.
  return !/^\s*(?:---|%%\s*\{)/m.test(plain)
    && !/<\/?[a-z][^>]*>/i.test(plain)
    && !/\b(?:click|href|callback|linkTarget)\b/i.test(plain)
    && !/(?:https?:|javascript:|vbscript:|data:|file:|ftp:|\/\/|url\s*\()/i.test(plain)
    && !/\b(?:img|image|icon)\s*:/i.test(plain)
    && !/\\[\da-f]{1,6}\s?/i.test(plain);
}
