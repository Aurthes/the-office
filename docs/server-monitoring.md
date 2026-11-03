# Server fleet and terminals

A new Office instance starts with an empty server room, including on macOS.
Open **Server room → Configure machines** to add or edit one machine, assign a
group, choose its purpose, enable/disable it, or remove its registration. Bulk
entry accepts one comma-separated row per machine:

```text
worker01, Research, compute, yes
worker02, Research, compute, no
frontend01, Production, production, yes
```

The last two fields are optional (`compute` and `yes` by default). Choose
`local` to register the machine running Office; otherwise the alias must match
an existing SSH configuration. Office keeps transport and SSH credentials in
the existing SSH configuration. Registration only configures monitoring and
terminal access; removing an entry does not remove anything on that machine.

Save persists the instance's private `server-registry.json` under
`CLAW3D_DATA_DIR` (default `~/.local/share/claw3d`).
`CLAW3D_SERVER_REGISTRY_FILE` can point to another private file. No personal
inventory is shipped with the repository. The file is written atomically with
owner-only permissions and contains `{ "version": 1, "hosts": [...] }`.
Each host has `alias`, `group` (`online`, `offline`, or `local`), `active`, and
optional `family` (the display group). `group` records purpose; `family` records
how machines are organized in the room. Display groups never change purpose.

For compatibility, an explicitly provided `CLAW3D_SERVER_POOL_FILE` can seed an
instance that has no saved registry yet. It uses `alias|class|params|notes`;
`active=no` disables a registration. Saving in Office creates its own instance
registry and leaves the source pool and SSH configuration intact. A saved empty
registry stays empty. Names and transport notes are never copied into source.

Explicit display groups take precedence over automatic alias-prefix grouping.
Without a group, aliases such as `worker01` and `WORKER02-arm` share WORKER.
Aliases without a number appear under Other servers. Groups are alphabetical,
and machines within them use numeric order.

L1 has one selectable server model per registered host, including disabled hosts.
Its model ID uses the alias, so sorting and refreshes cannot change its identity.
Unbound upper-deck cabinets are spare cabinets. Resource cards and the fleet
panel share one visible-page sampling loop; unknown readings remain unknown.

The Terminal button opens a browser PTY for the selected registered host. The
Studio host needs Python 3 with Unix PTY support and working SSH authentication.
Local Mac uses its own local shell. Disabled and unknown hosts cannot open a
terminal. SSH uses trusted known-host keys and reuses configured control masters;
Office does not change SSH configuration or close shared masters.

Terminal WebSockets use the existing authenticated `/api/gateway/ws` entry with
`terminalHost=<alias>`. Studio routes that mode to its own PTY handler before the
Codex proxy. Existing origin, proxy-token and login checks stay in place. Shells
receive a small terminal environment rather than Office service credentials.
Closing the panel or losing its socket closes only that terminal's PTY/SSH
channel. Other sessions and the Codex gateway are independent.

Validation:

```sh
node --test server/server-terminal.test.cjs
NODE_ENV=test npm test -- --run tests/unit/serverFamilies.test.ts tests/unit/serverRackInfo.test.ts tests/unit/serverRoomGeometry.test.ts tests/unit/serverMonitoring.test.ts tests/unit/monitorDashboard.test.ts tests/unit/sessionTerminal.test.ts
```
