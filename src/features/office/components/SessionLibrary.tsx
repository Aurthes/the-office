"use client";
import { DepartmentLibrary } from "@/features/ring-ship/DepartmentLibrary";
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
  return <div className="session-toolbox min-h-0 flex-1 overflow-auto">
    {!organization || (state && (!state.ready || (gateway && state.scope !== gateway.trim())) && !state.error) ? <p role="status">{t("Loading library…")}</p> : state?.error && !state.ready ? <p role="alert">{t(state.error)}</p> : !departmentId ? <p>{t("No department could be identified for this chat.")}</p> :
      <DepartmentLibrary key={`${gateway}:${threadId}:${departmentId}`} departmentId={departmentId} />}
  </div>;
}
