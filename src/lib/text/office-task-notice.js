"use strict";

// Read the controlled association only, never task-like words in the body.
// Null is ordinary text; false is a malformed legacy notice.
function officeTaskNotice(text) {
  const original = text.trim();
  const clean = original.replace(/^\*\*From(?: agent)?: [^\r\n]+\*\*\r?\n\r?\n/, "");
  const uuid = "[a-f\\d]{8}(?:-[a-f\\d]{4}){3}-[a-f\\d]{12}";
  const current = clean !== original && new RegExp(`^\\[((?:\\\\.|[^\\]\\\\\\r\\n])+)\\]\\(task:\\/\\/(${uuid})\\)(?:\\r?\\n|$)`, "i").exec(clean);
  if (current) return { taskId: current[2], title: current[1].replace(/\\([\\`*_[\]<>])/g, "$1").replace(/^T[1-9]\d* · /, "") };
  const legacy = new RegExp(`^(?:Work on delegated Office task|Work on Office task|Office delegation submitted for your acceptance\\. Task|Finish manager acceptance for Office task) (${uuid}): ([^\\r\\n]+)(?:\\r?\\n|$)`, "i").exec(clean);
  if (legacy) {
    let phase;
    try { const update = JSON.parse(clean.split(/\r?\n/)[1]?.replace(/^Task update: /, "")); if (typeof update.phaseTitle === "string") phase = update.phaseTitle; } catch { /* Heading-only historical records. */ }
    return { taskId: legacy[1], title: legacy[2], ...(phase ? { phase } : {}) };
  }
  if (/^(?:Work on (?:delegated )?Office (?:task|to-do)|Office delegation submitted|Finish manager acceptance)/i.test(clean)) return false;
  return null;
}

module.exports = { officeTaskNotice };
