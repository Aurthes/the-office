#!/usr/bin/env node
import { spawnSync } from "node:child_process";

// Public flags must be present while Next compiles the browser bundle.
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this build with npm run build:office");
const result = spawnSync(process.execPath, [npm, "run", "build", "--", "--webpack"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_CLAW3D_SESSION_VIEW: "1",
    NEXT_PUBLIC_CLAW3D_WEB_ACCESS: "1",
  },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
