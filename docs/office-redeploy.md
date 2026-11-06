# Office redeploy on macOS

Build and validate the candidate in a separate directory **before** redeploying.
Never build over a running or rollback release. Keep its dependencies and build
available until the replacement has passed acceptance.

The spaceship is the default UI for `npm run dev` and `npm run build`.
To use the legacy Office interface, explicitly set
`NEXT_PUBLIC_CLAW3D_SESSION_VIEW=0` during the build.

For the Codex spaceship UI behind authenticated web access, build with
`npm run build:office`. This sets both `NEXT_PUBLIC_CLAW3D_SESSION_VIEW=1` and
`NEXT_PUBLIC_CLAW3D_WEB_ACCESS=1` **during compilation**. Setting them only when
starting Studio cannot change an existing browser bundle. The desktop build keeps
its separate local-only configuration. The deploy preflight checks a public
Studio candidate's compiled modes against its service configuration and rejects
missing or mismatched modes before stopping the running service. Rebuild older
packages that lack this build metadata; copying an old `.next` is not validation.

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
For a protected public Studio, readiness automatically supplies
`X-Office-Proxy-Token` from the service's private `CLAW3D_PROXY_TOKEN` setting.
The token is not included in the deployment result or logs.

If any cutover fails, all attempted services are restored in reverse order,
including the service whose stop/start failed. Each recovery has its own error
handling and health check, so a failed recovery cannot skip another service.
External configuration changes are reported instead of overwritten. The tool
only accepts Office gateway/studio labels and entry points. It does not edit
native App state, schedules, credentials, auth proxies, or tunnels.

For production Studio updates, preflight carries the previous release's
`.next/static` files into the candidate before starting it. An already-open tab
can then load its original terminal JS/CSS after any later update without a page
reload. New files stay unchanged; a shared URL with different contents rejects
the deployment before services stop. Only public static assets are carried
forward, using hard links where possible so old release directories can still be
removed without losing the assets. Files from `.next/server`, credentials, and
dependencies are not copied. Acceptance records the added file count and bytes
under `services[].clientAssets`. Unique historical static files remain available
in the current release for older tabs. This cannot restore files deleted before
the mechanism was enabled, or undo an import failure already cached in an old tab.

The command prints `result.json` in
`~/.local/share/claw3d/deployments/deploy-*` (`--state-dir` overrides this).
`--wait` only waits for that independent job; a caller timeout never cancels it.
The result distinguishes `succeeded`, `rolled_back`, `rejected`, and
`recovery_failed`; only `succeeded` exits zero with `--wait`. It records PIDs,
cutover durations, rollback health, and errors. The one-shot controller removes
its own launchd registration after writing the result and releasing its locks.
Keep the private receipt/configuration backups available for release retention;
they are separate from the much larger disposable builds.

## Automatic release retention

Configure release cleanup once in the private
`~/.local/share/claw3d/maintenance/release-retention.json`, or set `releaseCleanup`
in a deployment plan. Paths belong in private configuration, not this repository:

```json
{
  "repo": "/absolute/source/office",
  "ref": "origin/main",
  "releasesDir": "/absolute/private/releases",
  "deploymentsDir": "/absolute/private/deployments",
  "keepPreviousRelease": false,
  "workspaceInventory": "/absolute/private/office-owned/office.json",
  "protectedPaths": []
}
```

Only `repo` and `releasesDir` are required. `workspaceInventory`, when supplied,
is Office's own projects/sessions inventory. The local policy takes precedence
for installed user LaunchAgents; a production plan cannot disable it. An isolated
disposable deployment can use `releaseCleanup: null`. Without a plan override or a local
policy file, existing installations continue without automatic pruning.

After **all** selected services pass readiness, the independent controller saves
acceptance and prunes automatically, without another confirmation. Successful
deployment receipts include named state directories and nested cutover jobs.
Set `deploymentsDir` to their common root when using a custom `--state-dir`.
`keepPreviousRelease: false` retains only the current release per service; the
compatibility default `true` also retains its actual predecessor. Directory
timestamps do not choose rollback versions. Older unused successful
releases are eligible immediately, with no 24-hour grace period. Builds that have
never deployed, pending/failed deployment candidates, source checkouts, local
credentials/data, and service/process/workspace/shared-dependency references are
retained. Only release directories are candidates; this step does not retire task
worktrees or delete their branches.

The cleaner is copied alongside the independent controller. Receipt history must
remain available; its small configuration backups are separate from build output.
Malformed or missing history fails closed. Inspect `result.cleanup.entries` for
removed/retained paths. `result.cleanup.status: "failed"` reports a cleanup error
while leaving the healthy deployment running. Failed or rolled-back deployments
never invoke pruning. Periodic cleanup should use the same `--deployments-dir`
history and `--current-release-only` when configured to retain only current builds.

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
