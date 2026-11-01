import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpRight, X } from "lucide-react";
import { RingShipOffice } from "@/features/ring-ship/RingShipOffice";
import { SessionControls, type LiveSessionItem } from "@/features/office/components/SessionControls";
import { SessionTranscript } from "@/features/office/components/SessionTranscript";
import type { OfficeAgent } from "@/features/retro-office/core/types";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import "@/app/globals.css";
import "./style.css";

const projects = [{ id: "web", name: "Website" }, { id: "app", name: "Product" }, { id: "lab", name: "Research" }];
const agents: OfficeAgent[] = [
  { id: "homepage", name: "Build the homepage", status: "working", color: "#8dd4c8", item: "" },
  { id: "design", name: "Choose a direction", status: "idle", needsInput: true, color: "#f0c880", item: "" },
  { id: "review", name: "Review the changes", status: "idle", needsReview: true, color: "#a7b5f1", item: "" },
  { id: "tests", name: "Run the test suite", status: "working", color: "#eea996", item: "" },
  { id: "docs", name: "Write the release notes", status: "idle", color: "#d8abd6", item: "" },
  { id: "resume", name: "Pick up where we left off", status: "idle", color: "#a4c9e6", item: "" },
];
const roster: CompanyRoster = { projects, members: agents.map((agent, i) => ({ id: agent.id, projectId: projects[Math.floor(i / 2)].id })) };
const question = { requestId: "demo-choice", questions: [{ id: "direction", question: "Which direction should the new homepage take?", isOther: true, options: [{ label: "A calm, spacious workspace", description: "Warm colors, clear hierarchy, room to breathe." }, { label: "A bold mission control", description: "Dark surfaces, bright accents, live activity." }] }] };
function initialMessages(id: string): LiveSessionItem[] {
  return [
    { id: `${id}:user`, role: "user", content: id === "design" ? "Help me find a visual direction for our new homepage." : "Help me ship this feature. Keep the changes small and explain the result." },
    { id: `${id}:work`, turnId: "demo", role: "tool", content: "Inspected the project structure and checked the existing components.\nNo changes to production data. (Simulated work log)", status: "completed" },
    { id: `${id}:answer`, role: "assistant", content: id === "design" ? "Two directions fit the brief. Pick the one you prefer, or write your own below." : "### A clear path forward\n\n- Reuse the existing components.\n- Make one focused change.\n- Check the result before shipping.\n\nThis is a **simulated conversation**. In your own Office, these messages come from your Codex runtime." },
  ];
}
function Conversation({ id, onClose }: { id: string; onClose: () => void }) {
  const [messages, setMessages] = useState(() => initialMessages(id));
  const [client] = useState(() => {
    let version = 1, questions = id === "design" ? [question] : [], turnStatus = id === "resume" ? "interrupted" : "completed";
    let subscriptionId = "";
    const listeners = new Set<(event: { event: string; payload?: unknown }) => void>();
    const snapshot = () => ({ threadId: `public-demo:${id}`, subscriptionId, connected: true, version: ++version, activeTurnId: null, turnStatus, items: [], approvals: [], questions, features: { voice: false, dictation: false, prediction: false } });
    const emit = () => { const event = { event: "session.stream", payload: snapshot() }; for (const listener of listeners) listener(event); };
    return { onEvent: (handler: (event: { event: string; payload?: unknown }) => void) => { listeners.add(handler); return () => { listeners.delete(handler); }; }, call: async (method: string, raw: unknown) => {
      const params = raw as { subscriptionId?: string; message?: string; answers?: Record<string, string> };
      if (method === "session.subscribe") { subscriptionId = params.subscriptionId || ""; queueMicrotask(emit); return { subscribed: true }; }
      if (method === "session.unsubscribe") { subscriptionId = ""; return {}; }
      if (["session.send", "session.question.reply", "session.continue"].includes(method)) {
        const text = method === "session.continue" ? "Continue where you left off." : method === "session.question.reply" ? Object.values(params.answers || {}).join("\n") : params.message || "";
        questions = []; turnStatus = "completed";
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: "user", content: text }, { id: crypto.randomUUID(), role: "assistant", content: "Got it. In a connected Office, Codex would continue this task with your answer and the existing conversation history.\n\n**Demo only:** nothing was sent to a model or run on a computer." }]);
        emit();
        return { status: "started", turnId: "demo" };
      }
      throw new Error("This feature needs your own connected Office. See the setup guide on GitHub.");
    } };
  });
  const onItems = useCallback(() => {}, []);
  return <aside className="demo-chat office-session-chat" aria-label="Demo conversation">
    <header><div><small>SIMULATED CONVERSATION</small><h2>{agents.find(a => a.id === id)?.name}</h2></div><button type="button" onClick={onClose} aria-label="Close conversation"><X size={20} /></button></header>
    <div className="demo-transcript"><SessionTranscript messages={messages} /></div>
    <SessionControls client={client} threadId={`public-demo:${id}`} onItems={onItems} />
  </aside>;
}
function Demo() {
  const [selected, setSelected] = useState<string | null>(null);
  return <div className="demo-app">
    <header className="demo-header"><a className="demo-brand" href="https://github.com/Aurthes/the-office">THE OFFICE<span>A home for your Codex conversations.</span></a><div className="demo-links"><span className="demo-badge">INTERACTIVE PREVIEW · SIMULATED DATA</span><a href="https://github.com/Aurthes/the-office#quick-start">Run your own <ArrowUpRight size={14} /></a></div></header>
    <main className="demo-main"><RingShipOffice agents={agents} companyRoster={roster} storageNamespace="public-demo" officeTitle="The Office · Orbital Headquarters" officeTitleLoaded gatewayStatus="demo" onAgentChatSelect={setSelected} />
      {selected ? <Conversation key={selected} id={selected} onClose={() => setSelected(null)} /> : null}
    </main>
    <footer className="demo-footer"><span>Drag to orbit · Scroll to zoom · Click a crewmate to chat</span><span>No account or API key needed. Real execution and connected services are available when self-hosted.</span></footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
