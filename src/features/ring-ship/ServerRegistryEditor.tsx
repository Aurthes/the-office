"use client";
import { useEffect, useState } from "react";
import type { PoolHost } from "@/lib/monitoring/types";
import { useUiText } from "@/lib/i18n/ui-language";

export function parseMachineRows(text: string): PoolHost[] {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const [alias = "", family = "", purpose = "compute", enabled = "yes", ...extra] = line.split(",").map(value => value.trim());
    const name = (purpose || "compute").toLowerCase();
    const group = name === "compute" ? "offline" : name === "production" ? "online" : name === "local" ? "local" : undefined;
    if (extra.length || !alias || !group || !/^(yes|no)$/i.test(enabled || "yes")) throw new Error("Use one row per machine: alias, group, purpose, enabled.");
    return { alias, family, group, active: (enabled || "yes").toLowerCase() === "yes" };
  });
}

export function ServerRegistryEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useUiText();
  const [hosts, setHosts] = useState<PoolHost[] | null>(null), [bulk, setBulk] = useState(""), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/monitoring/registry", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setHosts(data.hosts);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read the server registry."); });
    return () => controller.abort();
  }, []);
  const update = (index: number, patch: Partial<PoolHost>) => setHosts(current => current!.map((host, i) => i === index ? { ...host, ...patch } : host));
  const save = async () => {
    if (!hosts || saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/monitoring/registry", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hosts }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save server configuration."); }
    finally { setSaving(false); }
  };
  const field = "min-h-10 min-w-0 rounded-lg border border-white/15 bg-[#172330] px-2 text-sm text-white";
  const button = "min-h-10 rounded-lg border border-white/20 px-3 text-xs text-white/80 hover:bg-white/5 disabled:opacity-40";
  return <section aria-label={t("Configure machines")} className="space-y-4 p-1 text-sm text-white/80">
    <div className="flex items-center justify-between gap-2"><h3>{t("Configure machines")}</h3><button type="button" disabled={saving} className={button} onClick={onClose}>{t("Cancel")}</button></div>
    <p className="text-xs text-white/55">{t("Machines and groups are saved privately for this Office instance. Remote machines use your existing SSH aliases.")}</p>
    {error ? <p role="alert" className="text-rose-200">{t(error)}</p> : null}
    {hosts === null ? error ? null : <p>{t("Loading registered servers…")}</p> : <fieldset disabled={saving} className="space-y-3">
      {hosts.map((host, index) => <fieldset key={index} className="grid gap-2 rounded-lg border border-white/10 p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs">{t("Machine {number}", { number: index + 1 })}</legend>
        <label className="grid gap-1 text-xs">{t("SSH alias or local name")}<input aria-label={t("Machine {number} alias", { number: index + 1 })} className={field} maxLength={64} value={host.alias} onChange={event => update(index, { alias: event.target.value })} /></label>
        <label className="grid gap-1 text-xs">{t("Group")}<input aria-label={t("Machine {number} group", { number: index + 1 })} className={field} maxLength={64} value={host.family || ""} placeholder={t("Optional group name")} onChange={event => update(index, { family: event.target.value })} /></label>
        <label className="grid gap-1 text-xs">{t("Purpose")}<select aria-label={t("Machine {number} purpose", { number: index + 1 })} className={field} value={host.group} onChange={event => update(index, { group: event.target.value as PoolHost["group"] })}><option value="offline">{t("Research and compute servers")}</option><option value="online">{t("Production servers")}</option><option value="local">{t("Local machine")}</option></select></label>
        <div className="flex items-center justify-between gap-2"><label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={host.active} onChange={event => update(index, { active: event.target.checked })} />{t("Enabled")}</label><button type="button" className={button} aria-label={t("Remove machine {number}", { number: index + 1 })} onClick={() => setHosts(current => current!.filter((_, i) => i !== index))}>{t("Remove")}</button></div>
      </fieldset>)}
      <button type="button" className={button} onClick={() => setHosts(current => [...current!, { alias: "", family: "", group: "offline", active: true }])}>{t("Add machine")}</button>
      <details className="rounded-lg border border-white/10 p-3"><summary className="min-h-8 cursor-pointer">{t("Bulk add machines")}</summary>
        <p className="my-2 text-xs text-white/55">{t("One machine per line: alias, group, purpose (compute / production / local), enabled (yes / no). Purpose and enabled are optional.")}</p>
        <textarea aria-label={t("Bulk machines")} rows={4} className={field + " w-full py-2 font-mono"} placeholder={"worker01, Research, compute, yes\nworker02, Research, compute, yes"} value={bulk} onChange={event => setBulk(event.target.value)} />
        <button type="button" disabled={!bulk.trim()} className={button + " mt-2"} onClick={() => { try { setHosts(current => [...current!, ...parseMachineRows(bulk)]); setBulk(""); setError(""); } catch (cause) { setError((cause as Error).message); } }}>{t("Add rows")}</button>
      </details>
      <button type="button" className={button + " bg-cyan-800"} onClick={() => void save()}>{saving ? t("Saving…") : t("Save machines")}</button>
    </fieldset>}
  </section>;
}
