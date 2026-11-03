export function isTaskContinuation(text: string) {
  return /^(go|continue(?: where you left off)?|fix|deploy|yes|ok(?:ay)?|继续|修复|部署|好的|可以)[.!！。\s]*$/i.test(text.trim())
    || /^(?:Automatic deployment receipt|自动部署回执|<send_user_message_question_reply>)/i.test(text.trim());
}
export function latestSiteTask(messages: readonly { role: string; content: string }[]): string | null {
  for (const message of [...messages].reverse()) if (message.role === "user" && message.content.trim() && !isTaskContinuation(message.content)) return message.content.slice(0, 12000);
  return null;
}
