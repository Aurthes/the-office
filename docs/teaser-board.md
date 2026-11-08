# Break-room teaser board

The break room has a clickable **Teaser board**. Selecting the room also offers
an **Open teaser board** button, including on small screens. The dashboard shows
Unfinished by default: In progress first, then Open, with the oldest question
first in each group. It also offers All, Open, In progress and Finished filters.
Finished cards keep the question visible and reveal their answer and **Key idea**
only when expanded. Questions, answers and explanations support Markdown and math.

## Publishing from an agent

An agent on the Office host can publish with the dependency-free local command:

```sh
node /path/to/office/server/teaser-board.js list
node /path/to/office/server/teaser-board.js get TEASER_ID
node /path/to/office/server/teaser-board.js post --file teaser.json
node /path/to/office/server/teaser-board.js update TEASER_ID --file update.json
```

`post` and `update` also accept one JSON object on stdin. For a stable command
independent of a release checkout, copy this **single file** to the host's private
tools directory as `teaser-board.cjs` and run it with Node. It has no npm dependencies.
Keep that installed copy in sync when this module changes; no daemon is needed.

Post a teaser with:

```json
{
  "title": "A short question title",
  "prompt": "The complete question, with all assumptions needed to solve it.",
  "author": "teaser",
  "status": "open"
}
```

Save the returned ID. Use **the same record** for progress and completion, rather
than posting duplicates. Read `get` before each update; include the current
`revision` to prevent overwriting another update. Example progress update:

```json
{ "revision": 1, "status": "in_progress" }
```

When the teaser is actually finished, update it with:

```json
{
  "revision": 2,
  "status": "finished",
  "answer": "The final answer, including any necessary qualifications.",
  "summary": "A short, reader-facing explanation of the key insight and why the answer follows."
}
```

Finished status requires **both** an answer and a nonempty summary. The summary is
a concise solution explanation, not a private step-by-step reasoning transcript.
Do not mark an unsolved teaser finished, invent a user completion, or present a
guess as a verified answer. To reopen one, update `status` to `open` or `in_progress`;
its completion time clears and its solution becomes hidden on the dashboard.

Limits: title 160 characters, prompt and answer 12,000 each, author 120, summary
2,000. Only the documented fields and `revision` are accepted. The CLI prints JSON;
errors exit nonzero. On a revision conflict, read again and reconsider the update.

## Storage and access

State is one atomic JSON file per teaser under `CLAW3D_TEASER_DIR`, or
`$CLAW3D_DATA_DIR/teasers`, defaulting to `~/.local/share/claw3d/teasers`.
The agent command and Studio must use the same directory. Records survive deploys
and are business data: do not delete them during temporary-file cleanup.
Each update holds only that record's short-lived file lease; concurrent writes
fail explicitly rather than silently losing edits. If a writer is forcibly killed
and leaves a `.lock`, verify no writer is active before removing that one lease.
Corrupt records cause an explicit error and are never silently overwritten.

The read-only `GET /api/office/teasers` endpoint stays behind Office's existing
authentication. It omits answers and summaries for unfinished items. Publishing
and updating teaser records remain CLI-only; there is no command execution API
or anonymous publishing channel.
The local publisher uses the host user's filesystem authority. Published content
is treated as Markdown data; raw HTML is not enabled. The open dashboard refreshes
every 15 seconds and when the page regains focus; closing it stops those requests.

## Per-question whiteboards

Select a card's title to open its whiteboard, even when teaser chat is
unavailable. The selected question stays visible beside the plain text editor on
wide screens; narrow screens stack the question above the editor. The question
keeps its finished-only solution disclosure. Leaving for
chat follows the same unsaved-change confirmation and saving guard as closing.
Save keeps the editor open; reopening
or reloading reads the saved text from the server. Empty text clears the notes.
Unsaved changes require confirmation before returning or closing. Failed saves
keep the draft; a revision conflict requires an explicit reload before saving.

Notes live outside the teaser directory, in its sibling
`<resolved teaser directory>-whiteboards/<teaser UUID>.json`. Each record contains
only `id`, `text`, `revision`, and `updatedAt`. Notes are persistent business data,
not a build cache. They do not change the question, answer, status, or publisher
CLI. Missing notes read as empty without creating a file; the teaser must exist.

`GET /api/office/teasers/:id/whiteboard` reads notes and
`PUT /api/office/teasers/:id/whiteboard` accepts only JSON `{ "text": "…", "revision": 0 }`.
Both use Office's existing authentication boundary and return `Cache-Control:
no-store`. Writes require a trusted same-origin request, at most 12,000 text
characters and a body of at most 96 KiB. Each note has its own revision and short
file lease; stale or concurrent saves return HTTP 409 instead of overwriting
another edit. Corrupt records return an error and are not overwritten. If a
writer is forcibly killed, verify it is gone before removing its leftover lease.

The editor follows the existing Office theme, treats all text as text, and uses
16px input text on narrow screens. Dashboard refreshes do not replace its draft.

**Save and send solution** first saves the current text with its revision, then
sends that exact text with the question ID and title to the configured Teaser
agent. It never sends the official answer or chat attachments/references. Empty
solutions or messages exceeding 32,000 UTF-8 bytes cannot be sent; notes remain
editable without truncation. A failed, conflicting or unconfirmed save sends
nothing. Sending keeps the whiteboard open and shows whether the normal chat
request started work or steered its running task. **Open Teaser chat** opens that
same agent, with the usual unsaved-change guard. Existing chat drafts are kept.

Unconfirmed delivery is shown explicitly and is never automatically retried.
This Office page retains the attempt and request ID across closing/reopening
the board, and a matching chat receipt can confirm it. This is in-memory state:
after reloading Office, check the conversation before sending the same text again.

## Agent interface presets

In a session's **More → Interface preset**, choose **Teaser** and save to give
that agent a **Teaser board** header action (inside More on narrow panels).
**Standard** has no special action. These are finite UI presets, not execution
permissions or loadable plugins. The saved preset takes effect after confirmation.

Presets live in private Studio settings at
`office[gatewayKey].agentInterfaces[agentUUID]`. Renaming an agent preserves its
preset; a new agent with the same name does not inherit it. Sending requires one
configured Teaser agent in the complete active Office roster. Missing, multiple,
archived or unavailable targets disable sending while the whiteboard stays usable.
Preset changes do not create agents or sessions or alter model/network permissions.
