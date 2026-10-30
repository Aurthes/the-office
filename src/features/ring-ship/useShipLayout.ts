import { useEffect, useState } from "react";
import type { CompanyRoster } from "@/features/retro-office/core/companyLayout";
import { buildShipLayout, parseShipAllocation } from "./layout";

const EMPTY: CompanyRoster = { projects: [], members: [] };
function loadPrevious(key: string) {
  try { return parseShipAllocation(localStorage.getItem(key)); } catch { return; }
}

function sameRoster(a: CompanyRoster | null, b: CompanyRoster | null) {
  return a === b || !!a && !!b && a.projects.length === b.projects.length && a.members.length === b.members.length
    && a.projects.every((p, i) => p.id === b.projects[i].id && p.name === b.projects[i].name)
    && a.members.every((m, i) => m.id === b.members[i].id && m.projectId === b.members[i].projectId);
}

export function useShipLayout(roster: CompanyRoster | null, key: string) {
  const [state, setState] = useState(() => {
    const saved = loadPrevious(key);
    const layout = buildShipLayout(roster || EMPTY, saved);
    return { roster, key, saved: roster ? layout.allocation : saved, layout };
  });
  // Unknown startup metadata must not erase saved project placements. An
  // explicitly empty roster, in contrast, really does release those cabins.
  let current = state;
  if (!sameRoster(state.roster, roster) || state.key !== key) {
    const saved = state.key === key ? state.saved : loadPrevious(key);
    const layout = roster ? buildShipLayout(roster, saved) : state.key === key ? state.layout : buildShipLayout(EMPTY, saved);
    current = { roster, key, saved: roster ? layout.allocation : saved, layout };
    setState(current);
  }
  const layout = current.layout;
  const ready = !!roster;
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key, JSON.stringify(layout.allocation)); } catch { /* Rendering does not require storage. */ }
  }, [key, ready, layout.allocation]);
  return layout;
}
