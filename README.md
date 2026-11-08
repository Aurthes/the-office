# The Office

A 3D workspace for your Codex conversations.

**[Download for Mac — Apple Silicon preview](https://github.com/Aurthes/the-office/releases/download/v0.1.4-preview.1/The-Office-0.1.4-macOS-arm64.dmg)**

For **M1 or newer**, macOS 13.5+, and a ChatGPT account with Codex access.
Node and Codex are included. No terminal or manual gateway setup.

> **Developer preview:** Apple signing and notarization are not finished.
> macOS may block the app. [How to open the preview](docs/macos-install.md#if-macos-blocks-the-preview).

## Get started

1. **Install.** Open the DMG, drag **The Office** to **Applications**, then open it.
2. **Sign in.** In Office, click **Sign in with ChatGPT** and finish signing in.
3. **Start working.** Recruit an agent, choose a working folder, give it a name, and send a message.

Office asks you to sign in separately from the Codex App and keeps its own chats.
Music, server dashboards and other integrations are optional.

![The Office — projects have rooms and conversations have crewmates](docs/images/office-overview.png)

## Try it in your browser

**[Open the demo](https://aurthes.github.io/the-office/)** — no installation or login.
The demo uses sample conversations and simulated replies.

## Help and development

- [Install, troubleshoot or build the Mac app](docs/macos-install.md)
- [Run from source and connect Codex](docs/office-owned-state.md#setup)
- [Connect optional services](docs/operations.md) · [Remote access](docs/web-access.md)
- [Demo source](demo/README.md) · [Security](SECURITY.md)

---

Built on [Claw3D](https://github.com/iamlukethedev/Claw3D), originally by
[Luke The Dev](https://github.com/iamlukethedev), and independently maintained by
[Aurthes](https://github.com/Aurthes). Unofficial community project, not an OpenAI product.
[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).

### Independent task phases

New Office tasks use independent phases: one Owner coordinates the goal, and each phase has its own assigned agent, timer, handoff and review. Use each phase row to start work, pause timing or open its conversation. Controls appear on hover or keyboard focus and remain visible on touch devices. Different agents can work in parallel; completing one phase does not start another. Displayed time is cumulative phase work, not elapsed wall time or an individual's hours.

Phase-mode tool calls require an explicit `phaseId`; submissions, reviews and recalls also require the exact `handoffId` from the notification or task record. Managers retain acceptance through the actual reporting chain. The legitimately completed final phase archives the task once every phase is complete and no handoff remains open, without another parent approval step.

Existing tasks keep their original whole-task workflow and recorded history. To configure future phases independently, finish old handoffs and pause the timer, then explicitly choose independent assignments. Existing completed phases keep their IDs and recorded time; missing historical assignees remain unknown. The Owner coordinates assignments without restricting ordinary member or user edits.
