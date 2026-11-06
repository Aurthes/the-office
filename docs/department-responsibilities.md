# Department responsibilities

Department responsibilities are user configuration, not a second organization
roster. Store text in `office[gatewayUrl].departmentDescriptions`, keyed by existing
project IDs. The existing virtual `open-workspace` ID represents unassigned or
unavailable project membership. No company-specific responsibility text ships in
source.

A settings patch updates only named departments. A string saves trimmed text
(up to 4000 characters); an empty string or per-entry `null` removes one entry.
Setting `departmentDescriptions` itself to `null` clears all descriptions. Other
Office preferences and descriptions are preserved. Invalid value types and
prototype-related keys are rejected on writes; normalization drops invalid saved
entries. The settings coordinator coalesces independent per-department edits and
flushes an entire-map reset before subsequent per-entry edits.

`src/lib/office/department-structure.js` is shared CommonJS code for UI and gateway
consumers, with TypeScript exports in `departments.ts`:

- `normalizeDepartmentDescriptions(value)` returns a normalized ID/text record.
- `mergeDepartmentDescriptions(current, patch)` applies per-entry edits or reset.
- `organizationDepartments(projects, people, descriptions)` returns
  `{ id, name, description, heads, members }[]`.

The projection retains empty projects, distinguishes identical names by ID, and
excludes the CEO from Open Workspace. Members and Heads reference current
`OrganizationPerson` objects. Current reporting edges and the existing manager
role rule identify top departmental managers; an external reporting manager may
own another department. A department without a surviving manager shows a vacancy.
The projection never writes titles, promotes an employee, or changes membership.

`useOfficeOrganization` supplies this projection and
`saveDepartmentDescription(id, text)` through the existing settings coordinator.
`OrganizationView.openDepartment(id?)` opens a department or the company overview.
One `DepartmentPanel` in `OfficeScreen` owns the visible overview/detail view.
Detail tabs use department IDs, retain editing drafts while switching tabs or
closing the panel, and preserve failed edits for retry. Routine updates refresh
members, roles and saved responsibilities without replacing an active draft.

The control room entry beside the rear task board, directory department headings,
reporting-tree department links, and character organization details use this same
action. Person/session buttons retain their existing behavior; department actions
are separate buttons.

Responsibilities describe work routing. They do not grant permissions, replace
reporting relationships, or introduce an additional delegation system. Default
agent-context scope and routing are gateway concerns using this same data source.
