export type SiteTask = string | { taskId: string; title: string; phase?: string; revision?: number };
export type FieldworkTaskSummary = {
  id: string; title: string; status: string; archived: boolean; handlingAgentId?: string | null;
  revision?: number; lastStartedAt?: number; phases?: { title: string; completedAt?: number | null }[];
};

export function isTaskContinuation(text: string) {
  return /^(go|continue(?: where you left off)?|fix|deploy|yes|ok(?:ay)?|继续|修复|部署|好的|可以)[.!！。\s]*$/i.test(text.trim())
    || /^(?:Automatic deployment receipt|自动部署回执|<send_user_message_question_reply>)/i.test(text.trim());
}

// Only the controlled heading is a work target. The JSON/body can contain
// reports, cleanup instructions and examples of completely unrelated rooms.
export function siteTaskMessage(text: string): SiteTask | null {
  if (!text.trim() || isTaskContinuation(text)) return null;
  const match = /^(?:Work on delegated Office task|Work on Office task|Office delegation submitted for your acceptance\. Task|Finish manager acceptance for Office task) ([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}): ([^\r\n]+)(?:\r?\n|$)/i.exec(text.trim());
  if (match) return { taskId: match[1], title: match[2] };
  if (/^(?:Work on (?:delegated )?Office task|Office delegation submitted|Finish manager acceptance)/i.test(text.trim())) return "";
  return isWorkDirective(text) ? text.slice(0, 12000) : "";
}
export function latestSiteTask(messages: readonly { role: string; content: string }[]): SiteTask | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const task = siteTaskMessage(message.content);
    if (task !== null) return task;
  }
  return null;
}
export function taskSiteGoal(task: FieldworkTaskSummary): Exclude<SiteTask, string> {
  return { taskId: task.id, title: task.title, revision: task.revision, phase: task.phases?.find(p => p.completedAt == null)?.title };
}
// Documentation/review revisions do not change a work goal. A different task,
// phase, title or start epoch does invalidate an accepted live directive.
export function siteTaskKey(task: FieldworkTaskSummary) {
  return JSON.stringify([task.id, task.title, task.phases?.find(p => p.completedAt == null)?.title, task.lastStartedAt]);
}
export function currentFieldworkTask(tasks: readonly FieldworkTaskSummary[], agentId: string) {
  const active = tasks.filter(t => !t.archived && t.status === "running" && t.handlingAgentId === agentId);
  return active.length === 1 ? active[0] : undefined;
}

// Conservative target clauses, not arbitrary mentions in instructions/logs.
export function workTargetText(text: string) {
  return text.replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/(?:https?:\/\/|(?:[~.]?\/|[A-Za-z]:\\)|\b[\w.-]+\/)[^\s，。；;]+/g, " ")
    .replace(/[（(](?:比如|例如|for example|e\.g\.)[^)）]*[)）]/gi, " ")
    .split(/[\n。！？!?；;，,]/)
    .filter(clause => !/(?:清理.*(?:目录|缓存|临时)|cleanup|保护|保留|不要|不得|不能|不改|不修改|不调整|不操作|不涉及|不动|不去|别改|别动|无需|例如|比如|示例|举例|\b(?:preserve|protect|keep|except|example|without|not|do not|don't|must not)\b)/i.test(clause))
    .join(" ").trim();
}
export function isWorkDirective(text: string) {
  return /(?:调整|修改|修复|实现|换一|增加|新增|移除|移动|更换|检查|改进|优化|处理|更新|开发|施工|\b(?:fix|change|update|implement|build|repair|adjust|improve|move|add|remove)\b)/i.test(workTargetText(text));
}
