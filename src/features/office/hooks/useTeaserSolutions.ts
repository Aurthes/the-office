"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import type { InterfaceAgent } from "@/lib/office/agent-interface";
import type { LiveSessionItem, SessionClient } from "../components/SessionControls";
import { sendSessionMessage } from "../components/sessionSend";
export type TeaserSolution = { teaserId: string; title: string; text: string; targetId: string; targetName: string };
export type TeaserSolutionAttempt = TeaserSolution & { gateway: string; requestId: string; status: "sending" | "accepted" | "failed" | "unknown"; outcome?: "started" | "steered"; confirmedInHistory?: boolean; item?: LiveSessionItem };
export function solutionMessage(value: Pick<TeaserSolution, "teaserId" | "title" | "text">) {
  return `Teaser question: ${value.teaserId}\nTitle: ${value.title}\nMy solution (whiteboard text):\n${value.text}`;
}
export function solutionBytes(value: Pick<TeaserSolution, "teaserId" | "title" | "text">) { return new TextEncoder().encode(solutionMessage(value)).length; }
const EMPTY_SENDS: readonly LiveSessionItem[] = [];
export function useTeaserSolutions(client: SessionClient, gateway: string, getTarget: () => InterfaceAgent | null) {
  const records = useRef(new Map<string, TeaserSolutionAttempt>()), latest = useRef(new Map<string, string>());
  const [attempts, setAttempts] = useState<readonly TeaserSolutionAttempt[]>([]);
  const publish = useCallback((attempt: TeaserSolutionAttempt) => {
    records.current.set(attempt.requestId, attempt); setAttempts([...records.current.values()]);
  }, []);
  const getAttempt = useCallback((teaserId: string) => records.current.get(latest.current.get(`${gateway}\0${teaserId}`) || ""), [gateway]);
  const send = useCallback(async (snapshot: TeaserSolution) => {
    const previous = getAttempt(snapshot.teaserId);
    if (previous && (["sending", "unknown"].includes(previous.status) || previous.status === "accepted" && previous.text === snapshot.text && previous.targetId === snapshot.targetId)) return previous;
    const target = getTarget();
    if (!target || target.id !== snapshot.targetId || target.needsInput || !["idle", "running"].includes(target.status || "")) throw Error("The Teaser target changed or is unavailable. Nothing was sent.");
    if (!snapshot.text.trim() || solutionBytes(snapshot) > 32000) throw Error("The solution is empty or exceeds 32,000 UTF-8 bytes. Nothing was sent.");
    const attempt: TeaserSolutionAttempt = { ...snapshot, gateway, requestId: crypto.randomUUID(), status: "sending" };
    latest.current.set(`${gateway}\0${snapshot.teaserId}`, attempt.requestId); publish(attempt);
    try {
      const receipt = await sendSessionMessage(client, snapshot.targetId, { requestId: attempt.requestId, message: solutionMessage(snapshot), attachments: [], references: [] }, {
        onSendState: (_id, item) => {
          const current = records.current.get(attempt.requestId)!;
          publish({ ...current, status: current.confirmedInHistory ? "accepted" : item.delivery!, item: current.confirmedInHistory ? { ...item, delivery: "accepted" } : item });
        },
      });
      publish({ ...records.current.get(attempt.requestId)!, status: "accepted", outcome: receipt.status });
    } catch { /* The shared primitive already classified the receipt, never retry. */ }
    return records.current.get(attempt.requestId)!;
  }, [client, gateway, getAttempt, getTarget, publish]);
  const reconcile = useCallback((threadId: string, clientId: string) => {
    const attempt = records.current.get(clientId);
    if (!attempt || attempt.gateway !== gateway || attempt.targetId !== threadId || attempt.confirmedInHistory) return;
    publish({ ...attempt, status: "accepted", confirmedInHistory: true, item: attempt.item ? { ...attempt.item, delivery: "accepted" } : undefined });
  }, [gateway, publish]);
  const echoes = useMemo(() => {
    const grouped = new Map<string, LiveSessionItem[]>();
    for (const attempt of attempts) if (attempt.gateway === gateway && attempt.item) {
      const items = grouped.get(attempt.targetId) || []; items.push(attempt.item); grouped.set(attempt.targetId, items);
    }
    return grouped;
  }, [attempts, gateway]);
  return { getAttempt, send, reconcile, forThread: (id: string): readonly LiveSessionItem[] => echoes.get(id) || EMPTY_SENDS };
}
export type TeaserSolutionSender = Pick<ReturnType<typeof useTeaserSolutions>, "getAttempt" | "send">;
