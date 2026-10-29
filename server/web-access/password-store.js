const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const digest = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const same = (a, b) => crypto.timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
const writePrivate = (filename, value) => {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
};

class PasswordStore {
  constructor(dataDir, initial) {
    this.filename = path.join(dataDir, "credentials.json");
    this.setupFile = path.join(dataDir, "password-setup.json");
    this.current = fs.existsSync(this.filename) ? JSON.parse(fs.readFileSync(this.filename, "utf8")) : initial;
    const hash = this.current?.passwordHash;
    if (!this.current?.username || (hash ? hash.algorithm !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(hash.salt) || !/^[a-f0-9]{128}$/.test(hash.value) || typeof this.current.version !== "string" : String(this.current.password || "").length < 12)) throw new Error("Invalid access credentials");
  }
  get username() { return this.current.username; }
  get version() { return this.current.version || digest(JSON.stringify(this.current)); }
  get needsSetup() { return !this.current.setupComplete && fs.existsSync(this.setupFile); }
  async verify(password) {
    if (typeof password !== "string" || Buffer.byteLength(password) > 1024) return false;
    const hash = this.current.passwordHash;
    if (!hash) return same(password, this.current.password);
    const value = await scrypt(password, Buffer.from(hash.salt, "hex"), 64, parameters);
    return crypto.timingSafeEqual(value, Buffer.from(hash.value, "hex"));
  }
  setupGrant(now = Date.now()) {
    if (this.current.setupComplete || !fs.existsSync(this.setupFile)) return null;
    const value = JSON.parse(fs.readFileSync(this.setupFile, "utf8"));
    return value.previousVersion === this.version && value.expiresAt > now && /^[a-f0-9]{64}$/.test(value.tokenHash) ? value : null;
  }
  issueSetup(now = Date.now()) {
    if (this.current.setupComplete || this.current.passwordHash) throw new Error("Initial password has already been set");
    const token = crypto.randomBytes(32).toString("base64url");
    writePrivate(this.setupFile, { tokenHash: digest(token), previousVersion: this.version, expiresAt: now + 30 * 60 * 1000 });
    return token;
  }
  validToken(token, now = Date.now()) {
    const grant = this.setupGrant(now);
    return Boolean(grant && typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) && same(digest(token), grant.tokenHash));
  }
  async completeSetup(token, password, confirmation) {
    if (!this.validToken(token)) throw new Error("设置链接已失效或已使用，请重新获取一次性链接。");
    if (typeof password !== "string" || password.length < 12 || password.length > 256 || Buffer.byteLength(password) > 1024) throw new Error("密码请使用 12–256 个字符。");
    if (password !== confirmation) throw new Error("两次输入的密码不一致。");
    const salt = crypto.randomBytes(16);
    const value = await scrypt(password, salt, 64, parameters);
    // Recheck after the asynchronous KDF: simultaneous submissions cannot reuse a grant.
    if (!this.validToken(token)) throw new Error("设置链接已失效或已使用，请重新登录。");
    const next = { username: this.username, passwordHash: { algorithm: "scrypt-v1", salt: salt.toString("hex"), value: value.toString("hex") }, version: crypto.randomUUID(), setupComplete: true };
    writePrivate(this.filename, next);
    this.current = next;
  }
}
module.exports = { PasswordStore };
