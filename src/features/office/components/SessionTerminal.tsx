"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";
import "@xterm/xterm/css/xterm.css";

type TerminalState = { handle: string; running: boolean; exitCode: number | null; offset: number; dataBase64: string };
type TerminalEvent = TerminalState & { threadId: string; reset?: boolean };
const decode = (text: string) => Uint8Array.from(atob(text), character => character.charCodeAt(0));
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));

export function SessionTerminal({ client, threadId, active = true, label = "Codex", autoFocus = false }: { client: SessionClient; threadId: string; active?: boolean; label?: string; autoFocus?: boolean }) {
  const t = useUiText();
  const host = useRef<HTMLDivElement>(null);
  const write = useRef<((value: string) => void) | null>(null);
  const resync = useRef<(() => Promise<void>) | null>(null);
  const focus = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  const subscribed = useRef(false);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  const [state, setState] = useState<TerminalState | null>(null);
  const [error, setError] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  // Like the chat stream, terminal output has one owner per socket. Keep xterm
  // mounted while cached; hand off only its subscription, never the process.
  useEffect(() => {
    if (!active) return;
    void resync.current?.();
    return () => {
      if (!subscribed.current) return;
      subscribed.current = false;
      void client.call("session.terminal.unsubscribe", { threadId }).catch(() => {});
    };
  }, [active, client, threadId]);
  useEffect(() => {
    let disposed = false, cleanup = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !host.current) return;
      setReloadRequired(false);
      const terminal = new Terminal({ fontSize: 13, fontFamily: 'Menlo, Consolas, monospace', cursorBlink: true, scrollback: 1000,
        theme: { background: "#10161d", foreground: "#dee4e7", cursor: "#d5c49c", selectionBackground: "#485966" } });
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current);
      focus.current = () => terminal.focus();
      terminal.textarea?.setAttribute("aria-label", "Terminal input");
      let current: TerminalState | null = null, syncing = false, retry = false;
      const failed = (cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); };
      const resize = () => {
        if (!activeRef.current || !host.current?.clientWidth || !host.current?.clientHeight) return;
        fit.fit();
        if (current?.running) void client.call("session.terminal.resize", { threadId, handle: current.handle, cols: terminal.cols, rows: terminal.rows }).catch(failed);
      };
      const synchronize = async (queue = false) => {
        if (disposed || !activeRef.current) return;
        if (syncing) { if (queue) retry = true; return; }
        syncing = true;
        setConnected(false);
        try {
          subscribed.current = true;
          const snapshot = await client.call("session.terminal.subscribe", { threadId }) as TerminalState | null;
          if (disposed || !activeRef.current) return;
          const bytes = snapshot ? decode(snapshot.dataBase64) : new Uint8Array(), start = (snapshot?.offset ?? 0) - bytes.length;
          if (!snapshot || !current || snapshot.handle !== current.handle || snapshot.offset < current.offset || start > current.offset) {
            terminal.reset(); if (bytes.length) terminal.write(bytes);
          } else if (snapshot.offset > current.offset) terminal.write(bytes.subarray(Math.max(0, current.offset - start)));
          current = snapshot;
          terminal.options.disableStdin = false;
          setState(snapshot); setError(""); setConnected(true); resize();
        } catch (cause) { failed(cause); }
        finally { syncing = false; if (retry) { retry = false; void synchronize(); } }
      };
      resync.current = () => synchronize(true);
      const unEvent = client.onEvent?.(event => {
        if (event.event !== "session.terminal" || disposed || !activeRef.current) return;
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
        terminal.options.disableStdin = !activeRef.current || status !== "connected";
        if (status !== "connected") setConnected(false);
        if (status === "connected") void synchronize();
        else if (status === "disconnected") failed("Terminal disconnected. Reconnecting…");
      });
      const send = (bytes: Uint8Array) => {
        if (!activeRef.current || !current?.running) return;
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
      cleanup = () => { observer.disconnect(); unEvent?.(); unStatus?.(); input.dispose(); binary.dispose(); terminal.dispose(); };
      await synchronize();
      if (autoFocus && !disposed && activeRef.current) terminal.focus();
    })().catch(cause => {
      if (disposed) return;
      console.warn("Terminal initialization failed", cause);
      setError("The terminal could not load. Reload this page and try again.");
      setReloadRequired(true);
    });
    return () => { disposed = true; write.current = null; resync.current = null; focus.current = null; cleanup(); };
  }, [client, threadId, autoFocus]);
  const action = async (method: "start" | "stop") => {
    if (busy) return;
    setBusy(true); setError("");
    try { await client.call(`session.terminal.${method}`, { threadId, handle: state?.handle }); await resync.current?.(); if (method === "start") focus.current?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="session-terminal flex min-h-0 flex-1 flex-col" onKeyDown={event => event.stopPropagation()}>
    <div className="session-workspace-toolbar">
      <span className="mr-auto text-xs text-white/50">{label} · {state?.running ? t("Running") : state ? t("Exited · {code}", { code: state.exitCode ?? "?" }) : t("No terminal")}</span>
      {[['Tab', '\t'], ['Esc', '\x1b'], ['Ctrl C', '\x03']].map(([label, value]) => <button key={label} disabled={!state?.running || !connected} onClick={() => { write.current?.(value); focus.current?.(); }}>{label}</button>)}
      <button disabled={busy || !connected} onClick={() => void action(state?.running ? "stop" : "start")} aria-label={t(state?.running ? "Close terminal" : "Start terminal")}>{state?.running ? <Square size={14} /> : <Play size={14} />}{t(state?.running ? "Close" : "Start terminal")}</button>
    </div>
    {error ? <p role="alert" className="px-3 py-2 text-xs text-amber-200">{t(error)} <button className="underline" onClick={() => { if (reloadRequired) window.location.reload(); else void resync.current?.(); }}>{t(reloadRequired ? "Reload page" : "Retry")}</button></p> : null}
    <div ref={host} className="min-h-0 flex-1 p-2" />
  </div>;
}
