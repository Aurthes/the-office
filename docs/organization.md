# Office organization

Projects are departments. Sessions with no project belong to the Open Workspace
department. Each populated department starts with one Head; its other workers
report to that Head, and Heads report to the owner represented by the CEO NPC.

Gateway-scoped Studio office preferences store `organization`, a map from stable
session IDs (plus `npc:ceo`) to `{ title, reportsTo: string[] }`. Direct reports
are derived from these upward edges. Multiple managers are supported; cycles,
self-reporting, and a manager above the CEO are rejected. The existing roster
remains the only source of department membership.

Click the CEO to inspect all departments, or open a worker's Character page to
view and edit their title and managers. The CEO uses a randomized duck avatar
saved through existing Studio avatar settings. It has no Codex session.

Organization metadata lives in Office settings and does not grant execution,
approval, delegation or filesystem permissions. New recruits inherit their
department Head; when a Head leaves, a remaining member becomes Head.
