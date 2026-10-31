// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import { htmlPreviewRuntime } from "@/lib/security/htmlPreviewRuntime";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
let dom: { window: Window & typeof globalThis };
afterEach(() => dom?.window.close());
function page(html: string) {
  dom = new JSDOM(html, { runScripts: "outside-only", url: "https://preview.invalid" });
  dom.window.scrollTo = () => {};
  dom.window.eval(`(${htmlPreviewRuntime.toString()})(${JSON.stringify(html)}, 100000)`);
  return dom.window.document;
}
function update(html: string) {
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: dom.window, data: { type: "claw3d:session-asset-update", html } }));
}
it("updates data in place while preserving the document, node identity, focus and edited fields", () => {
  const html = '<html><head><title>Progress</title></head><body><p id="count">1</p><input value="original"><table><tbody><tr><td>running</td></tr></tbody></table></body></html>';
  const doc = page(html), root = doc.documentElement, count = doc.querySelector('#count'), cell = doc.querySelector('td'), input = doc.querySelector('input')!;
  input.value = "my draft"; input.focus(); input.setSelectionRange(2, 4);
  update(html.replace('>1<', '>2<').replace('>running<', '>done<'));
  expect(doc.documentElement).toBe(root); expect(doc.querySelector('#count')).toBe(count); expect(count?.textContent).toBe('2');
  expect(doc.querySelector('td')).toBe(cell); expect(cell?.textContent).toBe('done');
  expect(doc.querySelector('input')).toBe(input); expect(doc.activeElement).toBe(input); expect(input.value).toBe('my draft'); expect(input.selectionStart).toBe(2);
});
it("preserves client-generated content and does not rerun scripts on data updates", () => {
  const html = '<body><p id="count">1</p><div id="plot"></div><script>var data=[1]</script></body>';
  const doc = page(html), plot = doc.querySelector('#plot')!;
  plot.innerHTML = '<canvas data-client-rendered></canvas>';
  const canvas = plot.firstChild;
  update(html.replace('>1<', '>2<').replace('data=[1]', 'data=[2]'));
  expect(plot.firstChild).toBe(canvas); expect(doc.querySelector('#count')?.textContent).toBe('2');
  expect(doc.querySelector('script')?.textContent).toBe('var data=[1]');
});
it("handles inserted and removed rows, changed attributes and stripped refresh tags without replacing the page", () => {
  const html = '<body><table><tbody><tr class="running"><td>one</td></tr></tbody></table></body>';
  const doc = page(html), table = doc.querySelector('table');
  update('<body><meta http-equiv="refresh" content="0"><table><tbody><tr class="done"><td>two</td></tr><tr><td>three</td></tr></tbody></table></body>');
  expect(doc.querySelector('table')).toBe(table); expect(doc.querySelectorAll('tr')).toHaveLength(2); expect(doc.querySelector('tr')).toHaveClass('done'); expect(doc.querySelector('meta')).toBeNull();
  update(html); expect(doc.querySelectorAll('tr')).toHaveLength(1); expect(doc.querySelector('td')?.textContent).toBe('one');
});
