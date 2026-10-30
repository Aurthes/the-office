"use strict";
function visibleUserText(content) {
  const wrapped = /^\s*# (?:Applications|Files) mentioned by the user:/.test(content) || /^\s*<in-app-browser-context\b/.test(content);
  const marker = wrapped ? [...content.matchAll(/^## My request(?: for Codex)?:[ \t]*\r?$/gm)].at(-1) : undefined;
  if (marker) return content.slice(marker.index + marker[0].length).trim();
  const reply = content.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if (reply) {
    try { return JSON.parse(reply[1]).map(item => `${item.question}\n\n${item.answer}`).join("\n\n"); } catch { /* Keep unknown content intact. */ }
  }
  return content;
}
module.exports = { visibleUserText };
