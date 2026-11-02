# Office for macOS

The macOS application runs the existing Office interface in your browser. It
includes Node.js 24.15.0 and the pinned official Codex CLI 0.166.0. Users do not
install Node, OpenClaw, a global CLI, or a gateway, and do not configure tokens or
ports. The first release targets **Apple Silicon (M1 or newer)** on macOS 13.5 or
newer. Intel build tooling remains experimental: package/runtime checks have run,
but the graphical installation has not been validated on a physical Intel Mac.

## Install and start

1. Open the DMG for your Mac's architecture and drag **The Office** to Applications.
2. Open **The Office**. It starts its own local services and opens your browser.
3. In Office, sign in with ChatGPT. Complete the official browser authorization.
   A device-code alternative is available if the callback cannot connect.
4. Recruit an agent, choose an existing working folder and give the agent a name.

Office has independent sign-in, projects and conversations. It does not attach to
or change the native Codex/ChatGPT App. Existing public rules, standalone skills
and selected ordinary defaults use the existing discovery mechanism. See
[the integration boundary](office-owned-state.md).

Music, server dashboards, optional API dictation and other integrations do not
block the core workspace. Connect optional services separately when needed.

Closing the browser leaves Office running. Reopen it from the Dock or the app's
**Open Office** menu. **Quit Office** stops its own services, including active
Office tasks; conversations remain saved and can be continued after reopening.
The launcher also cleans up its own children if the native wrapper disappears.

Office core data is under `~/Library/Application Support/The Office/`: independent
Codex state in `runtime/`, settings in `state/`, uploads, local startup settings,
versioned web caches and service logs. App resources stay immutable. Ports and
the private gateway token are generated automatically and retained across starts.
The app listens only on loopback and does not install login items, tunnels or
system services. Optional integrations keep their existing configuration locations.
Optional remote hosting keeps its separate deployment workflow.

## Build and validate

On a Mac matching the target architecture, with Node.js 24 and Xcode Command Line
Tools installed:

```sh
npm ci
node --test desktop/launcher.test.cjs
npm test -- --run tests/unit/officeOnboarding.test.ts tests/unit/companyActions.test.ts tests/unit/codexOfficeRuntime.test.ts
npm run desktop:build
node scripts/check-macos-package.mjs --app "dist-macos/The Office.app"
npx playwright install chromium webkit
node scripts/check-macos-browser.mjs --app "dist-macos/The Office.app" --browser chromium
node scripts/check-macos-browser.mjs --app "dist-macos/The Office.app" --browser webkit
```

The builder creates the app, a drag-to-Applications DMG and `build-info.json` in
`dist-macos/`. It downloads the pinned Node archive from nodejs.org and verifies
its committed SHA-256 before unpacking it. Dependencies come from
`package-lock.json`. It compiles a small AppKit launcher and packages production
dependencies only. No Electron or additional frontend runtime is added.

The package check runs the real bundled Node and Codex against a loopback
synthetic model in disposable state, then tests automatic startup, frontend
WebSocket connectivity, private-token handling, independent initial login and
application-resource integrity. It does not use a paid endpoint or native App
state. Real browser sign-in and hardware microphone behavior still require an
account/device check. A successful engine fixture does not establish live voice
quality or account entitlement.

The browser check uses a temporary working folder and a local synthetic model,
then exercises the real packaged startup, first-login screen, recruitment,
appearance persistence, streaming reply and reloaded history. It redirects only
the folder picker's initial location to its disposable workspace and represents
optional music as unconfigured, so a test never uses the host's music account.
Core creation, settings, chat and history requests still reach the real runtime.
`--browser chrome`
can use an existing Google Chrome installation. Chromium uses the full desktop
browser in headless mode with its normal graphics backend. The check does not force
the animated 3D scene through a CPU renderer. WebKit is a browser-engine check,
not a claim that every Safari version or physical microphone has been tested.

The manually triggered **macOS Application Preview** workflow builds Apple Silicon
on `macos-15`, runs the same checks and uploads preview
DMGs as workflow artifacts. Browser checks use the runner's installed Chrome
and the pinned Playwright WebKit build. The check logs browser versions and the
Chromium graphics backend to help distinguish rendering stalls from app failures.
It does not publish a GitHub release. Installer builds
refuse to overwrite an existing output app or DMG; pass `--out /new/directory` for
a new candidate. Do not build over or delete a running app or rollback candidate.

## Signing and public distribution

Without signing configuration, builds are explicitly **developer previews**:
the local ad hoc signature checks bundle integrity, but does not establish trust
for downloaded apps. Gatekeeper can block a preview downloaded from the Internet.
Do not describe these artifacts as a completed public one-click release.

For a public installer, install a **Developer ID Application** identity in the
build user's keychain and configure a notarytool keychain profile. Supply their
names through `OFFICE_MAC_SIGN_IDENTITY` and `OFFICE_MAC_NOTARY_PROFILE` when
running the builder. It signs nested native executables, signs the app, submits
the DMG for notarization and staples the accepted ticket. Secrets and certificates
must stay outside Git; the preview workflow deliberately has no signing secrets.
See [Apple's distribution and notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

This work does not supply an Apple Developer membership, signing certificate or
notarization credential. Validate the signed downloaded installer on a clean Mac
before publishing it as an installation experience without security prompts.
