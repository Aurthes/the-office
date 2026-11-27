"use client";
import { DepartmentAssetsPanel } from "@/features/ring-ship/DepartmentAssetsPanel";
import "@/features/ring-ship/department-panel.css";
import { CEO_ID, OPEN_DEPARTMENT_ID, type OrganizationView } from "@/lib/office/organization";
import { useUiText } from "@/lib/i18n/ui-language";

export function SessionToolbox({ threadId, organization, gateway }: { gateway?:string; threadId: string; organization?: OrganizationView }) {
  const t = useUiText();
  const person = organization?.people.find(person => person.id === threadId);
  const state = organization?.departmentAssetsState;
  const departmentId = person && person.id !== CEO_ID ? person.departmentId || OPEN_DEPARTMENT_ID : null;
  if(gateway&&state?.scope!==gateway)return <p role="status">{t("Loading company tools…")}</p>;
  return <div className="session-toolbox">
    {!organization || (state?.scope && !state.ready && !state.error) ? <p role="status">{t("Loading department tools…")}</p>
      : state?.error && !state.ready ? <p role="alert">{t(state.error)}</p>
      : !state?.scope ? <p role="status">{t("Loading company tools…")}</p>
      : <>
        <DepartmentAssetsPanel key={`${state.scope}:company`} label="Company tools" departmentId="" entries={organization.companyTools||{}} kind="tool" />
        {state.error ? <p role="alert">{t(state.error)}</p> : null}
        {!departmentId ? <p>{t("No department could be identified for this chat.")}</p> : <>
        <h2>{organization.departments?.find(department => department.id === departmentId)?.name || person?.department}</h2>
        <p>{t("Reference only. Tools cannot be run or edited here.")}</p>
        <DepartmentAssetsPanel key={`${state.scope}:${departmentId}`} departmentId={departmentId} entries={organization.departmentAssets?.[departmentId] || {}} kind="tool" />
        </>}
      </>}
  </div>;
}
