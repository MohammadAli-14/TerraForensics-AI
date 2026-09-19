const { v4: uuidv4 } = require("uuid");
const { getVectorDbClass, getLLMProvider } = require("../helpers");
const { chatPrompt, sourceIdentifier } = require("./index");
const { EmbedChats } = require("../../models/embedChats");
const {
  convertToPromptHistory,
  writeResponseChunk,
} = require("../helpers/chat/responses");
const { DocumentManager } = require("../DocumentManager");

// GTD Imports
const mongoDBContextExtractor = require("../mongoDB/contextExtractor");
const gtdResponseFormatter = require("../mongoDB/gtdResponseFormatter");
const attackService = require("../mongoDB/services/attackService");
const { extractJsonFromLLMResponse } = require("./jsonUtils");
const { ResponseProxy } = require("./ResponseProxy");

async function streamChatWithForEmbed(
  response,
  /** @type {import("@prisma/client").embed_configs & {workspace?: import("@prisma/client").workspaces}} */
  embed,
  /** @type {String} */
  message,
  /** @type {String} */
  sessionId,
  { promptOverride, modelOverride, temperatureOverride, username }
) {
  const chatMode = embed.chat_mode;
  const chatModel = embed.allow_model_override ? modelOverride : null;

  // If there are overrides in request & they are permitted, override the default workspace ref information.
  if (embed.allow_prompt_override)
    embed.workspace.openAiPrompt = promptOverride;
  if (embed.allow_temperature_override)
    embed.workspace.openAiTemp = parseFloat(temperatureOverride);

  const uuid = uuidv4();
  const LLMConnector = getLLMProvider({
    provider: embed?.workspace?.chatProvider,
    model: chatModel ?? embed.workspace?.chatModel,
  });
  const VectorDb = getVectorDbClass();

  const messageLimit = embed.message_limit ?? 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(embed.workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(embed.workspace.slug);

  // User is trying to query-mode chat a workspace that has no data in it - so
  // we should exit early as no information can be found under these conditions.
  if ((!hasVectorizedSpace || embeddingsCount === 0) && chatMode === "query") {
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse:
        "I do not have enough information to answer that. Try another question.",
      sources: [],
      close: true,
      error: null,
    });
    return;
  }

  let completeText;
  let metrics = {};
  let contextTexts = [];
  let sources = [];
  let pinnedDocIdentifiers = [];
  const { rawHistory, chatHistory } = await recentEmbedChatHistory(
    sessionId,
    embed,
    messageLimit
  );

  // GTD Context Extraction
  let mongoContext = null;
  let mongoSources = [];

  try {
    mongoContext = await mongoDBContextExtractor.extractGTDContext(
      message,
      embed.workspace,
      username ? { username } : null,
      { slug: sessionId }
    );

    if (mongoContext && mongoContext.context) {
      console.log(`[EMBED] GTD Context extracted: ${mongoContext.type}`);
      // Add GTD context to context texts - MAKE IT THE FIRST CONTEXT
      contextTexts.unshift(mongoContext.context);

      // Add GTD sources
      if (mongoContext.sources && mongoContext.sources.length > 0) {
        mongoContext.sources.forEach((source) => {
          mongoSources.push({
            type: "terrorist_attack",
            id: source.id || source.eventid,
            name: source.name || "Terrorist Attack Data",
            country: source.country || "N/A",
            date: source.date || "N/A",
            text: `${source.attackType || "Attack"} in ${source.city || source.country || "Unknown"} - ${source.casualties?.killed || 0} killed`,
            fromMongoDB: true,
            metadata: { source: "Global Terrorism Database (GTD)", ...source },
          });
        });
        sources = [...sources, ...mongoSources];
      }
    }
  } catch (error) {
    console.error("⚠️ Embed GTD context extraction failed:", error.message);
  }

  // See stream.js comment for more information on this implementation.
  await new DocumentManager({
    workspace: embed.workspace,
    maxTokens: LLMConnector.promptWindowLimit(),
  })
    .pinnedDocs()
    .then((pinnedDocs) => {
      pinnedDocs.forEach((doc) => {
        const { pageContent, ...metadata } = doc;
        pinnedDocIdentifiers.push(sourceIdentifier(doc));
        contextTexts.push(doc.pageContent);
        sources.push({
          text:
            pageContent.slice(0, 1_000) +
            "...continued on in source document...",
          ...metadata,
        });
      });
    });

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await VectorDb.performSimilaritySearch({
          namespace: embed.workspace.slug,
          input: message,
          LLMConnector,
          similarityThreshold: embed.workspace?.similarityThreshold,
          topN: embed.workspace?.topN,
          filterIdentifiers: pinnedDocIdentifiers,
          rerank: embed.workspace?.vectorSearchMode === "rerank",
        })
      : {
          contextTexts: [],
          sources: [],
          message: null,
        };

  // Failed similarity search if it was run at all and failed.
  if (!!vectorSearchResults.message) {
    writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: "Failed to connect to vector database provider.",
    });
    return;
  }

  const { fillSourceWindow } = require("../helpers/chat");
  const filledSources = fillSourceWindow({
    nDocs: embed.workspace?.topN || 4,
    searchResults: vectorSearchResults.sources,
    history: rawHistory,
    filterIdentifiers: pinnedDocIdentifiers,
  });

  // Why does contextTexts get all the info, but sources only get current search?
  // This is to give the ability of the LLM to "comprehend" a contextual response without
  // populating the Citations under a response with documents the user "thinks" are irrelevant
  // due to how we manage backfilling of the context to keep chats with the LLM more correct in responses.
  // If a past citation was used to answer the question - that is visible in the history so it logically makes sense
  // and does not appear to the user that a new response used information that is otherwise irrelevant for a given prompt.
  // TLDR; reduces GitHub issues for "LLM citing document that has no answer in it" while keep answers highly accurate.
  contextTexts = [...contextTexts, ...filledSources.contextTexts];
  sources = [...sources, ...vectorSearchResults.sources];

  // If in query mode and no sources are found in current search or backfilled from history, do not
  // let the LLM try to hallucinate a response or use general knowledge
  if (chatMode === "query" && contextTexts.length === 0) {
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse:
        embed.workspace?.queryRefusalResponse ??
        "There is no relevant information in this workspace to answer your query.",
      sources: [],
      close: true,
      error: null,
    });
    return;
  }

  // Compress message to ensure prompt passes token limit with room for response
  // and build system messages based on inputs and history.
  const messages = await LLMConnector.compressMessages(
    {
      systemPrompt: await chatPrompt(embed.workspace, username),
      userPrompt: message,
      contextTexts,
      chatHistory,
    },
    rawHistory
  );

  // Handle GTD Chat History Override
  if (mongoContext && mongoContext.context && mongoContext.context.length > 0) {
    const isGTDDataQuery = ["gtd_stats", "gtd_sample", "gtd_data"].includes(
      mongoContext.type
    );
    if (isGTDDataQuery) {
      // Override chat history to prevent contamination
      messages[messages.length - 1].content =
        messages[messages.length - 1].content +
        `\n\n[INSTRUCTION: Answer using ONLY the VERIFIED DATABASE data provided in the context above. Do not use training data.]`;

      // Filter out previous user/assistant messages if needed, or just rely on the strong instruction and context priority
      // For embed, we'll keep it simple: just append instruction.
      // If we need to clear history:
      // messages = [messages[0], messages[messages.length - 1]]; // Keep system and last user message
    }
  }

  // If streaming is not explicitly enabled for connector
  // we do regular waiting of a response and send a single chunk.
  if (LLMConnector.streamingEnabled() !== true) {
    console.log(
      `\x1b[31m[STREAMING DISABLED]\x1b[0m Streaming is not available for ${LLMConnector.constructor.name}. Will use regular chat method.`
    );
    const { textResponse, metrics: performanceMetrics } =
      await LLMConnector.getChatCompletion(messages, {
        temperature: embed.workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      });
    completeText = textResponse;
    const extraction = extractJsonFromLLMResponse(textResponse);
    let visibleText = textResponse;
    if (
      extraction &&
      extraction.startIndex !== -1 &&
      extraction.endIndex !== -1
    ) {
      const before = textResponse.substring(0, extraction.startIndex);
      const after = textResponse.substring(extraction.endIndex);
      visibleText = (before + after).trim();
    }
    metrics = performanceMetrics;
    writeResponseChunk(response, {
      uuid,
      sources: [],
      type: "textResponseChunk",
      textResponse: visibleText,
      close: true,
      error: false,
      metrics, // Include metrics in the chunk
    });
  } else {
    const stream = await LLMConnector.streamGetChatCompletion(messages, {
      temperature: embed.workspace?.openAiTemp ?? LLMConnector.defaultTemp,
    });

    // Wrap response in proxy to strip internal JSON from the user stream
    const responseProxy = new ResponseProxy(response);

    completeText = await LLMConnector.handleStream(responseProxy, stream, {
      uuid,
      sources: [],
    });
    metrics = stream.metrics;
  }

  // GTD Post-Processing: Extract JSON & Execute Filter
  let gtdFormattedData = null;
  let llmParsedJson = null;

  if (completeText?.length > 0) {
    try {
      const extractionResult = extractJsonFromLLMResponse(completeText);
      if (extractionResult) {
        llmParsedJson = extractionResult.parsed;
        // Strip JSON
        if (
          extractionResult.startIndex !== -1 &&
          extractionResult.endIndex !== -1
        ) {
          const beforeJson = completeText.substring(
            0,
            extractionResult.startIndex
          );
          const afterJson = completeText.substring(extractionResult.endIndex);
          completeText = (beforeJson + afterJson).trim();
        }
      }

      // Execute Filter if needed
      if (
        llmParsedJson &&
        (llmParsedJson.mongo_filter ||
          llmParsedJson.mongo_filter === "" ||
          Object.keys(llmParsedJson.mongo_filter || {}).length === 0)
      ) {
        const shouldExecute = llmParsedJson.execute_on_server !== false;
        if (shouldExecute) {
          const normalizedFilter = mongoDBContextExtractor.normalizeGTDFilter(
            llmParsedJson.mongo_filter || {}
          );
          const limit = llmParsedJson.limit || 5000;
          const isWorldwide =
            !llmParsedJson.mongo_filter ||
            Object.keys(llmParsedJson.mongo_filter).length === 0;
          // Configurable via GTD_WORLDWIDE_GEO_LIMIT env var (default: 200000)
          const worldwideGeoLimit =
            parseInt(process.env.GTD_WORLDWIDE_GEO_LIMIT) || 200000;

          const result = await attackService.executeFilter(normalizedFilter, {
            limit: isWorldwide ? worldwideGeoLimit : Math.min(limit, 200000),
            skip: 0,
            maxLimit: 200000,
            countOnly: false,
            useRandomSample:
              isWorldwide || llmParsedJson.needs_geo_data !== false,
          });

          if (result.success) {
            gtdFormattedData = gtdResponseFormatter.formatResponse(
              result,
              llmParsedJson.answer || completeText,
              {
                query: message,
                includeGeoJSON: true,
                includeClusters: true,
                maxReturned: isWorldwide ? worldwideGeoLimit : limit,
                isWorldwideQuery: isWorldwide,
              }
            );
            gtdFormattedData.filter = normalizedFilter;
            gtdFormattedData.originalFilter = llmParsedJson.mongo_filter;
            gtdFormattedData.llm_metadata = {
              confidence: llmParsedJson.confidence,
              query_type: llmParsedJson.query_type,
              needs_geo_data: llmParsedJson.needs_geo_data,
            };
          }
        }
      }
    } catch (e) {
      console.error(`[EMBED] GTD Processing Error: ${e.message}`);
    }
  }

  await EmbedChats.new({
    embedId: embed.id,
    prompt: message,
    response: {
      text: completeText,
      type: chatMode,
      sources,
      metrics,
      gtdData: gtdFormattedData || null,
      llmParsedJson: llmParsedJson || null,
    },
    connection_information: response.locals.connection
      ? {
          ...response.locals.connection,
          username: !!username ? String(username) : null,
        }
      : { username: !!username ? String(username) : null },
    sessionId,
  });

  // Send custom response chunk with GTD data if available
  if (gtdFormattedData) {
    writeResponseChunk(response, {
      uuid,
      type: "finalizeResponseStream",
      close: true,
      error: false,
      metrics,
      gtdData: {
        success: true,
        total_count: gtdFormattedData.total_count,
        returned_count: gtdFormattedData.returned_count,
        geo_points: gtdFormattedData.geo_points,
        geojson: gtdFormattedData.geojson,
        filter: gtdFormattedData.filter,
        answer: gtdFormattedData.answer,
        llm_metadata: gtdFormattedData.llm_metadata,
      },
      llmOutput: llmParsedJson,
    });
    return;
  }
  return;
}

/**
 * @param {string} sessionId the session id of the user from embed widget
 * @param {Object} embed the embed config object
 * @param {Number} messageLimit the number of messages to return
 * @returns {Promise<{rawHistory: import("@prisma/client").embed_chats[], chatHistory: {role: string, content: string, attachments?: Object[]}[]}>
 */
async function recentEmbedChatHistory(sessionId, embed, messageLimit = 20) {
  const rawHistory = (
    await EmbedChats.forEmbedByUser(embed.id, sessionId, messageLimit, {
      id: "desc",
    })
  ).reverse();
  return { rawHistory, chatHistory: convertToPromptHistory(rawHistory) };
}

module.exports = {
  streamChatWithForEmbed,
};
