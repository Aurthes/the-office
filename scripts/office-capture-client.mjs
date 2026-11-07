// Narrow native-to-Office attachment handoff. No gateway cookie/token or send RPC.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec = promisify(execFile);
const cleanEnv = { HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function frontmostApplication() {
  const code = "ObjC.import('AppKit'); function run() { const app=$.NSWorkspace.sharedWorkspace.frontmostApplication; return app && app.bundleIdentifier ? JSON.stringify({bundleId:ObjC.unwrap(app.bundleIdentifier),pid:app.processIdentifier}) : 'null'; }";
  const result = await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', code], { env: cleanEnv, timeout: 10000 });
  return JSON.parse(result.stdout);
}
export async function readCaptureClient(file) {
  const info = await lstat(file), parent = await stat(path.dirname(file));
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (parent.mode & 0o077) || info.uid !== process.getuid()) throw new Error('Capture client configuration must be a private user-owned file and directory.');
  const config = JSON.parse(await readFile(file, 'utf8'));
  const url = new URL(config.url);
  if (config.version !== 1 || !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.url) || !url.port || !/^[\w-]{43}$/.test(config.key) || Object.keys(config).some(key => !['version', 'url', 'key'].includes(key))) throw new Error('Invalid capture-only client configuration.');
  return config;
}
export async function captureAttachment({ configPath, wrapper, wrapperSha256, node = process.execPath, frontmost = frontmostApplication, capture, requestId = randomUUID(), fetcher = fetch, wait = sleep }) {
  // Freeze first, before reading configuration, HTTP or displaying any UI.
  const target = await frontmost();
  if (!target?.bundleId || !Number.isInteger(target.pid) || ['com.apple.shortcuts', 'com.apple.shortcuts.events', 'com.apple.Automator'].includes(target.bundleId)) throw new Error('Run the screenshot shortcut from the target app, after closing shortcut setup prompts.');
  const config = await readCaptureClient(configPath);
  const api = async (suffix, options = {}) => {
    const response = await fetcher(config.url + '/capture/' + suffix, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + config.key }, signal: AbortSignal.timeout(12000), ...(options.body && typeof options.body !== 'string' ? { duplex: 'half' } : {}) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Capture handoff failed (${response.status})`);
    return body;
  };
  let reservation, record;
  try {
    try { reservation = await api('begin', { method: 'POST', body: JSON.stringify({ requestId }), headers: { 'Content-Type': 'application/json' } }); }
    catch { reservation = await api(requestId); } // Read the same operation; never re-begin after an uncertain receipt.
    if (reservation.state !== 'prepared') throw new Error(reservation.error || 'Screenshot attachment was not reserved.');
    const epoch = reservation.bootEpoch;
    const current = await frontmost();
    if (current?.pid !== target.pid || current.bundleId !== target.bundleId) throw new Error('The target app changed before capture; no screenshot was taken.');
    let output;
    if (capture) output = await capture(target); // Isolated fixture seam; installed driver always executes the fixed wrapper.
    else {
      if (createHash('sha256').update(await readFile(wrapper)).digest('hex') !== wrapperSha256) throw new Error('Approved capture wrapper changed; refusing to run.');
      const result = await exec(node, [wrapper, 'capture', '--app', target.bundleId], { env: cleanEnv, timeout: 100000, maxBuffer: 1024 * 1024 });
      output = JSON.parse(result.stdout);
    }
    record = output.data;
    if (output.exitCode !== 0 || record?.bundleID !== target.bundleId || typeof record.screenshotPath !== 'string' || typeof record.directoryPath !== 'string') throw new Error('Capture identity or screenshot result is invalid.');
    const directory = await realpath(record.directoryPath), image = await realpath(record.screenshotPath), relative = path.relative(directory, image);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Screenshot is outside its capture directory.');
    const size = (await stat(image)).size;
    if (!size || size > 20 * 1024 * 1024) throw new Error('Screenshot must be between 1 byte and 20 MB.');
    const check = result => { if (result.bootEpoch !== epoch || result.requestId !== requestId) throw new Error('Office restarted or the handoff changed. Screenshot kept; do not replay it.'); return result; };
    const upload = () => api(requestId + '/image', { method: 'POST', body: createReadStream(image), headers: { 'Content-Type': 'image/png', 'Content-Length': String(size) } });
    let status;
    try { status = await upload(); }
    catch {
      status = await api(requestId);
      if (status.state === 'prepared') status = await upload(); // Exact same bytes/request, guarded by server digest/idempotency.
    }
    status = check(status);
    const deadline = Date.now() + 30000;
    while (status.state !== 'delivered') {
      if (['failed', 'cancelled'].includes(status.state)) throw new Error(status.error || 'Screenshot attachment was cancelled.');
      if (Date.now() > deadline) throw new Error('Attachment delivery was not confirmed. Screenshot kept; check the originally bound page.');
      await wait(500); status = check(await api(requestId));
    }
    return { ok: true, requestId, threadId: status.threadId, screenshotPath: record.screenshotPath, message: 'Screenshot attached to the original chat draft. Nothing was sent.' };
  } catch (error) {
    // Cancels only this reservation. The captured image is user data, retained.
    await api(requestId + '/cancel', { method: 'POST' }).catch(() => {});
    return { ok: false, requestId, error: error.message, ...(record ? { screenshotPath: record.screenshotPath, directoryPath: record.directoryPath } : {}) };
  }
}
