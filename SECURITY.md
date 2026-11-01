# The Office security policy

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Preferred path:

- Use [private vulnerability reporting](https://github.com/Aurthes/the-office/security/advisories/new) for this repository.

Fallback path:

- If no private reporting channel is available, open a minimal public issue requesting a private contact channel and do not include exploit details, tokens, or proof-of-concept payloads in that issue.

When reporting a vulnerability, include:

- A clear description of the issue.
- Impact and affected areas.
- Reproduction steps or a proof of concept.
- Any suggested mitigation if you have one.

We aim to acknowledge reports promptly, investigate them, and coordinate a fix and disclosure timeline with the reporter.

## Current Security Limitations

- Studio gateway settings are stored on disk in plaintext under the local OpenClaw state directory.
- The current UI loads the configured upstream gateway URL/token into browser memory at runtime, even though those values are not stored in browser persistent storage.
- Remote access uses the optional web-access gateway. Its password/TOTP login protects HTTP and WebSocket access; Studio and Codex remain on loopback. Authentication adds a remote access boundary and is not a complete security audit.

## Scope

Please report issues related to:

- Authentication or access-control bypasses.
- Secret handling or token exposure.
- Remote code execution or privilege escalation paths.
- Unsafe filesystem, proxy, or network behavior.
- Dependency vulnerabilities that materially affect this project.

## Deployment Notes

- In production, set `UPSTREAM_ALLOWLIST` for the Studio gateway proxy.
- Empty allowlists are intended for local development only.
- If you enable `STUDIO_ACCESS_TOKEN`, you must also provision the `studio_access` cookie through your deployment/auth layer.
