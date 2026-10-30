import type { OfficeAgent } from "@/features/retro-office/core/types";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";

export function paintCrewNameplate(canvas: HTMLCanvasElement, agent: Pick<OfficeAgent, "name" | "color" | "status" | "needsInput" | "needsReview">, expanded: boolean, workText: string, gearAngle = 0) {
  const activity = getAgentActivity(agent);
  const speaking = activity.kind === "working" && !!workText;
  canvas.width = expanded ? 640 : 512; canvas.height = expanded ? 144 : 128;
  const c = canvas.getContext("2d"); if (!c) return;
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (speaking) {
    // Speech replaces the identity card briefly; the two never overlap.
    c.fillStyle = "#f7f0db"; c.strokeStyle = "#9cb4c3"; c.lineWidth = 4;
    c.beginPath(); c.roundRect(3, 3, canvas.width - 6, canvas.height - 23, 22); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(canvas.width / 2 - 12, canvas.height - 20); c.lineTo(canvas.width / 2, canvas.height - 2); c.lineTo(canvas.width / 2 + 12, canvas.height - 20); c.fill();
    c.fillStyle = "#263746"; c.font = "600 52px system-ui"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(workText, canvas.width / 2, (canvas.height - 20) / 2, canvas.width - 40);
    return;
  }
  c.fillStyle = "#122733"; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = agent.color; c.fillRect(0, 0, 10, canvas.height);
  c.font = expanded ? "600 42px system-ui" : "600 64px system-ui";
  const marker = activity.marker;
  const limit = expanded ? 13 : 6, name = agent.name.length > limit ? `${agent.name.slice(0, limit)}…` : agent.name;
  c.fillStyle = "#f3ecdc"; c.fillText(name, 24, expanded ? 58 : 86, canvas.width - (marker ? 128 : 45));
  if (marker) {
    c.font = activity.kind === "working" ? "600 58px monospace" : "800 72px system-ui";
    c.fillStyle = activity.color; c.textAlign = "center"; c.textBaseline = "middle";
    if (activity.kind === "working") {
      c.save(); c.translate(canvas.width - 52, expanded ? 44 : 66); c.rotate(gearAngle); c.fillText(marker, 0, 0, 86); c.restore();
    } else c.fillText(marker, canvas.width - 52, expanded ? 44 : 66, 86);
    c.textAlign = "left"; c.textBaseline = "alphabetic";
  }
  if (expanded) { c.font = "28px system-ui"; c.fillStyle = "#9cb4c3"; c.fillText(activity.label, 25, 110); }
}
