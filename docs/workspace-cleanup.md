# Workspace cleanup

Task worktrees and production builds need an end of life. Git ignore rules do
not reclaim disk space. Keep live services and shared dependencies intact.

After every generation, build, or validation batch, check only that batch's output
and temporary processes. Delete your own intermediate files and superseded
copies as soon as their last use is complete. Keep the intended deliverable and
anything still needed for review, validation, deployment, or rollback. Reuse
valid build caches while dependent checks remain; clear unused caches and build
copies when those checks finish. Stop only temporary processes owned by the task.
Do not perform a whole-disk or whole-workspace sweep after every generated file.

After merging and validating a completed task, retire its clean worktree once no
service, process, shared dependency, local data, or rollback needs it. Leave the
worktree first and run `git worktree remove <task-path>` from a retained checkout,
without `--force`. Check external references as described below before removal;
Git's clean check alone cannot detect them. Report the reason for any retained
worktree or large artifact. The 24-hour periodic policy below is a fallback for
abandoned leftovers, not a reason to keep your own completed temporary work.

Run from a retained checkout (Node.js, Git, `find`, `ps`, and `lsof` required;
macOS also uses `plutil`):

```sh
npm run cleanup:workspace
npm run cleanup:workspace -- --apply
```

The default is a read-only report. `--apply` removes task worktrees only when:

- They are direct children of `<workspace>/.worktrees/<repository>/`.
- Their commits are merged into `origin/main` (`--ref` overrides this).
- They are clean, unlocked, and idle for at least 24 hours.
- Ignored files contain only known generated builds, dependencies, and test output.
- No running process, macOS user LaunchAgent, or managed-directory symlink references them.

The base checkout, caller's working directory, and script's own checkout are
retained. Unknown ignored files (including `.env` and local agent state),
unregistered backups, unmerged work, and branches are left alone. No force flags
are used. References and Git state are checked again before each removal.

Deployments can additionally pass `--releases-dir <directory>`. Only directories
with a matching package name, `.next/BUILD_ID`, and `server/index.js` qualify as
releases. Referenced releases and the newest unused release for rollback are
retained; older unused releases must also meet the age threshold. This directory
must contain deployment artifacts only, never mutable user data.

Use `--protect <path>` repeatedly for references outside the managed directories,
including session/project workspaces and rollback paths in external deployment
configuration. Process inspection cannot discover remote clients or future use.
Do not put conversation state, uploads, credentials, or source backups in release
directories. They are outside this tool's scope and must be preserved separately.

Other options: `--repo <checkout>`, `--min-age-hours <hours>`, and
`--report <file>` (overwrites one JSON report). The script does not fetch Git,
install dependencies, kill processes, restart services, or alter runtime stores.
Fetch before a manual cleanup if the local reference is stale; stale references
conservatively retain work. For periodic maintenance, install a pinned copy of
the script outside task worktrees, supply deployment-specific protected paths,
and run daily with the default 24-hour grace period. Keep reports bounded.
