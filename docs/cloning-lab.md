# Cloning laboratory

Open an Office agent's chat, choose **Session information → Fork agent**, or
enter `/fork` (optionally followed by a new name). The view cuts straight to
the ship's cloning laboratory. No walk to the lab or pre-flight journey is needed.

Office uses the documented Codex App Server `thread/fork` through its existing
`session.fork` gateway method. The fork inherits the source conversation's stored
context and tools. Office also retains its project, working directory, model and
permission settings, appearance, title and upward reporting relationships.
The new agent has a new identity and conversation; subsequent turns are separate.
Working-directory inheritance uses the same files rather than creating a separate
filesystem snapshot. Scheduled tasks are deliberately **not copied**. Existing
employees keep their reporting relationships; cloning a manager does not reassign
their staff. Department membership remains independent of reporting relationships.

The lab occupies one ready reserve cabin. Its location is saved in the existing
ship allocation so future projects cannot displace it. Two lightweight pods reuse
the ship's duck figures; no new downloaded model or runtime daemon is required.
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
