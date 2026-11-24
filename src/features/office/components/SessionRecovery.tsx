import { useUiText } from "@/lib/i18n/ui-language";

export type ModelRecovery = {
  layer: "model"; turnId: string; phase: "reconnecting" | "retrying" | "failed" | "action_required" | "rate_limited";
  code: string | null; message: string; willRetry: boolean;
  attempt: number | null; maxAttempts: number | null; nextRetryAt: number | null;
};
export type RecoveryState = {
  modelRecovery?: ModelRecovery | null; retryAt?: number | null; retrying?: boolean; retryExhausted?: boolean;
  retryAttempt?: number; retryMaxAttempts?: number; retryStopped?: boolean; error?: string | null;
};
export function recoveryLabel(state: RecoveryState | null, connectionError = "") {
  if (connectionError) return "Office connection problem";
  if (state?.retryAt) return state.retrying ? "Office · Retrying the session…" : "Office · Waiting to retry";
  if (state?.retryExhausted) return "Office · Automatic retry failed";
  if (state?.modelRecovery) {
    if (state.retryStopped) return "Model · Recovery stopped";
    if (state.modelRecovery.phase === "action_required") return "Model · Sign-in or access needs attention";
    if (state.modelRecovery.phase === "rate_limited") return "Model · Rate or usage limit";
    if (state.modelRecovery.phase === "retrying") return "Model request problem · Retrying…";
    return state.modelRecovery.phase === "reconnecting" ? "Model connection problem · Reconnecting…" : "Model request failed";
  }
  return null;
}
export function SessionRecoveryDetails({ state, connectionError = "", seconds }: { state: RecoveryState | null; connectionError?: string; seconds: number }) {
  const t = useUiText();
  const label = recoveryLabel(state, connectionError);
  if (!label && !state?.error) return null;
  const waiting = Boolean(state?.retryAt || state?.modelRecovery?.willRetry && !state.retryStopped);
  return <div role={waiting ? "status" : "alert"} className={`mt-2 min-w-0 space-y-1 rounded-lg border p-2 text-xs ${waiting ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-rose-400/30 bg-rose-400/10 text-rose-200"}`} data-session-recovery>
    {label ? <p className="font-semibold break-words">{t(label)}</p> : null}
    {state?.retryAt ? <p>{state.retrying ? t("Retrying the session…") : t("Retrying in {seconds} seconds…", { seconds })}
      {state.retryAttempt !== undefined && state.retryMaxAttempts !== undefined ? <> · {t("Attempt {attempt} of {max}", { attempt: state.retryAttempt, max: state.retryMaxAttempts })}</> : null}</p> : null}
    {state?.retryExhausted ? <p>{t("Automatic retry stopped after 3 attempts.")}</p> : null}
    {state?.modelRecovery && !state.retryAt && !state.retryStopped && state.modelRecovery.willRetry ? <p>{t("Native retry count and next retry time are not available.")}</p> : null}
    <p className="break-words [overflow-wrap:anywhere]">{connectionError || state?.modelRecovery?.message || state?.error}</p>
  </div>;
}
