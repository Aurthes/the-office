# Which question a reply answers

Office replies show a short quote of the question above the answer. Delegated
reports also show the task title. Clicking a quote opens the full original
message in the existing read-only message viewer; returning preserves the live
conversation and its scroll position. The same presentation applies to CEO,
department Heads, and workers. Ordinary questions do not require a task.

## Provenance

`OfficeReplyContext` records native input and answer identities and at most 512
UTF-8 bytes per quoted source under the Office-owned `reply-context/` directory.
The full message remains in Codex. An answer's association freezes at its first
native item event or streaming delta. Later steering and late completion events
cannot relabel it. Token updates do not write this metadata to disk.

Task creation during an active agent turn captures that turn's request. Tasks
created outside an active conversation acquire their origin on the first
explicit delegation. Each handoff saves its original and specific follow-up
references; submit, return, acceptance, and nested forwarding preserve them.
An unrelated task notification cannot replace a saved task origin. The existing
assignment, review, delivery, and retry rules are unchanged.
When several unlinked questions have been steered into the same active turn,
task operations preserve their existing origin rather than guessing that the
latest question caused them. Explicit inherited handoff context remains usable.

Original requests and at most two later references are displayed separately.
When a response addresses several concrete questions, Office's response
instructions require short question headings for each answer. The header shows
request provenance; it does not infer semantic citations for individual sentences.

Live delivery and history reads attach the saved association to each answer.
For older messages without metadata, only a preceding user message visible in
the same native turn can supply a quote. Missing page-boundary origins remain
unlabelled. Legacy delegated tasks may show a task title with “Original question
not recorded”; a submission notification is never presented as the user's
original question. No lookup uses an agent's current task to relabel history.

## Read-only source lookup

The pinned `@openai/codex` 0.166.0 protocol supports `thread/items/read` with an
exact thread, turn, and item identity. `session.messageContext` reuses this API
for reply references without a search cursor. It supports archived Office chats
without resuming them or starting a turn. Missing or deleted sources show the
existing message-unavailable state. Existing search-cursor context paging is
unchanged. Long originals use the existing bounded-history truncation indicator.

## Verification

Unit checks cover steering, delayed events, restart/pagination, unrelated tasks,
Unicode bounds, ordinary replies, native source identity checks, and the source
viewer preserving the active chat. The real Codex/MCP delegation check adds
CEO → Head → worker → Head → CEO provenance, return/resubmission, gateway
restart, and exact source reading using a loopback model:

```sh
NODE_ENV=test npm test -- --run tests/unit/officeReplyContext.test.ts tests/unit/sessionTranscript.test.ts tests/unit/sessionMessageLocation.test.ts tests/unit/codexMessageSearch.test.ts
NODE_ENV=test node scripts/check-office-codex.mjs --codex "$PWD/node_modules/.bin/codex" --delegation-only
```

This check uses disposable employees and state, does not message existing
employees, and does not call a paid model endpoint. Git rollout alone does not
deploy or restart Office.
