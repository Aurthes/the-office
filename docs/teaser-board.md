# Break-room teaser board

The break room has a clickable **Teaser board**. Selecting the room also offers
an **Open teaser board** button, including on small screens. The dashboard shows
all teasers, or filters to Open, In progress and Finished, with completion counts.
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
authentication. It omits answers and summaries for unfinished items. There is no
new HTTP write endpoint, command execution API, or anonymous publishing channel.
The local publisher uses the host user's filesystem authority. Published content
is treated as Markdown data; raw HTML is not enabled. The open dashboard refreshes
every 15 seconds and when the page regains focus; closing it stops those requests.
