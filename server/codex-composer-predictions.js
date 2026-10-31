"use strict";
const https = require("node:https");
const { HttpsProxyAgent } = require("https-proxy-agent");

// Fetch the same account-gated configuration as the native composer. Credentials
// stay on the server; neither the token nor the generation prompt reaches the UI.
async function predictionAccount(client) {
  const auth = await client.call("getAuthStatus", { includeToken: true, refreshToken: false });
  if (!["chatgpt", "chatgptAuthTokens"].includes(auth.authMethod) || !auth.authToken) throw new Error("Predictions require a ChatGPT account");
  const accountId = JSON.parse(Buffer.from(auth.authToken.split(".")[1], "base64url"))["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (!accountId) throw new Error("Prediction account unavailable");
  return { token: auth.authToken, accountId };
}

function readPredictionConfig(client, account) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  return new Promise((resolve, reject) => {
    const req = https.get("https://chatgpt.com/backend-api/wham/predictions/config", {
      headers: { Authorization: "Bearer " + account.token, "ChatGPT-Account-Id": account.accountId, originator: "the-office", "User-Agent": client.userAgent },
      agent: proxy ? new HttpsProxyAgent(proxy) : undefined,
    }, res => {
      const chunks = []; let bytes = 0;
      res.on("data", chunk => { bytes += chunk.length; if (bytes > 32768) req.destroy(new Error("Prediction configuration too large")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("Native predictions unavailable"));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error("Invalid prediction configuration")); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error("Prediction configuration timed out")), 8000);
    req.on("close", () => clearTimeout(timer)); req.on("error", reject);
  });
}

class CodexComposerPredictions {
  constructor(client, { readConfig = readPredictionConfig, account = predictionAccount, random = Math.random, onError = detail => console.warn("[composer-prediction]", detail) } = {}) {
    this.client = client; this.readConfig = readConfig; this.account = account; this.random = random;
    this.onError = onError;
    this.config = null; this.results = new Map(); this.active = 0;
  }
  async request(row, context, generationTrigger = "catch_up") {
    if (!["live", "catch_up"].includes(generationTrigger)) return null;
    if (!this.client?.ready || context?.modelProvider !== "openai" || context.planMode) return null;
    const latest = (await this.client.call("thread/turns/list", { threadId: row.id, limit: 1, itemsView: "notLoaded", sortDirection: "desc" })).data[0];
    if (latest?.status !== "completed") return null;
    const account = await this.account(this.client);
    const key = JSON.stringify([account.accountId, row.id, latest.id, context.model]);
    if (this.results.has(key)) return this.results.get(key);
    if (this.active >= 2) return null;
    this.active++;
    const result = this.generate(row.id, latest.id, context.model, account, generationTrigger).then(prediction => {
      // Sampling eligibility is not a generated empty prediction. A later live
      // request for this turn must still be able to run after a catch-up skip.
      if (prediction === undefined && this.results.get(key) === result) this.results.delete(key);
      return prediction ?? null;
    }).catch(error => {
      // A failed generation is not a valid "no suggestion" result. A later
      // explicit request may retry the same completed turn, without polling.
      if (this.results.get(key) === result) this.results.delete(key);
      this.onError({ threadId: row.id, sourceTurnId: latest.id, code: error.code, stage: error.predictionStage || "sample",
        reason: /timed?\s*out|timeout/i.test(error.message || "") ? "native_timeout" : "native_error" });
      return null;
    }).finally(() => { this.active--; });
    this.results.set(key, result);
    while (this.results.size > 64) this.results.delete(this.results.keys().next().value);
    return result;
  }
  async generate(threadId, sourceTurnId, model, account, generationTrigger) {
    if (this.config?.accountId !== account.accountId || this.config.expires < Date.now()) {
      const entry = { accountId: account.accountId, expires: Date.now() + 300000 };
      entry.value = this.readConfig(this.client, account).catch(error => {
        if (this.config === entry) this.config = null;
        error.predictionStage = "configuration";
        throw error;
      });
      this.config = entry;
    }
    const config = await this.config.value;
    if (config?.is_enabled !== true || !config.prompt || typeof config.prompt !== "string" || config.prompt.length > 16384 || config.unsupported_models?.includes(model)) return;
    const rate = (generationTrigger === "live" ? config.live_sample_rate : config.catch_up_sample_rate) ?? 1;
    if (!Number.isFinite(rate) || rate <= 0 || this.random() >= rate) return;
    const schema = { type: "object", properties: { suggestion: { type: ["string", "null"] } }, required: ["suggestion"], additionalProperties: false };
    const params = {
      threadId, expectedTurnId: sourceTurnId,
      prompt: config.prompt + "\n\nReturn only JSON matching this schema: " + JSON.stringify(schema) + ".",
      // Inference-only sampling does not execute tools. Preserve the inherited
      // tool definitions instead of changing the source's prompt-cache prefix.
      effort: config.prediction_reasoning_effort || null,
      turnTrigger: "composer_predictions",
      responsesapiClientMetadata: { prediction_source_thread_id: threadId, prediction_source_turn_id: sourceTurnId, prediction_trigger: generationTrigger },
    };
    let result;
    for (let attempt = 0; ; attempt++) {
      try { result = await this.client.sampleThread(params); break; }
      catch (error) {
        // The native API has a 30-second budget, including fork startup and
        // cleanup. Retry once with the same context and native effort; never
        // change the user's model/settings or start an ordinary agent turn.
        if (attempt !== 0 || error.code !== -32603 || error.message !== "sample timed out") throw error;
        const latest = (await this.client.call("thread/turns/list", { threadId, limit: 1, itemsView: "notLoaded", sortDirection: "desc" })).data[0];
        if (latest?.id !== sourceTurnId || latest.status !== "completed") return;
        this.onError({ threadId, sourceTurnId, code: error.code, stage: "sample", reason: "native_timeout", retrying: true });
      }
    }
    if (result.sourceTurnId !== sourceTurnId || !result.text) return null;
    const text = JSON.parse(result.text).suggestion;
    if (typeof text !== "string" || !text.trim() || text.length > 4000) return null;
    return { text: text.trim(), sourceTurnId };
  }
}
module.exports = { CodexComposerPredictions };
