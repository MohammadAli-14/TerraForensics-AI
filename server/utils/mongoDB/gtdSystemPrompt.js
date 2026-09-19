/**
 * GTD System Prompt Module
 *
 * This module provides the complete system prompt for GTD queries,
 * including explicit JSON output format instructions and heuristics
 * for needs_geo_data determination.
 *
 * @module gtdSystemPrompt
 */

/**
 * The complete GTD system prompt with JSON output format instructions.
 * This is injected into the chat context for all GTD-related queries.
 */
const GTD_SYSTEM_PROMPT = `
═══════════════════════════════════════════════════════════════════════════════
GLOBAL TERRORISM DATABASE (GTD) ASSISTANT — STRICT RESPONSE RULES
═══════════════════════════════════════════════════════════════════════════════

You are a strict, defensive assistant that answers user queries using ONLY the provided conversation context and any GTD (Global Terrorism Database, 1970–2017) query result snippets present. Follow these rules exactly.

1) OUTPUT FORMAT (MANDATORY)
   - Your reply MUST contain exactly two parts in this order:
     A) A concise human-readable answer (2–6 sentences) that MUST include:
        • The exact verified attack count from context (VERIFIED DATABASE COUNT)
        • The total deaths from context (VERIFIED DEATHS)
        • The total wounded from context (VERIFIED INJURIES)
        • The year range from context (YEAR RANGE) if provided
        Example format: "...there were exactly X attacks, resulting in Y deaths and Z injuries (data spans YEAR1-YEAR2)."
     B) Immediately after that (no blank line, no extra commentary), a single VALID JSON object and nothing else. The JSON must parse with a strict JSON parser.

2) REQUIRED JSON SCHEMA (all keys must appear)
{
  "answer": "<exact same text as the human-readable answer above>",
  "confidence": <float 0.0-1.0>,
  "query_type": "statistical" | "sample" | "geographic" | "comparison" | "general",
  "mongo_filter": <object>,
  "needs_geo_data": <boolean>,
  "limit": <integer>,
  "execute_on_server": <boolean>,
  "server_instructions": <object>
}

3) FILTER RULES
   - If the context contains the literal block "USE THIS FILTER IN YOUR mongo_filter", COPY THAT FILTER EXACTLY into mongo_filter (byte-for-byte). Do not change keys/values.
   - Otherwise produce a simplified filter object using ONLY these allowed keys (if applicable): country_txt, city, provstate (for province/state queries), gname, attacktype1_txt, targtype1_txt, suicide ("1"/"0"), success ("1"/"0"), year_start, year_end, iyear, imonth, iday.
   - For province/state queries (e.g., "attacks in Punjab Province"), use provstate field: {"country_txt":"Pakistan","provstate":"Punjab"}
   - SPECIFIC DATE PARSING: When user mentions a specific date (e.g., "16-12-2014", "December 16, 2014", "16 December 2014"):
     * Extract year to iyear: "2014"
     * Extract month to imonth: "12" (as string, 1-12)
     * Extract day to iday: "16" (as string, 1-31)
     * Example: "attacks on 16-12-2014" → {"iyear":"2014","imonth":"12","iday":"16"}
   - MONTH-ONLY QUERIES: When user mentions only month and year (e.g., "December 2014", "in 12/2014"):
     * Use iyear and imonth only: {"iyear":"2014","imonth":"12"}
   - Do not include other keys.
   - NEVER put date text in gname or other fields - dates MUST use iyear/imonth/iday fields.

4) needs_geo_data HEURISTICS (deterministic)
   - Set needs_geo_data = true if ANY of:
     * User asks for a map/heatmap/plot/locations/where/by city/show coordinates/sample events.
     * Simplified filter contains geographic fields (country_txt, city, region, provstate).
     * query_type is "geographic" or "sample".
     * Query asks about attacks IN a specific country, city, province, or region.
   - Set needs_geo_data = false ONLY when:
     * Query is purely temporal with no location filter.
     * Query asks about global totals with NO location filter.
     * Query is about a specific event ID only.
   - DEFAULT: When in doubt, set needs_geo_data = true.

5) execute_on_server (signal for backend)
   - If you want the backend to immediately run the mongo_filter, fetch records, and return them into the chat UI, set "execute_on_server": true.
   - If you are only proposing a query and do NOT want execution, set "execute_on_server": false.
   - For most GTD queries, set execute_on_server: true.

6) server_instructions (REQUIRED when execute_on_server is true)
   - When execute_on_server:true, include a server_instructions object describing precisely what the server should return. Use this structure:
     "server_instructions": {
       "action": "return_records" | "return_aggregates",
       "return_mode": "geo_samples_with_fields" | "full_records" | "count_only",
       "return_fields": ["latitude","longitude","city","country_txt","iyear","eventid","attacktype1_txt","targtype1_txt","nkill","nwound"],
       "max_records": <integer>
     }
   - For geographic/heatmap queries use:
     "server_instructions": {"action":"return_records","return_mode":"geo_samples_with_fields","return_fields":["latitude","longitude","city","country_txt","iyear","eventid","attacktype1_txt","targtype1_txt","nkill","nwound"],"max_records":30000}
   - For count-only statistical queries use:
     "server_instructions": {"action":"return_aggregates","return_mode":"count_only","return_fields":[],"max_records":0}

7) CONFIDENCE GUIDELINES
   - 0.9–1.0: Exact value taken from provided GTD context or a direct DB count the server will run.
   - 0.6–0.9: Aggregation/estimation based on available data.
   - <0.6: Guess or insufficient evidence.

8) LIMIT RULES
   - Provide a sensible limit integer.
   - For large countries (Iraq, Pakistan, Afghanistan, India): use 200000.
   - For specific cities or small datasets: use 1000-5000.
   - limit and max_records must not exceed 200000.

9) JSON SANITY RULES
   - answer must EXACTLY match the human-readable answer above it (character-for-character).
   - The JSON must be strictly valid (no trailing commas, no comments).
   - Do not output any extra text beyond the two required parts.

10) SAFETY
   - Never output PII (victim names, phone numbers, exact identities).
   - If user requests disallowed content, refuse briefly and set confidence <0.6 and execute_on_server:false.

11) EXAMPLES (format to follow EXACTLY)

EXAMPLE 1 - Country query:
User question: "How many attacks have happened in Iraq?"

Your complete response:
According to the Global Terrorism Database (GTD, 1970–2017), there were exactly 24,636 terrorist attacks in Iraq, resulting in 78,589 deaths and 134,690 injuries. The data spans from 1979 to 2017.
{"answer":"According to the Global Terrorism Database (GTD, 1970–2017), there were exactly 24,636 terrorist attacks in Iraq, resulting in 78,589 deaths and 134,690 injuries. The data spans from 1979 to 2017.","confidence":1.0,"query_type":"statistical","mongo_filter":{"country_txt":"Iraq"},"needs_geo_data":true,"limit":30000,"execute_on_server":true,"server_instructions":{"action":"return_records","return_mode":"geo_samples_with_fields","return_fields":["latitude","longitude","city","country_txt","iyear","eventid","attacktype1_txt","targtype1_txt","nkill","nwound"],"max_records":30000}}

EXAMPLE 2 - Specific date query (CRITICAL - use imonth and iday):
User question: "Incidents in Pakistan on 16-12-2014?"

Your complete response:
According to the Global Terrorism Database (GTD, 1970–2017), there were 2 recorded attacks in Pakistan on December 16, 2014, resulting in 149 deaths and 125 injuries.
{"answer":"According to the Global Terrorism Database (GTD, 1970–2017), there were 2 recorded attacks in Pakistan on December 16, 2014, resulting in 149 deaths and 125 injuries.","confidence":1.0,"query_type":"geographic","mongo_filter":{"country_txt":"Pakistan","iyear":"2014","imonth":"12","iday":"16"},"needs_geo_data":true,"limit":5000,"execute_on_server":true,"server_instructions":{"action":"return_records","return_mode":"geo_samples_with_fields","return_fields":["latitude","longitude","city","country_txt","iyear","imonth","iday","eventid","attacktype1_txt","targtype1_txt","nkill","nwound","summary"],"max_records":5000}}

EXAMPLE 3 - Month and year query:
User question: "Attacks in Pakistan in December 2014?"

Your complete response:
According to the Global Terrorism Database (GTD, 1970–2017), there were 236 attacks in Pakistan during December 2014, resulting in 397 deaths and 598 injuries.
{"answer":"According to the Global Terrorism Database (GTD, 1970–2017), there were 236 attacks in Pakistan during December 2014, resulting in 397 deaths and 598 injuries.","confidence":1.0,"query_type":"geographic","mongo_filter":{"country_txt":"Pakistan","iyear":"2014","imonth":"12"},"needs_geo_data":true,"limit":5000,"execute_on_server":true,"server_instructions":{"action":"return_records","return_mode":"geo_samples_with_fields","return_fields":["latitude","longitude","city","country_txt","iyear","imonth","eventid","attacktype1_txt","targtype1_txt","nkill","nwound"],"max_records":5000}}

═══════════════════════════════════════════════════════════════════════════════
`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// CENTRALIZED ATTACK SYNONYMS - Import from contextExtractor for consistent pattern matching
// This ensures "mishap in Peshawar" is treated the same as "attack in Peshawar" across the entire system
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
const ATTACK_SYNONYMS_REGEX =
  "attacks?|incidents?|events?|mishaps?|bombings?|blasts?|shootings?|massacres?|tragedies?|occurrences?|disasters?|assaults?|raids?|strikes?|atrocit(?:y|ies)|ambush(?:es)?|carnage|slaughter|shootouts?|detonations?|explosions?";

/**
 * Heuristics for determining needs_geo_data value
 * These can be used for server-side validation/override of LLM output
 */
const NEEDS_GEO_DATA_HEURISTICS = {
  // Patterns that REQUIRE geo data (needs_geo_data = true)
  requireGeoPatterns: [
    // Explicit geo keywords
    /\b(map|maps|heatmap|heat\s*map|visualiz|geographic|geography)\b/i,
    /\b(location|locations|coordinates|geolocation|spatial|geospatial)\b/i,
    /\b(plot|display|show)\s+(on|the)\s*map/i,
    /\b(cluster|clusters|geojson|geo_points|geopoints)\b/i,

    // Worldwide/global queries - these NEED geo for global map visualization
    /\b(worldwide|world\s*wide|global|globally|around\s+the\s+world|across\s+the\s+world)\b/i,
    /\b(all\s+countries|every\s+country|all\s+attacks|total\s+attacks)\b/i,

    // Location queries (country, city, region) - FIXED: Use full ATTACK_SYNONYMS_REGEX
    // This ensures "mishap in Peshawar" triggers geo data just like "attack in Peshawar"
    new RegExp(
      `\\b(${ATTACK_SYNONYMS_REGEX})\\s+(in|from|at)\\s+[A-Z][a-z]+`,
      "i"
    ),
    /\bin\s+(Iraq|Pakistan|Afghanistan|Syria|India|Nigeria|Colombia|Turkey|Philippines)/i,
    /\b(where|which\s+locations?|which\s+cities?|which\s+countries?)\b/i,

    // Phrases implying location context
    /\bacross\s+\w+/i,
    /\bthroughout\s+\w+/i,
    /\bwithin\s+(the\s+)?(country|region|city)/i,

    // Implicit location intent - FIXED: Use full ATTACK_SYNONYMS_REGEX
    new RegExp(`\\ball\\s+(${ATTACK_SYNONYMS_REGEX})\\s+in\\b`, "i"),
    new RegExp(`\\blist\\s+(of\\s+)?(${ATTACK_SYNONYMS_REGEX})\\s+in\\b`, "i"),
    new RegExp(`\\bshow\\s+(me\\s+)?(${ATTACK_SYNONYMS_REGEX})\\s+in\\b`, "i"),
  ],

  // Patterns that DO NOT require geo data (needs_geo_data = false)
  // Be very conservative here - most queries benefit from geo visualization
  excludeGeoPatterns: [
    // Specific event ID queries
    /\bevent\s*id\s*[:=]?\s*\d+/i,
    /\beventid\s*[:=]?\s*\d+/i,
    /\bspecific\s+attack\s+id\b/i,

    // Pure trend/timeline analysis without location
    /\btrend\s+over\s+time\s+without\s+location\b/i,
    /\byear\s*-?\s*over\s*-?\s*year\s+only\b/i,
  ],

  // Field-based heuristics: if filter contains these, needs_geo_data = true
  geoFilterFields: [
    "country_txt",
    "country",
    "city",
    "region_txt",
    "region",
    "provstate",
    "latitude",
    "longitude",
  ],
};

/**
 * Evaluate whether a query needs geo data based on heuristics
 * This can be used to validate or override LLM output
 *
 * @param {string} query - The user's natural language query
 * @param {Object} filter - The mongo_filter from LLM output
 * @returns {Object} - { needsGeo: boolean, reason: string, confidence: number }
 */
function evaluateNeedsGeoData(query, filter = {}) {
  const lowerQuery = query.toLowerCase();
  let needsGeo = false;
  let reason = "";
  let confidence = 0.5;

  // Check for explicit exclude patterns first
  for (const pattern of NEEDS_GEO_DATA_HEURISTICS.excludeGeoPatterns) {
    if (pattern.test(query)) {
      return {
        needsGeo: false,
        reason: `Matches exclude pattern: ${pattern.toString()}`,
        confidence: 0.9,
      };
    }
  }

  // Check for require patterns
  for (const pattern of NEEDS_GEO_DATA_HEURISTICS.requireGeoPatterns) {
    if (pattern.test(query)) {
      needsGeo = true;
      reason = `Matches require pattern: ${pattern.toString()}`;
      confidence = 0.95;
      break;
    }
  }

  // Check filter fields
  if (filter && typeof filter === "object") {
    for (const field of NEEDS_GEO_DATA_HEURISTICS.geoFilterFields) {
      if (filter[field] !== undefined) {
        needsGeo = true;
        reason = `Filter contains geo field: ${field}`;
        confidence = 0.98;
        break;
      }
    }
  }

  // Default to true if uncertain (better to have geo data than not)
  if (!needsGeo && !reason) {
    // Check if query contains any location-like words
    const locationPatterns =
      /\b(iraq|pakistan|india|syria|afghanistan|nigeria|russia|turkey|yemen|somalia|libya|egypt|kenya|france|uk|usa|china|israel|palestine|lebanon|jordan|iran|colombia|peru|mexico|brazil|argentina|spain|germany|italy|japan|korea|philippines|thailand|indonesia|myanmar|bangladesh)/i;

    if (locationPatterns.test(query)) {
      needsGeo = true;
      reason = "Query mentions a country/location name";
      confidence = 0.9;
    }
  }

  return { needsGeo, reason, confidence };
}

/**
 * Validate and potentially override LLM's needs_geo_data output
 * Also validates execute_on_server and other required fields
 *
 * @param {Object} llmJson - Parsed JSON from LLM response
 * @param {string} originalQuery - The original user query
 * @returns {Object} - Validated/corrected JSON
 */
function validateAndCorrectNeedsGeoData(llmJson, originalQuery) {
  if (!llmJson || typeof llmJson !== "object") {
    return llmJson;
  }

  const evaluation = evaluateNeedsGeoData(originalQuery, llmJson.mongo_filter);

  // Log the evaluation
  console.log(
    `[GeoData Validator] Query: "${originalQuery.substring(0, 50)}..."`
  );
  console.log(
    `[GeoData Validator] LLM says needs_geo_data: ${llmJson.needs_geo_data}`
  );
  console.log(
    `[GeoData Validator] Heuristics say needs_geo_data: ${evaluation.needsGeo} (${evaluation.confidence} confidence)`
  );
  console.log(`[GeoData Validator] Reason: ${evaluation.reason || "default"}`);

  // Override if heuristics have high confidence and disagree with LLM
  if (
    evaluation.confidence >= 0.9 &&
    evaluation.needsGeo !== llmJson.needs_geo_data
  ) {
    console.log(
      `[GeoData Validator] ⚠️ OVERRIDING LLM needs_geo_data: ${llmJson.needs_geo_data} → ${evaluation.needsGeo}`
    );
    llmJson.needs_geo_data = evaluation.needsGeo;
    llmJson._geo_override = {
      original: !evaluation.needsGeo,
      corrected: evaluation.needsGeo,
      reason: evaluation.reason,
      confidence: evaluation.confidence,
    };
  }

  // Ensure execute_on_server is set (default to true for most queries)
  if (llmJson.execute_on_server === undefined) {
    llmJson.execute_on_server = true;
    console.log(`[GeoData Validator] Setting default execute_on_server: true`);
  }

  // Ensure limit is within bounds
  if (!llmJson.limit || llmJson.limit < 1) {
    llmJson.limit = 5000;
  } else if (llmJson.limit > 100000) {
    llmJson.limit = 100000;
  }

  // Ensure query_type is valid
  const validQueryTypes = [
    "statistical",
    "sample",
    "geographic",
    "comparison",
    "general",
  ];
  if (!llmJson.query_type || !validQueryTypes.includes(llmJson.query_type)) {
    // Infer query_type from context
    if (
      llmJson.needs_geo_data &&
      /map|heatmap|plot|visual/i.test(originalQuery)
    ) {
      llmJson.query_type = "geographic";
    } else if (/sample|example|show me|random/i.test(originalQuery)) {
      llmJson.query_type = "sample";
    } else if (/how many|count|total|number/i.test(originalQuery)) {
      llmJson.query_type = "statistical";
    } else {
      llmJson.query_type = "general";
    }
    console.log(
      `[GeoData Validator] Inferred query_type: ${llmJson.query_type}`
    );
  }

  // Ensure server_instructions is present when execute_on_server is true
  if (llmJson.execute_on_server && !llmJson.server_instructions) {
    console.log(`[GeoData Validator] Generating default server_instructions`);

    // Generate appropriate server_instructions based on query_type
    if (
      llmJson.needs_geo_data ||
      llmJson.query_type === "geographic" ||
      llmJson.query_type === "sample"
    ) {
      llmJson.server_instructions = {
        action: "return_records",
        return_mode: "geo_samples_with_fields",
        return_fields: [
          "latitude",
          "longitude",
          "city",
          "country_txt",
          "iyear",
          "eventid",
          "attacktype1_txt",
          "targtype1_txt",
          "nkill",
          "nwound",
        ],
        max_records: Math.min(llmJson.limit || 200000, 200000),
      };
    } else if (llmJson.query_type === "statistical") {
      // For pure count queries, still return records for potential map display
      llmJson.server_instructions = {
        action: "return_records",
        return_mode: "geo_samples_with_fields",
        return_fields: [
          "latitude",
          "longitude",
          "city",
          "country_txt",
          "iyear",
          "eventid",
          "attacktype1_txt",
          "targtype1_txt",
          "nkill",
          "nwound",
        ],
        max_records: Math.min(llmJson.limit || 200000, 200000),
      };
    } else {
      llmJson.server_instructions = {
        action: "return_records",
        return_mode: "full_records",
        return_fields: [],
        max_records: Math.min(llmJson.limit || 5000, 5000),
      };
    }
  }

  // Validate server_instructions structure if present
  if (llmJson.server_instructions) {
    const si = llmJson.server_instructions;

    // Ensure action is valid
    if (!["return_records", "return_aggregates"].includes(si.action)) {
      si.action = "return_records";
    }

    // Ensure return_mode is valid
    if (
      !["geo_samples_with_fields", "full_records", "count_only"].includes(
        si.return_mode
      )
    ) {
      si.return_mode = "geo_samples_with_fields";
    }

    // Ensure return_fields is an array
    if (!Array.isArray(si.return_fields)) {
      si.return_fields = [
        "latitude",
        "longitude",
        "city",
        "country_txt",
        "iyear",
        "eventid",
        "attacktype1_txt",
        "targtype1_txt",
        "nkill",
        "nwound",
      ];
    }

    // Ensure max_records is within bounds
    if (!si.max_records || si.max_records < 0) {
      si.max_records = 5000;
    } else if (si.max_records > 100000) {
      si.max_records = 100000;
    }

    console.log(
      `[GeoData Validator] server_instructions: action=${si.action}, mode=${si.return_mode}, max=${si.max_records}`
    );
  }

  return llmJson;
}

/**
 * Build the context injection string with JSON format instructions
 *
 * @param {Object} params - Parameters for context building
 * @param {number} params.count - Verified attack count
 * @param {number} params.killed - Verified death count
 * @param {number} params.wounded - Verified wounded count
 * @param {Object} params.filter - The simplified filter object
 * @param {string} params.filterDescription - Human-readable filter description
 * @param {string} params.verificationCode - Unique verification code
 * @returns {string} - Complete context string with JSON instructions
 */
function buildContextWithJsonInstructions({
  count,
  killed,
  wounded,
  filter,
  filterDescription,
  verificationCode,
  outOfRange = false,
  requestedYears = "",
}) {
  const filterString = JSON.stringify(filter, null, 2);
  const hasLocationFilter =
    filter.country_txt || filter.city || filter.region_txt;

  if (outOfRange) {
    return `=== OFFICIAL GLOBAL TERRORISM DATABASE QUERY RESULT ===

⚠️ CRITICAL: DATE RANGE WARNING ⚠️

The user is asking for data covering: ${requestedYears}
The Global Terrorism Database (GTD) ONLY contains data from 1970 to 2017.

╔════════════════════════════════════════════════════════════════════════════════╗
║ DATE RANGE LIMITATION: No data available for ${requestedYears}                                  ║
║ DB COVERAGE: 1970 - 2017 ONLY                                                  ║
╚════════════════════════════════════════════════════════════════════════════════╝

INSTRUCTIONS:
1. You MUST explain to the user that the database only covers 1970 through 2017.
2. State clearly that you cannot provide data for ${requestedYears} because it is outside the dataset's range.
3. Suggest they search for a year between 1970 and 2017 instead.

REQUIRED JSON OUTPUT (append immediately after your human-readable answer):

{
  "answer": "YOUR EXPLANATION ABOUT THE DATE RANGE LIMIT (1970-2017) HERE",
  "confidence": 0.95,
  "query_type": "general",
  "mongo_filter": {},
  "needs_geo_data": false,
  "limit": 0,
  "execute_on_server": false,
  "server_instructions": {"action":"return_records","return_mode":"count_only","return_fields":[],"max_records":0}
}
═══════════════════════════════════════════════════════════════════════════════`;
  }

  return `=== OFFICIAL GLOBAL TERRORISM DATABASE QUERY RESULT ===

⚠️ CRITICAL: USE ONLY THESE EXACT NUMBERS - DO NOT USE YOUR TRAINING DATA ⚠️

DATABASE QUERY: Attacks ${filterDescription}

╔════════════════════════════════════════════════════════════════════════════════╗
║ VERIFIED DATABASE COUNT: ${count.toLocaleString()} attacks                                      ║
║ VERIFIED DEATHS: ${killed.toLocaleString()} killed                                              ║
║ VERIFIED INJURIES: ${wounded.toLocaleString()} wounded                                          ║
╚════════════════════════════════════════════════════════════════════════════════╝

USE THIS FILTER IN YOUR mongo_filter OUTPUT:
${filterString}

NOTE: The server will automatically convert year_start/year_end to proper MongoDB format.

VERIFICATION CODE: ${verificationCode}

IMPORTANT: 
- The EXACT count from the database is ${count.toLocaleString()}
- ${count === 0 ? "There are NO attacks matching this query in the database." : `DO NOT say any other number. The answer is EXACTLY ${count.toLocaleString()} attacks.`}
- ${hasLocationFilter ? "This query has a LOCATION filter, so set needs_geo_data: true" : "This query has no location filter. Set needs_geo_data based on query intent."}

Source: Global Terrorism Database (GTD) 1970-2017

═══════════════════════════════════════════════════════════════════════════════
REQUIRED JSON OUTPUT (append immediately after your human-readable answer):

{
  "answer": "YOUR EXACT ANSWER TEXT HERE",
  "confidence": 0.95,
  "query_type": "statistical",
  "mongo_filter": ${filterString.replace(/\n/g, "")},
  "needs_geo_data": ${hasLocationFilter ? "true" : "true"},
  "limit": ${count > 10000 ? 200000 : 5000},
  "execute_on_server": true,
  "server_instructions": {"action":"return_records","return_mode":"geo_samples_with_fields","return_fields":["latitude","longitude","city","country_txt","iyear","eventid","attacktype1_txt","targtype1_txt","nkill","nwound"],"max_records":${count > 10000 ? 200000 : 5000}}
}

RULES:
- needs_geo_data = true because ${hasLocationFilter ? "filter has location field (country_txt/city)" : "default to true for attack queries"}
- execute_on_server = true so server returns geo_points for map visualization
- server_instructions tells server exactly what data to return
- The "answer" field must EXACTLY match your human-readable response above
═══════════════════════════════════════════════════════════════════════════════`;
}

module.exports = {
  GTD_SYSTEM_PROMPT,
  NEEDS_GEO_DATA_HEURISTICS,
  evaluateNeedsGeoData,
  validateAndCorrectNeedsGeoData,
  buildContextWithJsonInstructions,
};
