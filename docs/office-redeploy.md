# Office redeploy on macOS

Build and validate the candidate in a separate directory **before** redeploying.
Never build over a running or rollback release. Keep its dependencies and build
available until the replacement has passed acceptance.

Use the shared entry point instead of writing a new stop/start script:

```sh
node scripts/redeploy-office.mjs --plan /absolute/private/deploy.json --wait
```

The private plan lists only services that need replacing, in cutover order. A
frontend-only update should list only Studio. For a full update, put the gateway
first so Studio remains available while its backend restarts:

```json
{
  "services": [
    {
      "plist": "/absolute/Library/LaunchAgents/local.claw3d.gateway.plist",
      "candidate": "/absolute/private/gateway.next.plist",
      "health": "http://127.0.0.1:18790/health"
    },
    {
      "plist": "/absolute/Library/LaunchAgents/local.claw3d.studio.plist",
      "candidate": "/absolute/private/studio.next.plist",
      "health": "http://127.0.0.1:3033/api/health"
    }
  ],
  "readyTimeoutMs": 15000
}
```

Create candidate plists by copying the existing Office plists and updating the
working directory and script path to the prepared release. Preserve environment,
ports, account/data directories, and tokens. Production Studio requires an
existing `.next/BUILD_ID` and Next dependency. Plists and backups can contain
credentials: keep them outside Git in private directories. Do not print them.

The command copies the controller and both service configurations to a private
job directory, then asks launchd to run the controller independently. Closing the
browser, ending the initiating chat, or stopping Office does not stop that job.
No task continuation or message submission is needed for recovery.

Before stopping anything, the controller locks the selected service plists,
checks source fingerprints and existing service health, and checks for concurrent
configuration changes. It replaces services one at a time. After `bootout`, it
waits for **both deregistration and old PID exit** before `bootstrap`. A running
PID and a successful loopback health response are required for readiness; the
gateway must also return `ok: true`. Health checks reject redirects.

If any cutover fails, all attempted services are restored in reverse order,
including the service whose stop/start failed. Each recovery has its own error
handling and health check, so a failed recovery cannot skip another service.
External configuration changes are reported instead of overwritten. The tool
only accepts Office gateway/studio labels and entry points. It does not edit
native App state, schedules, credentials, auth proxies, or tunnels.

The command prints `result.json` in
`~/.local/share/claw3d/deployments/deploy-*` (`--state-dir` overrides this).
`--wait` only waits for that independent job; a caller timeout never cancels it.
The result distinguishes `succeeded`, `rolled_back`, `rejected`, and
`recovery_failed`; only `succeeded` exits zero with `--wait`. It records PIDs,
cutover durations, rollback health, and errors. The one-shot controller removes
its own launchd registration after writing the result and releasing its locks.
Keep the private backups until acceptance; prune old jobs afterward.

If a controller is forcibly killed, inspect its result, launchd registration,
service health, and PID before removing its `.redeploy-lock` file. Never bypass a
live deployment's lock or run a second stop/start sequence while it is working.
Existing active chats/voice calls can be interrupted by a gateway restart: arrange
the cutover when idle. A frontend-only cutover preserves backend work. This tool
reduces the replacement window; it does not promise zero downtime or restore
in-flight tasks/data migrations. Keep incompatible data migrations separate.

Run the real disposable-LaunchAgent regression suite on macOS:

```sh
node --test scripts/redeploy-office.test.mjs
```

It checks caller exit, delayed shutdown, successful replacement, startup and
health failures, multi-service rollback, unchanged services on preflight failure,
source drift, deployment locks, and the native App boundary. Fixtures use their
own loopback ports and are removed afterward. Other platforms skip these tests;
this deployment entry point is specifically for macOS user LaunchAgents.
