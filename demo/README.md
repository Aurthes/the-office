# Public demo

A browser-only preview built from the production `RingShipOffice`,
`SessionTranscript` and `SessionControls` components. Projects, conversations and
responses are simulated in this entry point. It does not connect to a gateway,
execute Codex, use credentials or expose the self-hosted office. Refreshing the
page resets its sample conversations; scene preferences remain in browser storage.

```sh
npm ci
npm run demo:dev
```

Open the URL printed by Vite. To build the GitHub Pages site:

```sh
npm run demo:build
```

The output is `dist-demo/`, with `/the-office/` as its default base. Override
`DEMO_BASE_PATH=/` to host it at an origin root. The build rebases the production
scene's public asset paths without changing the self-hosted app.

The `Publish interactive demo` workflow publishes it on pushes to `main` that
change its source or assets. GitHub Pages must use **GitHub Actions** as its source.
Account-backed voice, live execution, server monitoring and music search require
the self-hosted app. Those services are not part of this public preview.

Screenshots in `docs/images/` show this preview with simulated content and real
application components. Asset licenses remain in `THIRD_PARTY_NOTICES.md`.
