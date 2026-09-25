const { v4: uuidv4 } = require("uuid");
const { DocumentManager } = require("../DocumentManager");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");
const { getVectorDbClass, getLLMProvider } = require("../helpers");
const { writeResponseChunk } = require("../helpers/chat/responses");
const {
  chatPrompt,
  sourceIdentifier,
  recentChatHistory,
  grepAllSlashCommands,
} = require("./index");
const {
  EphemeralAgentHandler,
  EphemeralEventListener,
} = require("../agents/ephemeral");
const { Telemetry } = require("../../models/telemetry");
const { CollectorApi } = require("../collectorApi");
const fs = require("fs");
const path = require("path");
const { hotdirPath, normalizePath, isWithin } = require("../files");
// MongoDB Context Extractor for GTD data
const mongoDBContextExtractor = require("../mongoDB/contextExtractor");
// GTD Response Formatter for geo_points and clusters
const gtdResponseFormatter = require("../mongoDB/gtdResponseFormatter");
// Attack service for GTD data execution
const attackService = require("../mongoDB/services/attackService");
// Shared JSON extraction utility
const { extractJsonFromLLMResponse } = require("./jsonUtils");
const { stripGeoPointsForStorage } = require("./gtdStorageHelper");

function isGlobalScopeQuery(query = "") {
  if (typeof query !== "string") return false;
  return /\b(worldwide|world\s*wide|global(?:ly)?|around\s+the\s+world|across\s+the\s+world|in\s+the\s+world|all\s+countries|everywhere|across\s+the\s+globe|around\s+the\s+globe)\b/i.test(
    query
  );
}

/**
 * Execute a MongoDB filter from LLM output and generate formatted GTD data
 * @param {Object} llmJson - Parsed JSON from LLM response
 * @param {string} originalQuery - The original user query
 * @returns {Object|null} - Formatted GTD data or null
 */
async function executeFilterFromLLMResponse(llmJson, originalQuery) {
  const hasFilter = llmJson && llmJson.mongo_filter !== undefined;
  const isEmptyFilter =
    !llmJson?.mongo_filter ||
    llmJson.mongo_filter === "" ||
    (typeof llmJson.mongo_filter === "object" &&
      Object.keys(llmJson.mongo_filter).length === 0);

  if (!hasFilter && !isEmptyFilter) {
    return null;
  }

  if (isEmptyFilter && llmJson) {
    llmJson.mongo_filter = {};
  }

  try {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState !== 1) {
      console.error(`[API Chat Filter Executor] MongoDB not connected`);
      return null;
    }

    let filter = llmJson.mongo_filter;
    const limit = llmJson.limit || 5000;
    const needsGeoData = llmJson.needs_geo_data !== false;
    const serverInstructions = llmJson.server_instructions || {};
    const isCountOnlyQuery =
      serverInstructions.return_mode === "count_only" ||
      serverInstructions.action === "return_aggregates";

    console.log(
      `[API Chat Filter Executor] Executing filter:`,
      JSON.stringify(filter)
    );

    // Valid GTD database fields that can be used in filters
    // Includes special conversion fields (year_start, year_end) that normalizeGTDFilter handles
    const validGTDFields = new Set([
      "eventid",
      "iyear",
      "imonth",
      "iday",
      "country",
      "country_txt",
      "region",
      "region_txt",
      "provstate",
      "city",
      "latitude",
      "longitude",
      "attacktype1",
      "attacktype1_txt",
      "attacktype2",
      "attacktype2_txt",
      "targtype1",
      "targtype1_txt",
      "target1",
      "targsubtype1_txt",
      "gname",
      "gsubname",
      "motive",
      "weaptype1",
      "weaptype1_txt",
      "weapsubtype1_txt",
      "nkill",
      "nwound",
      "nperps",
      "success",
      "suicide",
      "extended",
      "ishostkid",
      "ransom",
      "ransompaid",
      "property",
      "propvalue",
      "summary",
      "corp1",
      "natlty1_txt",
      // Special conversion fields - normalizeGTDFilter converts these to $expr
      "year_start",
      "year_end",
      // Allow $expr for complex queries
      "$expr",
      "$and",
      "$or",
      "$not",
    ]);

    // Check if a filter contains only valid GTD fields
    const hasOnlyValidFields = (filterObj) => {
      if (!filterObj || typeof filterObj !== "object") return true;
      const keys = Object.keys(filterObj);
      return keys.every((key) => validGTDFields.has(key));
    };

    // Detect worldwide queries - empty filter OR filter with "worldwide" as a value
    const isWorldwideFilter = (value) => {
      if (typeof value === "string") {
        return /^(worldwide|global|all\s*countries?|world|everywhere)$/i.test(
          value.trim()
        );
      }
      return false;
    };

    // Check if original query mentions "worldwide" or similar global terms
    const queryMentionsWorldwide =
      /\b(worldwide|global|all\s*countries|around\s*the\s*world|across\s*the\s*world|in\s*the\s*world|total|overall)\b/i.test(
        originalQuery
      );

    let isWorldwideQuery = !filter || Object.keys(filter).length === 0;

    // Check if filter contains worldwide indicators OR invalid fields
    if (filter && !isWorldwideQuery) {
      const filterKeys = Object.keys(filter);

      // Check if the only filter is a worldwide indicator
      if (
        filterKeys.length === 1 &&
        filterKeys[0] === "country_txt" &&
        isWorldwideFilter(filter.country_txt)
      ) {
        console.log(
          `[API Chat Filter Executor] Detected worldwide indicator in filter: ${filter.country_txt}`
        );
        console.log(
          `[API Chat Filter Executor] Converting to empty filter for worldwide query`
        );
        filter = {};
        isWorldwideQuery = true;
      }
      // Check if filter contains ONLY invalid/meta fields (LLM put answer in filter)
      else if (!hasOnlyValidFields(filter)) {
        console.log(
          `[API Chat Filter Executor] ⚠️ Filter contains invalid GTD fields: ${JSON.stringify(filter)}`
        );
        console.log(
          `[API Chat Filter Executor] Valid fields are: country_txt, provstate, city, gname, iyear, etc.`
        );

        // If query mentions worldwide, treat as worldwide query
        if (queryMentionsWorldwide) {
          console.log(
            `[API Chat Filter Executor] Query mentions worldwide - treating as worldwide query`
          );
          filter = {};
          isWorldwideQuery = true;
        } else {
          // Try to salvage any valid fields from the filter
          const validFilter = {};
          for (const [key, value] of Object.entries(filter)) {
            if (validGTDFields.has(key)) {
              validFilter[key] = value;
            }
          }
          if (Object.keys(validFilter).length > 0) {
            console.log(
              `[API Chat Filter Executor] Salvaged valid fields: ${JSON.stringify(validFilter)}`
            );
            filter = validFilter;
          } else {
            console.log(
              `[API Chat Filter Executor] No valid fields found - treating as worldwide query`
            );
            filter = {};
            isWorldwideQuery = true;
          }
        }
      }
    }

    // If query explicitly mentions worldwide but we still have a non-empty filter,
    // it might be a worldwide query that the LLM incorrectly filtered
    if (
      !isWorldwideQuery &&
      queryMentionsWorldwide &&
      Object.keys(filter).length > 0
    ) {
      // Check if the filter values are worldwide indicators
      const allValuesAreWorldwide = Object.values(filter).every(
        (v) => typeof v === "string" && isWorldwideFilter(v)
      );
      if (allValuesAreWorldwide) {
        console.log(
          `[API Chat Filter Executor] All filter values are worldwide indicators - converting to empty filter`
        );
        filter = {};
        isWorldwideQuery = true;
      }
    }

    // For worldwide queries, we want to fetch sample records for geo visualization
    // Configurable via GTD_WORLDWIDE_GEO_LIMIT env var (default: 200000)
    const worldwideGeoLimit =
      parseInt(process.env.GTD_WORLDWIDE_GEO_LIMIT) || 200000;

    // Normalize the filter (Numeric fields & Global Schema)
    let normalizedFilter = mongoDBContextExtractor.normalizeGTDFilter(filter);

    // CRITICAL: Apply Centralized Schema Normalization (Attack Types, Target Types, etc.)
    const GTDNormalizer = require("../mongoDB/GTDNormalizationService");
    normalizedFilter = GTDNormalizer.normalizeFilter(normalizedFilter);
    console.log(
      `[API Chat Filter Executor] Normalized filter (Final):`,
      JSON.stringify(normalizedFilter)
    );

    // Determine effective limit
    let effectiveLimit;
    let useCountOnly = false;
    if (isWorldwideQuery) {
      effectiveLimit = worldwideGeoLimit;
      console.log(
        `[API Chat Filter Executor] WORLDWIDE: Fetching ${worldwideGeoLimit} sample records for global geo visualization`
      );
    } else if (isCountOnlyQuery && !needsGeoData) {
      effectiveLimit = 0;
      useCountOnly = true;
      console.log(
        `[API Chat Filter Executor] COUNT-ONLY mode - using aggregation for count`
      );
    } else {
      effectiveLimit = serverInstructions.max_records || limit;
    }

    // Determine if we should use random sampling for representative distribution
    // Check for year range queries (contain year_start/year_end or $expr with $toInt on iyear)
    const hasYearRange =
      filter.year_start !== undefined ||
      filter.year_end !== undefined ||
      (normalizedFilter.$expr &&
        JSON.stringify(normalizedFilter.$expr).includes("$toInt"));

    // Use random sampling for worldwide, date range, or geo queries
    const useRandomSample = isWorldwideQuery || hasYearRange || needsGeoData;

    if (useRandomSample) {
      console.log(
        `[API Chat Filter Executor] Using random sampling for representative distribution`
      );
    }

    // Execute the filter
    const result = await attackService.executeFilter(normalizedFilter, {
      limit: useCountOnly ? 0 : Math.min(effectiveLimit, 200000),
      skip: 0,
      maxLimit: 200000,
      countOnly: useCountOnly,
      useRandomSample: useRandomSample && !useCountOnly,
    });

    if (!result.success) {
      console.error(`[API Chat Filter Executor] Query failed:`, result.error);
      return null;
    }

    console.log(
      `[API Chat Filter Executor] Query returned ${result.results.length} of ${result.totalCount} total`
    );

    // Apply return_fields filtering if specified
    let filteredResults = result.results;
    if (
      serverInstructions.return_fields &&
      serverInstructions.return_fields.length > 0
    ) {
      const fields = serverInstructions.return_fields;
      filteredResults = result.results.map((record) => {
        const filtered = {};
        fields.forEach((field) => {
          if (record[field] !== undefined) {
            filtered[field] = record[field];
          }
        });
        return filtered;
      });
    }

    // Calculate totals
    let totalKilled = 0;
    let totalWounded = 0;
    result.results.forEach((r) => {
      totalKilled += parseInt(r.nkill, 10) || 0;
      totalWounded += parseInt(r.nwound, 10) || 0;
    });

    // Generate geo_points if needsGeoData or worldwide query
    let geoPoints = [];
    if (needsGeoData || isWorldwideQuery) {
      geoPoints = result.results
        .filter((r) => r.latitude && r.longitude)
        .map((r) => ({
          eventid: r.eventid || `GTD_doc_${r._id}`,
          lat: parseFloat(r.latitude),
          lon: parseFloat(r.longitude),
          weight: 1,
          iyear: parseInt(r.iyear, 10) || null,
          country_txt: r.country_txt || "",
          region_txt: r.region_txt || "",
          city: r.city || "",
          attacktype1_txt: r.attacktype1_txt || "",
          weaptype1_txt: r.weaptype1_txt || "",
          targtype1_txt: r.targtype1_txt || "",
          gname: r.gname || "",
          nkill: parseInt(r.nkill, 10) || 0,
          nwound: parseInt(r.nwound, 10) || 0,
          summary: r.summary || "",
        }));
    }

    // Build response object
    const response = {
      success: true,
      total_count: result.totalCount,
      returned_count: result.results.length,
      geo_points: geoPoints,
      filter: normalizedFilter,
      originalFilter: filter,
      query: originalQuery,
      answer: llmJson.answer || "",
      totalKilled,
      totalWounded,
      llm_metadata: {
        confidence: llmJson.confidence,
        query_type: llmJson.query_type,
        needs_geo_data: needsGeoData,
        execute_on_server: llmJson.execute_on_server,
        isCountOnlyQuery: useCountOnly,
      },
    };

    // Add worldwide query metadata
    if (isWorldwideQuery) {
      response.is_worldwide = true;
      response.geo_points_limited = true;
      response.geo_points_max = worldwideGeoLimit;
      response.geo_points_sample = true; // Indicate this is a sample, not all points
    }

    // Add random sampling indicator
    if (result.usedRandomSample) {
      response.used_random_sample = true;
    }

    return response;
  } catch (error) {
    console.error(`[API Chat Filter Executor] Error:`, error.message);
    return null;
  }
}
/**
 * @typedef ResponseObject
 * @property {string} id - uuid of response
 * @property {string} type - Type of response
 * @property {string|null} textResponse - full text response
 * @property {object[]} sources
 * @property {boolean} close
 * @property {string|null} error
 * @property {object} metrics
 */

/**
 * Users can pass in documents as attachments to the chat API.
 * The name of the document is the name of the attachment and must include the file extension.
 * the mime type for documents is `application/VertexAI-document` - anything else is assumed to be an image.
 * @param {{name: string, mime: string, contentString: string}[]} attachments
 * @returns {Promise<{parsedDocuments: Object[], imageAttachments: {name: string; mime: string; contentString: string}[]}>}
 */
async function processDocumentAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0)
    return { parsedDocuments: [], imageAttachments: [] };
  const documentAttachments = [];
  const imageAttachments = [];
  for (const attachment of attachments) {
    if (
      attachment &&
      attachment.contentString &&
      attachment.mime &&
      attachment.mime.toLowerCase() === "application/VertexAI-document"
    )
      documentAttachments.push(attachment);
    else imageAttachments.push(attachment);
  }

  if (documentAttachments.length === 0)
    return { parsedDocuments: [], imageAttachments };
  const Collector = new CollectorApi();
  const processingOnline = await Collector.online();
  if (!processingOnline) {
    console.warn(
      "Collector API is not online, skipping document attachment processing"
    );
    return { parsedDocuments: [], imageAttachments };
  }
  if (!fs.existsSync(hotdirPath)) fs.mkdirSync(hotdirPath, { recursive: true });

  const parsedDocuments = [];
  for (const attachment of documentAttachments) {
    try {
      let base64Data = attachment.contentString;
      const dataUriMatch = base64Data.match(/^data:[^;]+;base64,(.+)$/);
      if (dataUriMatch) base64Data = dataUriMatch[1];

      const buffer = Buffer.from(base64Data, "base64");
      const filename = normalizePath(
        attachment.name || `attachment-${uuidv4()}`
      );
      const filePath = normalizePath(path.join(hotdirPath, filename));
      if (!isWithin(hotdirPath, filePath))
        throw new Error(`Invalid file path for attachment ${filename}`);
      fs.writeFileSync(filePath, buffer);

      const { success, reason, documents } =
        await Collector.parseDocument(filename);
      if (success && documents?.length > 0) parsedDocuments.push(...documents);
      else console.warn(`Failed to parse attachment ${filename}:`, reason);
    } catch (error) {
      console.error(
        `Error processing attachment ${attachment.name}:`,
        error.message
      );
    }
  }

  return { parsedDocuments, imageAttachments };
}

/**
 * Handle synchronous chats with your workspace via the developer API endpoint
 * @param {{
 *  workspace: import("@prisma/client").workspaces,
 *  message:string,
 *  mode: "chat"|"query",
 *  user: import("@prisma/client").users|null,
 *  thread: import("@prisma/client").workspace_threads|null,
 *  sessionId: string|null,
 *  attachments: { name: string; mime: string; contentString: string }[],
 *  reset: boolean,
 * }} parameters
 * @returns {Promise<ResponseObject>}
 */
async function chatSync({
  workspace,
  message = null,
  mode = "chat",
  user = null,
  thread = null,
  sessionId = null,
  attachments = [],
  reset = false,
}) {
  const uuid = uuidv4();
  const chatMode = mode ?? "chat";

  // If the user wants to reset the chat history we do so pre-flight
  // and continue execution. If no message is provided then the user intended
  // to reset the chat history only and we can exit early with a confirmation.
  if (reset) {
    await WorkspaceChats.markThreadHistoryInvalidV2({
      workspaceId: workspace.id,
      user_id: user?.id,
      thread_id: thread?.id,
      api_session_id: sessionId,
    });
    if (!message?.length) {
      return {
        id: uuid,
        type: "textResponse",
        textResponse: "Chat history was reset!",
        sources: [],
        close: true,
        error: null,
        metrics: {},
      };
    }
  }

  // Process slash commands
  // Since preset commands are not supported in API calls, we can just process the message here
  const processedMessage = await grepAllSlashCommands(message);
  message = processedMessage;

  if (EphemeralAgentHandler.isAgentInvocation({ message })) {
    await Telemetry.sendTelemetry("agent_chat_started");

    // Initialize the EphemeralAgentHandler to handle non-continuous
    // conversations with agents since this is over REST.
    const agentHandler = new EphemeralAgentHandler({
      uuid,
      workspace,
      prompt: message,
      userId: user?.id || null,
      threadId: thread?.id || null,
      sessionId,
    });

    // Establish event listener that emulates websocket calls
    // in Aibitat so that we can keep the same interface in Aibitat
    // but use HTTP.
    const eventListener = new EphemeralEventListener();
    await agentHandler.init();
    await agentHandler.createAIbitat({ handler: eventListener });
    agentHandler.startAgentCluster();

    // The cluster has started and now we wait for close event since
    // this is a synchronous call for an agent, so we return everything at once.
    // After this, we conclude the call as we normally do.
    return await eventListener
      .waitForClose()
      .then(async ({ thoughts, textResponse }) => {
        await WorkspaceChats.new({
          workspaceId: workspace.id,
          prompt: String(message),
          response: {
            text: textResponse,
            sources: [],
            attachments,
            type: chatMode,
            thoughts,
          },
          include: false,
          apiSessionId: sessionId,
        });
        return {
          id: uuid,
          type: "textResponse",
          sources: [],
          close: true,
          error: null,
          textResponse,
          thoughts,
        };
      });
  }

  const LLMConnector = getLLMProvider({
    provider: workspace?.chatProvider,
    model: workspace?.chatModel,
  });
  const VectorDb = getVectorDbClass();
  const messageLimit = workspace?.openAiHistory || 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);

  // DEBUG: Log API chat parameters
  console.log(
    `[API CHAT DEBUG] ═══════════════════════════════════════════════════`
  );
  console.log(`[API CHAT DEBUG] Received query: "${message}"`);
  console.log(
    `[API CHAT DEBUG] Workspace: ${workspace?.name} (ID: ${workspace?.id}, slug: ${workspace?.slug})`
  );
  console.log(`[API CHAT DEBUG] Chat mode: "${chatMode}"`);
  console.log(
    `[API CHAT DEBUG] Has vectorized space: ${hasVectorizedSpace}, Embeddings count: ${embeddingsCount}`
  );
  console.log(
    `[API CHAT DEBUG] ═══════════════════════════════════════════════════`
  );

  // Check if this might be a GTD query - GTD data comes from MongoDB, not vector DB
  // We should NOT exit early for GTD queries even if workspace has no embeddings
  const isLikelyGTDQuery = mongoDBContextExtractor.isGTDQuery(message);

  // SMART MODE FALLBACK: If user requested "query" mode but workspace has no embeddings
  // and it's not a GTD query, fall back to "chat" mode instead of returning an error.
  // This allows normal conversation to work while preserving RAG behavior when documents exist.
  let effectiveChatMode = chatMode;
  if (
    (!hasVectorizedSpace || embeddingsCount === 0) &&
    chatMode === "query" &&
    !isLikelyGTDQuery
  ) {
    console.log(
      `[API CHAT DEBUG] 🔄 MODE FALLBACK: No embeddings + query mode + not GTD query`
    );
    console.log(
      `[API CHAT DEBUG] Falling back from "query" to "chat" mode for general conversation`
    );
    effectiveChatMode = "chat";
  }

  // If we are here we know that we are in a workspace that is:
  // 1. Chatting in "chat" mode and may or may _not_ have embeddings
  // 2. Chatting in "query" mode and has at least 1 embedding
  // 3. Or we fell back to "chat" mode because no embeddings exist
  let contextTexts = [];
  let sources = [];
  let pinnedDocIdentifiers = [];
  const { rawHistory, chatHistory } = await recentChatHistory({
    user,
    workspace,
    thread,
    messageLimit,
    apiSessionId: sessionId,
  });

  await new DocumentManager({
    workspace,
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

  const processedAttachments = await processDocumentAttachments(attachments);
  const parsedAttachments = processedAttachments.parsedDocuments;
  attachments = processedAttachments.imageAttachments;
  parsedAttachments.forEach((doc) => {
    if (doc.pageContent) {
      contextTexts.push(doc.pageContent);
      const { pageContent, ...metadata } = doc;
      sources.push({
        text:
          pageContent.slice(0, 1_000) + "...continued on in source document...",
        ...metadata,
      });
    }
  });

  // Inject any parsed files for this workspace/thread/user (matching stream.js behavior)
  const parsedFiles = await WorkspaceParsedFiles.getContextFiles(
    workspace,
    thread || null,
    user || null
  );
  parsedFiles.forEach((doc) => {
    const { pageContent, ...metadata } = doc;
    contextTexts.push(doc.pageContent);
    sources.push({
      text:
        pageContent.slice(0, 1_000) + "...continued on in source document...",
      ...metadata,
    });
  });

  // Get MongoDB GTD Context (if applicable)
  let mongoContext = null;
  let mongoSources = [];

  try {
    console.log(
      `[API CHAT DEBUG] Checking for GTD data in query: "${message}"`
    );
    mongoContext = await mongoDBContextExtractor.extractGTDContext(
      message,
      workspace,
      user,
      thread
    );

    console.log(`[API CHAT DEBUG] MongoDB extraction result:`, {
      hasContext: !!mongoContext?.context,
      contextLength: mongoContext?.context?.length || 0,
      type: mongoContext?.type || "none",
      sourcesCount: mongoContext?.sources?.length || 0,
    });

    if (mongoContext && mongoContext.isUnavailable) {
      console.log(
        `[API CHAT DEBUG] MongoDB is unavailable. Returning clean notification to user.`
      );
      return {
        textResponse:
          "The Global Terrorism Database is currently reconnecting or temporarily unavailable. Please wait a moment and try your query again.",
        sources: [],
        type: chatMode,
        close: true,
        error: null,
      };
    }

    if (
      mongoContext &&
      mongoContext.context &&
      mongoContext.context.length > 0
    ) {
      console.log(
        `[API CHAT DEBUG] ═══════════════════════════════════════════════════`
      );
      console.log(`[API CHAT DEBUG] GTD CONTEXT EXTRACTED SUCCESSFULLY!`);
      console.log(
        `[API CHAT DEBUG] Context type: ${mongoContext.type || "unknown"}`
      );
      console.log(
        `[API CHAT DEBUG] Context length: ${mongoContext.context.length} chars`
      );
      console.log(
        `[API CHAT DEBUG] Sources count: ${mongoContext.sources?.length || 0}`
      );
      console.log(
        `[API CHAT DEBUG] ═══════════════════════════════════════════════════`
      );

      // Add GTD context to context texts - MAKE IT THE FIRST CONTEXT
      // This ensures it has priority
      contextTexts.unshift(mongoContext.context);

      // Add GTD sources with proper metadata
      if (mongoContext.sources && mongoContext.sources.length > 0) {
        console.log(
          `[API CHAT DEBUG] Found ${mongoContext.sources.length} GTD sources`
        );
        mongoContext.sources.forEach((source) => {
          mongoSources.push({
            type: "terrorist_attack",
            id: source.id || source.eventid,
            name: source.name || "Terrorist Attack Data",
            country: source.country || "N/A",
            region: source.region || "N/A",
            city: source.city || "N/A",
            group: source.group || "Unknown",
            attackType: source.attackType || "N/A",
            targetType: source.targetType || "N/A",
            casualties: source.casualties || { killed: 0, wounded: 0 },
            date: source.date || "N/A",
            text: `${source.attackType || "Attack"} in ${source.city || source.country || "Unknown"} on ${source.date || "unknown date"} - ${source.casualties?.killed || 0} killed, ${source.casualties?.wounded || 0} wounded`,
            fromMongoDB: true,
            metadata: {
              source: "Global Terrorism Database (GTD)",
              ...source,
            },
          });
        });

        sources = [...sources, ...mongoSources];
      }
    } else {
      console.log(
        `[API CHAT DEBUG] No GTD context extracted - mongoContext:`,
        mongoContext
      );
      if (mongoContext && !mongoContext.context) {
        console.log(
          `[API CHAT DEBUG] WARNING: MongoDB returned result but no context!`
        );
      }
    }
  } catch (error) {
    console.error(
      "⚠️ GTD context extraction failed in API chat:",
      error.message
    );
    console.error("⚠️ Full error:", error);
    // Continue without GTD context - don't break the chat
  }

  const hasGTDIntent = isLikelyGTDQuery || !!mongoContext?.context;

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await VectorDb.performSimilaritySearch({
          namespace: workspace.slug,
          input: message,
          LLMConnector,
          similarityThreshold: workspace?.similarityThreshold,
          topN: workspace?.topN,
          filterIdentifiers: pinnedDocIdentifiers,
          rerank: workspace?.vectorSearchMode === "rerank",
        })
      : {
          contextTexts: [],
          sources: [],
          message: null,
        };

  // Failed similarity search if it was run at all and failed.
  if (!!vectorSearchResults.message) {
    return {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: vectorSearchResults.message,
      metrics: {},
    };
  }

  const { fillSourceWindow } = require("../helpers/chat");
  const filledSources = fillSourceWindow({
    nDocs: workspace?.topN || 4,
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

  // If in query mode and no context chunks are found from search, backfill, or pins -  do not
  // let the LLM try to hallucinate a response or use general knowledge and exit early
  // EXCEPTION: If this is a GTD query, the GTD context should already be in contextTexts
  // If contextTexts is empty for a GTD query, it means extraction failed - still allow LLM to try
  // NOTE: Use effectiveChatMode which may have been changed from "query" to "chat" if no embeddings
  if (contextTexts.length === 0 && !hasGTDIntent) {
    const textResponse =
      workspace?.queryRefusalResponse ??
      "There is no relevant information in this workspace to answer your query.";

    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        attachments: attachments,
        type: chatMode,
        metrics: {},
      },
      threadId: thread?.id || null,
      include: false,
      apiSessionId: sessionId,
      user,
    });

    return {
      id: uuid,
      type: "textResponse",
      sources: [],
      close: true,
      error: null,
      textResponse,
      metrics: {},
    };
  }

  // CRITICAL FIX: When GTD context is present, we need to handle chat history carefully
  // to prevent the LLM from using outdated/wrong answers from previous messages
  let effectiveChatHistory = chatHistory;
  let effectiveRawHistory = rawHistory;
  let effectiveUserPrompt = message;

  if (mongoContext && mongoContext.context && mongoContext.context.length > 0) {
    // Check if this is a GTD data query (stats, sample, or data)
    const isGTDDataQuery =
      mongoContext.type === "gtd_stats" ||
      mongoContext.type === "gtd_sample" ||
      mongoContext.type === "gtd_data";

    if (isGTDDataQuery) {
      console.log(
        `[API CHAT DEBUG] GTD data query detected - applying chat history override`
      );

      // STRATEGY 1: Clear chat history entirely for GTD queries to prevent contamination
      // This ensures the LLM only sees the current context
      effectiveChatHistory = [];
      effectiveRawHistory = [];

      // STRATEGY 2: Modify the user prompt to be explicit about using context data
      if (mongoContext.type === "gtd_stats") {
        // Use the exact count from mongoContext directly (most reliable)
        // Fall back to extracting from context string if not available
        const exactCount =
          mongoContext.count !== undefined
            ? mongoContext.count.toLocaleString()
            : mongoContext.context.match(
                /VERIFIED DATABASE COUNT:\s*([\d,]+)/
              )?.[1] || "the number shown above";

        const exactKilled =
          mongoContext.killed !== undefined
            ? mongoContext.killed.toLocaleString()
            : "N/A";
        const exactWounded =
          mongoContext.wounded !== undefined
            ? mongoContext.wounded.toLocaleString()
            : "N/A";
        const geoPointsCount = mongoContext.preComputedGeoPoints?.length || 0;

        // Derive year range string for the answer
        let yearRangeLabel = "1970-2017";
        if (mongoContext.conditions && mongoContext.conditions._yearRange) {
          yearRangeLabel = `${mongoContext.conditions._yearRange.start}-${mongoContext.conditions._yearRange.end}`;
        } else if (mongoContext.conditions && mongoContext.conditions.iyear) {
          yearRangeLabel = `${mongoContext.conditions.iyear}`;
        }

        effectiveUserPrompt = `${message}

═══════════════════════════════════════════════════════════════════════════════
MANDATORY ANSWER REQUIREMENTS - READ CAREFULLY:
═══════════════════════════════════════════════════════════════════════════════

1. The EXACT database count is: ${exactCount} attacks
2. VERIFIED DEATHS: ${exactKilled} killed
3. VERIFIED INJURIES: ${exactWounded} wounded
4. DATA YEAR RANGE: ${yearRangeLabel}
5. Geo data available: ${geoPointsCount} locations with coordinates

YOUR ANSWER **MUST** INCLUDE ALL FOUR OF THESE STATISTICS:
  • Attack count  → "exactly ${exactCount} attacks"
  • Deaths        → "resulting in ${exactKilled} deaths"
  • Injuries      → "and ${exactWounded} injuries"
  • Data span     → "The data spans from ${yearRangeLabel}."

Example good answer:
"According to the Global Terrorism Database (GTD, ${yearRangeLabel}), there were exactly ${exactCount} attacks, resulting in ${exactKilled} deaths and ${exactWounded} injuries. The data spans from ${yearRangeLabel}."

DO NOT:
- Omit deaths, injuries, or year range from your answer
- Use any other number from your training data
- Say "approximately" or "around" - the counts are EXACT
- Say "no data" or "no attacks" when the count is ${exactCount}
- Use numbers from previous messages

The database query has been executed. The result is ${exactCount} attacks, ${exactKilled} killed, ${exactWounded} wounded (${yearRangeLabel}).
═══════════════════════════════════════════════════════════════════════════════`;
      } else if (mongoContext.type === "gtd_sample") {
        // For sample attacks, reinforce the exact data
        effectiveUserPrompt = `${message}

[INSTRUCTION: Provide details ONLY from the VERIFIED ATTACK data shown in the context above. Use the exact Event ID, Country, City, and all other VERIFIED fields. Do not use any data from your training or previous messages.]`;
      } else {
        effectiveUserPrompt = `${message}

[INSTRUCTION: Use ONLY the VERIFIED data from the Global Terrorism Database context above. Do not use training data or previous chat answers.]`;
      }

      console.log(
        `[API CHAT DEBUG] Cleared chat history and modified user prompt for GTD query`
      );
      console.log(
        `[API CHAT DEBUG] Effective user prompt: ${effectiveUserPrompt.substring(0, 200)}...`
      );
    }
  }

  // Compress & Assemble message to ensure prompt passes token limit with room for response
  // and build system messages based on inputs and history.
  const messages = await LLMConnector.compressMessages(
    {
      systemPrompt: await chatPrompt(workspace, user, {
        includeGtdInstructions: hasGTDIntent,
      }),
      userPrompt: effectiveUserPrompt,
      contextTexts,
      chatHistory: effectiveChatHistory,
      attachments,
    },
    effectiveRawHistory
  );

  // Send the text completion.
  const { textResponse, metrics: performanceMetrics } =
    await LLMConnector.getChatCompletion(messages, {
      temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      user: user,
    });

  if (!textResponse) {
    return {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: "No text completion could be completed with this input.",
      metrics: performanceMetrics,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: Parse LLM's JSON output and execute the mongo_filter
  // This enables GTD data to be returned in API responses (same as stream.js)
  // ═══════════════════════════════════════════════════════════════════════════
  let gtdData = null;
  let llmOutput = null;
  let cleanedTextResponse = textResponse;

  try {
    // extractJsonFromLLMResponse returns { parsed, raw, startIndex, endIndex }
    const extractionResult = extractJsonFromLLMResponse(textResponse);

    if (extractionResult && extractionResult.parsed) {
      const llmParsedJson = extractionResult.parsed;

      // CRITICAL FIX: Strip the JSON from the text response so user doesn't see it
      if (
        extractionResult.startIndex !== -1 &&
        extractionResult.endIndex !== -1
      ) {
        const beforeJson = textResponse.substring(
          0,
          extractionResult.startIndex
        );
        const afterJson = textResponse.substring(extractionResult.endIndex);
        cleanedTextResponse = (beforeJson + afterJson).trim();
        console.log(
          `[API CHAT] Stripped JSON from response. New length: ${cleanedTextResponse.length}`
        );
      }

      if (llmParsedJson.mongo_filter !== undefined) {
        if (!hasGTDIntent) {
          console.log(
            `[API CHAT] Skipping GTD mongo_filter execution (non-GTD intent query)`
          );
        } else {
          console.log(
            `[API CHAT] LLM output contains mongo_filter - executing GTD query`
          );

          // Handle empty filter as worldwide query
          const hasEmptyFilter =
            !llmParsedJson.mongo_filter ||
            llmParsedJson.mongo_filter === "" ||
            (typeof llmParsedJson.mongo_filter === "object" &&
              Object.keys(llmParsedJson.mongo_filter).length === 0);

          if (hasEmptyFilter) {
            llmParsedJson.mongo_filter = {};
            console.log(
              `[API CHAT] WORLDWIDE QUERY DETECTED - Empty filter converted to {}`
            );
          }

          // Validate and correct needs_geo_data if needed
          try {
            const {
              validateAndCorrectNeedsGeoData,
            } = require("../mongoDB/gtdSystemPrompt");
            const correctedJson = validateAndCorrectNeedsGeoData(
              llmParsedJson,
              message
            );
            llmOutput = correctedJson;
          } catch (validationError) {
            llmOutput = llmParsedJson;
          }

          // ═══════════════════════════════════════════════════════════════════════════
          // CRITICAL FIX: Prefer pre-computed geo_points from context extraction
          // This ensures the count reported in LLM's answer MATCHES the geo_points shown
          // ═══════════════════════════════════════════════════════════════════════════

          // Check if we have pre-computed data from context extraction
          if (
            mongoContext &&
            mongoContext.preComputedGeoPoints &&
            mongoContext.preComputedGeoPoints.length > 0
          ) {
            console.log(
              `[API CHAT] ✅ Using PRE-COMPUTED geo_points (${mongoContext.preComputedGeoPoints.length}) from context extraction`
            );
            console.log(
              `[API CHAT] This ensures LLM answer count (${mongoContext.count}) matches displayed geo_points`
            );

            // Calculate year range from conditions (filter) or from geo_points
            let yearRangeStart = null;
            let yearRangeEnd = null;
            if (mongoContext.conditions && mongoContext.conditions._yearRange) {
              yearRangeStart = parseInt(
                mongoContext.conditions._yearRange.start
              );
              yearRangeEnd = parseInt(mongoContext.conditions._yearRange.end);
            } else if (
              mongoContext.simpleFilter &&
              mongoContext.simpleFilter.year_start
            ) {
              yearRangeStart = mongoContext.simpleFilter.year_start;
              yearRangeEnd = mongoContext.simpleFilter.year_end;
            } else if (mongoContext.preComputedGeoPoints.length > 0) {
              // Fallback: Calculate from geo_points
              const years = mongoContext.preComputedGeoPoints
                .map((p) => p.iyear)
                .filter((y) => y && !isNaN(y));
              if (years.length > 0) {
                yearRangeStart = Math.min(...years);
                yearRangeEnd = Math.max(...years);
              }
            }

            gtdData = {
              success: true,
              total_count: mongoContext.count,
              returned_count: mongoContext.preComputedGeoPoints.length,
              records_with_coordinates:
                mongoContext.recordsWithCoordinates ||
                mongoContext.preComputedGeoPoints.length,
              geo_points: mongoContext.preComputedGeoPoints,
              filter: mongoContext.filter,
              simpleFilter: mongoContext.simpleFilter,
              query: message,
              totalKilled: mongoContext.killed || 0,
              totalWounded: mongoContext.wounded || 0,
              source: "pre_computed_unified", // Mark that this came from unified query
              // Include year range for frontend display
              year_range:
                yearRangeStart && yearRangeEnd
                  ? {
                      start: yearRangeStart,
                      end: yearRangeEnd,
                    }
                  : null,
              llm_metadata: {
                confidence: llmParsedJson.confidence,
                query_type: llmParsedJson.query_type || "statistical",
                needs_geo_data: true,
              },
            };

            console.log(`[API CHAT] Total count: ${gtdData.total_count}`);
            console.log(
              `[API CHAT] Geo points: ${gtdData.geo_points?.length || 0}`
            );
            if (yearRangeStart && yearRangeEnd) {
              console.log(
                `[API CHAT] Year range from filter: ${yearRangeStart}-${yearRangeEnd}`
              );
            }
          } else {
            // Fallback: Execute LLM filter if no pre-computed data available
            const shouldExecute = llmParsedJson.execute_on_server !== false;
            console.log(
              `[API CHAT] No pre-computed geo_points, execute_on_server: ${shouldExecute}`
            );

            if (shouldExecute) {
              const executedGtdData = await executeFilterFromLLMResponse(
                llmParsedJson,
                message
              );

              if (executedGtdData) {
                console.log(
                  `[API CHAT] ✅ GTD data retrieved: ${executedGtdData.geo_points?.length || 0} geo_points, total: ${executedGtdData.total_count}`
                );
                gtdData = executedGtdData;
              }
            }
          }
        }
      }
    }
  } catch (parseError) {
    console.error(
      `[API CHAT] Error parsing/executing LLM output:`,
      parseError.message
    );
  }

  // FALLBACK: If LLM didn't output JSON but we have preComputedGeoPoints from context extraction
  // This handles cases like "Mishap in Indonesia?" where synonym detection works but LLM doesn't output filter
  if (
    !gtdData &&
    mongoContext &&
    mongoContext.preComputedGeoPoints &&
    mongoContext.preComputedGeoPoints.length > 0
  ) {
    console.log(
      `[API CHAT] ✅ FALLBACK: Using PRE-COMPUTED geo_points (${mongoContext.preComputedGeoPoints.length}) - LLM didn't output JSON`
    );
    gtdData = {
      success: true,
      total_count:
        mongoContext.count || mongoContext.preComputedGeoPoints.length,
      returned_count: mongoContext.preComputedGeoPoints.length,
      records_with_coordinates:
        mongoContext.recordsWithCoordinates ||
        mongoContext.preComputedGeoPoints.length,
      geo_points: mongoContext.preComputedGeoPoints,
      filter: mongoContext.filter,
      simpleFilter: mongoContext.simpleFilter,
      query: message,
      totalKilled: mongoContext.killed || 0,
      totalWounded: mongoContext.wounded || 0,
      source: "pre_computed_fallback",
    };
  }

  // Last-resort fallback for global GTD API calls:
  // if LLM JSON parsing fails and precomputed points are unavailable, execute a
  // deterministic worldwide filter so external clients still receive heatmap data.
  if (!gtdData && hasGTDIntent && isGlobalScopeQuery(message)) {
    console.log(
      `[API CHAT] Fallback: executing synthetic worldwide filter for global query`
    );
    const syntheticGlobalPayload = {
      mongo_filter: {},
      needs_geo_data: true,
      query_type: "statistical",
      execute_on_server: true,
      limit: parseInt(process.env.GTD_WORLDWIDE_GEO_LIMIT) || 200000,
    };

    const executedSyntheticData = await executeFilterFromLLMResponse(
      syntheticGlobalPayload,
      message
    );

    if (executedSyntheticData) {
      executedSyntheticData.source = "synthetic_global_fallback";
      gtdData = executedSyntheticData;
      if (!llmOutput) llmOutput = syntheticGlobalPayload;
    }
  }

  // CRITICAL: Strip geo_points before saving to SQLite — full data returned to API caller below
  const gtdDataForStorage = stripGeoPointsForStorage(gtdData);
  const { chat } = await WorkspaceChats.new({
    workspaceId: workspace.id,
    prompt: message,
    response: {
      text: cleanedTextResponse,
      sources,
      attachments,
      type: chatMode,
      metrics: performanceMetrics,
      gtdData: gtdDataForStorage,
      llmOutput: llmOutput,
    },
    threadId: thread?.id || null,
    apiSessionId: sessionId,
    user,
  });

  // Return FULL gtdData (with geo_points) to the API caller — not the stripped version
  const response = {
    id: uuid,
    type: "textResponse",
    close: true,
    error: null,
    chatId: chat.id,
    textResponse: cleanedTextResponse,
    sources,
    metrics: performanceMetrics,
  };

  // Include GTD data if available
  if (gtdData) {
    response.gtdData = gtdData;
  }
  if (llmOutput) {
    response.llmOutput = llmOutput;
  }

  return response;
}

/**
 * Handle streamable HTTP chunks for chats with your workspace via the developer API endpoint
 * @param {{
 * response: import("express").Response,
 *  workspace: import("@prisma/client").workspaces,
 *  message:string,
 *  mode: "chat"|"query",
 *  user: import("@prisma/client").users|null,
 *  thread: import("@prisma/client").workspace_threads|null,
 *  sessionId: string|null,
 *  attachments: { name: string; mime: string; contentString: string }[],
 *  reset: boolean,
 * }} parameters
 * @returns {Promise<VoidFunction>}
 */
async function streamChat({
  response,
  workspace,
  message = null,
  mode = "chat",
  user = null,
  thread = null,
  sessionId = null,
  attachments = [],
  reset = false,
}) {
  const uuid = uuidv4();
  const chatMode = mode ?? "chat";

  // If the user wants to reset the chat history we do so pre-flight
  // and continue execution. If no message is provided then the user intended
  // to reset the chat history only and we can exit early with a confirmation.
  if (reset) {
    await WorkspaceChats.markThreadHistoryInvalidV2({
      workspaceId: workspace.id,
      user_id: user?.id,
      thread_id: thread?.id,
      api_session_id: sessionId,
    });
    if (!message?.length) {
      writeResponseChunk(response, {
        id: uuid,
        type: "textResponse",
        textResponse: "Chat history was reset!",
        sources: [],
        attachments: [],
        close: true,
        error: null,
        metrics: {},
      });
      return;
    }
  }

  // Check for and process slash commands
  // Since preset commands are not supported in API calls, we can just process the message here
  const processedMessage = await grepAllSlashCommands(message);
  message = processedMessage;

  if (EphemeralAgentHandler.isAgentInvocation({ message })) {
    await Telemetry.sendTelemetry("agent_chat_started");

    // Initialize the EphemeralAgentHandler to handle non-continuous
    // conversations with agents since this is over REST.
    const agentHandler = new EphemeralAgentHandler({
      uuid,
      workspace,
      prompt: message,
      userId: user?.id || null,
      threadId: thread?.id || null,
      sessionId,
    });

    // Establish event listener that emulates websocket calls
    // in Aibitat so that we can keep the same interface in Aibitat
    // but use HTTP.
    const eventListener = new EphemeralEventListener();
    await agentHandler.init();
    await agentHandler.createAIbitat({ handler: eventListener });
    agentHandler.startAgentCluster();

    // The cluster has started and now we wait for close event since
    // and stream back any results we get from agents as they come in.
    return eventListener
      .streamAgentEvents(response, uuid)
      .then(async ({ thoughts, textResponse }) => {
        await WorkspaceChats.new({
          workspaceId: workspace.id,
          prompt: String(message),
          response: {
            text: textResponse,
            sources: [],
            attachments: attachments,
            type: chatMode,
            thoughts,
          },
          include: true,
          threadId: thread?.id || null,
          apiSessionId: sessionId,
        });
        writeResponseChunk(response, {
          uuid,
          type: "finalizeResponseStream",
          textResponse,
          thoughts,
          close: true,
          error: false,
        });
      });
  }

  const LLMConnector = getLLMProvider({
    provider: workspace?.chatProvider,
    model: workspace?.chatModel,
  });

  const VectorDb = getVectorDbClass();
  const messageLimit = workspace?.openAiHistory || 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);

  // DEBUG: Log API stream chat parameters
  console.log(
    `[API STREAM DEBUG] ═══════════════════════════════════════════════════`
  );
  console.log(`[API STREAM DEBUG] Received query: "${message}"`);
  console.log(
    `[API STREAM DEBUG] Workspace: ${workspace?.name} (ID: ${workspace?.id}, slug: ${workspace?.slug})`
  );
  console.log(`[API STREAM DEBUG] Chat mode: "${chatMode}"`);
  console.log(
    `[API STREAM DEBUG] Has vectorized space: ${hasVectorizedSpace}, Embeddings count: ${embeddingsCount}`
  );
  console.log(
    `[API STREAM DEBUG] ═══════════════════════════════════════════════════`
  );

  // Check if this might be a GTD query - GTD data comes from MongoDB, not vector DB
  const isLikelyGTDQueryStream = mongoDBContextExtractor.isGTDQuery(message);

  // SMART MODE FALLBACK: If user requested "query" mode but workspace has no embeddings
  // and it's not a GTD query, fall back to "chat" mode instead of returning an error.
  // This allows normal conversation to work while preserving RAG behavior when documents exist.
  let effectiveChatModeStream = chatMode;
  if (
    (!hasVectorizedSpace || embeddingsCount === 0) &&
    chatMode === "query" &&
    !isLikelyGTDQueryStream
  ) {
    console.log(
      `[API STREAM DEBUG] 🔄 MODE FALLBACK: No embeddings + query mode + not GTD query`
    );
    console.log(
      `[API STREAM DEBUG] Falling back from "query" to "chat" mode for general conversation`
    );
    effectiveChatModeStream = "chat";
  }

  // If we are here we know that we are in a workspace that is:
  // 1. Chatting in "chat" mode and may or may _not_ have embeddings
  // 2. Chatting in "query" mode and has at least 1 embedding
  let completeText;
  let metrics = {};
  let contextTexts = [];
  let sources = [];
  let pinnedDocIdentifiers = [];
  const { rawHistory, chatHistory } = await recentChatHistory({
    user,
    workspace,
    thread,
    messageLimit,
    apiSessionId: sessionId,
  });

  // Look for pinned documents and see if the user decided to use this feature. We will also do a vector search
  // as pinning is a supplemental tool but it should be used with caution since it can easily blow up a context window.
  // However we limit the maximum of appended context to 80% of its overall size, mostly because if it expands beyond this
  // it will undergo prompt compression anyway to make it work. If there is so much pinned that the context here is bigger than
  // what the model can support - it would get compressed anyway and that really is not the point of pinning. It is really best
  // suited for high-context models.
  await new DocumentManager({
    workspace,
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

  const processedAttachments = await processDocumentAttachments(attachments);
  const parsedAttachments = processedAttachments.parsedDocuments;
  attachments = processedAttachments.imageAttachments;
  parsedAttachments.forEach((doc) => {
    if (doc.pageContent) {
      contextTexts.push(doc.pageContent);
      const { pageContent, ...metadata } = doc;
      sources.push({
        text:
          pageContent.slice(0, 1_000) + "...continued on in source document...",
        ...metadata,
      });
    }
  });

  // Inject any parsed files for this workspace/thread/user (matching stream.js behavior)
  const parsedFilesStream = await WorkspaceParsedFiles.getContextFiles(
    workspace,
    thread || null,
    user || null
  );
  parsedFilesStream.forEach((doc) => {
    const { pageContent, ...metadata } = doc;
    contextTexts.push(doc.pageContent);
    sources.push({
      text:
        pageContent.slice(0, 1_000) + "...continued on in source document...",
      ...metadata,
    });
  });

  // Get MongoDB GTD Context (if applicable)
  let mongoContext = null;
  let mongoSources = [];

  try {
    console.log(
      `[API STREAM DEBUG] Checking for GTD data in query: "${message}"`
    );
    mongoContext = await mongoDBContextExtractor.extractGTDContext(
      message,
      workspace,
      user,
      thread
    );

    if (mongoContext && mongoContext.context) {
      console.log(
        `[API STREAM DEBUG] ═══════════════════════════════════════════════════`
      );
      console.log(`[API STREAM DEBUG] GTD CONTEXT EXTRACTED SUCCESSFULLY!`);
      console.log(
        `[API STREAM DEBUG] Context type: ${mongoContext.type || "unknown"}`
      );
      console.log(
        `[API STREAM DEBUG] Context length: ${mongoContext.context.length} chars`
      );
      console.log(
        `[API STREAM DEBUG] Sources count: ${mongoContext.sources?.length || 0}`
      );
      console.log(
        `[API STREAM DEBUG] ═══════════════════════════════════════════════════`
      );

      // Add GTD context to context texts - MAKE IT THE FIRST CONTEXT
      // This ensures it has priority
      contextTexts.unshift(mongoContext.context);

      // Add GTD sources with proper metadata
      if (mongoContext.sources && mongoContext.sources.length > 0) {
        console.log(
          `[API STREAM DEBUG] Found ${mongoContext.sources.length} GTD sources`
        );
        mongoContext.sources.forEach((source) => {
          mongoSources.push({
            type: "terrorist_attack",
            id: source.id || source.eventid,
            name: source.name || "Terrorist Attack Data",
            country: source.country || "N/A",
            region: source.region || "N/A",
            city: source.city || "N/A",
            group: source.group || "Unknown",
            attackType: source.attackType || "N/A",
            targetType: source.targetType || "N/A",
            casualties: source.casualties || { killed: 0, wounded: 0 },
            date: source.date || "N/A",
            text: `${source.attackType || "Attack"} in ${source.city || source.country || "Unknown"} on ${source.date || "unknown date"} - ${source.casualties?.killed || 0} killed, ${source.casualties?.wounded || 0} wounded`,
            fromMongoDB: true,
            metadata: {
              source: "Global Terrorism Database (GTD)",
              ...source,
            },
          });
        });

        sources = [...sources, ...mongoSources];
      }
    } else {
      console.log(`[API STREAM DEBUG] No GTD context extracted for query`);
    }
  } catch (error) {
    console.error(
      "⚠️ GTD context extraction failed in API stream chat:",
      error.message
    );
    // Continue without GTD context - don't break the chat
  }

  const hasGTDIntentStream = isLikelyGTDQueryStream || !!mongoContext?.context;

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await VectorDb.performSimilaritySearch({
          namespace: workspace.slug,
          input: message,
          LLMConnector,
          similarityThreshold: workspace?.similarityThreshold,
          topN: workspace?.topN,
          filterIdentifiers: pinnedDocIdentifiers,
          rerank: workspace?.vectorSearchMode === "rerank",
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
      error: vectorSearchResults.message,
      metrics: {},
    });
    return;
  }

  const { fillSourceWindow } = require("../helpers/chat");
  const filledSources = fillSourceWindow({
    nDocs: workspace?.topN || 4,
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

  // If in query mode and no context chunks are found from search, backfill, or pins -  do not
  // let the LLM try to hallucinate a response or use general knowledge and exit early
  // EXCEPTION: If this is a GTD query, the GTD context should already be in contextTexts
  // NOTE: Use effectiveChatModeStream which may have been changed from "query" to "chat" if no embeddings
  if (contextTexts.length === 0 && !hasGTDIntentStream) {
    const textResponse =
      workspace?.queryRefusalResponse ??
      "There is no relevant information in this workspace to answer your query.";
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      close: true,
      error: null,
      metrics: {},
    });

    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        attachments: attachments,
        type: chatMode,
        metrics: {},
      },
      threadId: thread?.id || null,
      apiSessionId: sessionId,
      include: false,
      user,
    });
    return;
  }

  // CRITICAL FIX: When GTD context is present, we need to handle chat history carefully
  // to prevent the LLM from using outdated/wrong answers from previous messages
  let effectiveChatHistory = chatHistory;
  let effectiveRawHistory = rawHistory;
  let effectiveUserPrompt = message;

  if (mongoContext && mongoContext.context && mongoContext.context.length > 0) {
    // Check if this is a GTD data query (stats, sample, or data)
    const isGTDDataQuery =
      mongoContext.type === "gtd_stats" ||
      mongoContext.type === "gtd_sample" ||
      mongoContext.type === "gtd_data";

    if (isGTDDataQuery) {
      console.log(
        `[API STREAM DEBUG] GTD data query detected - applying chat history override`
      );

      // STRATEGY 1: Clear chat history entirely for GTD queries to prevent contamination
      // This ensures the LLM only sees the current context
      effectiveChatHistory = [];
      effectiveRawHistory = [];

      // STRATEGY 2: Modify the user prompt to be explicit about using context data
      if (mongoContext.type === "gtd_stats") {
        // Extract the exact count from context for reinforcement
        const countMatch = mongoContext.context.match(
          /VERIFIED DATABASE COUNT:\s*([\d,]+)/
        );
        const exactCount = countMatch
          ? countMatch[1]
          : "the number shown above";

        effectiveUserPrompt = `${message}

[INSTRUCTION: Answer this question using ONLY the VERIFIED DATABASE data provided in the context. The exact count is ${exactCount}. Do not use any other numbers from your training data or previous messages. State the exact number: ${exactCount}]`;
      } else if (mongoContext.type === "gtd_sample") {
        // For sample attacks, reinforce the exact data
        effectiveUserPrompt = `${message}

[INSTRUCTION: Provide details ONLY from the VERIFIED ATTACK data shown in the context above. Use the exact Event ID, Country, City, and all other VERIFIED fields. Do not use any data from your training or previous messages.]`;
      } else {
        effectiveUserPrompt = `${message}

[INSTRUCTION: Use ONLY the VERIFIED data from the Global Terrorism Database context above. Do not use training data or previous chat answers.]`;
      }

      console.log(
        `[API STREAM DEBUG] Cleared chat history and modified user prompt for GTD query`
      );
      console.log(
        `[API STREAM DEBUG] Effective user prompt: ${effectiveUserPrompt.substring(0, 200)}...`
      );
    }
  }

  // Compress & Assemble message to ensure prompt passes token limit with room for response
  // and build system messages based on inputs and history.
  const messages = await LLMConnector.compressMessages(
    {
      systemPrompt: await chatPrompt(workspace, user, {
        includeGtdInstructions: hasGTDIntentStream,
      }),
      userPrompt: effectiveUserPrompt,
      contextTexts,
      chatHistory: effectiveChatHistory,
      attachments,
    },
    effectiveRawHistory
  );

  // If streaming is not explicitly enabled for connector
  // we do regular waiting of a response and send a single chunk.
  if (LLMConnector.streamingEnabled() !== true) {
    console.log(
      `\x1b[31m[STREAMING DISABLED]\x1b[0m Streaming is not available for ${LLMConnector.constructor.name}. Will use regular chat method.`
    );
    const { textResponse, metrics: performanceMetrics } =
      await LLMConnector.getChatCompletion(messages, {
        temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
        user: user,
      });
    completeText = textResponse;
    metrics = performanceMetrics;
    writeResponseChunk(response, {
      uuid,
      sources,
      type: "textResponseChunk",
      textResponse: completeText,
      close: true,
      error: false,
      metrics,
    });
  } else {
    const stream = await LLMConnector.streamGetChatCompletion(messages, {
      temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      user: user,
    });
    completeText = await LLMConnector.handleStream(response, stream, { uuid });
    metrics = stream.metrics;
  }

  if (completeText?.length > 0) {
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Parse LLM's JSON output and execute the mongo_filter
    // This enables GTD data to be returned in API stream responses
    // ═══════════════════════════════════════════════════════════════════════════
    let gtdData = null;
    let llmOutput = null;
    let cleanedCompleteText = completeText;

    try {
      // extractJsonFromLLMResponse returns { parsed, raw, startIndex, endIndex }
      const extractionResult = extractJsonFromLLMResponse(completeText);

      if (extractionResult && extractionResult.parsed) {
        const llmParsedJson = extractionResult.parsed;

        // CRITICAL FIX: Strip the JSON from the text response so user doesn't see it
        if (
          extractionResult.startIndex !== -1 &&
          extractionResult.endIndex !== -1
        ) {
          const beforeJson = completeText.substring(
            0,
            extractionResult.startIndex
          );
          const afterJson = completeText.substring(extractionResult.endIndex);
          cleanedCompleteText = (beforeJson + afterJson).trim();
          console.log(
            `[API STREAM] Stripped JSON from response. New length: ${cleanedCompleteText.length}`
          );
        }

        if (llmParsedJson.mongo_filter !== undefined) {
          if (!hasGTDIntentStream) {
            console.log(
              `[API STREAM] Skipping GTD mongo_filter execution (non-GTD intent query)`
            );
          } else {
            console.log(
              `[API STREAM] LLM output contains mongo_filter - executing GTD query`
            );

            // Handle empty filter as worldwide query
            const hasEmptyFilter =
              !llmParsedJson.mongo_filter ||
              llmParsedJson.mongo_filter === "" ||
              (typeof llmParsedJson.mongo_filter === "object" &&
                Object.keys(llmParsedJson.mongo_filter).length === 0);

            if (hasEmptyFilter) {
              llmParsedJson.mongo_filter = {};
              console.log(
                `[API STREAM] WORLDWIDE QUERY DETECTED - Empty filter converted to {}`
              );
            }

            // Validate and correct needs_geo_data if needed
            try {
              const {
                validateAndCorrectNeedsGeoData,
              } = require("../mongoDB/gtdSystemPrompt");
              const correctedJson = validateAndCorrectNeedsGeoData(
                llmParsedJson,
                message
              );
              llmOutput = correctedJson;
            } catch (validationError) {
              llmOutput = llmParsedJson;
            }

            // CRITICAL FIX: Prefer pre-computed geo_points from context extraction
            // This ensures the count reported in LLM's answer MATCHES the geo_points shown
            // ═══════════════════════════════════════════════════════════════════════════

            // Check if we have pre-computed data from context extraction
            if (
              mongoContext &&
              mongoContext.preComputedGeoPoints &&
              mongoContext.preComputedGeoPoints.length > 0
            ) {
              console.log(
                `[API STREAM] ✅ Using PRE-COMPUTED geo_points (${mongoContext.preComputedGeoPoints.length}) from context extraction`
              );
              console.log(
                `[API STREAM] This ensures LLM answer count (${mongoContext.count}) matches displayed geo_points`
              );

              // Calculate year range from conditions (filter) or from geo_points
              let yearRangeStart = null;
              let yearRangeEnd = null;
              if (
                mongoContext.conditions &&
                mongoContext.conditions._yearRange
              ) {
                yearRangeStart = parseInt(
                  mongoContext.conditions._yearRange.start
                );
                yearRangeEnd = parseInt(mongoContext.conditions._yearRange.end);
              } else if (
                mongoContext.simpleFilter &&
                mongoContext.simpleFilter.year_start
              ) {
                yearRangeStart = mongoContext.simpleFilter.year_start;
                yearRangeEnd = mongoContext.simpleFilter.year_end;
              } else if (mongoContext.preComputedGeoPoints.length > 0) {
                // Fallback: Calculate from geo_points
                const years = mongoContext.preComputedGeoPoints
                  .map((p) => p.iyear)
                  .filter((y) => y && !isNaN(y));
                if (years.length > 0) {
                  yearRangeStart = Math.min(...years);
                  yearRangeEnd = Math.max(...years);
                }
              }

              gtdData = {
                success: true,
                total_count: mongoContext.count,
                returned_count: mongoContext.preComputedGeoPoints.length,
                records_with_coordinates:
                  mongoContext.recordsWithCoordinates ||
                  mongoContext.preComputedGeoPoints.length,
                geo_points: mongoContext.preComputedGeoPoints,
                filter: mongoContext.filter,
                simpleFilter: mongoContext.simpleFilter,
                query: message,
                totalKilled: mongoContext.killed || 0,
                totalWounded: mongoContext.wounded || 0,
                source: "pre_computed_unified", // Mark that this came from unified query
                // Include year range for frontend display
                year_range:
                  yearRangeStart && yearRangeEnd
                    ? {
                        start: yearRangeStart,
                        end: yearRangeEnd,
                      }
                    : null,
                llm_metadata: {
                  confidence: llmParsedJson.confidence,
                  query_type: llmParsedJson.query_type || "statistical",
                  needs_geo_data: true,
                },
              };

              console.log(`[API STREAM] Total count: ${gtdData.total_count}`);
              console.log(
                `[API STREAM] Geo points: ${gtdData.geo_points?.length || 0}`
              );
              if (yearRangeStart && yearRangeEnd) {
                console.log(
                  `[API STREAM] Year range from filter: ${yearRangeStart}-${yearRangeEnd}`
                );
              }
            } else {
              // Fallback: Execute LLM filter if no pre-computed data available
              const shouldExecute = llmParsedJson.execute_on_server !== false;
              if (shouldExecute) {
                const executedGtdData = await executeFilterFromLLMResponse(
                  llmParsedJson,
                  message
                );

                if (executedGtdData) {
                  console.log(
                    `[API STREAM] ✅ GTD data retrieved: ${executedGtdData.geo_points?.length || 0} geo_points, total: ${executedGtdData.total_count}`
                  );
                  gtdData = executedGtdData;
                }
              }
            }
          }
        }
      }
    } catch (parseError) {
      console.error(
        `[API STREAM] Error parsing/executing LLM output:`,
        parseError.message
      );
    }

    // FALLBACK: If LLM didn't output JSON but we have preComputedGeoPoints from context extraction
    // This handles cases like "Mishap in Indonesia?" where synonym detection works but LLM doesn't output filter
    if (
      !gtdData &&
      mongoContext &&
      mongoContext.preComputedGeoPoints &&
      mongoContext.preComputedGeoPoints.length > 0
    ) {
      console.log(
        `[API STREAM] ✅ FALLBACK: Using PRE-COMPUTED geo_points (${mongoContext.preComputedGeoPoints.length}) - LLM didn't output JSON`
      );
      gtdData = {
        success: true,
        total_count:
          mongoContext.count || mongoContext.preComputedGeoPoints.length,
        returned_count: mongoContext.preComputedGeoPoints.length,
        records_with_coordinates:
          mongoContext.recordsWithCoordinates ||
          mongoContext.preComputedGeoPoints.length,
        geo_points: mongoContext.preComputedGeoPoints,
        filter: mongoContext.filter,
        simpleFilter: mongoContext.simpleFilter,
        query: message,
        totalKilled: mongoContext.killed || 0,
        totalWounded: mongoContext.wounded || 0,
        source: "pre_computed_fallback",
      };
    }

    // Last-resort fallback for global GTD API stream calls:
    // ensures final SSE chunk includes gtdData for worldwide heatmaps.
    if (!gtdData && hasGTDIntentStream && isGlobalScopeQuery(message)) {
      console.log(
        `[API STREAM] Fallback: executing synthetic worldwide filter for global query`
      );
      const syntheticGlobalPayload = {
        mongo_filter: {},
        needs_geo_data: true,
        query_type: "statistical",
        execute_on_server: true,
        limit: parseInt(process.env.GTD_WORLDWIDE_GEO_LIMIT) || 200000,
      };

      const executedSyntheticData = await executeFilterFromLLMResponse(
        syntheticGlobalPayload,
        message
      );

      if (executedSyntheticData) {
        executedSyntheticData.source = "synthetic_global_fallback";
        gtdData = executedSyntheticData;
        if (!llmOutput) llmOutput = syntheticGlobalPayload;
      }
    }

    // CRITICAL: Strip geo_points before saving to SQLite — full data sent to frontend via responseChunk below
    const gtdDataForStorage = stripGeoPointsForStorage(gtdData);
    const { chat } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: cleanedCompleteText,
        sources,
        type: chatMode,
        metrics,
        attachments,
        gtdData: gtdDataForStorage,
        llmOutput: llmOutput,
      },
      threadId: thread?.id || null,
      apiSessionId: sessionId,
      user,
    });

    // Build response chunk with FULL GTD data (including geo_points) for the frontend
    const responseChunk = {
      uuid,
      type: "finalizeResponseStream",
      close: true,
      error: false,
      chatId: chat.id,
      metrics,
      sources,
    };

    // Include GTD data if available
    if (gtdData) {
      responseChunk.gtdData = gtdData;
    }
    if (llmOutput) {
      responseChunk.llmOutput = llmOutput;
    }

    writeResponseChunk(response, responseChunk);
    return;
  }

  writeResponseChunk(response, {
    uuid,
    type: "finalizeResponseStream",
    close: true,
    error: false,
  });
  return;
}

module.exports.ApiChatHandler = {
  chatSync,
  streamChat,
};
