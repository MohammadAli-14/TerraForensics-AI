/**
 * Eagerly load the context windows for the current provider.
 * This is done to ensure that the context windows are pre-cached when the server boots.
 *
 * This prevents us from having misreporting of the context window before a chat is ever sent.
 * eg: when viewing the attachments in the workspace - the context window would be misreported if a chat
 * has not been sent yet.
 */
async function eagerLoadContextWindows() {
  const currentProvider = process.env.LLM_PROVIDER;

  const log = (provider) => {
    console.log(`⚡\x1b[32mPre-cached context windows for ${provider}\x1b[0m`);
  };

  switch (currentProvider) {
    case "ollama":
      const { OllamaAILLM } = require("../AiProviders/ollama");
      await OllamaAILLM.cacheContextWindows(true);
      log("Ollama");
      break;
  }
}

module.exports = eagerLoadContextWindows;
