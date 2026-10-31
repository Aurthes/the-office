// Runs inside the opaque preview frame. Keep this function self-contained: the
// server serializes it into the document, without exposing app APIs or cookies.
export function htmlPreviewRuntime(initialHtml: string, delay: number) {
  const model = (html: string) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll('meta[http-equiv]').forEach(meta => {
      if (meta.getAttribute("http-equiv")?.toLowerCase() === "refresh") meta.remove();
    });
    // Scripts initialize the page once. Their generated DOM and local state
    // survive updates when the corresponding server markup has not changed.
    parsed.querySelectorAll("script").forEach(script => { script.textContent = ""; });
    return parsed;
  };
  let previous = model(initialHtml);
  const patch = (live: Node, before: Node, after: Node) => {
    if (before.isEqualNode(after)) return;
    if (before.nodeType !== after.nodeType || before.nodeName !== after.nodeName) {
      live.parentNode?.replaceChild(after.cloneNode(true), live);
      return;
    }
    if (!(after instanceof Element)) {
      live.nodeValue = after.nodeValue;
      return;
    }
    if (!(live instanceof Element) || !(before instanceof Element) || after.tagName === "SCRIPT") return;
    for (const attr of Array.from(before.attributes)) {
      if (!after.hasAttribute(attr.name)) live.removeAttribute(attr.name);
    }
    for (const attr of Array.from(after.attributes)) {
      if (before.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
    }
    const current = Array.from(live.childNodes).filter(node => !(node instanceof Element && node.hasAttribute("data-claw3d-preview-refresh")));
    const old = Array.from(before.childNodes);
    const next = Array.from(after.childNodes);
    for (let i = 0; i < Math.max(old.length, next.length); i++) {
      if (!next[i]) current[i]?.parentNode?.removeChild(current[i]);
      else if (!old[i] || !current[i]) live.insertBefore(next[i].cloneNode(true), live.querySelector(":scope > script[data-claw3d-preview-refresh]"));
      else patch(current[i], old[i], next[i]);
    }
  };
  const schedule = () => setTimeout(() => window.parent.postMessage("claw3d:session-asset-refresh", "*"), delay);
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.type !== "claw3d:session-asset-update") return;
    try {
      if (typeof event.data.html === "string") {
        const next = model(event.data.html);
        const x = window.scrollX, y = window.scrollY;
        patch(document.documentElement, previous.documentElement, next.documentElement);
        previous = next;
        window.scrollTo(x, y);
      }
    } finally { schedule(); }
  });
  schedule();
}
