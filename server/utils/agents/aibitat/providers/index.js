const OpenAIProvider = require("./openai.js");
const AnthropicProvider = require("./anthropic.js");
const OllamaProvider = require("./ollama.js");
const OpenRouterProvider = require("./openrouter.js");
const GenericOpenAiProvider = require("./genericOpenAi.js");
const GeminiProvider = require("./gemini.js");

module.exports = {
  OpenAIProvider,
  AnthropicProvider,
  OllamaProvider,
  OpenRouterProvider,
  GenericOpenAiProvider,
  GeminiProvider,
};
