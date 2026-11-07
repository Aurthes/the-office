"use client";
import { useEffect, useRef, useState } from "react";
import type { SessionClient } from "./SessionControls";
import { useUiText } from "@/lib/i18n/ui-language";

export type MessageOccurrence = { messageId: string; itemId: string; turnId: string; turnCursor: string; snippet: string; snippetMatchRange: { start: number; end: number } };
export type MessageSearchGroup = { threadId: string; name: string; project: string; archived: boolean; matches: MessageOccurrence[]; nextCursor: string | null };
export type MessageSearchTarget = Omit<MessageSearchGroup, "matches" | "nextCursor"> & Omit<MessageOccurrence, "turnCursor"> & { turnCursor?: string; requestId: string };
type Results = { groups: MessageSearchGroup[]; nextCursor: string | null };

export function SearchSnippet({ text, range }: { text: string; range: { start: number; end: number } }) {
  return <>{text.slice(0, range.start)}<mark>{text.slice(range.start, range.end)}</mark>{text.slice(range.end)}</>;
}
const appendMatches = (before: MessageOccurrence[], after: MessageOccurrence[]) => [...new Map([...before, ...after].map(hit => [hit.messageId, hit])).values()];

export function MessageSearchResults({ client, query, onOpenMessage }: { client: SessionClient; query: string; onOpenMessage: (target: MessageSearchTarget) => void }) {
  const t = useUiText(), search = query.trim();
  const [includeArchived, setIncludeArchived] = useState(true);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<Results & { query: string; archived: boolean; busy: boolean; error: string }>({ groups: [], nextCursor: null, query: "", archived: true, busy: false, error: "" });
  const generation = useRef(0);
  const current = state.query === search && state.archived === includeArchived;
  useEffect(() => {
    generation.current++;
    if (!search) return;
    let stopped = false;
    const timer = setTimeout(() => {
      setState({ query: search, archived: includeArchived, groups: [], nextCursor: null, busy: true, error: "" });
      void client.call("session.search", { query: search, includeArchived }).then(value => {
        if (!stopped) setState({ ...value as Results, query: search, archived: includeArchived, busy: false, error: "" });
      }).catch(cause => { if (!stopped) setState({ groups: [], nextCursor: null, query: search, archived: includeArchived, busy: false, error: cause instanceof Error ? cause.message : "Could not search messages. Please retry." }); });
    }, 300);
    return () => { stopped = true; clearTimeout(timer); };
  }, [client, search, includeArchived, retry]);
  const more = async (group?: MessageSearchGroup) => {
    if (!current || state.busy) return;
    const version = generation.current;
    setState(previous => ({ ...previous, busy: true, error: "" }));
    try {
      const value = await client.call("session.search", { query: search, includeArchived, cursor: group?.nextCursor ?? state.nextCursor, ...(group ? { threadId: group.threadId } : {}) });
      if (version !== generation.current) return;
      setState(previous => {
        if (previous.query !== search || previous.archived !== includeArchived) return previous;
        if (group) { const result = value as MessageSearchGroup; return { ...previous, busy: false, groups: previous.groups.map(item => item.threadId === group.threadId ? { ...result, matches: appendMatches(item.matches, result.matches) } : item) }; }
        const result = value as Results, groups = new Map(previous.groups.map(item => [item.threadId, item]));
        for (const item of result.groups) { const old = groups.get(item.threadId); groups.set(item.threadId, old ? { ...item, matches: appendMatches(old.matches, item.matches) } : item); }
        return { ...previous, busy: false, groups: [...groups.values()], nextCursor: result.nextCursor };
      });
    } catch (cause) { if (version !== generation.current) return; setState(previous => previous.query === search && previous.archived === includeArchived ? { ...previous, busy: false, error: cause instanceof Error ? cause.message : "Could not search messages. Please retry." } : previous); }
  };
  return <div className="directory-message-search">
    <label className="directory-search-archives"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />{t("Include archived conversations")}</label>
    {!search ? <p className="directory-empty">{t("Search messages across conversations.")}</p> : !current || state.busy && !state.groups.length ? <p role="status" className="directory-empty">{t("Searching messages…")}</p> : null}
    {current && search ? <>
      {state.error ? <p role="alert" className="directory-notice">{t(state.error)} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>{t("Retry")}</button></p> : null}
      {!state.busy && !state.error && !state.groups.length ? <p className="directory-empty">{t("No matching messages.")}</p> : null}
      {state.groups.map(group => <section className="directory-message-group" key={group.threadId}>
        <h3><strong>{group.name}</strong>{group.archived ? <span>{t("Archived")}</span> : null}<small>{group.project}</small></h3>
        {group.matches.map(hit => <button type="button" className="directory-message-hit" key={hit.messageId} onClick={() => onOpenMessage({ threadId: group.threadId, name: group.name, project: group.project, archived: group.archived, ...hit, requestId: crypto.randomUUID() })}>
          <SearchSnippet text={hit.snippet} range={hit.snippetMatchRange} />
        </button>)}
        {group.nextCursor ? <button type="button" className="directory-search-more" disabled={state.busy} onClick={() => void more(group)}>{t("More matches in {name}", { name: group.name })}</button> : null}
      </section>)}
      {state.nextCursor ? <button type="button" className="directory-search-more" disabled={state.busy} onClick={() => void more()}>{t("More conversations")}</button> : null}
    </> : null}
  </div>;
}
