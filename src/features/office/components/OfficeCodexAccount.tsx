"use client";
import { useEffect, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

export function OfficeCodexAccount({ client, onAccountChange, quiet = false }: { client: SessionClient; onAccountChange?: (loggedIn: boolean) => void; quiet?: boolean }) {
  const t = useUiText();
  const [required, setRequired] = useState(false), [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [browserFlow, setBrowserFlow] = useState(false), [checked, setChecked] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false;
    const refresh = () => { void client.call("office.account", {}).then(value => {
      if (!stopped) {
        const account = value as { loggedIn: boolean; loginFlow?: string };
        setRequired(!account.loggedIn); setBrowserFlow(account.loginFlow === "browser"); setChecked(true); setError("");
        onAccountChange?.(account.loggedIn);
      }
    }).catch(() => { if (!stopped) { setError(t("Could not check Codex sign-in. Please retry.")); setChecked(true); onAccountChange?.(false); } }); };
    const off = client.onEvent?.(event => { if (event.event === "office.account") refresh(); });
    // The gateway subscription immediately reports its current status, so it
    // also owns the initial read. Avoid a second parallel read on every mount.
    const status = client.onStatus?.(value => { if (value === "connected") refresh(); });
    if (!client.onStatus) refresh();
    return () => { stopped = true; off?.(); status?.(); };
  }, [client, onAccountChange, retry, t]);
  const signIn = (device = false) => {
    setBusy(true); setError("");
    void client.call("office.login", device ? { flow: "device" } : {}).then(value => {
      const result = value as { loggedIn?: boolean; authUrl?: string; verificationUrl?: string; userCode?: string };
      if (result.loggedIn) { setRequired(false); onAccountChange?.(true); return; }
      const target = new URL(result.verificationUrl || result.authUrl || "");
      if (target.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(target.hostname)) throw new Error("Invalid sign-in URL");
      setUrl(target.href); setCode(result.userCode || "");
    }).catch(cause => setError(cause instanceof Error ? cause.message : "Sign-in failed")).finally(() => setBusy(false));
  };
  // Opening a chat only reads the shared account; keep that routine check
  // quiet. Explicit retries and actual sign-in requirements remain visible.
  if (!checked) return quiet && !retry ? null : <p role="status" className="my-2 text-xs text-white/60">{t("Checking Codex sign-in…")}</p>;
  if (!required && !error) return null;
  if (!required) return <div className="my-2 text-xs text-amber-100"><p role="alert">{error}</p><button className="mt-2 min-h-10 underline" onClick={() => { setChecked(false); setRetry(value => value + 1); }}>{t("Retry")}</button></div>;
  return <div className="my-2 rounded-lg border border-cyan-300/25 bg-[#11212c] p-2 text-xs text-white/80">
    <p>{t("Sign in to Codex for Office")}</p>
    <button disabled={busy} className="mt-2 min-h-10 rounded bg-cyan-800 px-3 disabled:opacity-40" onClick={() => signIn()}>{busy ? t("Connecting…") : t("Sign in with ChatGPT")}</button>
    {browserFlow ? <button disabled={busy} className="ml-3 min-h-10 underline" onClick={() => signIn(true)}>{t("Use a sign-in code instead")}</button> : null}
    {url ? <p className="mt-2"><a href={url} target="_blank" rel="noreferrer" className="text-cyan-200 underline">{t("Open OpenAI sign-in")}</a>{code ? <code className="ml-3 select-all text-sm text-white">{code}</code> : null}<span className="mt-1 block text-white/55">{code ? t("Enter this code on the OpenAI sign-in page.") : t("Complete sign-in in a browser on the Office computer.")}</span></p> : null}
    {error ? <p role="alert" className="mt-2 text-amber-100">{t(error)}</p> : null}
  </div>;
}
