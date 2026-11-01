# Native Codex ring ship

The Codex session view uses a horizontal ship with three stacked decks. Each deck
has the same three concentric rings, cabin divisions, public amenities and radial
corridors. Rounded lower hulls, transparent upper shells and visible frames show
the complete pressure modules while keeping interiors readable. Ring centerline
radii start at 12, 26 and 42; depths are 5.6, 6.8 and 8. The clear gaps between
rings start at 7.8 and 8.6. Decks are 10 units apart.

The OpenClaw office remains available through its existing runtime. Session chat,
project creation, recruitment, unread markers and studio settings use the existing
application handlers and gateway connection.

## Allocation

- A work group is one Codex Project. Unassigned sessions use a shared work cabin.
- Inner, middle and outer bays seat 3, 6 and 8 agents respectively. Groups prefer
  the smallest suitable ring on their deck. Larger groups join adjacent outer bays.
- Existing projects keep their saved deck and bay where capacity permits. Old
  single-deck placement records load as L1; the original L1 cabin IDs are retained.
- New projects use ready bays on L1, then L2, then L3. Public amenities never become
  work cabins. Every agent has exactly one seat and belongs to one deck.
- When no suitable span remains on any deck, every ring on all decks gains one
  angular division: `N → N+1`. Every radius scales by `(N+1)/N`; ring depths,
  furniture and agent size stay fixed. Each bay's centerline arc length and floor
  area stay fixed, and all rings close. Removing projects releases their bays;
  the ship does not automatically shrink.

Allocation memory is local to the browser and gateway. Unknown startup metadata
does not overwrite it; an authoritative empty roster releases removed projects.
Codex remains the source of project and session membership. The scene adds no
polling, database, network connection or model request.

## Travel and views

Click the central axis or its anchored **中央升降梯** sign to choose a destination.
The current deck is disabled. The camera approaches the lift, switches to the
cabin's first-person view during vertical travel, then opens the destination deck.
Controls pause during the roughly three-second ride. Reduced-motion preferences
skip the animation. Escape closes the destination menu and restores entry focus.

The toolbar's **整船结构** button shows the stacked hulls and central spine. It
contains no external floor selector; enter the lift to change floors. **本层全景**
returns to the active deck. Only that deck's crew render in the ordinary view;
crew are hidden in the structural view and during travel. Project selection on
another deck uses the same lift. Opening an existing chat immediately follows
its person on the correct deck, retaining the previous view for return.

## Public spaces and rendering

Each deck has a botanical garden, hydroponic food garden, cafeteria, gym, server
room, workshop, lounge, observatory, supply bay and crew quarters. Working cabins
include desks, storage, plants and meeting/rest corners; standby cabins retain
service equipment. Idle agents can visit public spaces on their own deck; working
agents at their desks keep working. A roaming worker who receives a task retraces
its occupied route and jogs back before showing the seated typing pose. Native
task execution starts immediately and never waits for this scene animation. Crew
use original procedural duck figures
with matte feathers, webbed feet and no equipment.

The botanical garden is a rainforest ecology cabin: textured tree crowns,
broad-leaf understory, ferns, hanging vines, rock-edged water and a timber path.
The server room has two equipment rows with layered rack fronts, status lights,
top-mounted cooling fans, coolant pipes, cables and maintenance terminals. Both
rooms leave the central ring circulation lane open on all three decks. Their
Quaternius CC0 models and surface maps are bundled locally, with shared textures
capped at 1024 pixels; see `public/office-assets/models/ship/README.md`.

Hull and small props are procedural geometry merged by material. Shell buffers
and materials are shared across the three decks. One renderer and scene are used;
a second camera is active only during lift travel. Furniture uses existing local
Kenney Furniture Kit assets under CC0 (see `../THIRD_PARTY_NOTICES.md`). No remote
HDR, font, paid asset or service is needed. Optional furniture loading does not
block the hull or session controls.

## Activity and chat navigation

Each nameplate has one mutually exclusive state: a slowly rotating green gear for
work, yellow `!` for required user input, yellow `?` for a new unread result, red
`!` for a session error, or no marker when idle. Error and input states take
priority; a new run supersedes an older unread result. Native status and existing
completion read receipts remain authoritative.

Working people occasionally show brief ambient chatter or thinking dots. While
they speak, a separate speech bubble replaces the nameplate; afterwards the name
and status return. Flavor text never enters the chat or claims actual progress.
Input requests and errors interrupt chatter.

Opening chat eases the camera toward the person in the area left uncovered by
the panel. Switching conversations follows the next person. Closing chat restores
the prior view. Closing and reopening preserves text drafts and completed uploads
in this page's memory; incomplete uploads show a reselect prompt. Reloading clears
unsent drafts.

## Checks

`tests/unit/ringShipLayout.test.ts` checks tiering, spare-bay activation, all-deck
expansion, fixed bay dimensions, large groups, public-space protection, unique
crew placement and old allocation compatibility. `ringShipHydration.test.ts`
checks startup and authoritative roster changes; `chatCamera.test.ts` checks
chat framing including upper-deck height. Browser checks cover core clicking,
up/down and cross-deck travel, reduced motion, actual sessions, project/public
focus, creation dialogs, refresh persistence, narrow viewports and missing
optional furniture. Browser resource evidence should distinguish local rendering
cost from the unchanged gateway connection and query behavior.
