/**
 * GTD Configuration Module
 * Centralized configuration for GTD pipeline reliability settings
 *
 * Environment Variables:
 * - GTD_LLM_MAX_TOKENS: Maximum tokens for LLM responses (default: 4096)
 * - GTD_LLM_TIMEOUT_MS: Timeout for LLM requests in ms (default: 30000)
 * - GTD_ENABLE_FALLBACK: Enable fallback when LLM fails (default: true)
 * - GTD_MAX_RECORDS: Maximum records for GTD queries (default: 30000)
 */

const gtdConfig = {
  /**
   * Maximum tokens for LLM responses
   * Safe default of 4096 works with most models
   * Some models may support higher (8192, 16384) but risk 402 errors
   */
  get maxTokens() {
    const envVal = parseInt(process.env.GTD_LLM_MAX_TOKENS, 10);
    if (!isNaN(envVal) && envVal > 0) {
      return Math.min(envVal, 32768); // Cap at 32k for safety
    }
    return 4096; // Safe default
  },

  /**
   * Timeout for LLM requests in milliseconds
   * Default 30 seconds - enough for most queries, prevents hanging
   */
  get timeoutMs() {
    const envVal = parseInt(process.env.GTD_LLM_TIMEOUT_MS, 10);
    if (!isNaN(envVal) && envVal >= 5000) {
      return Math.min(envVal, 120000); // Cap at 2 minutes
    }
    return 30000; // 30 seconds default
  },

  /**
   * Enable fallback mode when LLM fails
   * When true, returns database results directly if LLM is unavailable
   */
  get enableFallback() {
    const envVal = process.env.GTD_ENABLE_FALLBACK;
    if (envVal === "false" || envVal === "0") {
      return false;
    }
    return true; // Default to enabled
  },

  /**
   * Maximum records for GTD queries
   * Allows worldwide and country-level queries (Complete Dataset: ~181K records)
   */
  get maxRecords() {
    const envVal = parseInt(process.env.GTD_MAX_RECORDS, 10);
    if (!isNaN(envVal) && envVal > 0) {
      return Math.min(envVal, 200000); // Increased cap to 200k for full dataset
    }
    return 200000; // Default to full dataset limit
  },

  /**
   * Get safe max_tokens value for a specific model
   * Different models have different limits
   * @param {string} modelName - Name of the LLM model
   * @returns {number} - Safe max_tokens value
   */
  getMaxTokensForModel(modelName) {
    if (!modelName) return this.maxTokens;

    const model = modelName.toLowerCase();

    // GPT-4 and variants
    if (model.includes("gpt-4")) {
      return Math.min(this.maxTokens, 8192);
    }

    // GPT-3.5
    if (model.includes("gpt-3.5")) {
      return Math.min(this.maxTokens, 4096);
    }

    // Claude models
    if (model.includes("claude")) {
      return Math.min(this.maxTokens, 4096);
    }

    // Gemini models
    if (model.includes("gemini")) {
      return Math.min(this.maxTokens, 8192);
    }

    // Llama models
    if (model.includes("llama")) {
      return Math.min(this.maxTokens, 4096);
    }

    // Mistral models
    if (model.includes("mistral") || model.includes("mixtral")) {
      return Math.min(this.maxTokens, 4096);
    }

    // OpenRouter auto
    if (model.includes("openrouter/auto")) {
      return Math.min(this.maxTokens, 4096);
    }

    // Default - use configured max
    return this.maxTokens;
  },

  /**
   * Log current configuration (for debugging)
   */
  logConfig() {
    console.log("[GTD Config] Current settings:");
    console.log(`  - maxTokens: ${this.maxTokens}`);
    console.log(`  - timeoutMs: ${this.timeoutMs}ms`);
    console.log(`  - enableFallback: ${this.enableFallback}`);
    console.log(`  - maxRecords: ${this.maxRecords}`);
  },
};

module.exports = gtdConfig;
