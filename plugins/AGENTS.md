# Optional native-App plugins

These packages are separate from the standalone Office application.
The light plugin stores only its own role names, colors, and explicitly linked
native-chat URLs. Opening a documented chat link is not session synchronization.

Use official MCP Apps interfaces. Do not launch Codex, connect to the existing
Office gateway, inspect native databases, discover native history in the
background, or alter the native App's configuration or backend.
Keep build dependencies, output, and validation isolated inside each package.
