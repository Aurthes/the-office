"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const HEADER = "x-office-push-identity";
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
function signIdentity(value, secret) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", secret).update(body).digest("base64url");
}
function readIdentity(raw, secret) {
  if (!secret || typeof raw !== "string" || raw.length > 2048) return null;
  const [body, signature, extra] = raw.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body || "").digest("base64url");
  if (extra || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString());
    const url = new URL(value.origin);
    if (url.protocol !== "https:" || url.origin !== value.origin || !/^[a-f0-9]{64}$/.test(value.owner) || !/^[a-f0-9-]{36}$/.test(value.device) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return null;
    return value;
  } catch { return null; }
}
function writePrivate(filename, data) {
  const temp = filename + "." + crypto.randomUUID() + ".tmp";
  try { fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: "wx" }); fs.renameSync(temp, filename); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
class PushIdentity {
  constructor(directory, owner) {
    this.filename = path.join(directory, "push-devices.json"); this.owner = owner;
    this.devices = fs.existsSync(this.filename) ? JSON.parse(fs.readFileSync(this.filename, "utf8")) : [];
  }
  fingerprint() { return digest(this.owner()); }
  register(session) {
    const owner = this.fingerprint();
    if (!session.pushDevice || !this.devices.some(d => d.id === session.pushDevice && d.owner === owner)) {
      session.pushDevice = crypto.randomUUID();
      this.devices = [...this.devices.filter(d => d.owner === owner), { id: session.pushDevice, owner }].slice(-128);
      writePrivate(this.filename, this.devices);
    }
    return session.pushDevice;
  }
  valid(value) { return value.owner === this.fingerprint() && this.devices.some(d => d.id === value.device && d.owner === value.owner); }
  revoke(device) { this.devices = this.devices.filter(d => d.id !== device); writePrivate(this.filename, this.devices); }
}
module.exports = { HEADER, signIdentity, readIdentity, PushIdentity, writePrivate };
