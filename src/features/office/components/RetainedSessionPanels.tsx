"use client";
import { useEffect, useState, type ReactNode } from "react";

export const SESSION_RETENTION_MS = 15 * 60 * 1000;
type Entry = { id: string; instance: number; inactiveAt: number | null; focusMode: boolean };
type Cache = { activeId: string | null; sessionIds: string[]; serial: number; entries: Entry[] };
type PanelState = { active: boolean; focusMode: boolean; onToggleFocus: () => void };

export function RetainedSessionPanels({ activeId, sessionIds, renderPanel }: {
  activeId: string | null;
  sessionIds: string[];
  renderPanel: (id: string, state: PanelState) => ReactNode;
}) {
  const [cache, setCache] = useState<Cache>(() => ({ activeId, sessionIds, serial: 1, entries: activeId && sessionIds.includes(activeId) ? [{ id: activeId, instance: 1, inactiveAt: null, focusMode: false }] : [] }));
  // Reconcile navigation before committing children, so a quick return never
  // paints an empty panel or commits an already-expired instance.
  if (cache.activeId !== activeId || cache.sessionIds !== sessionIds) {
    setCache(previous => {
      const now = Date.now(), valid = new Set(sessionIds);
      let serial = previous.serial;
      const entries = previous.entries.flatMap(entry => {
        // Check the deadline here too: background tabs can delay timer delivery.
        if (!valid.has(entry.id) || (!entry.focusMode && entry.inactiveAt !== null && now - entry.inactiveAt >= SESSION_RETENTION_MS)) return [];
        const inactiveAt = entry.id === activeId ? null : entry.inactiveAt ?? now;
        if (inactiveAt === entry.inactiveAt) return [entry];
        return [{ ...entry, inactiveAt }];
      });
      if (activeId && valid.has(activeId) && !entries.some(entry => entry.id === activeId)) {
        entries.push({ id: activeId, instance: ++serial, inactiveAt: null, focusMode: false });
      }
      return { activeId, sessionIds, serial, entries };
    });
  }

  useEffect(() => {
    const deadlines = cache.entries.filter(entry => !entry.focusMode && entry.inactiveAt !== null).map(entry => entry.inactiveAt! + SESSION_RETENTION_MS);
    if (!deadlines.length) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setCache(previous => ({ ...previous, entries: previous.entries.filter(entry => entry.id === previous.activeId || entry.focusMode || entry.inactiveAt === null || now - entry.inactiveAt < SESSION_RETENTION_MS) }));
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => clearTimeout(timer);
  }, [cache]);

  return <>{cache.entries.map(entry => {
    const active = entry.id === activeId;
    return <div key={entry.instance} data-session-panel={entry.id} hidden={!active} inert={!active} aria-hidden={!active}
      className="min-h-0 min-w-0 flex-1 flex-col" style={{ display: active ? "flex" : "none" }}>
      {renderPanel(entry.id, { active, focusMode: entry.focusMode, onToggleFocus: () => setCache(previous => ({ ...previous, entries: previous.entries.map(item => item.id === entry.id ? { ...item, focusMode: !item.focusMode, inactiveAt: item.id === previous.activeId ? null : Date.now() } : item) })) })}
    </div>;
  })}</>;
}
