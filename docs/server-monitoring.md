# Server fleet and terminals

`CLAW3D_SERVER_POOL_FILE` points to the existing `alias|class|params|notes`
registry. SSH aliases come from the host's SSH configuration. The monitor and
terminal use the same registry parser. Generic prefix families (`cluster-a-`,
`cluster-b-`, `cluster-c-`, `cluster-d-`) appear as Cluster A–D; for example,
`cluster-a-01` belongs to Cluster A. Matching is case-insensitive; other remote
aliases appear under Other servers. These display groups do not change
online/offline workload classifications. Keep real host inventories and SSH
configuration outside the repository; documentation and tests use example aliases.

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
