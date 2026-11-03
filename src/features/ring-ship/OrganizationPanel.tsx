"use client";
import { useState, type ReactNode } from "react";
import { CEO_ID, OPEN_DEPARTMENT_ID, type OrganizationView } from "@/lib/office/organization";
import { useUiText } from "@/lib/i18n/ui-language";
import "./organization.css";

export function OrganizationPanel({ organization, personId, browse = false }: { organization: OrganizationView; personId: string; browse?: boolean }) {
  const t = useUiText(), [selected, setSelected] = useState(personId);
  const person = organization.people.find(value => value.id === selected);
  if (!person) return null;
  const department = (value: typeof person) => value.id === CEO_ID ? t("Company") : value.departmentId ? value.department : t("Open Workspace");
  const departments = new Map<string, OrganizationView["people"]>();
  for (const value of organization.people.filter(value => value.reportsTo.includes(CEO_ID))) {
    const id = value.departmentId || OPEN_DEPARTMENT_ID;
    if (!departments.has(id)) departments.set(id, []);
    departments.get(id)!.push(value);
  }
  const branches = (people: OrganizationView["people"], path: string[] = []): ReactNode => <ul>{people.filter(value => !path.includes(value.id)).map(value => <li key={value.id}>
    <button type="button" onClick={() => organization.focusPerson?.(value.id)} disabled={!organization.focusPerson} aria-label={t("Focus on {name}", { name: value.name })}>{value.name} · {value.title === "Worker" || value.title === "Head" ? t(value.title) : value.title}</button>
    {organization.people.some(child => child.reportsTo.includes(value.id)) ? branches(organization.people.filter(child => child.reportsTo.includes(value.id)), [...path, value.id]) : null}
  </li>)}</ul>;
  return <section className="organization-panel" aria-label={t("Organization")}>
    {browse ? <ul className="organization-tree" aria-label={t("Department reporting structure")}>
      {[...departments].map(([id, people]) => <li key={id}>
        <strong>{department(people[0])}</strong>
        {branches(people, [CEO_ID])}
      </li>)}
    </ul> : null}
    {browse ? <label>{t("Person")}<select aria-label={t("Person")} value={selected} onChange={event => { setSelected(event.target.value); organization.focusPerson?.(event.target.value); }}>{organization.people.map(value => <option key={value.id} value={value.id}>{value.name} · {department(value)}</option>)}</select></label> : null}
    <PersonPosition key={selected} organization={organization} person={person} />
  </section>;
}

function PersonPosition({ organization, person }: { organization: OrganizationView; person: OrganizationView["people"][number] }) {
  const t = useUiText(), [editing, setEditing] = useState(false), [title, setTitle] = useState(person.title), [reportsTo, setReportsTo] = useState(person.reportsTo);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const displayTitle = (value: string) => value === "Head" || value === "Worker" ? t(value) : value;
  const department = (value: typeof person) => value.id === CEO_ID ? t("Company") : value.departmentId ? value.department : t("Open Workspace");
  const reports = organization.people.filter(value => value.reportsTo.includes(person.id));
  const managers = person.reportsTo.map(id => organization.people.find(value => value.id === id)).filter(value => !!value);
  return <>
    <dl><div><dt>{t("Department")}</dt><dd>{department(person)}</dd></div><div><dt>{t("Title")}</dt><dd>{displayTitle(person.title)}</dd></div>
      <div><dt>{t("Reports to")}</dt><dd className="organization-person-links">{managers.length ? managers.map(manager => <button key={manager.id} type="button" disabled={!organization.focusPerson} aria-label={t("Focus on {name}", { name: manager.name })} onClick={() => organization.focusPerson?.(manager.id)}>{manager.name}</button>) : "—"}</dd></div>
      <div><dt>{t("Direct reports")}</dt><dd className="organization-person-links">{reports.length ? reports.map(value => <button key={value.id} type="button" disabled={!organization.focusPerson} aria-label={t("Focus on {name}", { name: value.name })} onClick={() => organization.focusPerson?.(value.id)}>{value.name} ({displayTitle(value.title)} · {department(value)})</button>) : "—"}</dd></div></dl>
    {editing ? <form onSubmit={event => {
      event.preventDefault(); if (saving) return; setSaving(true); setError("");
      void organization.savePosition(person.id, { title, reportsTo }).then(() => setEditing(false)).catch(cause => setError(cause instanceof Error ? t(cause.message) : t("Could not save organization."))).finally(() => setSaving(false));
    }}>
      <label>{t("Title")}<input aria-label={t("Title")} required maxLength={80} value={title} disabled={saving} onChange={event => setTitle(event.target.value)} /></label>
      {person.id !== CEO_ID ? <p className="text-[10px] text-white/55">{t("Setting Head or Manager brings department peers under this manager, keeping their other reporting lines.")}</p> : null}
      {person.id !== CEO_ID ? <fieldset disabled={saving}><legend>{t("Reports to")}</legend>{organization.people.filter(value => value.id !== person.id).map(value => <label key={value.id} className="organization-manager"><input type="checkbox" checked={reportsTo.includes(value.id)} onChange={event => setReportsTo(previous => event.target.checked ? [...previous, value.id] : previous.filter(id => id !== value.id))} />{value.name} · {displayTitle(value.title)}</label>)}</fieldset> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="organization-actions"><button type="button" disabled={saving} onClick={() => setEditing(false)}>{t("Cancel")}</button><button disabled={saving}>{t(saving ? "Saving…" : "Save organization")}</button></div>
    </form> : <button type="button" onClick={() => { setTitle(person.title); setReportsTo(person.reportsTo); setEditing(true); }}>{t("Edit organization")}</button>}
  </>;
}
