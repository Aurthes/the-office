"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "the-office:read-completions:v1";
type ReadState = Record<string, string>;
function readState(value: string | null): ReadState {
  try {
    const data = JSON.parse(value || "{}");
    return data && typeof data === "object" && !Array.isArray(data)
      ? Object.fromEntries(Object.entries(data).filter(([, key]) => typeof key === "string")) as ReadState : {};
  } catch { return {}; }
}
function load(): ReadState {
  try { return readState(localStorage.getItem(STORAGE_KEY)); } catch { return {}; }
}

// A browser receipt supplements App-owned unread flags without writing App data.
export function useCompletionReadState(viewed: { id: string; key: string } | null) {
  const [readById, setReadById] = useState<ReadState>(load);
  const current = useRef(readById);
  const markRead = useCallback((id: string, key: string) => {
    if (current.current[id] === key) return;
    const next = { ...load(), ...current.current, [id]: key };
    current.current = next; setReadById(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the in-memory receipt. */ }
  }, []);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = readState(event.newValue);
      current.current = next; setReadById(next);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const id = viewed?.id, key = viewed?.key;
  useEffect(() => {
    const seen = () => { if (id && key && document.visibilityState === "visible") markRead(id, key); };
    seen(); document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [id, key, markRead]);
  return { readById };
}
