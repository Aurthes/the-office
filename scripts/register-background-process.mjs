#!/usr/bin/env node
// Register an existing task; this command never starts, stops or retries it.
import { registerJob, readProcesses } from "../server/background-processes.js";
import { parseArgs } from "node:util";
try {
  const { values } = parseArgs({ options: { id: { type: "string" }, name: { type: "string" }, service: { type: "string" }, pid: { type: "string" }, events: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) console.log("node scripts/register-background-process.mjs --id data-sync --name 'Data sync' (--service com.example.data-sync | --pid 1234) [--events /absolute/progress.jsonl]\nUses CLAW3D_BACKGROUND_PROCESSES_DIR or the instance background-processes directory. PID registrations capture the process start identity.");
  else {
    if (!values.id || !values.name || Boolean(values.service) === Boolean(values.pid)) throw new Error("Specify --id, --name and exactly one of --service / --pid. See --help.");
    let target;
    if (values.service) target = { type: "launchd", label: values.service };
    else {
      const pid = Number(values.pid), process = (await readProcesses()).get(pid);
      if (!process || process.zombie) throw new Error("The process is not running; no registration was written.");
      target = { type: "pid", pid, started: process.started };
    }
    console.log(JSON.stringify(await registerJob({ version: 1, id: values.id, name: values.name, target, ...(values.events ? { eventsFile: values.events } : {}) })));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
