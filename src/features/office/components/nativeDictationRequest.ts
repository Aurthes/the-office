import type { SessionClient } from "./SessionControls";

type Params = { threadId: string; id: string; sequence?: number };
// Preparation and final recognition may outlive the ordinary 20-second RPC.
// The gateway acknowledges promptly, then pushes the result on this connection.
export async function nativeDictationRequest<T>(client: SessionClient, operation: "start" | "finish", params: Params, signal?: AbortSignal): Promise<T> {
  if (!client.onEvent) return client.call("session.dictation." + operation, params) as Promise<T>;
  if (signal?.aborted) throw new Error("Transcription cancelled. Recording kept.");
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const result = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  void result.catch(() => {}); // Cancellation can arrive before the RPC acknowledgement.
  const unsubscribe = client.onEvent(event => {
    const value = event.payload as { threadId?: string; id?: string; operation?: string; result?: T; error?: string } | undefined;
    if (event.event !== "session.dictation" || value?.threadId !== params.threadId || value.id !== params.id || value.operation !== operation) return;
    if (value.error) reject(new Error(value.error)); else resolve(value.result as T);
  });
  const cancel = () => reject(new Error("Transcription cancelled. Recording kept."));
  const timer = setTimeout(() => reject(new Error(operation === "start"
    ? "Native dictation preparation timed out. Recording kept; please retry."
    : "Native dictation completion timed out. Recording kept; please retry.")), 60000);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await client.call("session.dictation." + operation, { ...params, asyncResult: true });
    // Also accept an immediate result from an older gateway during a rollout.
    return (response as { pending?: boolean } | null)?.pending ? await result : response as T;
  } finally { clearTimeout(timer); unsubscribe(); signal?.removeEventListener("abort", cancel); }
}
