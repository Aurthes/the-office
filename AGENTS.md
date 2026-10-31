# Agent Instructions

Keep repository instructions generic and safe for open source.

The Office is an independently maintained Claw3D derivative using Codex through documented interfaces. Preserve upstream attribution and license notices. Keep any runtime checkout and all private deployment state separate from this repository.

## Non-invasive Codex integration

Office owns its projects, sessions, and Codex runtime state independently of the
native App. Do not build native project/session synchronization, including
read-only discovery, metadata edits, queued messages, or execution handoff. Use an
Office-owned Codex home and documented interfaces for Office's own conversations.
Do not revive the legacy shared-store adapters. See `docs/office-owned-state.md`
for the accepted boundary and chat-feature limits.

The Office adapts to an unmodified Codex/ChatGPT App. Do not patch its installation,
change its launcher or global environment, replace its backend owner, or change
its configuration to make Office work. Use documented interfaces and disable or
report unavailable capabilities instead of changing the App. Office-owned Codex
processes must remain separate from App-owned execution. Historical private-file
adapters are not an approved backend. Disclose experimental interface maturity
and validate the installed version. See `docs/codex-integration-boundary.md`.

A public method, a successful local probe, or no explicit prohibition is not
enough to establish cross-client App synchronization. Even documented sharing
remains outside the selected product scope unless that decision is explicitly
revisited. Test uncertain behavior on disposable data; never repair App databases
or caches to make an experiment pass.

Do not modify the OpenClaw source code. When the user asks for changes, they are asking for changes to this app. Your solutions should be applied to this app but to understand the full context of implementing your solution, you will need to search through OpenClaw's source code.

If you use local private overlay instructions, keep them outside the repository and do not commit them here.

Do not commit personal, environment-specific, or secret instructions to this repository.

## Cursor Cloud specific instructions

### Service overview

The Office is a Next.js 16 frontend derived from Claw3D (TypeScript, React 19, Three.js, Phaser) for OpenClaw. It runs a custom Node.js server (`server/index.js`) that bundles a same-origin WebSocket proxy to the upstream OpenClaw Gateway. No database or Docker is required. The only hard system dependency is Node.js 20+ with npm 10+.

### Running the app

- `npm run dev` starts the dev server on port 3000 via the custom server (`node server/index.js --dev`).
- Use the demo gateway for local exploration. Existing-App session mode is legacy; the independent Codex runtime must meet docs/office-owned-state.md before being presented as install-ready. OpenClaw is optional. A disconnected gateway shows the connection form.
- `.env` is copied from `.env.example`; see `README.md` "Configuration" for variable descriptions.

### Lint, typecheck, and tests

- `npm run lint` — ESLint. The codebase has a small number of pre-existing warnings and one pre-existing error (in `RetroOffice3D.tsx`).
- `npm run typecheck` — `tsc --noEmit`. Pre-existing type errors exist in some test files (`agentChatPanel-*.test.ts`) due to a stale `onOpenSettings` prop.
- `npm run test -- --run` — Vitest unit tests (use `--run` for single-run mode). A few pre-existing failures exist.
- `npm run e2e` — Playwright E2E tests; requires `npx playwright install` first.
- `npm run smoke:dev-server` — starts the dev server on a random port and verifies HTTP response.

### Build

- `npm run build` — Next.js production build. Expect a non-blocking warning about `Can't resolve 'openclaw'`; the `openclaw` npm package is resolved optionally at runtime and is not bundled.

### Gotchas

- The `openclaw` npm package is not a dependency of this repo. The build warning about it is harmless.
- `npm run studio:setup` is interactive (TTY prompts) — avoid running it in non-interactive cloud environments.
- Vitest runs in watch mode by default; always pass `--run` for CI/cloud agent use.
