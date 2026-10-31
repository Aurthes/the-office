import { parse, type DefaultTreeAdapterMap } from "parse5";

// Only embedded previews delegate self-refresh to the authenticated parent.
// Keep the original document bytes, CSP and opaque sandbox everywhere else.
export function prepareHtmlPreview(html: string): string {
  const removals: { start: number; end: number }[] = [];
  let delay = Infinity;
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node && node.tagName === "meta") {
      const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
      const seconds = attrs.content?.match(/^\s*(\d+(?:\.\d+)?)\s*;?\s*$/);
      if (attrs["http-equiv"]?.toLowerCase() === "refresh" && seconds && node.sourceCodeLocation) {
        delay = Math.min(delay, Math.max(1000, Math.min(2_147_483_647, Number(seconds[1]) * 1000)));
        removals.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset });
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  if (!removals.length) return html;
  for (const { start, end } of removals.sort((a, b) => b.start - a.start)) html = html.slice(0, start) + html.slice(end);
  // The parent accepts this only from its current frame and reloads the same
  // signed file URL. Never grant the file access to app cookies or the DOM.
  return html + `<script>setTimeout(function(){parent.postMessage("claw3d:session-asset-refresh","*")},${delay})</script>`;
}
