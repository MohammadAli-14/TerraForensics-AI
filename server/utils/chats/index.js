const { v4: uuidv4 } = require("uuid");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { resetMemory } = require("./commands/reset");
const { convertToPromptHistory } = require("../helpers/chat/responses");
const { SlashCommandPresets } = require("../../models/slashCommandsPresets");
const { SystemPromptVariables } = require("../../models/systemPromptVariables");

const VALID_COMMANDS = {
  "/reset": resetMemory,
};

async function grepCommand(message, user = null) {
  const userPresets = await SlashCommandPresets.getUserPresets(user?.id);
  const availableCommands = Object.keys(VALID_COMMANDS);

  // Check if the message starts with any built-in command
  for (let i = 0; i < availableCommands.length; i++) {
    const cmd = availableCommands[i];
    const re = new RegExp(`^(${cmd})`, "i");
    if (re.test(message)) {
      return cmd;
    }
  }

  // Replace all preset commands with their corresponding prompts
  // Allows multiple commands in one message
  let updatedMessage = message;
  for (const preset of userPresets) {
    const regex = new RegExp(
      `(?:\\b\\s|^)(${preset.command})(?:\\b\\s|$)`,
      "g"
    );
    updatedMessage = updatedMessage.replace(regex, preset.prompt);
  }

  return updatedMessage;
}

/**
 * @description This function will do recursive replacement of all slash commands with their corresponding prompts.
 * @notice This function is used for API calls and is not user-scoped. THIS FUNCTION DOES NOT SUPPORT PRESET COMMANDS.
 * @returns {Promise<string>}
 */
async function grepAllSlashCommands(message) {
  const allPresets = await SlashCommandPresets.where({});

  // Replace all preset commands with their corresponding prompts
  // Allows multiple commands in one message
  let updatedMessage = message;
  for (const preset of allPresets) {
    const regex = new RegExp(
      `(?:\\b\\s|^)(${preset.command})(?:\\b\\s|$)`,
      "g"
    );
    updatedMessage = updatedMessage.replace(regex, preset.prompt);
  }

  return updatedMessage;
}

async function recentChatHistory({
  user = null,
  workspace,
  thread = null,
  messageLimit = 20,
  apiSessionId = null,
}) {
  const rawHistory = (
    await WorkspaceChats.where(
      {
        workspaceId: workspace.id,
        user_id: user?.id || null,
        thread_id: thread?.id || null,
        api_session_id: apiSessionId || null,
        include: true,
      },
      messageLimit,
      { id: "desc" }
    )
  ).reverse();
  return { rawHistory, chatHistory: convertToPromptHistory(rawHistory) };
}

/**
 * Returns the base prompt for the chat. This method will also do variable
 * substitution on the prompt if there are any defined variables in the prompt.
 * @param {Object|null} workspace - the workspace object
 * @param {Object|null} user - the user object
 * @returns {Promise<string>} - the base prompt
 */
async function chatPrompt(
  workspace,
  user = null,
  { includeGtdInstructions = true } = {}
) {
  const { SystemSettings } = require("../../models/systemSettings");
  const basePrompt =
    workspace?.openAiPrompt ?? SystemSettings.saneDefaultSystemPrompt;

  if (!includeGtdInstructions) {
    return await SystemPromptVariables.expandSystemPromptVariables(
      basePrompt,
      user?.id,
      workspace?.id
    );
  }

  // Use the comprehensive GTD system prompt with JSON output instructions
  let gtdInstructions;
  try {
    const { GTD_SYSTEM_PROMPT } = require("../mongoDB/gtdSystemPrompt");
    gtdInstructions = GTD_SYSTEM_PROMPT;
  } catch (e) {
    // Fallback to basic instructions if module not available
    gtdInstructions = `
═══════════════════════════════════════════════════════════════════════════════
CRITICAL GLOBAL TERRORISM DATABASE (GTD) INSTRUCTION SET
═══════════════════════════════════════════════════════════════════════════════

⚠️ ABSOLUTE RULES - VIOLATION WILL CAUSE INCORRECT RESPONSES ⚠️

1. VERIFIED DATA ONLY
   - When you see "VERIFIED" fields in context, use ONLY those exact values
   - NEVER substitute data from your training knowledge

2. EXACT NUMBERS REQUIRED  
   - When context provides "VERIFIED DATABASE COUNT: X", respond with exactly X
   - Do NOT round, estimate, or use any other number

3. NO HALLUCINATION
   - If data is not in the context, say "Information not available in database"
   - NEVER invent attack details, casualties, groups, or locations

4. CONTEXT PRIORITY
   - Database context OVERRIDES your training data
   - Database context OVERRIDES chat history inferences

5. JSON OUTPUT REQUIRED
   - After your answer, output a JSON object with: answer, confidence, query_type, mongo_filter, needs_geo_data, limit
   - Set needs_geo_data to TRUE for any query with a location filter (country, city, region)

═══════════════════════════════════════════════════════════════════════════════
`;
  }

  // Combine base prompt with GTD instructions
  const enhancedPrompt = `${gtdInstructions}\n\n${basePrompt}`;

  return await SystemPromptVariables.expandSystemPromptVariables(
    enhancedPrompt,
    user?.id,
    workspace?.id
  );
}

// We use this util function to deduplicate sources from similarity searching
// if the document is already pinned.
// Eg: You pin a csv, if we RAG + full-text that you will get the same data
// points both in the full-text and possibly from RAG - result in bad results
// even if the LLM was not even going to hallucinate.
function sourceIdentifier(sourceDocument) {
  if (!sourceDocument?.title || !sourceDocument?.published) return uuidv4();
  return `title:${sourceDocument.title}-timestamp:${sourceDocument.published}`;
}

module.exports = {
  sourceIdentifier,
  recentChatHistory,
  chatPrompt,
  grepCommand,
  grepAllSlashCommands,
  VALID_COMMANDS,
};
