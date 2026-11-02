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
view and edit their title and managers. Clicking a manager, direct report, or
organization-list entry focuses the camera on that person, switching decks when
needed. The CEO nameplate appears on hover or keyboard focus; the model remains
clickable on touch devices. The CEO uses a randomized duck avatar
saved through existing Studio avatar settings. It has no Codex session.

The CEO has an independent daily routine: sitting at the monitor console,
stretching, checking a tablet, looking out into space, sipping coffee and visiting
departments on the main deck. Timing varies, and an occasional small celebration
breaks up the routine. It uses the existing duck rig, supported walking routes
and collision checks. Crew and companions also give it space. Selecting the CEO
keeps the existing camera follow and information card, whose activity updates
as it moves. These are scene animations; they do not run tasks or issue commands.

Organization metadata lives in Office settings and does not grant execution,
approval, delegation or filesystem permissions. New recruits inherit their
department Head; when a Head leaves, a remaining member becomes Head.
