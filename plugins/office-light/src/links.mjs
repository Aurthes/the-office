export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACCENTS = {
  sage: { label: "Sage", color: "#85b5a2", outfit: "#476a61" },
  blue: { label: "Blue", color: "#8aaed2", outfit: "#425d7b" },
  coral: { label: "Coral", color: "#d79b88", outfit: "#8c5d50" },
  amber: { label: "Amber", color: "#cdb87f", outfit: "#7d714e" },
};

export function normalizeChatLink(value) {
  const text = String(value || "").trim();
  if (UUID.test(text)) return "codex://threads/" + text.toLowerCase();
  try {
    const url = new URL(text);
    const id = url.pathname.replace(/^\/|\/$/g, "");
    if (url.protocol === "codex:" && url.host === "threads" &&
        !url.username && !url.password && !url.search && !url.hash && UUID.test(id)) {
      return "codex://threads/" + id.toLowerCase();
    }
  } catch { /* Report the supported local-link format below. */ }
  throw new Error("Paste a local Codex chat link: codex://threads/<chat-id>.");
}
