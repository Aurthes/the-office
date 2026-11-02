"use client";
import { useState, type ReactNode } from "react";
import type { SessionClient } from "@/features/office/components/SessionControls";
import { OfficeCodexAccount } from "@/features/office/components/OfficeCodexAccount";
import { useUiText } from "@/lib/i18n/ui-language";

export function OfficeOnboarding({ client, connected, agentCount, onComplete, children }: {
  client: SessionClient; connected: boolean; agentCount: number; onComplete: () => void; children?: ReactNode;
}) {
  const t = useUiText();
  const [signedIn, setSignedIn] = useState(false);
  return <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-label={t("Welcome to The Office")} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/15 bg-[#0d1b22] p-6 text-white shadow-2xl">
      <p className="text-[10px] tracking-[.2em] text-amber-200/70">THE OFFICE</p>
      <h2 className="mt-3 text-2xl">{t("Welcome to The Office")}</h2>
      <p className="mt-3 text-sm leading-6 text-white/65">{t("Sign in, choose a working folder, and give your first agent a name.")}</p>
      <p className="mt-2 text-xs leading-5 text-white/45">{t("Office has its own conversations and sign-in. Your existing Codex App stays unchanged.")}</p>
      <div className="my-5 border-y border-white/10 py-4">
        {!connected ? <p role="status">{t("Connecting to your office")}</p> : <>
          <OfficeCodexAccount client={client} onAccountChange={setSignedIn} />
          {signedIn ? <>
            <p className="mb-3 text-xs text-emerald-200">{t("Codex is ready.")}</p>
            {agentCount ? <button className="min-h-11 rounded bg-cyan-800 px-4 text-sm" onClick={onComplete}>{t("Open your office")}</button> : <>
              <p className="mb-3 text-sm text-white/70">{t("Recruit an agent to start. You can create projects and connect other services later.")}</p>
              {children}
            </>}
          </> : null}
        </>}
      </div>
      <button className="min-h-10 text-xs text-white/55 underline" onClick={onComplete}>{t("Explore first")}</button>
    </section>
  </div>;
}
