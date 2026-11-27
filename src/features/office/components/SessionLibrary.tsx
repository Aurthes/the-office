"use client";
import { useState } from "react";
import { CompanyLibrary, DepartmentLibrary } from "@/features/ring-ship/DepartmentLibrary";
import "@/features/ring-ship/department-panel.css";
import { CEO_ID, type OrganizationView } from "@/lib/office/organization";
import { useUiText } from "@/lib/i18n/ui-language";

export function sessionDepartment(threadId: string, organization?: OrganizationView, gateway?: string) {
  const state = organization?.departmentAssetsState;
  if (state && gateway && (state.scope !== gateway.trim() || !state.ready)) return null;
  const person = organization?.people.find(person => person.id === threadId);
  return person && person.id !== CEO_ID ? person.departmentId || null : null;
}
export function SessionLibrary({ threadId, organization, gateway }: { threadId: string; organization?: OrganizationView; gateway?: string }) {
  const t = useUiText();
  const departmentId = sessionDepartment(threadId, organization, gateway);
  const state = organization?.departmentAssetsState;
  const [selected, setSelected] = useState<"department" | "company">("department");
  const loading = !organization || (state && (!state.ready || (gateway && state.scope !== gateway.trim())) && !state.error);
  const error = state?.error && !state.ready ? state.error : null;
  const company = selected === "company" || (!departmentId && !loading && !error);
  return <div className="session-toolbox min-h-0 flex-1 overflow-auto">
    <div role="group" aria-label={t("Library")} className="mb-3 flex flex-wrap gap-2">
      <button type="button" aria-pressed={!company} className="min-h-11 rounded border border-white/20 px-3 aria-pressed:bg-white/15" onClick={() => setSelected("department")} disabled={!departmentId && !error && !loading}>{t("Department library")}</button>
      <button type="button" aria-pressed={company} className="min-h-11 rounded border border-white/20 px-3 aria-pressed:bg-white/15" onClick={() => setSelected("company")}>{t("Company library")}</button>
    </div>
    {company ? <CompanyLibrary key={gateway} />
      : loading ? <p role="status">{t("Loading library…")}</p>
      : error ? <p role="alert">{t(error)}</p>
      : departmentId ? <DepartmentLibrary key={`${gateway}:${threadId}:${departmentId}`} departmentId={departmentId} /> : null}
  </div>;
}
