const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const OTPAuth = require("otpauth");

const recoveryHash = code => crypto.createHash("sha256").update(code).digest("hex");
const normalize = code => String(code || "").replace(/[\s-]/g, "").toUpperCase();
const authenticator = (secret, username = "") => new OTPAuth.TOTP({
  issuer: "Claw3D", label: username, algorithm: "SHA1", digits: 6, period: 30,
  secret: OTPAuth.Secret.fromBase32(secret),
});
const counterFor = (secret, code, now) => {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator(secret).validate({ token: code, timestamp: now, window: 1 });
  return delta === null ? null : Math.floor(now / 30000) + delta;
};

class TotpStore {
  constructor(dataDir) {
    this.filename = path.join(dataDir, "totp.json");
    this.requiredFile = path.join(dataDir, "totp-required");
    this.state = null;
    if (fs.existsSync(this.filename)) {
      const state = JSON.parse(fs.readFileSync(this.filename, "utf8"));
      if (!state.id || !/^[A-Z2-7]{32}$/.test(state.secret) || !Number.isSafeInteger(state.lastCounter) || !Array.isArray(state.recoveryHashes) || !state.recoveryHashes.every(hash => /^[a-f0-9]{64}$/.test(hash))) throw new Error("Invalid two-factor configuration; refusing password-only fallback");
      this.state = state;
      fs.chmodSync(this.filename, 0o600);
    } else if (fs.existsSync(this.requiredFile)) {
      throw new Error("Two-factor configuration is missing; local recovery is required");
    }
  }
  get enabled() { return Boolean(this.state); }
  get id() { return this.state?.id; }
  enrollment(username) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    return { secret, uri: authenticator(secret, username).toString() };
  }
  uri(secret, username) { return authenticator(secret, username).toString(); }
  write(state) {
    const temporary = `${this.filename}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(state) + "\n", { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.filename);
      this.state = state;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  activate(secret, code, now = Date.now()) {
    if (this.enabled) throw new Error("Two-factor authentication is already enabled");
    const counter = counterFor(secret, normalize(code), now);
    if (counter === null) return null;
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(10).toString("hex").toUpperCase().match(/.{4}/g).join("-"));
    // A missing/corrupt state must fail closed after activation, including at restart.
    fs.writeFileSync(this.requiredFile, "required\n", { mode: 0o600 });
    this.write({ id: crypto.randomUUID(), secret, lastCounter: counter, recoveryHashes: codes.map(code => recoveryHash(normalize(code))) });
    return codes;
  }
  consume(code, now = Date.now()) {
    if (!this.state) return false;
    const value = normalize(code);
    const counter = counterFor(this.state.secret, value, now);
    if (counter !== null && counter > this.state.lastCounter) {
      this.write({ ...this.state, lastCounter: counter }); return true;
    }
    if (!/^[A-F0-9]{20}$/.test(value)) return false;
    const digest = recoveryHash(value);
    const index = this.state.recoveryHashes.findIndex(hash => crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(digest, "hex")));
    if (index < 0) return false;
    this.write({ ...this.state, recoveryHashes: this.state.recoveryHashes.filter((_, i) => i !== index) });
    return true;
  }
}
module.exports = { TotpStore };
