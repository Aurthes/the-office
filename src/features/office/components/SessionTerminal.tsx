"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";
import "@xterm/xterm/css/xterm.css";

type TerminalState = { handle: string; running: boolean; exitCode: number | null; offset: number; dataBase64: string };
type TerminalEvent = TerminalState & { threadId: string; reset?: boolean };
const decode = (text: string) => Uint8Array.from(atob(text), character => character.charCodeAt(0));
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));

export function SessionTerminal({ client, threadId }: { client: SessionClient; threadId: string }) {
  const t = useUiText();
  const host = useRef<HTMLDivElement>(null);
  const write = useRef<((value: string) => void) | null>(null);
  const resync = useRef<(() => Promise<void>) | null>(null);
  const focus = useRef<(() => void) | null>(null);
  const [state, setState] = useState<TerminalState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let disposed = false, cleanup = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !host.current) return;
      const terminal = new Terminal({ fontSize: 13, fontFamily: 'Menlo, Consolas, monospace', cursorBlink: true, scrollback: 1000,
        theme: { background: "#10161d", foreground: "#dee4e7", cursor: "#d5c49c", selectionBackground: "#485966" } });
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current);
      focus.current = () => terminal.focus();
      terminal.textarea?.setAttribute("aria-label", "Terminal input");
      let current: TerminalState | null = null, syncing = false;
      const failed = (cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); };
      const resize = () => {
        if (!host.current?.clientWidth || !host.current?.clientHeight) return;
        fit.fit();
        if (current?.running) void client.call("session.terminal.resize", { threadId, handle: current.handle, cols: terminal.cols, rows: terminal.rows }).catch(failed);
      };
      const synchronize = async () => {
        if (syncing || disposed) return;
        syncing = true;
        try {
          const snapshot = await client.call("session.terminal.subscribe", { threadId }) as TerminalState | null;
          if (disposed) return;
          current = snapshot; terminal.reset();
          if (snapshot?.dataBase64) terminal.write(decode(snapshot.dataBase64));
          setState(snapshot); setError(""); setConnected(true); resize();
        } catch (cause) { failed(cause); }
        finally { syncing = false; }
      };
      resync.current = synchronize;
      const unEvent = client.onEvent?.(event => {
        if (event.event !== "session.terminal" || disposed) return;
        const update = event.payload as TerminalEvent;
        if (update.threadId !== threadId) return;
        if (syncing || !current || current.handle !== update.handle) { if (!syncing) void synchronize(); return; }
        const bytes = decode(update.dataBase64), start = update.offset - bytes.length;
        if (update.reset) { terminal.reset(); terminal.write(bytes); }
        else if (start > current.offset) { void synchronize(); return; }
        else if (update.offset > current.offset) terminal.write(bytes.subarray(Math.max(0, current.offset - start)));
        current = { ...update, dataBase64: "" };
        setState(previous => previous?.handle === update.handle && previous.running === update.running && previous.exitCode === update.exitCode ? previous : current);
      });
      const unStatus = client.onStatus?.(status => {
        terminal.options.disableStdin = status !== "connected";
        if (status !== "connected") setConnected(false);
        if (status === "connected") void synchronize();
        else if (status === "disconnected") failed("Terminal disconnected. Reconnecting…");
      });
      const send = (bytes: Uint8Array) => {
        if (!current?.running) return;
        for (let start = 0; start < bytes.length; start += 12 * 1024)
          void client.call("session.terminal.write", { threadId, handle: current.handle, dataBase64: encode(bytes.subarray(start, start + 12 * 1024)) }).catch(failed);
      };
      write.current = value => send(new TextEncoder().encode(value));
      const input = terminal.onData(value => send(new TextEncoder().encode(value)));
      const binary = terminal.onBinary(value => send(Uint8Array.from(value, character => character.charCodeAt(0))));
      let previousSize = "";
      const observer = new ResizeObserver(entries => {
        const box = entries[0]?.contentRect, size = `${box?.width}:${box?.height}`;
        if (size !== previousSize) { previousSize = size; resize(); }
      });
      observer.observe(host.current);
      cleanup = () => { observer.disconnect(); unEvent?.(); unStatus?.(); input.dispose(); binary.dispose(); terminal.dispose();
        void client.call("session.terminal.unsubscribe", { threadId }).catch(() => {}); };
      await synchronize();
    })().catch(cause => { if (!disposed) setError(String(cause)); });
    return () => { disposed = true; write.current = null; resync.current = null; focus.current = null; cleanup(); };
  }, [client, threadId]);
  const action = async (method: "start" | "stop") => {
    if (busy) return;
    setBusy(true); setError("");
    try { await client.call(`session.terminal.${method}`, { threadId, handle: state?.handle }); await resync.current?.(); if (method === "start") focus.current?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="session-terminal flex min-h-0 flex-1 flex-col" onKeyDown={event => event.stopPropagation()}>
    <div className="session-workspace-toolbar">
      <span className="mr-auto text-xs text-white/50">Codex · {state?.running ? t("Running") : state ? t("Exited · {code}", { code: state.exitCode ?? "?" }) : t("No terminal")}</span>
      {[['Tab', '\t'], ['Esc', '\x1b'], ['Ctrl C', '\x03']].map(([label, value]) => <button key={label} disabled={!state?.running || !connected} onClick={() => { write.current?.(value); focus.current?.(); }}>{label}</button>)}
      <button disabled={busy || !connected} onClick={() => void action(state?.running ? "stop" : "start")} aria-label={t(state?.running ? "Close terminal" : "Start terminal")}>{state?.running ? <Square size={14} /> : <Play size={14} />}{t(state?.running ? "Close" : "Start terminal")}</button>
    </div>
    {error ? <p role="alert" className="px-3 py-2 text-xs text-amber-200">{t(error)} <button className="underline" onClick={() => void resync.current?.()}>{t("Retry")}</button></p> : null}
    <div ref={host} className="min-h-0 flex-1 p-2" />
  </div>;
}
