"use client";
import { useEffect, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

export function OfficeCodexAccount({ client }: { client: SessionClient }) {
  const t = useUiText();
  const [required, setRequired] = useState(false), [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => {
    let stopped = false;
    const refresh = () => { void client.call("office.account", {}).then(value => {
      if (!stopped) { setRequired(!(value as { loggedIn: boolean }).loggedIn); setError(""); }
    }).catch(() => {}); };
    refresh();
    const off = client.onEvent?.(event => { if (event.event === "office.account") refresh(); });
    const status = client.onStatus?.(value => { if (value === "connected") refresh(); });
    return () => { stopped = true; off?.(); status?.(); };
  }, [client]);
  if (!required) return null;
  return <div className="my-2 rounded-lg border border-cyan-300/25 bg-[#11212c] p-2 text-xs text-white/80">
    <p>{t("Sign in to Codex for Office")}</p>
    <button disabled={busy} className="mt-2 min-h-10 rounded bg-cyan-800 px-3 disabled:opacity-40" onClick={() => {
      setBusy(true); setError("");
      void client.call("office.login", {}).then(value => {
        const result = value as { loggedIn?: boolean; authUrl?: string; verificationUrl?: string; userCode?: string };
        if (result.loggedIn) return setRequired(false);
        const target = new URL(result.verificationUrl || result.authUrl || "");
        if (target.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(target.hostname)) throw new Error("Invalid sign-in URL");
        setUrl(target.href); setCode(result.userCode || "");
      }).catch(cause => setError(cause instanceof Error ? cause.message : "Sign-in failed")).finally(() => setBusy(false));
    }}>{busy ? t("Connecting…") : t("Sign in with ChatGPT")}</button>
    {url ? <p className="mt-2"><a href={url} target="_blank" rel="noreferrer" className="text-cyan-200 underline">{t("Open OpenAI sign-in")}</a>{code ? <code className="ml-3 select-all text-sm text-white">{code}</code> : null}<span className="mt-1 block text-white/55">{code ? t("Enter this code on the OpenAI sign-in page.") : t("Complete sign-in in a browser on the Office computer.")}</span></p> : null}
    {error ? <p role="alert" className="mt-2 text-amber-100">{t(error)}</p> : null}
  </div>;
}
