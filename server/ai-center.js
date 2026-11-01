"use strict";

const { readOpenAiUsage } = require("./ai-center-openai");

// Provider readers return the same presentation data; only OpenAI is connected today.
async function readAiCenter(native, options) {
  const providers = await Promise.all([readOpenAiUsage(native, options)]);
  return { fetchedAt: new Date().toISOString(), providers };
}

module.exports = { readAiCenter };
