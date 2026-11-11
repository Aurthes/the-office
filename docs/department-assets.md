# Department assets

A department owns its guidelines, workflows and tools independently of its
current employees. Open its existing department details to register, edit or
deprecate an entry. Renaming an entry keeps its ID. Sources can reference an
existing document, skill or command; registration does not install or execute it.

Entries use the same Studio settings source as the organization:
`office[gatewayKey].departmentAssets[departmentId][assetId]`. Each complete entry
has `kind` (`guideline`, `workflow`, `tool`), `name`, `summary` (purpose/when),
`instructions` (usage/scope/limits), `source`, `version` and `status` (`active`,
`draft`, `deprecated`). Settings patches merge individual entries; `null` removes
an explicitly named entry. Omitting the field preserves existing assets.

Agents receive a small department index, not full documents or commands.
`office_tasks.todo_department_assets` lists at most 25 summaries with optional
kind/search/page filters; supplying the exact department and asset ID reads the
current detail. Existing conversations refresh their index through the normal
context cache; staff transfers and new sessions do not remove department data.
These references do not grant execution permissions or replace task constraints.

Deploy the updated Gateway and Studio before registering the first entry.
New services preserve assets when older clients omit the field. An old server
cannot preserve a field it does not understand: retain the settings/registry
backup before any downgrade and restore it through the current settings API.
