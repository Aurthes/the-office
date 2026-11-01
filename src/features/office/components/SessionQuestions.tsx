"use client";
import { useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";
export type SessionQuestionRequest = { requestId: string; submitted?: boolean; questions: { id: string; header?: string; question: string; defaultAnswer?: string; isOther?: boolean; isSecret?: boolean; options?: { label: string; description?: string }[] | null }[] };
export function SessionQuestions({ client, threadId, request }: { client: SessionClient; threadId: string; request: SessionQuestionRequest }) {
  const t = useUiText();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false), [submitted, setSubmitted] = useState(false), [error, setError] = useState("");
  const sending = useRef(false), nonce = useRef(crypto.randomUUID());
  const disabled = busy || submitted || request.submitted;
  const complete = (values: Record<string, string>) => request.questions.every(q => values[q.id]?.trim());
  const hasCustomAnswer = request.questions.some(q => !q.options?.length || other[q.id]);
  const submit = async (values: Record<string, string>) => {
    if (sending.current || disabled || !complete(values)) return;
    sending.current = true; setBusy(true); setError("");
    try {
      await client.call("session.question.reply", { threadId, promptId: request.requestId, requestId: nonce.current,
        answers: Object.fromEntries(request.questions.map(q => [q.id, values[q.id]])) });
      setSubmitted(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Answer not confirmed. Check before retrying."); }
    finally { sending.current = false; setBusy(false); }
  };
  const choose = (id: string, value: string) => {
    if (sending.current || disabled) return;
    const next = { ...answers, [id]: value }, custom = { ...other, [id]: false };
    setAnswers(next); setOther(custom);
    // Native requests accept one answer batch. Never send an untouched default
    // or custom text that the user has not explicitly submitted.
    if (request.questions.every(q => q.options?.length && !custom[q.id]) && complete(next)) void submit(next);
  };
  return <form aria-label={t("Waiting for your answer")} aria-busy={busy} className="mb-3 rounded-lg border border-amber-300/30 bg-amber-300/5 p-3" onSubmit={event => {
    event.preventDefault(); if (hasCustomAnswer) void submit(answers);
  }}>
    <p className="mb-2 text-xs font-semibold text-amber-200">{t("! Waiting for your answer")}</p>
    <fieldset disabled={disabled} className="space-y-3">
      {request.questions.map(q => <fieldset key={q.id} className="min-w-0 space-y-1.5">
        <legend className="mb-1 whitespace-pre-wrap text-sm text-white">{q.question}</legend>
        {q.options?.map(option => <button key={option.label} type="button" aria-pressed={!other[q.id] && answers[q.id] === option.label} onClick={() => choose(q.id, option.label)} className={"flex w-full items-start gap-2 rounded border p-2 text-left text-sm hover:bg-white/5 disabled:opacity-50 " + (!other[q.id] && answers[q.id] === option.label ? "border-amber-300/50 bg-amber-300/10" : "border-white/10")}>
          <span className="min-w-0 break-words">{option.label}{option.description ? <span className="mt-1 block text-xs text-white/50">{option.description}</span> : null}</span>
        </button>)}
        {q.isOther && q.options?.length ? <button type="button" aria-pressed={Boolean(other[q.id])} onClick={() => { setOther(v => ({ ...v, [q.id]: true })); if (!other[q.id]) setAnswers(v => ({ ...v, [q.id]: "" })); }} className="flex min-h-9 items-center gap-2 p-2 text-sm text-white/70 hover:text-white">{t("Custom answer")}</button> : null}
        {!q.options?.length || other[q.id] ? <input aria-label={q.question} type={q.isSecret ? "password" : "text"} autoComplete="off" required maxLength={8000} value={answers[q.id] || ""} onChange={event => setAnswers(v => ({ ...v, [q.id]: event.target.value }))} className="min-h-10 w-full rounded border border-white/20 bg-black/20 px-2 text-sm" /> : null}
      </fieldset>)}
      {hasCustomAnswer ? <button type="submit" disabled={!complete(answers)} className="min-h-9 rounded bg-amber-300 px-3 text-xs text-black disabled:opacity-40">{busy ? t("Submitting…") : t("Submit answer")}</button> : null}
    </fieldset>
    {busy || submitted || request.submitted ? <p role="status" className="mt-2 text-xs text-white/60">{busy ? t("Submitting…") : t("Answer submitted. Waiting for the session to confirm.")}</p> : null}
    {error ? <p role="alert" className="mt-2 break-words text-xs text-amber-100">{t(error)}</p> : null}
  </form>;
}
