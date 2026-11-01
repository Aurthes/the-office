"use client";
import { useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";
export type SessionQuestionRequest = { requestId: string; submitted?: boolean; questions: { id: string; header?: string; question: string; defaultAnswer?: string; isOther?: boolean; isSecret?: boolean; options?: { label: string; description?: string }[] | null }[] };
export function SessionQuestions({ client, threadId, request }: { client: SessionClient; threadId: string; request: SessionQuestionRequest }) {
  const t = useUiText();
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(request.questions.filter(q => q.defaultAnswer).map(q => [q.id, q.defaultAnswer!])));
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false), [submitted, setSubmitted] = useState(false), [error, setError] = useState("");
  const sending = useRef(false), nonce = useRef(crypto.randomUUID());
  const disabled = busy || submitted || request.submitted;
  return <form aria-label={t("Waiting for your answer")} className="mb-3 rounded-lg border border-amber-300/30 bg-amber-300/5 p-3" onSubmit={async event => {
    event.preventDefault(); if (sending.current || disabled) return;
    sending.current = true; setBusy(true); setError("");
    try {
      await client.call("session.question.reply", { threadId, promptId: request.requestId, requestId: nonce.current,
        answers: Object.fromEntries(request.questions.map(q => [q.id, answers[q.id] || ""])) });
      setSubmitted(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Answer not confirmed. Check before retrying."); }
    finally { sending.current = false; setBusy(false); }
  }}>
    <p className="mb-2 text-xs font-semibold text-amber-200">{t("! Waiting for your answer")}</p>
    <fieldset disabled={disabled} className="space-y-3">
      {request.questions.map(q => <fieldset key={q.id} className="min-w-0 space-y-1.5">
        <legend className="mb-1 whitespace-pre-wrap text-sm text-white">{q.question}</legend>
        {q.options?.map(option => <label key={option.label} className="flex cursor-pointer items-start gap-2 rounded border border-white/10 p-2 text-sm hover:bg-white/5">
          <input type="radio" className="mt-1 shrink-0" name={q.id} value={option.label} checked={!other[q.id] && answers[q.id] === option.label} onChange={() => { setOther(v => ({ ...v, [q.id]: false })); setAnswers(v => ({ ...v, [q.id]: option.label })); }} />
          <span className="min-w-0 break-words">{option.label}{option.description ? <span className="mt-1 block text-xs text-white/50">{option.description}</span> : null}</span>
        </label>)}
        {q.isOther && q.options?.length ? <label className="flex items-center gap-2 p-2 text-sm"><input type="radio" name={q.id} checked={Boolean(other[q.id])} onChange={() => { setOther(v => ({ ...v, [q.id]: true })); setAnswers(v => ({ ...v, [q.id]: "" })); }} />{t("Custom answer")}</label> : null}
        {!q.options?.length || other[q.id] ? <input aria-label={q.question} type={q.isSecret ? "password" : "text"} autoComplete="off" required maxLength={8000} value={answers[q.id] || ""} onChange={event => setAnswers(v => ({ ...v, [q.id]: event.target.value }))} className="min-h-10 w-full rounded border border-white/20 bg-black/20 px-2 text-sm" /> : null}
      </fieldset>)}
      <button type="submit" disabled={request.questions.some(q => !answers[q.id]?.trim())} className="min-h-9 rounded bg-amber-300 px-3 text-xs text-black disabled:opacity-40">{busy ? t("Submitting…") : t("Submit answer")}</button>
    </fieldset>
    {submitted || request.submitted ? <p role="status" className="mt-2 text-xs text-white/60">{t("Answer submitted. Waiting for the session to confirm.")}</p> : null}
    {error ? <p role="alert" className="mt-2 break-words text-xs text-amber-100">{t(error)}</p> : null}
  </form>;
}
