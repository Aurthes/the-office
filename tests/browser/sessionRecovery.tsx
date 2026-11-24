import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionControls, type SessionClient } from "@/features/office/components/SessionControls";
import { SessionTranscript } from "@/features/office/components/SessionTranscript";
import "@/app/globals.css";

declare global { interface Window { setRecoveryFixture: (mode: string) => void; recoveryCalls: string[] } }
window.recoveryCalls = [];
const listeners = new Set<(event: { event: string; payload?: unknown }) => void>();
let subscriptionId = "", version = 0, currentMode = "native";
const modelRecovery = { layer: "model", turnId: "current", phase: "reconnecting", code: "responseStreamConnectionFailed", message: "The model connection was interrupted. Native recovery is in progress.", willRetry: true, attempt: null, maxAttempts: null, nextRetryAt: null };
window.setRecoveryFixture = mode => {
  currentMode = mode;
  const outer = mode === "outer";
  listeners.forEach(handler => handler({ event: "session.stream", payload: { threadId: "synthetic", subscriptionId, connected: true, version: ++version,
    activeTurnId: outer ? null : "current", turnStatus: outer ? "failed" : "inProgress", items: [], approvals: [], features: { voice: false, prediction: false, dictation: false },
    modelRecovery: mode === "healthy" ? null : outer ? { ...modelRecovery, phase: "failed", willRetry: false, message: "Model connection failed." } : modelRecovery, retryAt: outer ? Date.now() + 15000 : null, retryAttempt: outer ? 2 : 0, retryMaxAttempts: 3, retryStopped: mode === "stopped" } }));
};
const client: SessionClient = {
  onEvent: handler => { listeners.add(handler); return () => { listeners.delete(handler); }; },
  call: async (method, params) => {
    window.recoveryCalls.push(method);
    if (method === "session.subscribe") { subscriptionId = (params as { subscriptionId: string }).subscriptionId; queueMicrotask(() => window.setRecoveryFixture(currentMode)); }
    if (method === "session.stop") window.setRecoveryFixture("stopped");
    return {};
  },
};
function Fixture() {
  const [activeTurnId, setActiveTurnId] = useState<string | null>("current");
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);
  return <section className="session-panel mx-auto flex min-h-dvh max-w-3xl flex-col bg-[#101923] text-white" style={{ containerType: "inline-size" }}>
    <h1 className="p-4 text-lg">Connection recovery · isolated fixture</h1>
    <main className="flex-1 space-y-3 p-4"><SessionTranscript messages={[{ id: "current:item", turnId: "current", role: "assistant", phase: "commentary", content: "Earlier work remains available while the model reconnects." }]} activeTurnId={activeTurnId} recoveryStatus={recoveryStatus} /></main>
    <SessionControls client={client} threadId="synthetic" onItems={() => {}} onActiveTurnChange={setActiveTurnId} onRecoveryChange={setRecoveryStatus} />
  </section>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
