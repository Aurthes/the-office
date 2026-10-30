"use strict";
function visibleUserText(content) {
  const marker = content.lastIndexOf("## My request:");
  if (marker >= 0 && (/^\s*# (?:Applications|Files) mentioned by the user:/.test(content) || /^\s*<in-app-browser-context\b/.test(content))) return content.slice(marker + 14).trim();
  const reply = content.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if (reply) {
    try { return JSON.parse(reply[1]).map(item => `${item.question}\n\n${item.answer}`).join("\n\n"); } catch { /* Keep unknown content intact. */ }
  }
  return content;
}
module.exports = { visibleUserText };
