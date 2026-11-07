# Questions and original messages

Each Office response names the concrete question (Q), or step of a question,
that it answers. Its semantic summary is separate from the **Original message**
link. One prompt can contain multiple Qs; a continuation prompt is a control,
not a new Q. Ordinary knowledge/language questions have Qs without tasks.

## Model and agent protocol

`OfficeReplyContext` stores immutable Qs under Office-owned `questions/` and
per-conversation selections/reply bindings under `reply-context/`. A Q has a
stable `q-UUID`, semantic `summary` (180 characters), source message identities
and optionally `parentQuestionId`. Child Qs represent meaningful steps, inherit
the original source, and may add a clarification's source. Full original text
remains in native Codex; each source excerpt is bounded to 512 UTF-8 bytes.

The agent must call the existing Office MCP server's `question_context` before
public commentary or an answer. It chooses Qs by meaning; the UI and backend
never derive the Q summary from the last prompt or the current task.

- Read: `{actorId}` returns `answering`, `context`, `knownQuestions`, `recentSources`.
- Register: `{actorId, requestId, questions:[{key,summary,source?}], answering:[key]}`.
  `source` has exact Office `threadId`, native `turnId` and `itemId`.
- Split a prompt: define Q1/Q2 in one batch, choose only the one being answered.
- Select an existing Q: `{actorId, answering:[questionId]}`.
- Add a step: define a child with `parentQuestionId` (existing ID or earlier
  local key in the same batch). A source is optional when inheriting a parent.
- Optionally attach valid `taskId`/`phaseId` when selecting Qs. Q registration
  never creates, starts or completes a task. Actionable task workflow is separate.

At most eight Qs are defined/selected in one call. Definition retries reuse
`requestId`; changed arguments with the same ID fail rather than duplicate Qs.
A source defaults only when exactly one current original user message is
available. Several candidates require an explicit source; this provenance
convenience does not infer a semantic Q. Multi-Q answers use matching short Q
headings in the body. Agent declarations determine meaning; metadata validation
checks identity and provenance, not whether a summary is semantically correct.

## Reply, resume and delegation behavior

A reply freezes the selected Q snapshots at its first native assistant event
or delta. Later selection, steering, delayed events, history pagination and
restarts cannot relabel it. Streaming tokens do not repeatedly write metadata.
New human input clears the selection; the agent explicitly chooses whether it
continues an existing Q or opens new Qs. Play/automatic retry carries the prior
selection using the native send identity. `Continue where you left off` and
Office task/report notifications are never registered as original sources.

Tasks capture only explicitly selected Qs. Existing real handoffs carry their
stable identities through CEO → Head → worker, return, submission and review.
A selected child can refine a task's saved root Q; unrelated work cannot replace
that root. Assignee, reporting-line and acceptance rules remain unchanged.

Old v1 message-only associations preserve proven source links with no semantic
Q. The UI says **Question not identified** rather than showing a copied prompt
as a Q summary. It never reconstructs missing Qs from nearby messages. Source
viewing uses the pinned Codex 0.166.0 `thread/items/read` through the existing
read-only viewer, including archived Office chats, without resuming an agent.
Returning retains the live conversation DOM and restores its scroll position.

## Verification

Unit/component cases cover semantic selection, multiple Qs from one message,
child steps, source ambiguity, retries, resume, first-event snapshots, stale
turns, legacy migration, task boundaries and exact source navigation.

```sh
NODE_ENV=test npm test -- --run tests/unit/officeReplyContext.test.ts tests/unit/sessionTranscript.test.ts tests/unit/sessionMessageLocation.test.ts tests/unit/codexSessionControls.test.ts tests/unit/officeTodoMcp.test.ts
NODE_ENV=test node scripts/check-office-codex.mjs --codex "$PWD/node_modules/.bin/codex" --delegation-only
```

The native check uses actual pinned Codex and authenticated MCP with disposable
employees/state and a loopback model. It exercises Q declaration, nested handoff,
return/resubmission, restart and exact original-message reading; it does not
message existing employees or call a paid endpoint. Real model/browser semantic
acceptance is a separate deployment check; unit or loopback success alone does
not establish that every production agent chose the right Q.
