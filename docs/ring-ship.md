# Native Codex ring ship

The Codex session view uses a roofless, horizontal habitat with three concentric
rings. The OpenClaw office view remains available through its existing runtime.
Session chat, project creation, recruitment, unread markers and voice settings
use the existing application handlers and gateway connection.

## Allocation

- A work group is one Codex Project. Unassigned sessions use a shared work cabin.
- Inner, middle and outer bays seat 3, 6 and 8 agents respectively. Groups prefer
  the smallest suitable ring. A larger group joins adjacent outer bays.
- New projects use available bays first. Public amenities are permanent and
  never become work cabins. Initial construction leaves spare bays.
- When no suitable span remains, every ring gains one angular division: `N → N+1`.
  Every centerline radius scales by `(N+1)/N`. Base radii are 10, 17 and 24 at
  `N=8`; ring depths, furniture size and agent size stay fixed. Thus each bay's
  centerline arc length and floor area stay fixed, and all three rings close.
- Existing placements are reused where capacity permits. Removing a project
  releases its bays; the ship does not automatically shrink.

Allocation memory is local to the browser and gateway. Unknown startup metadata
does not overwrite it; an authoritative empty roster releases removed projects.
Codex remains the source of project and session membership. No new polling,
database, network connection or model request is introduced by the scene.

## Public spaces and rendering

The reactor hub and four open radial corridors connect the rings. Permanent
amenities include a botanical garden, separate hydroponic food garden, cafeteria,
gym, server room, workshop, lounge, observatory, supply bay and crew quarters.
Idle agents can visit public spaces; working agents stay at their assigned desks.

Hull and small props are procedural geometry, merged by material. Furniture uses
the existing local Kenney Furniture Kit assets under CC0 (see
`../THIRD_PARTY_NOTICES.md`). No external HDR, font, paid asset or service is needed.
Optional furniture loading does not block the hull or session controls.

The company selector focuses a project or public cabin. Clicking a crew member or
using the fleet list opens the corresponding existing Codex chat. The home button
returns to the full ship; creation and recruitment remain in the company menu.

## Checks

`tests/unit/ringShipLayout.test.ts` checks tiering, spare-bay activation, exact
three-ring expansion, fixed bay dimensions, large groups, public-space protection,
stable placements, cache parsing and routes. `ringShipHydration.test.ts` checks
startup and authoritative roster changes. Browser checks should include desktop,
portrait and landscape layouts, project/public focus, chat, creation dialogs,
refresh persistence and unavailable optional furniture.
