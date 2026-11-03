# Cloning laboratory

Open an Office agent's chat, choose **Session information → Fork agent**, or
enter `/fork` (optionally followed by a new name). The view cuts straight to
the ship's cloning laboratory. No walk to the lab or pre-flight journey is needed.
To branch from an earlier point, choose **Fork from here** below a completed
answer. Office passes its native `lastTurnId`: that turn and all earlier context
are retained, and later turns are excluded. The menu action and `/fork` still
branch from the latest progress. Work logs, voice entries without a native turn
boundary and the current in-progress turn do not offer a historical fork action.

Office uses the documented Codex App Server `thread/fork` through its existing
`session.fork` gateway method. The fork inherits the source conversation's stored
context and tools. Office also retains its project, working directory, model and
permission settings, title and upward reporting relationships. Appearance is
randomized from the new agent ID using the same generator as creating a new
agent. The new pod passenger, saved character and normal crew use that same look;
the original keeps its existing appearance.
The new agent has a new identity and conversation; subsequent turns are separate.
Working-directory inheritance uses the same files rather than creating a separate
filesystem snapshot. Scheduled tasks are deliberately **not copied**. Existing
employees keep their reporting relationships; cloning a manager does not reassign
their staff. Department membership remains independent of reporting relationships.

The lab uses a compact 8.4-unit section of one ready reserve cabin; the unused
sides retain their reserve flooring. Its location is saved in the existing ship
allocation so future projects cannot displace it. The pods sit toward the back,
leaving the front aisle open for opposing crew and large companions to pass.
Two lightweight pods reuse
the ship's duck figures; no new downloaded model or runtime daemon is required.
Each pod can be selected to zoom in and open the standard object information
card. Pod bodies and boarding steps share their rendered footprint with the
existing swept collision checks. The walking aisle stays open; ordinary ring
traffic and returning clones route around the equipment.
After the fork and personal settings are confirmed, both canopies open and the
original and clone get off their beds. Crew on that deck rejoin the existing
collision-aware walking routes from the lab exit. Crew assigned to another deck
resume their routines on their assigned deck when the short scene ends.

Pending or failed requests never display a successful clone. Failure restores
the original crew member and shows the error. If the native fork succeeded but
personal settings could not be saved or reloaded, the message says the clone was
created and asks the owner to refresh before repeating the operation. It never
blindly submits another fork. Reduced-motion users skip the exit animation after
confirmation. The scene only moves the camera and characters; it does not stop
the original agent's backend work or start a model turn in the clone.

Reference: [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).
