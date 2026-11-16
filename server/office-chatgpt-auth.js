"use strict";
const fs = require("node:fs");
const path = require("node:path");
// home is supplied by the Office runtime, never by a browser request.
function readOfficeChatGPTLogin(home) {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8"));
    if (auth.auth_mode !== "chatgpt" || !auth.tokens?.access_token) return null;
    return { accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id };
  } catch { return null; }
}
module.exports = { readOfficeChatGPTLogin };
