import { firefighterPrompt, type FirefighterAlert } from "@/lib/monitoring/firefighter";

export async function dispatchFirefighter(client: { call: (method: string, params: object) => Promise<unknown> }, alert: FirefighterAlert, requestId: string) {
  const worker = await client.call("session.firefighter", {}) as { threadId: string; created: boolean };
  if (!worker.threadId) throw new Error("Could not find the firefighter session.");
  await client.call("session.send", { threadId: worker.threadId, message: firefighterPrompt(alert), requestId, sourcePurpose: "firefighter" });
  return worker;
}
