import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { htmlPreviewRuntime } from "./htmlPreviewRuntime";

// Only embedded previews delegate data reads to the authenticated parent.
// Keep the frame mounted, its CSP and its opaque sandbox intact.
export function prepareHtmlPreview(html: string): string {
  const removals: { start: number; end: number }[] = [];
  let delay = Infinity;
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node && node.tagName === "script") node.childNodes = [];
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
  const document = parse(html, { sourceCodeLocationInfo: true });
  visit(document);
  if (!removals.length) return html;
  for (const { start, end } of removals.sort((a, b) => b.start - a.start)) html = html.slice(0, start) + html.slice(end);
  // The source snapshot distinguishes server changes from interactive DOM that
  // the page created itself. Omit script payloads and escape HTML delimiters so
  // file content cannot terminate the generated bootstrap script.
  const initial = JSON.stringify(serialize(document)).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return html + `<script data-claw3d-preview-refresh>(${htmlPreviewRuntime.toString()})(${initial},${delay})</script>`;
}
