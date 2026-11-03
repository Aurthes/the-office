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
department manager. When a manager is archived, each direct report inherits that
manager's upstream reporting lines and keeps its own title. Consecutive archived
layers are collapsed to the nearest surviving managers, with CEO as the fallback;
other reporting lines stay intact. No remaining worker is promoted automatically.
Reconciliation persists these changes when Office loads the updated roster.

To restore the layer, use **Edit organization** on a new or existing worker and
set its title to **Head** or **Manager**, choosing its upstream managers. On the
first promotion, peers in the same department that share those upstream managers
report to it instead; their other reporting lines and their own reports remain.
Other departments and already designated managers are preserved. New hires join
the existing department manager, or report to CEO when the department is flat.
The CEO tree groups direct reports by department ID, so a department with several
people reporting to CEO still has one department heading. Nested reporting layers
remain visible within each group. Entirely new departments keep the existing
initial Head assignment.
