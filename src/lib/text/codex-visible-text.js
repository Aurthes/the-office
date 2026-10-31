"use strict";
function visibleUserText(content) {
  const wrapped = /^\s*# (?:Applications|Files) mentioned by the user:/.test(content) || /^\s*<in-app-browser-context\b/.test(content);
  const marker = wrapped ? [...content.matchAll(/^## My request(?: for Codex)?:[ \t]*\r?$/gm)].at(-1) : undefined;
  if (marker) content = content.slice(marker.index + marker[0].length).trim();
  const realtime = content.trim().match(/^<realtime_delegation>\s*([\s\S]*?)\s*<\/realtime_delegation>$/)
    || (!content.includes("</realtime_delegation>") && content.trim().match(/^<realtime_delegation>\s*([\s\S]*)$/));
  if (realtime) {
    // This is a transport notification, not another user request.
    if (/^<source>\s*transcript_tail_flush\s*<\/source>/.test(realtime[1])) return "";
    // Older gateways can clip the transcript suffix; the complete input is
    // still usable without rendering that clipped transport context.
    const input = realtime[1].match(/^<input>([\s\S]*?)<\/input>(?:\s*<transcript_delta>[\s\S]*<\/transcript_delta>)?\s*$/)
      || realtime[1].match(/^<input>([\s\S]*?)<\/input>\s*<transcript_delta>/);
    if (input) return input[1].trim();
  }
  const reply = content.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/);
  if (reply) {
    try { return JSON.parse(reply[1]).map(item => `${item.question}\n\n${item.answer}`).join("\n\n"); } catch { /* Keep unknown content intact. */ }
  }
  return content;
}
module.exports = { visibleUserText };
