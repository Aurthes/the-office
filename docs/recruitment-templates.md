# Recruitment templates

Recruitment templates are independent saved configuration, not employees or
references to existing conversations. Each contains an ID, name, model, reasoning
effort, and access mode. Every department, including Open Workspace, can select
one default. Templates and defaults live in the Office runtime's existing state
file alongside its own project and session metadata.

Open **Recruit agent**, choose a project or an Open Workspace working folder,
then select a saved template, **Department default**, or **Fresh defaults**. The
panel previews the configuration. **Manage recruitment templates** provides
create, edit, delete, and department-default controls using current backend model,
effort, and permission choices. Open Workspace requires a working folder before
workspace-specific options are loaded. Saving a template creates no employee.

Selection semantics are the same for both manual and Head recruitment:

- Omitted `templateId` uses the target department's saved default, if present;
  without one it uses the original fresh defaults.
- A string `templateId` selects that independent saved configuration.
- Explicit `templateId: null` uses fresh defaults even when a department default
  exists. Fresh defaults remain model/effort unset and workspace permissions.

Unknown template references, unavailable models/efforts, or currently disallowed
access modes fail before employee creation. They never fall back silently.
Deleting a template clears defaults referring to it in the same state save.
Changing a template or default does not change existing employee settings.

Full access uses the existing permission validator and requires confirmation when
the user saves the template. The confirmation explicitly covers employees later
recruited with that template and their future tasks. Applying an already saved
template does not repeat that confirmation, but still queries the real target
workspace's options and enforces `allowed`. Templates add no new permission mode,
Head authority, or bypass for disallowed permissions.

## One complete backend flow

The manual path is:

`CompanyActions` → authenticated `session.create` RPC →
`CodexOfficeStore.createSession` → `store.once`.

The Head path is:

`todo_recruit` MCP → `office-todo-mcp` → `todo.recruit` RPC →
`OfficeCompany.recruit` → the same `CodexOfficeStore.createSession` → `store.once`.

The Head wrapper checks its existing eligibility, department and reporting rules,
then supplies the recruitment metadata. The UI collects parameters and refreshes
the resulting roster. Neither path performs a second initialization afterward.
The shared action resolves the template/default, validates with
`sessionChoices`/`settingsPatch`, copies a settings snapshot, generates and stores
appearance, and persists the new session and idempotent result. Project working
folder membership is checked again after asynchronous native option validation.

New sessions have no copied native thread, history or project context. Recruitment
does not send work or start a Codex turn; native thread creation remains deferred
until work actually starts. Successful retries return the existing session and
appearance even after the template is changed or deleted. Existing operation-ID
conflict and uncertain-request behavior is preserved.

## Appearance and existing data

The common initializer stores the new session ID as its creation seed and uses
the original deterministic duck generator. The pure CommonJS implementation is
shared by the backend and the existing TypeScript facade; there is no second
randomization algorithm or TypeScript runtime loader.

Hydration prefers an existing saved Studio avatar, then the new backend avatar,
then the original default for older sessions. It normalizes the backend's partial
profile with the existing avatar normalizer. Normal Recruit no longer supplements
or writes an avatar in the frontend. Existing custom profiles, explicit firefighter
styling, and the separate clone flow keep their previous behavior. Older sessions
are not backfilled or randomized.

Authenticated user UI management uses `recruitment.list`, `recruitment.choices`,
`recruitment.save`, `recruitment.delete`, and `recruitment.default`. Mutation RPCs
use the existing request IDs. Template saves include project/workspace context for
validation; setting a default uses the stable department ID, with null mapping to
Open Workspace. No template-management MCP tools are added: `todo_recruit` can
only consume saved templates through its optional `templateId`.
