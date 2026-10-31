// @vitest-environment node
import { expect, it } from "vitest";
import { prepareHtmlPreview } from "@/lib/security/prepareHtmlPreview";

it("changes only actual self-refresh tags, preserving scripts, comments and inert template markup", () => {
  const untouched = '<!doctype html><html lang="en"><head><!-- <meta http-equiv="refresh" content="1"> --><script>const example = \'<meta http-equiv="refresh" content="1">\';</script></head><body><template><meta http-equiv="refresh" content="1"></template><p>Progress</p></body></html>';
  expect(prepareHtmlPreview(untouched)).toBe(untouched);
  const refresh = '<META CONTENT="3" HTTP-EQUIV=Refresh>';
  const html = untouched.replace("</head>", refresh + "</head>");
  const prepared = prepareHtmlPreview(html);
  expect(prepared.startsWith(untouched + '<script data-claw3d-preview-refresh>')).toBe(true);
  expect(prepared).toContain("claw3d:session-asset-refresh");
  expect(prepared.endsWith(",3000)</script>")).toBe(true);
});

it("uses the first active self-refresh deadline and bounds zero and huge delays", () => {
  const transformed = prepareHtmlPreview('<meta http-equiv="refresh" content="8"><meta http-equiv="refresh" content="2;">');
  expect(transformed.endsWith(",2000)</script>")).toBe(true);
  expect(transformed).not.toContain("<meta");
  expect(prepareHtmlPreview('<meta http-equiv="refresh" content="0">').endsWith(",1000)</script>")).toBe(true);
  expect(prepareHtmlPreview('<meta http-equiv="refresh" content="9999999999999999999">').endsWith(",2147483647)</script>")).toBe(true);
});

it("escapes its source snapshot and avoids duplicating large script payloads", () => {
  const payload = "large-data-".repeat(1000);
  const html = '<meta http-equiv="refresh" content="2"><script>var data="' + payload + '"</script><p>进度</p>';
  const prepared = prepareHtmlPreview(html);
  expect(prepared.split(payload)).toHaveLength(2);
  const bootstrap = prepared.slice(prepared.indexOf('<script data-claw3d-preview-refresh>'));
  expect(bootstrap.match(/<\/script>/g)).toHaveLength(1);
  expect(bootstrap).toContain('\\u003c');
});

it("preserves explicit redirects and malformed refresh values rather than turning them into authenticated navigations", () => {
  for (const content of ["2; url=https://example.com", "2;url=/api/other", "invalid", "-1"]) {
    const html = `<meta http-equiv="refresh" content="${content}">`;
    expect(prepareHtmlPreview(html)).toBe(html);
  }
});
