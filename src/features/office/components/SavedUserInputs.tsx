"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionClient } from './SessionControls';
import { encodeReference, type InlineReference } from './inlineReferences';
import { useUiText } from '@/lib/i18n/ui-language';
export type SavedInputPayload = { message: string; attachments: string[]; references: InlineReference[]; sourcePurpose?: string | null };
export type UserSendSummary = { version: number; count: number; reviewCount?: number; retained?: number; unavailable?: boolean };
type Row = { id: string; createdAt: number; state: string; preview: string; replacedBy?: string; skipped?: boolean; historyChanged?: boolean };
type Page = { threadId: string; items: Row[]; nextCursor: string | null; confirmedIds?: string[] };
export function savedInputDraft(payload: SavedInputPayload) {
  let value = payload.message;
  for (const ref of [...payload.references].sort((a,b)=>b.start-a.start)) {
    if (Number.isInteger(ref.start) && Number.isInteger(ref.end) && ref.start >= 0 && ref.end <= value.length && ref.end >= ref.start) value = value.slice(0,ref.start) + encodeReference(ref) + value.slice(ref.end);
  }
  return value;
}
export function savedAttachment(ref: string) {
  let name = 'Recovered attachment', size = 0;
  try { const base = ref.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); const row = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base),c=>c.charCodeAt(0)))); if(typeof row.name==='string')name=row.name; if(typeof row.size==='number')size=row.size; } catch {}
  return { id: crypto.randomUUID(), name, size, ref };
}
export function SavedUserInputs({ client, threadId, summary, activeTurn, disabled, onRestore }: { client: SessionClient; threadId: string; summary: UserSendSummary; activeTurn: boolean; disabled: boolean; onRestore: (payload: SavedInputPayload) => void }) {
  const t=useUiText(),[rows,setRows]=useState<Row[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[checked,setChecked]=useState<Record<string,boolean>>({}),[expanded,setExpanded]=useState<Record<string,SavedInputPayload>>({});
  const [open,setOpen]=useState(false);
  const reviewCount=summary.reviewCount ?? summary.count;
  const restoreCurrent=useRef(onRestore);
  useLayoutEffect(()=>{restoreCurrent.current=onRestore;},[onRestore]);
  const confirmedRows=useRef(new Set<string>());
  const alive=useRef(true),version=useRef(0),intent=useRef(new Map<string,string>()),busyRef=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const load=useCallback(async(after?:string)=>{const v=++version.current;try{const page=await client.call('session.sends.list',{threadId,...(after?{cursor:after}:{})}) as Page;if(!alive.current||v!==version.current)return;if(page.threadId!==threadId||!Array.isArray(page.items))throw new Error('Saved-message response did not match this session.');for(const id of page.confirmedIds||[])confirmedRows.current.add(id);setRows(old=>{const received=after?[...old.filter(r=>!page.items.some(i=>i.id===r.id)),...page.items]:page.items;const confirmed=new Set(page.confirmedIds||[]);return [...received,...(open?old.filter(r=>!received.some(i=>i.id===r.id)).map(r=>({...r,state:confirmed.has(r.id)?'confirmed':r.state})):[])];});setCursor(page.nextCursor);setError('');}catch(e){if(alive.current&&v===version.current)setError(e instanceof Error?e.message:'Could not read saved messages.');}},[client,threadId,open]);
  useEffect(()=>{if(!open)return;const current=++version.current;const timer=setTimeout(()=>void load(),0);return()=>{clearTimeout(timer);version.current=current+1;};},[load,summary.version,open]);
  const act=async(row:Row,kind:'copy'|'restore'|'show'|'resend')=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');try{
    if(kind==='resend'){if(!checked[row.id])return;let requestId=intent.current.get(row.id);if(!requestId){requestId=crypto.randomUUID();intent.current.set(row.id,requestId);}const result=await client.call('session.sends.resend',{threadId,originalId:row.id,requestId,confirmed:true}) as {status:string};if(!alive.current)return;setNotice(result.status==='confirmed'?'Already confirmed in message history; nothing was resent.':result.status==='saved'?'Input is saved; native delivery still needs review.':'Explicit resend submitted. History confirmation is still required.');await load();return;}
    const item=await client.call('session.sends.read',{threadId,requestId:row.id}) as {threadId:string;state?:string;payload?:SavedInputPayload};if(!alive.current)return;if(item.threadId!==threadId)throw new Error('Saved-message response did not match this session.');
    if(item.state==='confirmed'||confirmedRows.current.has(row.id)){confirmedRows.current.add(row.id);setRows(old=>old.map(r=>r.id===row.id?{...r,state:'confirmed'}:r));setNotice('Already confirmed in message history; nothing was resent.');return;}
    if(!item.payload)throw new Error('Saved input body is unavailable.');
    if(kind==='restore'){restoreCurrent.current(item.payload);setNotice('Appended to the current draft; nothing was sent.');}
    if(kind==='copy'){try{await navigator.clipboard.writeText(savedInputDraft(item.payload));setNotice('Copied saved input.');}catch{setExpanded(old=>({...old,[row.id]:item.payload!}));setError('Clipboard unavailable. Select and copy the saved text below.');}}
    if(kind==='show')setExpanded(old=>({...old,[row.id]:item.payload!}));
  }catch(e){if(alive.current){if(confirmedRows.current.has(row.id))setNotice('Already confirmed in message history; nothing was resent.');else setError(e instanceof Error?e.message:'Saved-message action failed.');}}finally{busyRef.current=false;if(alive.current)setBusy(false);}};
  if(!reviewCount&&!summary.unavailable&&!open)return null;
  return <section className="mb-2 rounded-lg border border-amber-300/30 bg-amber-900/10 p-2 text-xs text-[var(--foreground)]">
    <div className="flex items-center justify-between gap-2"><span role="status">{t(reviewCount?'Delivery unconfirmed':'Saved input records')}{reviewCount?` · ${reviewCount}`:''}</span><button type="button" className="min-h-9 rounded border border-[var(--border)] px-2" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{t(open?'Close review':'Review')}</button></div>
    {open?<>
    <p className="my-2 text-[var(--muted-foreground)]">{t('A native receipt is not message history or proof of execution. Automatic continuation is held for this session. Review history before resending; it may duplicate work.')}</p>
    {summary.unavailable?<p role="alert">{t('Saved-message storage needs recovery. New messages will not be accepted; keep your draft.')}</p>:null}
    <div className="max-h-52 space-y-2 overflow-y-auto [overflow-wrap:anywhere]">{rows.map(row=><article key={row.id} className="rounded border border-[var(--border)] p-2">
      <p className="whitespace-pre-wrap">{row.preview}</p><p className="mt-1 text-[var(--muted-foreground)]">{t(row.state==='confirmed'?'Recorded in message history':row.state==='unavailable'?'Saved input status changed; check history':row.skipped?'Not resent · Original confirmed in history':row.state==='accepted'?'Native accepted · History not confirmed':row.state==='saved'?'Saved · Not dispatched':'Saved · Delivery needs review')}{row.historyChanged?` · ${t('History changed; previous confirmation is unknown')}`:''}{row.replacedBy?` · ${t('Explicit recovery send recorded')}`:''}</p>
      <div className="mt-1 flex flex-wrap gap-2">{(['show','copy','restore'] as const).map(kind=><button type="button" className="min-h-9 rounded border border-[var(--border)] px-2 disabled:opacity-40" disabled={busy||disabled||['confirmed','unavailable'].includes(row.state)} key={kind} onClick={()=>void act(row,kind)}>{t({show:'View saved input',copy:'Copy saved input',restore:'Append to draft'}[kind])}</button>)}</div>
      {expanded[row.id]?<textarea aria-label={t('Saved input text')} readOnly value={savedInputDraft(expanded[row.id])} className="mt-2 max-h-40 min-h-16 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2"/>:null}
      {!row.replacedBy&&!row.skipped&&!['confirmed','unavailable'].includes(row.state)?<><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={Boolean(checked[row.id])} onChange={e=>setChecked(old=>({...old,[row.id]:e.target.checked}))}/><span>{t('I checked history and want to resend this input once with a new ID.')}</span></label><button type="button" className="mt-1 min-h-9 rounded border border-amber-400/40 px-2 disabled:opacity-40" disabled={busy||disabled||activeTurn||!checked[row.id]} onClick={()=>void act(row,'resend')}>{t('Resend saved input')}</button></>:null}
    </article>)}</div>
    {cursor?<button type="button" disabled={busy} className="min-h-9 underline" onClick={()=>void load(cursor)}>{t('More saved inputs')}</button>:null}
    <button type="button" disabled={busy||disabled} className="ml-2 min-h-9 underline" onClick={()=>{void client.call('session.sends.reconcile',{threadId}).then(()=>load()).catch(e=>{if(alive.current)setError(e instanceof Error?e.message:'History reconciliation failed.');});}}>{t('Check message history')}</button>
    {notice?<p role="status">{t(notice)}</p>:null}{error?<p role="alert" className="mt-1 text-amber-200">{t(error)}</p>:null}
    </>:null}
  </section>;
}
