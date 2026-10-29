const fs = require("node:fs");
const path = require("node:path");
const { PasswordStore } = require("../server/web-access/password-store");
const [directory, baseUrl] = process.argv.slice(2);
if (!directory || !baseUrl) throw new Error("Usage: node scripts/create-password-setup.js PRIVATE_ACCESS_DIR HTTPS_ORIGIN");
const origin = new URL(baseUrl);
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Use an HTTPS origin without a path or credentials");
const store = new PasswordStore(directory, JSON.parse(fs.readFileSync(path.join(directory, "credentials.json"), "utf8")));
const token = store.issueSetup();
// This is a short-lived credential for the local owner. Do not put it in logs.
process.stdout.write(`${origin.origin}/auth/password/setup#token=${token}\n`);
