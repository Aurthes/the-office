// @vitest-environment node
import { expect, it } from "vitest";
import { prepareHtmlPreview } from "@/lib/security/prepareHtmlPreview";

it("changes only actual self-refresh tags, preserving scripts, comments and inert template markup", () => {
  const untouched = '<!doctype html><html lang="en"><head><!-- <meta http-equiv="refresh" content="1"> --><script>const example = \'<meta http-equiv="refresh" content="1">\';</script></head><body><template><meta http-equiv="refresh" content="1"></template><p>Progress</p></body></html>';
  expect(prepareHtmlPreview(untouched)).toBe(untouched);
  const refresh = '<META CONTENT="3" HTTP-EQUIV=Refresh>';
  const html = untouched.replace("</head>", refresh + "</head>");
  expect(prepareHtmlPreview(html)).toBe(untouched + '<script>setTimeout(function(){parent.postMessage("claw3d:session-asset-refresh","*")},3000)</script>');
});

it("uses the first active self-refresh deadline and bounds zero and huge delays", () => {
  const transformed = prepareHtmlPreview('<meta http-equiv="refresh" content="8"><meta http-equiv="refresh" content="2;">');
  expect(transformed).toContain("},2000)");
  expect(transformed).not.toContain("<meta");
  expect(prepareHtmlPreview('<meta http-equiv="refresh" content="0">')).toContain("},1000)");
  expect(prepareHtmlPreview('<meta http-equiv="refresh" content="9999999999999999999">')).toContain("},2147483647)");
});

it("preserves explicit redirects and malformed refresh values rather than turning them into authenticated navigations", () => {
  for (const content of ["2; url=https://example.com", "2;url=/api/other", "invalid", "-1"]) {
    const html = `<meta http-equiv="refresh" content="${content}">`;
    expect(prepareHtmlPreview(html)).toBe(html);
  }
});
