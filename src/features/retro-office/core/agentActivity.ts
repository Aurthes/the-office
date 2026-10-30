import type { OfficeAgent } from "./types";

const ACTIVITIES = {
  working: { kind: "working", marker: "⚙︎", color: "#6ee7b7", label: "正在工作" },
  waiting: { kind: "waiting", marker: "!", color: "#facc15", label: "等待你处理" },
  review: { kind: "review", marker: "?", color: "#facc15", label: "新结果待查看" },
  error: { kind: "error", marker: "!", color: "#fb7185", label: "工作出错" },
  idle: { kind: "idle", marker: "", color: "#9cb4c3", label: "空闲" },
} as const;
export type AgentActivity = typeof ACTIVITIES[keyof typeof ACTIVITIES];

// A new run supersedes an old unread result. Errors and input requests must
// remain visible even when the native turn is still nominally running.
export function getAgentActivity(agent: Pick<OfficeAgent, "status" | "needsInput" | "needsReview">): AgentActivity {
  if (agent.status === "error") return ACTIVITIES.error;
  if (agent.needsInput) return ACTIVITIES.waiting;
  if (agent.status === "working") return ACTIVITIES.working;
  if (agent.needsReview) return ACTIVITIES.review;
  return ACTIVITIES.idle;
}

const WORK_CHATTER = ["咖啡，续上！", "脑子冒烟了…", "这破 bug…", "键盘要着火了", "让我想想…", "靠，藏得真深"];
export function workChatter(agentId: string, timeMs: number) {
  let seed = 0; for (const char of agentId) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const elapsed = Math.max(0, timeMs) + seed % 24000;
  // Short, staggered flavor text; never a claim about actual task progress.
  if (elapsed % 24000 < 3200) return WORK_CHATTER[(Math.floor(elapsed / 24000) + seed) % WORK_CHATTER.length];
  if (elapsed % 24000 >= 12000 && elapsed % 24000 < 14400) return ".".repeat(1 + Math.floor(elapsed / 650) % 3);
  return "";
}
