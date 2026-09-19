const { v4: uuidv4 } = require("uuid");
const { DocumentManager } = require("../DocumentManager");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");
const { getVectorDbClass, getLLMProvider } = require("../helpers");
const { writeResponseChunk } = require("../helpers/chat/responses");
const { grepAgents } = require("./agents");
const {
  grepCommand,
  VALID_COMMANDS,
  chatPrompt,
  recentChatHistory,
  sourceIdentifier,
} = require("./index");

// Replace MongoDB Context Extractor import with GTD Context Extractor
const mongoDBContextExtractor = require("../mongoDB/contextExtractor");
const gtdResponseFormatter = require("../mongoDB/gtdResponseFormatter");
const attackService = require("../mongoDB/services/attackService");
const { extractJsonFromLLMResponse } = require("./jsonUtils");
const { stripGeoPointsForStorage } = require("./gtdStorageHelper");
const { ResponseProxy } = require("./ResponseProxy");

const VALID_CHAT_MODE = ["chat", "query"];

/**
 * Execute a MongoDB filter from LLM output and generate formatted GTD data
 *
 * @param {Object} llmJson - Parsed JSON from LLM response
 * @param {string} originalQuery - The original user query
 * @returns {Object|null} - Formatted GTD data or null
 */
async function executeFilterFromLLMResponse(llmJson, originalQuery) {
  // Handle empty filter (worldwide queries) - treat as all records
  const hasFilter = llmJson && llmJson.mongo_filter !== undefined;
  const isEmptyFilter =
    !llmJson?.mongo_filter ||
    llmJson.mongo_filter === "" ||
    (typeof llmJson.mongo_filter === "object" &&
      Object.keys(llmJson.mongo_filter).length === 0);

  if (!hasFilter && !isEmptyFilter) {
    console.log(`[Filter Executor] No mongo_filter in LLM response`);
    return null;
  }

  // Convert empty string to empty object for worldwide queries
  if (isEmptyFilter && llmJson) {
    llmJson.mongo_filter = {};
    console.log(
      `[Filter Executor] Empty filter detected - treating as worldwide query`
    );
  }

  try {
    // Check MongoDB connection first
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState !== 1) {
      console.error(
        `[Filter Executor] MongoDB not connected (readyState: ${mongoose.connection.readyState})`
      );
      return null;
    }

    let filter = llmJson.mongo_filter;
    const limit = llmJson.limit || 5000;
    const needsGeoData = llmJson.needs_geo_data !== false; // Default to true
    const serverInstructions = llmJson.server_instructions || {};

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
    // LLMs sometimes return {"country_txt":"worldwide"} instead of {}
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
          `[Filter Executor] Detected worldwide indicator in filter: ${filter.country_txt}`
        );
        console.log(
          `[Filter Executor] Converting to empty filter for worldwide query`
        );
        filter = {};
        isWorldwideQuery = true;
      }
      // Check if filter contains ONLY invalid/meta fields (LLM put answer in filter)
      else if (!hasOnlyValidFields(filter)) {
        console.log(
          `[Filter Executor] ⚠️ Filter contains invalid GTD fields: ${JSON.stringify(filter)}`
        );
        console.log(
          `[Filter Executor] Valid fields are: country_txt, provstate, city, gname, iyear, etc.`
        );

        // If query mentions worldwide, treat as worldwide query
        if (queryMentionsWorldwide) {
          console.log(
            `[Filter Executor] Query mentions worldwide - treating as worldwide query`
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
              `[Filter Executor] Salvaged valid fields: ${JSON.stringify(validFilter)}`
            );
            filter = validFilter;
          } else {
            console.log(
              `[Filter Executor] No valid fields found - treating as worldwide query`
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
          `[Filter Executor] All filter values are worldwide indicators - converting to empty filter`
        );
        filter = {};
        isWorldwideQuery = true;
      }
    }

    // Check if this is a count-only query (no geo_points needed)
    const isCountOnlyQuery =
      serverInstructions.return_mode === "count_only" ||
      serverInstructions.action === "return_aggregates";

    // For worldwide queries, we ALWAYS want to show geo_points (sample) for global visualization
    // For filtered count-only queries (e.g., "how many by Taliban?"), respect needs_geo_data
    const shouldFetchGeoData = isWorldwideQuery || needsGeoData;

    // For worldwide queries, we return stats but limit geo_points to prevent massive data transfer
    // For count-only queries, we still need some data to calculate totals
    // Configurable via GTD_WORLDWIDE_GEO_LIMIT env var (default: 200000)
    const worldwideGeoLimit =
      parseInt(process.env.GTD_WORLDWIDE_GEO_LIMIT) || 200000;

    console.log(
      `[Filter Executor] ═══════════════════════════════════════════════════`
    );
    console.log(
      `[Filter Executor] Executing LLM-generated filter:`,
      JSON.stringify(filter)
    );
    console.log(
      `[Filter Executor] needs_geo_data: ${needsGeoData}, limit: ${limit}`
    );
    console.log(
      `[Filter Executor] isCountOnlyQuery: ${isCountOnlyQuery}, isWorldwideQuery: ${isWorldwideQuery}`
    );
    console.log(`[Filter Executor] shouldFetchGeoData: ${shouldFetchGeoData}`);
    if (isWorldwideQuery) {
      console.log(
        `[Filter Executor] WORLDWIDE QUERY - Will fetch ${worldwideGeoLimit} sample records for geo visualization`
      );
    }

    // Log server_instructions if present
    if (serverInstructions.action) {
      console.log(
        `[Filter Executor] server_instructions: action=${serverInstructions.action}, mode=${serverInstructions.return_mode}, max=${serverInstructions.max_records}`
      );
    }

    // Normalize the filter for GTD's string-typed numeric fields
    let normalizedFilter = mongoDBContextExtractor.normalizeGTDFilter(filter);

    // CRITICAL: Apply Centralized Schema Normalization (Attack Types, Target Types, etc.)
    // This fixes "Bombing" -> "Bombing/Explosion" and "Religious" -> "Religious Figures"
    const GTDNormalizer = require("../mongoDB/GTDNormalizationService");
    normalizedFilter = GTDNormalizer.normalizeFilter(normalizedFilter);

    console.log(
      `[Filter Executor] Normalized filter (Final):`,
      JSON.stringify(normalizedFilter)
    );

    // Determine the effective limit from server_instructions or llmJson
    // Note: max_records=0 means "count only" - we still need to query to get totalCount
    // For worldwide queries, we ALWAYS fetch some records for geo visualization
    // For filtered count-only queries, we can use aggregation only
    let effectiveLimit;
    let useCountOnly = false;

    if (isWorldwideQuery) {
      // Worldwide queries: fetch sample records for geo_points
      effectiveLimit = worldwideGeoLimit;
      useCountOnly = false;
      console.log(
        `[Filter Executor] WORLDWIDE: Fetching ${worldwideGeoLimit} sample records for global geo visualization`
      );
    } else if (isCountOnlyQuery && !needsGeoData) {
      // Filtered count-only queries with no geo data needed: just get count
      effectiveLimit = 0;
      useCountOnly = true;
      console.log(
        `[Filter Executor] COUNT-ONLY mode - using aggregation for count`
      );
    } else if (
      serverInstructions.max_records &&
      serverInstructions.max_records > 0
    ) {
      effectiveLimit = serverInstructions.max_records;
    } else {
      effectiveLimit = limit;
    }

    // Determine if we should use random sampling
    // Use random sampling for:
    // 1. Worldwide queries (need global distribution)
    // 2. Large date range queries (spanning more than 5 years)
    // 3. Any query where expected results >> limit
    const hasYearRange =
      normalizedFilter.$expr &&
      JSON.stringify(normalizedFilter.$expr).includes("$toInt");
    const isLargeDateRange = hasYearRange; // Year range queries benefit from random sampling
    const useRandomSample =
      isWorldwideQuery || isLargeDateRange || needsGeoData;

    if (useRandomSample && !useCountOnly) {
      console.log(
        `[Filter Executor] Using random sampling for representative distribution`
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
      console.error(`[Filter Executor] Query execution failed:`, result.error);
      return null;
    }

    console.log(
      `[Filter Executor] Query returned ${result.results.length} of ${result.totalCount} total attacks`
    );
    if (isCountOnlyQuery) {
      console.log(
        `[Filter Executor] COUNT-ONLY mode - no records fetched, only count`
      );
    }

    // Apply return_fields filtering if specified
    let filteredResults = result.results;
    if (
      !isCountOnlyQuery &&
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
      console.log(
        `[Filter Executor] Filtered to ${fields.length} fields per record`
      );
    }

    // Calculate totals from original results (before field filtering)
    // For count-only queries, we don't have individual records to calculate these
    let totalKilled = 0;
    let totalWounded = 0;
    if (!isCountOnlyQuery && result.results.length > 0) {
      totalKilled = result.results.reduce(
        (sum, a) => sum + (parseInt(a.nkill) || 0),
        0
      );
      totalWounded = result.results.reduce(
        (sum, a) => sum + (parseInt(a.nwound) || 0),
        0
      );
    }

    // Extract country from filter for answer generation
    let detectedCountry = null;
    if (normalizedFilter.country_txt) {
      if (typeof normalizedFilter.country_txt === "string") {
        detectedCountry = normalizedFilter.country_txt;
      } else if (normalizedFilter.country_txt.$regex) {
        const match = normalizedFilter.country_txt.$regex.match(
          /\^\\s\*([^\\]+)\\s\*\$/
        );
        detectedCountry = match ? match[1] : null;
      }
    }

    // Extract province from filter for answer generation
    let detectedProvince = null;
    if (normalizedFilter.provstate) {
      if (typeof normalizedFilter.provstate === "string") {
        detectedProvince = normalizedFilter.provstate;
      } else if (normalizedFilter.provstate.$regex) {
        const match = normalizedFilter.provstate.$regex.match(
          /\^\\s\*([^\\]+)\\s\*\$/
        );
        detectedProvince = match ? match[1] : null;
      }
    }

    // Generate human-readable answer
    let locationText = "";
    if (detectedProvince && detectedCountry) {
      locationText = ` in ${detectedProvince}, ${detectedCountry}`;
    } else if (detectedCountry) {
      locationText = ` in ${detectedCountry}`;
    } else if (detectedProvince) {
      locationText = ` in ${detectedProvince}`;
    } else if (isWorldwideQuery) {
      locationText = " worldwide";
    }

    const humanReadableAnswer =
      llmJson.answer ||
      `From the Global Terrorism Database (1970-2017), there were ${result.totalCount.toLocaleString()} recorded attacks${locationText}, resulting in ${totalKilled.toLocaleString()} fatalities and ${totalWounded.toLocaleString()} wounded.`;

    // For worldwide queries, limit the results sent to formatter to avoid massive geo_points
    // For filtered count-only queries (no geo needed), skip geo_points
    let resultsForFormatting = filteredResults;
    let skipGeoPoints = useCountOnly; // Only skip if we used count-only mode (no records fetched)

    if (skipGeoPoints) {
      // For count-only queries (filtered, no geo), don't generate geo_points
      resultsForFormatting = [];
      console.log(
        `[Filter Executor] COUNT-ONLY: Skipping geo_points generation`
      );
    } else if (isWorldwideQuery) {
      // Worldwide: use all fetched records (already limited to worldwideGeoLimit)
      resultsForFormatting = filteredResults;
      console.log(
        `[Filter Executor] WORLDWIDE: Using ${filteredResults.length} records for geo_points`
      );
    } else if (filteredResults.length > limit) {
      // Regular filtered query: limit to requested amount
      resultsForFormatting = filteredResults.slice(0, limit);
      console.log(
        `[Filter Executor] Limited geo_points from ${filteredResults.length} to ${limit}`
      );
    }

    // Format the response - use filtered results if applicable
    const formattedResponse = gtdResponseFormatter.formatResponse(
      { ...result, results: resultsForFormatting },
      humanReadableAnswer,
      {
        country: detectedCountry,
        province: detectedProvince,
        query: originalQuery,
        includeGeoJSON: !skipGeoPoints, // Include GeoJSON if we have geo_points
        includeClusters: !skipGeoPoints, // Include clusters if we have geo_points
        maxReturned: isWorldwideQuery
          ? worldwideGeoLimit
          : Math.min(limit, 200000),
        isWorldwideQuery: isWorldwideQuery,
        isCountOnlyQuery: useCountOnly,
      }
    );

    // For worldwide queries, ensure we have the correct total count and metadata
    if (isWorldwideQuery) {
      formattedResponse.total_count = result.totalCount;
      formattedResponse.is_worldwide = true;
      formattedResponse.geo_points_limited = true;
      formattedResponse.geo_points_max = worldwideGeoLimit;
      formattedResponse.geo_points_sample = true; // Indicate this is a sample, not all points
    }

    // For count-only queries, mark as such
    if (useCountOnly) {
      formattedResponse.geo_points = [];
      formattedResponse.is_count_only = true;
    }

    // Add metadata
    formattedResponse.filter = normalizedFilter;
    formattedResponse.originalFilter = filter;
    formattedResponse.query = originalQuery;
    formattedResponse.llm_metadata = {
      confidence: llmJson.confidence,
      query_type: llmJson.query_type,
      needs_geo_data: llmJson.needs_geo_data,
      limit: llmJson.limit,
    };

    console.log(
      `[Filter Executor] Generated formatted response with ${formattedResponse.geo_points?.length || 0} geo_points`
    );
    console.log(
      `[Filter Executor] ═══════════════════════════════════════════════════`
    );

    return formattedResponse;
  } catch (error) {
    console.error(`[Filter Executor] Error executing filter:`, error.message);
    return null;
  }
}

async function streamChatWithWorkspace(
  response,
  workspace,
  message,
  chatMode = "chat",
  user = null,
  thread = null,
  attachments = []
) {
  console.log(`[STREAM DEBUG] Received query: "${message}"`);
  console.log(`[STREAM DEBUG] Workspace ID: ${workspace?.id}`);

  const uuid = uuidv4();
  const updatedMessage = await grepCommand(message, user);
  const isLikelyGTDQuery = mongoDBContextExtractor.isGTDQuery(updatedMessage);

  // DEBUG: Log what message is being processed
  console.log(`[STREAM DEBUG] Processed message: "${updatedMessage}"`);

  if (Object.keys(VALID_COMMANDS).includes(updatedMessage)) {
    const data = await VALID_COMMANDS[updatedMessage](
      workspace,
      message,
      uuid,
      user,
      thread
    );
    writeResponseChunk(response, data);
    return;
  }

  // If is agent enabled chat we will exit this flow early.
  const isAgentChat = await grepAgents({
    uuid,
    response,
    message: updatedMessage,
    user,
    workspace,
    thread,
  });
  if (isAgentChat) return;

  const LLMConnector = getLLMProvider({
    provider: workspace?.chatProvider,
    model: workspace?.chatModel,
  });
  const VectorDb = getVectorDbClass();

  const messageLimit = workspace?.openAiHistory || 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);

  // User is trying to query-mode chat a workspace that has no data in it - so
  // we should exit early as no information can be found under these conditions.
  if (
    (!hasVectorizedSpace || embeddingsCount === 0) &&
    chatMode === "query" &&
    !isLikelyGTDQuery
  ) {
    const textResponse =
      workspace?.queryRefusalResponse ??
      "There is no relevant information in this workspace to answer your query.";
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse,
      sources: [],
      attachments,
      close: true,
      error: null,
    });
    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments,
      },
      threadId: thread?.id || null,
      include: false,
      user,
    });
    return;
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

  // Inject any parsed files for this workspace/thread/user
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
  let gtdFormattedData = null; // Store the structured GTD response for frontend

  try {
    console.log(
      `[STREAM DEBUG] Checking for GTD data in query: "${updatedMessage}"`
    );
    mongoContext = await mongoDBContextExtractor.extractGTDContext(
      updatedMessage,
      workspace,
      user,
      thread
    );

    if (mongoContext && mongoContext.context) {
      console.log(
        `[STREAM DEBUG] ═══════════════════════════════════════════════════`
      );
      console.log(`[STREAM DEBUG] GTD CONTEXT EXTRACTED SUCCESSFULLY!`);
      console.log(
        `[STREAM DEBUG] Context type: ${mongoContext.type || "unknown"}`
      );
      console.log(
        `[STREAM DEBUG] Context length: ${mongoContext.context.length} chars`
      );
      console.log(
        `[STREAM DEBUG] Sources count: ${mongoContext.sources?.length || 0}`
      );
      console.log(
        `[STREAM DEBUG] ═══════════════════════════════════════════════════`
      );
      console.log(`[STREAM DEBUG] FULL CONTEXT BEING SENT TO LLM:`);
      console.log(mongoContext.context);
      console.log(
        `[STREAM DEBUG] ═══════════════════════════════════════════════════`
      );

      // CRITICAL: Generate formatted GTD data for frontend (geo_points, etc.)
      // This is returned alongside the LLM response for map visualization
      // Check for filter OR sources OR preComputedGeoPoints
      const hasFilter =
        mongoContext.filter && Object.keys(mongoContext.filter).length > 0;
      const hasSources =
        mongoContext.sources && mongoContext.sources.length > 0;
      const hasPreComputed =
        mongoContext.preComputedGeoPoints &&
        mongoContext.preComputedGeoPoints.length > 0;

      if (hasFilter || hasSources || hasPreComputed) {
        try {
          const gtdResponseFormatter = require("../mongoDB/gtdResponseFormatter");
          const attackService = require("../mongoDB/services/attackService");

          // Only generate geo data if user needs it or context has attacks
          const needsGeo = mongoDBContextExtractor.needsGeoData(updatedMessage);
          const hasAttacks =
            mongoContext.sources && mongoContext.sources.length > 0;

          if (needsGeo || hasAttacks || hasPreComputed) {
            console.log(
              `[STREAM DEBUG] Generating GTD formatted data for frontend...`
            );

            // PRIORITY 1: Use preComputedGeoPoints if available (most efficient)
            // This is generated by formatResult() and ensures consistency
            if (hasPreComputed) {
              console.log(
                `[STREAM DEBUG] ✅ Using PRE-COMPUTED geo_points (${mongoContext.preComputedGeoPoints.length}) from context extraction`
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

              gtdFormattedData = {
                success: true,
                answer:
                  mongoContext.context.match(
                    /VERIFIED DATABASE COUNT:\s*([\d,]+)/
                  )?.[1] || `${mongoContext.count} attacks`,
                total_count:
                  mongoContext.count ||
                  mongoContext.preComputedGeoPoints.length,
                returned_count: mongoContext.preComputedGeoPoints.length,
                records_with_coordinates:
                  mongoContext.recordsWithCoordinates ||
                  mongoContext.preComputedGeoPoints.length,
                geo_points: mongoContext.preComputedGeoPoints,
                filter: mongoContext.filter,
                simpleFilter: mongoContext.simpleFilter,
                query: updatedMessage,
                totalKilled: mongoContext.killed || 0,
                totalWounded: mongoContext.wounded || 0,
                source: "pre_computed_unified",
                // Include year range for frontend display
                year_range:
                  yearRangeStart && yearRangeEnd
                    ? {
                        start: yearRangeStart,
                        end: yearRangeEnd,
                      }
                    : null,
              };
              console.log(
                `[STREAM DEBUG] Generated GTD formatted data with ${gtdFormattedData.geo_points?.length || 0} geo_points`
              );
              if (yearRangeStart && yearRangeEnd) {
                console.log(
                  `[STREAM DEBUG] Year range from filter: ${yearRangeStart}-${yearRangeEnd}`
                );
              }
            }
            // PRIORITY 2: Execute filter if available
            else if (hasFilter) {
              console.log(
                `[STREAM DEBUG] Executing filter to get raw attack data for geo_points`
              );
              const result = await attackService.executeFilter(
                mongoContext.filter,
                {
                  limit: 200000,
                  skip: 0,
                  maxLimit: 200000,
                }
              );
              if (result.success && result.results.length > 0) {
                gtdFormattedData = gtdResponseFormatter.formatResponse(
                  {
                    results: result.results,
                    totalCount: mongoContext.count || result.results.length,
                  },
                  mongoContext.context.match(
                    /VERIFIED DATABASE COUNT:\s*([\d,]+)/
                  )?.[1] || `${result.results.length} attacks`,
                  {
                    includeGeoJSON: true,
                    includeClusters: true,
                    maxReturned: 5000,
                  }
                );
                gtdFormattedData.filter = mongoContext.filter;
                gtdFormattedData.query = updatedMessage;
                console.log(
                  `[STREAM DEBUG] Generated GTD formatted data with ${gtdFormattedData.geo_points?.length || 0} geo_points`
                );
              }
            }
            // PRIORITY 3: Convert sources (fallback)
            else if (hasSources) {
              console.log(
                `[STREAM DEBUG] Converting ${mongoContext.sources.length} source objects to attack format`
              );
              const attacksForFormatting = mongoContext.sources.map(
                (source) => ({
                  eventid: source.id || source.metadata?.eventid,
                  latitude: source.metadata?.latitude,
                  longitude: source.metadata?.longitude,
                  country_txt: source.country,
                  region_txt: source.region,
                  city: source.city,
                  gname: source.group,
                  attacktype1_txt: source.attackType,
                  targtype1_txt: source.targetType,
                  weaptype1_txt: source.weapon,
                  nkill: source.casualties?.killed || 0,
                  nwound: source.casualties?.wounded || 0,
                  success: source.success ? "1" : "0",
                  suicide: source.suicide ? "1" : "0",
                  iyear: source.date
                    ? source.date.split("/")[2] || source.date.split("-")[0]
                    : null,
                  imonth: source.date
                    ? source.date.split("/")[1] || source.date.split("-")[1]
                    : null,
                  iday: source.date
                    ? source.date.split("/")[0] || source.date.split("-")[2]
                    : null,
                  summary: source.metadata?.summary,
                })
              );

              if (attacksForFormatting.length > 0) {
                gtdFormattedData = gtdResponseFormatter.formatResponse(
                  {
                    results: attacksForFormatting,
                    totalCount:
                      mongoContext.count || attacksForFormatting.length,
                  },
                  mongoContext.context.match(
                    /VERIFIED DATABASE COUNT:\s*([\d,]+)/
                  )?.[1] || `${attacksForFormatting.length} attacks`,
                  {
                    includeGeoJSON: true,
                    includeClusters: true,
                    maxReturned: 5000,
                  }
                );
                gtdFormattedData.filter = mongoContext.filter;
                gtdFormattedData.query = updatedMessage;
                console.log(
                  `[STREAM DEBUG] Generated GTD formatted data with ${gtdFormattedData.geo_points?.length || 0} geo_points`
                );
              }
            }
          }
        } catch (formatError) {
          console.error(
            `[STREAM DEBUG] Error generating GTD formatted data:`,
            formatError.message
          );
          // Continue without formatted data
        }
      }

      // Add GTD context to context texts - MAKE IT THE FIRST CONTEXT
      // This ensures it has priority
      contextTexts.unshift(mongoContext.context);

      // Add GTD sources with proper metadata
      if (mongoContext.sources && mongoContext.sources.length > 0) {
        console.log(
          `[STREAM DEBUG] Found ${mongoContext.sources.length} GTD sources`
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
      console.log(`[STREAM DEBUG] No GTD context extracted for query`);
    }
  } catch (error) {
    console.error("⚠️ GTD context extraction failed:", error.message);
    // Continue without GTD context - don't break the chat
  }

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await VectorDb.performSimilaritySearch({
          namespace: workspace.slug,
          input: updatedMessage,
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

  // Combine all contexts: pinned docs, parsed files, GTD, and vector search results
  contextTexts = [...contextTexts, ...filledSources.contextTexts];
  // For sources, we keep all sources: pinned, parsed, GTD, and vector search
  sources = [...sources, ...vectorSearchResults.sources];

  // Debug logs for contextTexts
  console.log(
    `[STREAM DEBUG] Total contextTexts chunks: ${contextTexts.length}`
  );
  contextTexts.forEach((text, i) => {
    console.log(
      `[STREAM DEBUG] Context ${i + 1} preview: ${text.substring(0, 100).replace(/\n/g, " ")}...`
    );
  });

  const hasGTDIntent = isLikelyGTDQuery || !!mongoContext?.context;

  // If no context chunks are found for non-GTD queries, exit early
  if (!hasGTDIntent && contextTexts.length === 0) {
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
    });

    await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: textResponse,
        sources: [],
        type: chatMode,
        attachments,
      },
      threadId: thread?.id || null,
      include: false,
      user,
    });
    return;
  }

  // CRITICAL FIX: When GTD context is present, we need to handle chat history carefully
  // to prevent the LLM from using outdated/wrong answers from previous messages
  let effectiveChatHistory = chatHistory;
  let effectiveRawHistory = rawHistory;
  let effectiveUserPrompt = updatedMessage;

  if (mongoContext && mongoContext.context && mongoContext.context.length > 0) {
    // Check if this is a GTD data query (stats, sample, or data)
    const isGTDDataQuery =
      mongoContext.type === "gtd_stats" ||
      mongoContext.type === "gtd_sample" ||
      mongoContext.type === "gtd_data";

    if (isGTDDataQuery) {
      console.log(
        `[STREAM DEBUG] GTD data query detected - applying chat history override`
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

        effectiveUserPrompt = `${updatedMessage}

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
        effectiveUserPrompt = `${updatedMessage}

[INSTRUCTION: Provide details ONLY from the VERIFIED ATTACK data shown in the context above. Use the exact Event ID, Country, City, and all other VERIFIED fields. Do not use any data from your training or previous messages.]`;
      } else {
        effectiveUserPrompt = `${updatedMessage}

[INSTRUCTION: Use ONLY the VERIFIED data from the Global Terrorism Database context above. Do not use training data or previous chat answers.]`;
      }

      console.log(
        `[STREAM DEBUG] Cleared chat history and modified user prompt for GTD query`
      );
      console.log(
        `[STREAM DEBUG] Effective user prompt: ${effectiveUserPrompt.substring(0, 200)}...`
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

    // Strip JSON for the user response, but keep completeText full for internal processing
    let visibleText = textResponse;
    const extraction = extractJsonFromLLMResponse(textResponse);
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
      sources,
      type: "textResponseChunk",
      textResponse: visibleText,
      close: true,
      error: false,
      metrics,
    });
  } else {
    const stream = await LLMConnector.streamGetChatCompletion(messages, {
      temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      user: user,
    });

    // Wrap response in proxy to strip internal JSON from the user stream
    const responseProxy = new ResponseProxy(response);

    completeText = await LLMConnector.handleStream(responseProxy, stream, {
      uuid,
      sources,
    });
    metrics = stream.metrics;
  }

  if (completeText?.length > 0) {
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL: Parse LLM's JSON output and execute the mongo_filter
    // This is the TWO-STEP PIPELINE:
    // Step 1: LLM generates response with mongo_filter
    // Step 2: Server parses JSON, executes filter, returns full GTD data
    // ═══════════════════════════════════════════════════════════════════════════

    let llmParsedJson = null;
    let executedGtdData = null;

    try {
      // Parse JSON from LLM response
      const extractionResult = extractJsonFromLLMResponse(completeText);

      if (extractionResult) {
        llmParsedJson = extractionResult.parsed;

        // CRITICAL FIX: Strip the JSON from the text response so user doesn't see it
        // We only show the human-readable part
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
          console.log(
            `[STREAM DEBUG] Stripped JSON from response. New length: ${completeText.length}`
          );
        } else {
          console.log(
            `[STREAM DEBUG] JSON found but indices unknown - could not strip from response`
          );
        }
      }

      if (
        llmParsedJson &&
        (llmParsedJson.mongo_filter ||
          llmParsedJson.mongo_filter === "" ||
          Object.keys(llmParsedJson.mongo_filter || {}).length === 0)
      ) {
        if (!hasGTDIntent) {
          console.log(
            `[STREAM DEBUG] Skipping GTD mongo_filter execution (non-GTD intent query)`
          );
        } else {
          // Handle empty filter as worldwide/all records query
          const hasEmptyFilter =
            !llmParsedJson.mongo_filter ||
            llmParsedJson.mongo_filter === "" ||
            (typeof llmParsedJson.mongo_filter === "object" &&
              Object.keys(llmParsedJson.mongo_filter).length === 0);

          if (hasEmptyFilter) {
            // Convert empty string to empty object for worldwide queries
            llmParsedJson.mongo_filter = {};
            console.log(
              `[STREAM DEBUG] ═══════════════════════════════════════════════════`
            );
            console.log(
              `[STREAM DEBUG] WORLDWIDE QUERY DETECTED - Empty filter converted to {}`
            );
          } else {
            console.log(
              `[STREAM DEBUG] ═══════════════════════════════════════════════════`
            );
            console.log(`[STREAM DEBUG] LLM OUTPUT PARSED SUCCESSFULLY`);
          }

          console.log(
            `[STREAM DEBUG] mongo_filter:`,
            JSON.stringify(llmParsedJson.mongo_filter)
          );
          console.log(`[STREAM DEBUG] query_type: ${llmParsedJson.query_type}`);
          console.log(
            `[STREAM DEBUG] needs_geo_data (LLM): ${llmParsedJson.needs_geo_data}`
          );
          console.log(`[STREAM DEBUG] confidence: ${llmParsedJson.confidence}`);

          // SERVER-SIDE VALIDATION: Override needs_geo_data if LLM got it wrong
          // This is a safety net to ensure geo data is returned when needed
          try {
            const {
              validateAndCorrectNeedsGeoData,
            } = require("../mongoDB/gtdSystemPrompt");
            llmParsedJson = validateAndCorrectNeedsGeoData(
              llmParsedJson,
              updatedMessage
            );
            console.log(
              `[STREAM DEBUG] needs_geo_data (after validation): ${llmParsedJson.needs_geo_data}`
            );
          } catch (validationError) {
            console.log(
              `[STREAM DEBUG] GeoData validation skipped: ${validationError.message}`
            );
            // Fallback: set needs_geo_data to true if filter has location fields
            const filter = llmParsedJson.mongo_filter;
            if (filter.country_txt || filter.city || filter.region_txt) {
              console.log(
                `[STREAM DEBUG] Forcing needs_geo_data=true due to location filter`
              );
              llmParsedJson.needs_geo_data = true;
            }
          }

          console.log(
            `[STREAM DEBUG] ═══════════════════════════════════════════════════`
          );

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
              `[STREAM DEBUG] ✅ Using PRE-COMPUTED geo_points (${mongoContext.preComputedGeoPoints.length}) from context extraction`
            );
            console.log(
              `[STREAM DEBUG] This ensures LLM answer count (${mongoContext.count}) matches displayed geo_points`
            );

            executedGtdData = {
              success: true,
              total_count: mongoContext.count,
              returned_count: mongoContext.preComputedGeoPoints.length,
              records_with_coordinates:
                mongoContext.recordsWithCoordinates ||
                mongoContext.preComputedGeoPoints.length,
              geo_points: mongoContext.preComputedGeoPoints,
              filter: mongoContext.filter,
              simpleFilter: mongoContext.simpleFilter,
              query: updatedMessage,
              totalKilled: mongoContext.killed || 0,
              totalWounded: mongoContext.wounded || 0,
              source: "pre_computed_unified", // Mark that this came from unified query
              llm_metadata: {
                confidence: llmParsedJson.confidence,
                query_type: llmParsedJson.query_type || "statistical",
                needs_geo_data: true,
              },
            };

            gtdFormattedData = executedGtdData;
            console.log(
              `[STREAM DEBUG] Total count: ${executedGtdData.total_count}`
            );
            console.log(
              `[STREAM DEBUG] Geo points: ${executedGtdData.geo_points?.length || 0}`
            );
          } else {
            // Fallback: Execute LLM filter if no pre-computed data available
            const shouldExecute = llmParsedJson.execute_on_server !== false; // Default to true
            console.log(
              `[STREAM DEBUG] No pre-computed geo_points, execute_on_server: ${shouldExecute}`
            );

            if (shouldExecute) {
              // Execute the filter from LLM output
              executedGtdData = await executeFilterFromLLMResponse(
                llmParsedJson,
                updatedMessage
              );

              if (executedGtdData) {
                console.log(
                  `[STREAM DEBUG] ✅ Successfully executed LLM filter and generated GTD data`
                );
                console.log(
                  `[STREAM DEBUG] Total count: ${executedGtdData.total_count}`
                );
                console.log(
                  `[STREAM DEBUG] Returned count: ${executedGtdData.returned_count}`
                );
                console.log(
                  `[STREAM DEBUG] Geo points: ${executedGtdData.geo_points?.length || 0}`
                );

                // Use executed data as the gtdFormattedData
                gtdFormattedData = executedGtdData;
              } else {
                console.log(
                  `[STREAM DEBUG] ⚠️ Filter execution returned no data`
                );
              }
            } else {
              console.log(
                `[STREAM DEBUG] Skipping execution - execute_on_server is false`
              );
            }
          }
        }
      } else if (llmParsedJson) {
        console.log(`[STREAM DEBUG] LLM JSON parsed but no mongo_filter found`);
        console.log(`[STREAM DEBUG] Parsed keys:`, Object.keys(llmParsedJson));
      } else {
        console.log(
          `[STREAM DEBUG] No JSON found in LLM response - using pre-extracted gtdFormattedData if available`
        );
      }
    } catch (parseError) {
      console.error(
        `[STREAM DEBUG] Error parsing/executing LLM output:`,
        parseError.message
      );
      // Continue with pre-extracted gtdFormattedData if available
    }

    // Store in chat history
    // CRITICAL: Strip geo_points from gtdData before saving to SQLite
    // Full geo_points are sent to frontend via responseChunk below — only metadata is persisted
    const gtdDataForStorage = stripGeoPointsForStorage(gtdFormattedData);
    const { chat } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: message,
      response: {
        text: completeText,
        sources,
        type: chatMode,
        attachments,
        metrics,
        // Store lightweight GTD metadata (no geo_points) to prevent Prisma NAPI crashes
        gtdData: gtdDataForStorage,
        // Also store the parsed LLM JSON for debugging
        llmParsedJson: llmParsedJson || null,
      },
      threadId: thread?.id || null,
      user,
    });

    // CRITICAL: Include GTD formatted data in the response to frontend
    // This allows the frontend to render maps/heatmaps with the geo_points
    const responseChunk = {
      uuid,
      type: "finalizeResponseStream",
      close: true,
      error: false,
      chatId: chat.id,
      metrics,
    };

    // Add GTD data if available (from LLM filter execution OR pre-extraction)
    if (gtdFormattedData) {
      // Resolve killed/wounded from whichever source has them:
      //   - Pre-computed path sets top-level totalKilled/totalWounded
      //   - formatResponse() nests them under statistics.total_killed/total_wounded
      //   - mongoContext has the authoritative aggregation values
      const resolvedKilled =
        gtdFormattedData.totalKilled ||
        gtdFormattedData.statistics?.total_killed ||
        (mongoContext?.killed ?? 0);
      const resolvedWounded =
        gtdFormattedData.totalWounded ||
        gtdFormattedData.statistics?.total_wounded ||
        (mongoContext?.wounded ?? 0);

      // Compute scientific Multi-Factor Grounding Telemetry (replaces hardcoded 1.0)
      let groundingTelemetry = null;
      try {
        const { computeConfidenceTelemetry } = require("../mongoDB/gtdGroundingScorer");
        groundingTelemetry = computeConfidenceTelemetry({
          filter: gtdFormattedData.filter || gtdFormattedData.simpleFilter || mongoContext?.filter,
          gtdData: gtdFormattedData,
          responseText: completeText,
          isOutOfRange: mongoContext?.type === "gtd_out_of_range",
        });
      } catch (err) {
        console.warn("[STREAM DEBUG] Grounding telemetry computation skipped:", err.message);
      }

      responseChunk.gtdData = {
        success: true,
        total_count: gtdFormattedData.total_count,
        returned_count: gtdFormattedData.returned_count,
        geo_points: gtdFormattedData.geo_points,
        segments: gtdFormattedData.segments,
        clusters: gtdFormattedData.clusters,
        geojson: gtdFormattedData.geojson,
        filter: gtdFormattedData.filter,
        originalFilter: gtdFormattedData.originalFilter,
        simpleFilter: gtdFormattedData.simpleFilter || null,
        query: gtdFormattedData.query,
        answer: gtdFormattedData.answer,
        llm_metadata: {
          ...(gtdFormattedData.llm_metadata || {}),
          confidence: groundingTelemetry ? groundingTelemetry.confidence : (gtdFormattedData.llm_metadata?.confidence || 0.95),
        },
        grounding_telemetry: groundingTelemetry,
        totalKilled: resolvedKilled,
        totalWounded: resolvedWounded,
        statistics: gtdFormattedData.statistics || null,
      };
      console.log(
        `[STREAM DEBUG] ✅ Including GTD data in response: ${gtdFormattedData.geo_points?.length || 0} geo_points, total: ${gtdFormattedData.total_count}, killed: ${resolvedKilled}, wounded: ${resolvedWounded}, confidence: ${groundingTelemetry?.confidence || "N/A"}`
      );
    } else if (
      mongoContext &&
      (mongoContext.killed || mongoContext.wounded || mongoContext.count)
    ) {
      // Fallback: global stats path may skip gtdFormattedData generation
      // but we still have killed/wounded from the contextExtractor aggregation
      responseChunk.gtdData = {
        success: true,
        total_count: mongoContext.count || 0,
        returned_count: 0,
        geo_points: [],
        filter: mongoContext.filter || {},
        simpleFilter: mongoContext.simpleFilter || {},
        query: updatedMessage,
        totalKilled: mongoContext.killed || 0,
        totalWounded: mongoContext.wounded || 0,
        statistics: {
          total_killed: mongoContext.killed || 0,
          total_wounded: mongoContext.wounded || 0,
        },
        llm_metadata: null,
      };
      console.log(
        `[STREAM DEBUG] ✅ Using mongoContext stats fallback: killed=${mongoContext.killed}, wounded=${mongoContext.wounded}`
      );
    } else {
      console.log(`[STREAM DEBUG] ⚠️ No GTD data to include in response`);
    }

    // Also include the raw parsed LLM JSON for frontend reference
    if (llmParsedJson) {
      responseChunk.llmOutput = {
        mongo_filter: llmParsedJson.mongo_filter,
        query_type: llmParsedJson.query_type,
        confidence: llmParsedJson.confidence,
        needs_geo_data: llmParsedJson.needs_geo_data,
        limit: llmParsedJson.limit,
        execute_on_server: llmParsedJson.execute_on_server,
        server_instructions: llmParsedJson.server_instructions || null,
        _geo_override: llmParsedJson._geo_override || null,
      };
    }

    writeResponseChunk(response, responseChunk);
    return;
  }

  writeResponseChunk(response, {
    uuid,
    type: "finalizeResponseStream",
    close: true,
    error: false,
    metrics,
  });
  return;
}

// Add a helper function to get combined chat context (optional, for backward compatibility)
async function getChatContext(workspace, message, user = null) {
  try {
    const LLMConnector = getLLMProvider();
    const VectorDb = getVectorDbClass();

    // Check if vector database has data
    const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
    const vectorCount = await VectorDb.namespaceCount(workspace.slug);

    let vectorContext = {
      contextTexts: [],
      sources: [],
      message: null,
      vectorCount,
    };

    // Get vector context if available
    if (hasVectorizedSpace && vectorCount > 0) {
      vectorContext = await VectorDb.performSimilaritySearch({
        namespace: workspace.slug,
        input: message,
        LLMConnector,
        similarityThreshold: workspace?.similarityThreshold || 0.25,
        topN: workspace?.topN || 4,
      });
    }

    // Get MongoDB/GTD context
    const mongoContext = await mongoDBContextExtractor.extractGTDContext(
      message,
      workspace
    );

    // Combine both contexts
    const combinedContextTexts = [
      ...vectorContext.contextTexts,
      ...(mongoContext.context ? [mongoContext.context] : []),
    ];

    const combinedSources = [
      ...vectorContext.sources,
      ...(mongoContext.sources || []).map((source) => ({
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
      })),
    ];

    return {
      contextTexts: combinedContextTexts,
      sources: combinedSources,
      message: vectorContext.message,
      hasGTDData: !!mongoContext.context,
      vectorCount,
      gtdSourceCount: mongoContext.sources?.length || 0,
    };
  } catch (error) {
    console.error("Error in getChatContext:", error.message, error);
    return {
      contextTexts: [],
      sources: [],
      message: null,
      hasGTDData: false,
      vectorCount: 0,
      gtdSourceCount: 0,
    };
  }
}

module.exports = {
  VALID_CHAT_MODE,
  streamChatWithWorkspace,
  getChatContext, // Export the new function for backward compatibility
};
