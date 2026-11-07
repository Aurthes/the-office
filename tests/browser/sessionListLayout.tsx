import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentDirectory } from "@/features/office/components/AgentDirectory";
import { SessionListDivider } from "@/features/office/components/SessionListDivider";
import { SessionMessageLocation } from "@/features/office/components/SessionMessageLocation";
import { useSessionListLayout } from "@/features/office/hooks/useSessionListLayout";
import { getAgentActivity } from "@/features/retro-office/core/agentActivity";
import type { MessageSearchTarget } from "@/features/office/components/MessageSearchResults";
import "@/app/globals.css";

declare global { interface Window { sessionListFixtureContentClass: string } }
const target: MessageSearchTarget = { requestId: "archive", threadId: "old", name: "Archived fixture", project: "Fixture", archived: true, itemId: "answer", turnId: "past", turnCursor: "past", messageId: "past:answer", snippet: "Archived answer", snippetMatchRange: { start: 0, end: 8 } };
const client = { call: async () => ({ threadId: "old", name: target.name, project: "Fixture", archived: true, messageId: target.messageId,
  messages: [{ id: target.messageId, turnId: "past", role: "assistant", phase: "final_answer", content: "Archived answer" }], olderOffset: null, newerOffset: null }) };
const agents = [{ id: "fixture", name: "Fixture worker", projectId: null, projectName: "Fixture", updatedAt: 1, color: "#92dce4", activity: getAgentActivity({ status: "idle" }) }];
const organization = { ceoAvatar: null, savePosition: async () => {}, people: [{ id: "fixture", name: "Fixture worker", title: "Worker", department: "Fixture", departmentId: null, reportsTo: [] }] };

function App() {
  const { container, overlay, collapsed, setCollapsed, openChat, update } = useSessionListLayout(true);
  const [open, setOpen] = useState(false), [archived, setArchived] = useState(false), [width, setWidth] = useState(500);
  const [search, setSearch] = useState("");
  const openSpecificChat = () => { openChat(); setOpen(true); setArchived(false); };
  const toggle = <button type="button" aria-controls="session-chat-list" aria-expanded={!collapsed} aria-label={collapsed ? "Open session list" : "Close session list"} onClick={() => setCollapsed(value => !value)}>Sessions</button>;
  return <>
    <div className="flex gap-4 p-2">
      <button onClick={openSpecificChat}>Open specific chat externally</button>
      <button onClick={() => setOpen(false)}>Close chat</button>
      <label>Container width<input aria-label="Container width" type="number" value={width} onChange={event => setWidth(Number(event.target.value))} /></label>
    </div>
    <div className="office-session-chat" style={{ display: open ? "flex" : "none", width, height: 600 }}>
      <div ref={container} className="session-chat-layout relative flex min-h-0 w-full flex-1 overflow-hidden" data-session-list-mode={overlay ? "overlay" : "split"} onKeyDown={event => {
        if (overlay && !collapsed && event.key === "Escape") { event.stopPropagation(); setCollapsed(true); }
      }}>
        {overlay && !collapsed ? <button aria-label="Backdrop dismiss" className="session-list-backdrop" onClick={() => setCollapsed(true)} /> : null}
        {!collapsed ? <AgentDirectory agents={agents} organization={organization} view="organization" onViewChange={() => {}} search={search} onSearchChange={setSearch} selectedId="fixture"
          onOpenChat={openSpecificChat} onOpenTask={() => {}} onDismiss={overlay ? () => setCollapsed(true) : undefined} /> : null}
        {!overlay && !collapsed ? <SessionListDivider onResize={update} /> : null}
        {/* Read from the owning OfficeScreen JSX, so missing isolation fails hit tests. */}
        <div className={window.sessionListFixtureContentClass} data-testid="chat-content">
          <div hidden={archived}>
            <header className="flex p-3">{toggle}</header>
            <textarea aria-label="Preserved draft" defaultValue="Unsent draft" />
            <button onClick={() => { openChat(); setArchived(true); }}>Open archived result</button>
          </div>
          {archived ? <SessionMessageLocation client={client} target={target} onClose={() => setArchived(false)} headerStart={toggle} /> : null}
        </div>
      </div>
    </div>
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
