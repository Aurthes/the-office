"use strict";
const { describeSessionAssets } = require("./codex-session-assets");
const { visibleUserText } = require("../src/lib/text/codex-visible-text");

// Preserve native phases. Only public reasoning summaries belong in the UI.
function sessionItem(item, turnId) {
  const base = { id: `${turnId}:${item.id}`, turnId };
  if (item.type === "userMessage") {
    const content = (item.content || []).filter(p => ["text", "inputText", "input_text"].includes(p.type)).map(p => p.text).join("\n");
    return { ...base, role: "user", content: visibleUserText(content), assets: describeSessionAssets(content, item.content || []) };
  }
  if (item.type === "agentMessage") return { ...base, role: "assistant", phase: item.phase, content: item.text || "", assets: describeSessionAssets(item.text || "") };
  if (item.type === "plan") return { ...base, role: "assistant", phase: "partial_answer", content: item.text || "" };
  const text = item.type === "reasoning" ? (item.summary || []).join("\n")
    : item.command || item.tool || item.query || ({ fileChange: "修改文件", webSearch: "搜索网页", mcpToolCall: "调用工具", dynamicToolCall: "调用工具", collabToolCall: "协作任务", contextCompaction: "整理上下文" })[item.type];
  return text ? { ...base, role: "tool", content: text, status: item.status } : null;
}

function clipText(text, limit) {
  const bytes = Buffer.from(text, "utf8");
  return { content: new TextDecoder().decode(bytes.subarray(0, limit), { stream: true }), truncated: bytes.length > limit };
}
module.exports = { sessionItem, clipText };
