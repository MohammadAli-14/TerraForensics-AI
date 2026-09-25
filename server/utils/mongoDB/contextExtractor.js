const attackService = require("../mongoDB/services/attackService");
const Attack = require("../mongoDB/models/Attack");

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CENTRALIZED ATTACK SYNONYMS - Used across ALL pattern matching in this file
// This ensures consistent recognition of attack-related terms everywhere
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const ATTACK_SYNONYMS = [
  "attack",
  "attacks",
  "incident",
  "incidents",
  "event",
  "events",
  "mishap",
  "mishaps",
  "bombing",
  "bombings",
  "blast",
  "blasts",
  "shooting",
  "shootings",
  "massacre",
  "massacres",
  "tragedy",
  "tragedies",
  "occurrence",
  "occurrences",
  "disaster",
  "disasters",
  "assault",
  "assaults",
  "raid",
  "raids",
  "strike",
  "strikes",
  "atrocity",
  "atrocities",
  "ambush",
  "ambushes",
  "carnage",
  "slaughter",
  "shootout",
  "shootouts",
  "detonation",
  "detonations",
  "explosion",
  "explosions",
];

// Regex pattern string for use in RegExp constructors (singular|plural forms)
const ATTACK_SYNONYMS_REGEX = ATTACK_SYNONYMS.join("|");

// Export for use in other modules
module.exports.ATTACK_SYNONYMS = ATTACK_SYNONYMS;
module.exports.ATTACK_SYNONYMS_REGEX = ATTACK_SYNONYMS_REGEX;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SAFE $toInt HELPER â€” wraps MongoDB $toInt with $convert to handle null/empty
// GTD stores iyear, nkill, nwound as strings. Some records have null, "", or "."
// Bare $toInt throws; $convert with onError/onNull defaults to 0 safely.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function safeToInt(field) {
  return { $convert: { input: field, to: "int", onError: 0, onNull: 0 } };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CENTRALIZED PROVINCE CORRECTIONS â€” single source of truth for spelling fixes
// Used by normalizeGTDFilter, parseNaturalLanguageQuery, and buildMongoDBFilter
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const PROVINCE_CORRECTIONS = {
  "khyber pakhtunhwa": "Khyber Pakhtunkhwa",
  "khyber pakhtonkhwa": "Khyber Pakhtunkhwa",
  "khyber-pakhtunkhwa": "Khyber Pakhtunkhwa",
  khyberpakhtunkhwa: "Khyber Pakhtunkhwa",
  kpk: "Khyber Pakhtunkhwa",
  nwfp: "Khyber Pakhtunkhwa",
  "north west frontier province": "Khyber Pakhtunkhwa",
  baluchistan: "Balochistan",
  "gilgit baltistan": "Gilgit-Baltistan",
  "federally administered tribal areas": "FATA",
};

const PROVINCE_ALIASES = {
  "Khyber Pakhtunkhwa": ["North-West Frontier Province"],
  "North-West Frontier Province": ["Khyber Pakhtunkhwa"],
  KPK: ["Khyber Pakhtunkhwa", "North-West Frontier Province"],
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COUNTRY ALIASES â€” maps common abbreviations/alternative names to canonical
// GTD country_txt values. Applied before the main country extraction loop.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const COUNTRY_ALIASES = {
  america: "United States",
  usa: "United States",
  "u.s.a": "United States",
  "u.s.": "United States",
  "united states of america": "United States",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  uae: "United Arab Emirates",
  burma: "Myanmar",
  holland: "Netherlands",
  persia: "Iran",
  "ivory coast": "Cote d'Ivoire",
  ksa: "Saudi Arabia",
  saudi: "Saudi Arabia",
  "south korea": "South Korea",
  "north korea": "North Korea",
  congo: "Democratic Republic of the Congo",
  drc: "Democratic Republic of the Congo",
  zaire: "Democratic Republic of the Congo",
  czechoslovakia: "Czech Republic",
  bosnia: "Bosnia-Herzegovina",
  macedonia: "North Macedonia",
};

class MongoDBContextExtractor {
  constructor() {
    this.gtdKeywords = [
      // GTD-specific terms (core terrorism vocabulary)
      "terrorism",
      "terrorist",
      "attack",
      "attacks",
      "bombing",
      "bombings",
      "terror",
      "violence",
      "terrorism database",
      "gtd",
      "global terrorism",
      "terrorist group",
      "terrorist organization",
      "casualties",
      "fatalities",
      "terrorist attack",
      "terrorist attacks",
      "suicide attack",
      "armed attack",
      "assassination",
      "assassinations",
      "hostage",
      "hostages",
      "kidnapping",
      "kidnappings",
      "hijacking",
      "hijackings",
      "explosion",
      "explosions",
      "terrorism statistics",
      "terrorism data",
      "terrorism report",
      "terrorist incident",
      "terrorist activity",
      "terrorist threat",
      "counterterrorism",
      "counter-terrorism",
      "extremism",
      "radicalization",

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // SYNONYM KEYWORDS - Common words users might use instead of "attack"
      // These help detect GTD queries even when user uses informal language
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      "incident",
      "incidents",
      "event",
      "events",
      "mishap",
      "mishaps",
      "occurrence",
      "occurrences",
      "happening",
      "happenings",
      "tragedy",
      "tragedies",
      "disaster",
      "disasters",
      "catastrophe",
      "blast",
      "blasts",
      "detonation",
      "detonations",
      "massacre",
      "massacres",
      "slaughter",
      "carnage",
      "shootout",
      "shooting",
      "shootings",
      "gunfire",
      "ambush",
      "raid",
      "raids",
      "strike",
      "strikes",
      "assault",
      "assaults",
      "atrocity",
      "atrocities",
      "act of terror",
      "acts of terror",
      "act of violence",
      "acts of violence",
      "suicide bombing",
      "car bombing",
      "truck bombing",
      "ied",
      "improvised explosive",
      "explosive device",

      // Query patterns
      "tell about",
      "details about",
      "information about",
      "show me",
      "what happened",
      "how many",
      "statistics",
      "data",
      "report",
      "list",
      "find",
      "search",
      "query",
    ];

    // Keywords that indicate user needs geographic/map output
    this.geoKeywords = [
      "map",
      "maps",
      "heatmap",
      "heat map",
      "heat-map",
      "visualize",
      "visualization",
      "geographic",
      "geography",
      "location",
      "locations",
      "coordinates",
      "geolocation",
      "plot",
      "display on map",
      "show on map",
      "where",
      "spatial",
      "geospatial",
      "geo_points",
      "geopoints",
      "cluster",
      "clusters",
      "geojson",
      "globe",
      "worldwide",
      "across the globe",
    ];

    // CONVERSATION CONTEXT TRACKING
    // Store the last query context per workspace to handle follow-up questions
    this.conversationContext = new Map();
    this.contextTimeout = 5 * 60 * 1000; // 5 minutes timeout for context

    // Province aliases — reference centralized module-level PROVINCE_ALIASES constant
    this.provinceAliases = PROVINCE_ALIASES;

    // Initialize cache properties
    this.knownCountries = [];
    this.knownProvinces = [];
    this.knownGroups = [];
    this.cacheLoaded = false;
    this.cacheLoadingPromise = null;
  }

  // Helper to build a unique composite session key to prevent cross-user/thread race conditions (Figure 10 fix)
  _buildContextKey(workspaceOrKey, user = null, thread = null) {
    if (!workspaceOrKey) return "default:anonymous:default";
    if (typeof workspaceOrKey === "string" && workspaceOrKey.includes(":")) {
      return workspaceOrKey;
    }
    const ws =
      typeof workspaceOrKey === "object"
        ? workspaceOrKey?.id || workspaceOrKey?.slug || "default"
        : workspaceOrKey || "default";

    const usr =
      typeof user === "object"
        ? user?.id || user?.username || "anonymous"
        : user || "anonymous";
    const th =
      typeof thread === "object"
        ? thread?.id || thread?.slug || "default"
        : thread || "default";

    return `${ws}:${usr}:${th}`;
  }

  // Store context for follow-up queries with thread and user isolation
  storeContext(workspaceOrKey, context, user = null, thread = null) {
    const key = this._buildContextKey(workspaceOrKey, user, thread);
    this.conversationContext.set(key, {
      ...context,
      timestamp: Date.now(),
    });
    console.log(
      `[Context Tracker] Stored context for session [${key}]:`,
      context
    );
  }

  // Get stored context if still valid with thread and user isolation
  getStoredContext(workspaceOrKey, user = null, thread = null) {
    const key = this._buildContextKey(workspaceOrKey, user, thread);
    let stored = this.conversationContext.get(key);

    // Backward compatibility fallback for legacy workspace-only key
    if (!stored) {
      const legacyKey =
        typeof workspaceOrKey === "string"
          ? workspaceOrKey
          : workspaceOrKey?.id || "default";
      stored = this.conversationContext.get(legacyKey);
    }

    if (!stored) return null;

    // Check if context has expired
    if (Date.now() - stored.timestamp > this.contextTimeout) {
      this.conversationContext.delete(key);
      console.log(
        `[Context Tracker] Context expired for session [${key}]`
      );
      return null;
    }

    console.log(`[Context Tracker] Retrieved stored context for [${key}]:`, stored);
    return stored;
  }

  /**
   * Detect if the user's query implies they need geographic/map output
   * This helps determine if the response should include geo_points, clusters, geojson
   *
   * @param {string} query - User's natural language query
   * @returns {boolean} - True if the query suggests map/geo visualization is needed
   */
  needsGeoData(query) {
    if (!query || typeof query !== "string") return false;

    const lowerQuery = query.toLowerCase();

    // Check for explicit geo keywords
    const hasGeoKeyword = this.geoKeywords.some((keyword) =>
      lowerQuery.includes(keyword)
    );

    if (hasGeoKeyword) {
      console.log(
        `[Geo Detection] Query needs geo data: "${query.substring(0, 50)}..."`
      );
      return true;
    }

    // Check for patterns that imply geographic output
    // Use ATTACK_SYNONYMS_REGEX for consistent synonym matching
    const geoPatterns = [
      /\bwhere\s+(did|were|are|was)\b/i, // "where did attacks occur"
      /\b(locations?|places?)\s+(of|for)\b/i, // "locations of attacks"
      /\b(across|throughout|in)\s+\w+\s+region/i, // "across the region"
      new RegExp(
        `\\bplot\\s+(the|these|all)?\\s*(${ATTACK_SYNONYMS_REGEX})\\b`,
        "i"
      ), // "plot the attacks/mishaps/incidents"
      /\bshow\s+(me\s+)?(on|the)\s*map\b/i, // "show on map"
    ];

    const matchesPattern = geoPatterns.some((pattern) => pattern.test(query));

    if (matchesPattern) {
      console.log(
        `[Geo Detection] Query pattern implies geo data: "${query.substring(0, 50)}..."`
      );
      return true;
    }

    return false;
  }

  // Detect if this is a follow-up query that references previous results
  isFollowUpQuery(query) {
    const lowerQuery = query.toLowerCase().trim();

    // Build dynamic patterns using ATTACK_SYNONYMS_REGEX for consistent synonym matching
    const followUpPatterns = [
      // Reference patterns - using full attack synonyms
      new RegExp(
        `\\b(the|these|those|some|any|one of the|few of the)\\s+(${ATTACK_SYNONYMS_REGEX}|records?)\\b`,
        "i"
      ),
      /\bgive\s+(me\s+)?(details?|info|information)\s+(about|of|on)\s+(the|them|some|those|these)\b/i,
      /\blist\s+(\d+|one|some|a few|few)\s*(of\s+)?(the|them)?\b/i,
      new RegExp(
        `\\bshow\\s+(me\\s+)?(\\d+|one|some|a few)\\s*(of\\s+)?(the|them|${ATTACK_SYNONYMS_REGEX})?\\b`,
        "i"
      ),
      /\bdetails?\s+(of|about|for)\s+(some|the|these|those|them)\b/i,
      new RegExp(
        `\\b(more|another|other)\\s+(details?|${ATTACK_SYNONYMS_REGEX}|examples?)\\b`,
        "i"
      ),
      /\btell\s+(me\s+)?(about|more)\s+(them|the|some)\b/i,
      new RegExp(
        `\\bwhat\\s+(about|are)\\s+(the|these|those)\\s+(${ATTACK_SYNONYMS_REGEX}|details?)\\b`,
        "i"
      ),
      // Simple patterns
      /^list\s+\d+\b/i,
      /^show\s+\d+\b/i,
      /^give\s+\d+\b/i,
      new RegExp(
        `\\blist\\s+(one|1|an?)\\s+(${ATTACK_SYNONYMS_REGEX}|of)\\b`,
        "i"
      ),
      new RegExp(
        `\\bshow\\s+(one|1|an?)\\s+(${ATTACK_SYNONYMS_REGEX}|of)\\b`,
        "i"
      ),
    ];

    const isFollowUp = followUpPatterns.some((pattern) =>
      pattern.test(lowerQuery)
    );

    if (isFollowUp) {
      console.log(`[Context Tracker] Detected follow-up query: "${query}"`);
    }

    return isFollowUp;
  }

  // Helper to escape regex special characters
  escapeRegex(str) {
    if (!str || typeof str !== "string") return str;
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Helper to build MongoDB filter from conditions
  buildMongoDBFilter(conditions) {
    const filter = {};

    console.log(
      `[Filter Builder] Building filter from conditions:`,
      JSON.stringify(conditions, null, 2)
    );

    // Standard field filters - ALL use exact match with proper escaping and trimming
    if (conditions.country_txt) {
      if (Array.isArray(conditions.country_txt)) {
        // Multi-country OR query — produce { $in: [ /^regex$/i, ... ] }
        const regexes = conditions.country_txt.map((c) => {
          const escaped = this.escapeRegex(String(c).trim());
          return new RegExp(`^\\s*${escaped}\\s*$`, "i");
        });
        filter.country_txt = { $in: regexes };
        console.log(
          `[Filter Builder] Multi-country $in filter: ${conditions.country_txt.join(", ")}`
        );
      } else {
        const trimmed = String(conditions.country_txt).trim();
        const escaped = this.escapeRegex(trimmed);
        filter.country_txt = { $regex: `^\\s*${escaped}\\s*$`, $options: "i" };
        console.log(
          `[Filter Builder] Country filter: ^\\s*${escaped}\\s*$ (allows whitespace)`
        );
      }
    }
    if (conditions.city) {
      const trimmed = String(conditions.city).trim();
      const escaped = this.escapeRegex(trimmed);
      // Use exact match but allow optional whitespace (database might have trailing spaces)
      filter.city = { $regex: `^\\s*${escaped}\\s*$`, $options: "i" };
      console.log(
        `[Filter Builder] City filter: ^\\s*${escaped}\\s*$ (allows whitespace)`
      );
    }
    if (conditions.gname) {
      // CRITICAL FIX: Use exact match with anchors, proper escaping, and whitespace handling
      const trimmed = String(conditions.gname).trim();
      const escaped = this.escapeRegex(trimmed);
      // Use exact match but allow optional whitespace (database might have trailing spaces)
      filter.gname = { $regex: `^\\s*${escaped}\\s*$`, $options: "i" };
      console.log(
        `[Filter Builder] Group filter: ^\\s*${escaped}\\s*$ (EXACT MATCH, allows whitespace)`
      );
    }
    if (conditions.attacktype1_txt) {
      const escaped = this.escapeRegex(conditions.attacktype1_txt);
      filter.attacktype1_txt = { $regex: `^${escaped}$`, $options: "i" };
      console.log(`[Filter Builder] Attack type filter: ^${escaped}$`);
    }
    if (conditions.targtype1_txt) {
      const escaped = this.escapeRegex(conditions.targtype1_txt);
      filter.targtype1_txt = { $regex: `^${escaped}$`, $options: "i" };
      console.log(`[Filter Builder] Target type filter: ^${escaped}$`);
    }
    if (conditions.weaptype1_txt) {
      const escaped = this.escapeRegex(conditions.weaptype1_txt);
      filter.weaptype1_txt = { $regex: `^${escaped}$`, $options: "i" };
      console.log(`[Filter Builder] Weapon type filter: ^${escaped}$`);
    }
    if (conditions.region_txt) {
      const escaped = this.escapeRegex(conditions.region_txt);
      filter.region_txt = { $regex: `^${escaped}$`, $options: "i" };
      console.log(`[Filter Builder] Region filter: ^${escaped}$`);
    }
    // PROVINCE/STATE FILTER - Handle provstate field (e.g., "Punjab", "Sindh")
    if (conditions.provstate) {
      if (Array.isArray(conditions.provstate)) {
        // Handle multiple provinces (aliases like Khyber Pakhtunkhwa / North-West Frontier Province)
        const regexValues = conditions.provstate.map((p) => {
          const escaped = this.escapeRegex(String(p).trim());
          return new RegExp(`^\\s*${escaped}\\s*$`, "i");
        });
        filter.provstate = { $in: regexValues };
        console.log(
          `[Filter Builder] Province/State filter (MULTI): Matches any of ${JSON.stringify(conditions.provstate)}`
        );
      } else {
        const trimmed = String(conditions.provstate).trim();
        const escaped = this.escapeRegex(trimmed);
        filter.provstate = { $regex: `^\\s*${escaped}\\s*$`, $options: "i" };
        console.log(
          `[Filter Builder] Province/State filter: ^\\s*${escaped}\\s*$ (allows whitespace)`
        );
      }
    }
    if (conditions.success !== undefined) {
      filter.success = conditions.success;
    }
    if (conditions.suicide !== undefined) {
      filter.suicide = conditions.suicide;
    }

    // Date range handling - CRITICAL FIX: iyear is stored as STRING in GTD database
    // Must use $expr with $toInt for proper numeric comparison
    if (conditions._yearRange) {
      const startYear = parseInt(conditions._yearRange.start);
      const endYear = parseInt(conditions._yearRange.end);

      // Use $expr with $toInt for proper numeric comparison on string field
      filter.$expr = {
        $and: [
          { $gte: [safeToInt("$iyear"), startYear] },
          { $lte: [safeToInt("$iyear"), endYear] },
        ],
      };
      console.log(
        `[Filter Builder] Year range filter using $expr: ${startYear} to ${endYear}`
      );
    } else if (conditions.iyear) {
      // Single year - can use direct string match
      filter.iyear = conditions.iyear.toString();
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // MONTH FILTER - imonth is stored as STRING in GTD (1-12, no leading zeros)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (conditions.imonth !== undefined && conditions.imonth !== null) {
      // Normalize to string without leading zeros (GTD stores as "1", "2", ... "12")
      const monthNum = parseInt(conditions.imonth);
      if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
        filter.imonth = monthNum.toString();
        console.log(
          `[Filter Builder] Month filter: imonth = "${filter.imonth}"`
        );
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // DAY FILTER - iday is stored as STRING in GTD (1-31, no leading zeros)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (conditions.iday !== undefined && conditions.iday !== null) {
      // Normalize to string without leading zeros (GTD stores as "1", "2", ... "31")
      const dayNum = parseInt(conditions.iday);
      if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
        filter.iday = dayNum.toString();
        console.log(`[Filter Builder] Day filter: iday = "${filter.iday}"`);
      }
    }

    // Casualty range handling - nkill/nwound are also stored as strings
    // Use $expr for proper numeric comparison
    if (conditions._minKilled !== undefined) {
      const minKill = parseInt(conditions._minKilled);
      // If we already have $expr.$and, add to it; otherwise create it
      if (filter.$expr && filter.$expr.$and) {
        filter.$expr.$and.push({ $gte: [safeToInt("$nkill"), minKill] });
      } else if (filter.$expr) {
        // $expr exists but not as $and - wrap it
        filter.$expr = {
          $and: [filter.$expr, { $gte: [safeToInt("$nkill"), minKill] }],
        };
      } else {
        filter.$expr = { $gte: [safeToInt("$nkill"), minKill] };
      }
      console.log(
        `[Filter Builder] Min killed filter using $expr: >= ${minKill}`
      );
    }
    if (conditions._minWounded !== undefined) {
      const minWound = parseInt(conditions._minWounded);
      if (filter.$expr && filter.$expr.$and) {
        filter.$expr.$and.push({ $gte: [safeToInt("$nwound"), minWound] });
      } else if (filter.$expr) {
        filter.$expr = {
          $and: [filter.$expr, { $gte: [safeToInt("$nwound"), minWound] }],
        };
      } else {
        filter.$expr = { $gte: [safeToInt("$nwound"), minWound] };
      }
      console.log(
        `[Filter Builder] Min wounded filter using $expr: >= ${minWound}`
      );
    }

    return filter;
  }

  /**
   * Normalize a filter generated by LLM to handle GTD's string-typed numeric fields
   * This converts simple $gte/$lte operators on iyear/nkill/nwound to proper $expr with $toInt
   * Also handles year_start/year_end format from simplified LLM output
   *
   * @param {Object} filter - Raw MongoDB filter (possibly from LLM)
   * @returns {Object} - Normalized filter safe for GTD string fields
   */
  normalizeGTDFilter(filter) {
    if (!filter || typeof filter !== "object") {
      return filter;
    }

    const normalized = { ...filter };
    const exprConditions = [];

    // Helper to escape regex special chars
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Handle country_txt - LLM might send it as simple string
    if (normalized.country_txt && typeof normalized.country_txt === "string") {
      const escapedCountry = escapeRegex(normalized.country_txt.trim());
      normalized.country_txt = {
        $regex: `^\\s*${escapedCountry}\\s*$`,
        $options: "i",
      };
      console.log(
        `[Filter Normalizer] Converted country_txt string to regex: ^\\s*${escapedCountry}\\s*$`
      );
    }

    // Handle city - LLM might send it as simple string
    if (normalized.city && typeof normalized.city === "string") {
      const escapedCity = escapeRegex(normalized.city.trim());
      normalized.city = { $regex: `^\\s*${escapedCity}\\s*$`, $options: "i" };
      console.log(
        `[Filter Normalizer] Converted city string to regex: ^\\s*${escapedCity}\\s*$`
      );
    }

    // Handle provstate field - LLM might send it as simple string or object
    // Apply province spelling corrections for common variations
    if (normalized.provstate) {
      const handleSingleProvince = (name) => {
        let provinceName = name.trim();
        const lowerProvince = provinceName.toLowerCase();

        // Province spelling corrections — uses centralized PROVINCE_CORRECTIONS constant
        if (PROVINCE_CORRECTIONS[lowerProvince]) {
          provinceName = PROVINCE_CORRECTIONS[lowerProvince];
        }

        // Return components for an OR query if aliases exist — uses centralized PROVINCE_ALIASES
        return PROVINCE_ALIASES[provinceName]
          ? [provinceName, ...PROVINCE_ALIASES[provinceName]]
          : [provinceName];
      };

      if (Array.isArray(normalized.provstate)) {
        const allNames = new Set();
        normalized.provstate.forEach((p) => {
          handleSingleProvince(p).forEach((name) => allNames.add(name));
        });
        const names = Array.from(allNames);
        normalized.provstate = {
          $in: names.map((p) => new RegExp(`^\\s*${escapeRegex(p)}\\s*$`, "i")),
        };
      } else if (typeof normalized.provstate === "string") {
        const names = handleSingleProvince(normalized.provstate);
        if (names.length > 1) {
          normalized.provstate = {
            $in: names.map(
              (p) => new RegExp(`^\\s*${escapeRegex(p)}\\s*$`, "i")
            ),
          };
        } else {
          normalized.provstate = {
            $regex: `^\\s*${escapeRegex(names[0])}\\s*$`,
            $options: "i",
          };
        }
      }
      console.log(
        `[Filter Normalizer] Normalized provstate to:`,
        normalized.provstate
      );
    }

    // Handle year_start/year_end format (simplified format for LLM)
    if (
      normalized.year_start !== undefined ||
      normalized.year_end !== undefined
    ) {
      if (normalized.year_start !== undefined) {
        exprConditions.push({
          $gte: [safeToInt("$iyear"), parseInt(normalized.year_start)],
        });
        delete normalized.year_start;
      }
      if (normalized.year_end !== undefined) {
        exprConditions.push({
          $lte: [safeToInt("$iyear"), parseInt(normalized.year_end)],
        });
        delete normalized.year_end;
      }
      console.log(`[Filter Normalizer] Converted year_start/year_end to $expr`);
    }

    // Handle iyear - stored as STRING in GTD
    if (normalized.iyear) {
      if (typeof normalized.iyear === "object") {
        // Has operators like $gte, $lte, $gt, $lt
        const iyear = normalized.iyear;

        if (iyear.$gte !== undefined) {
          exprConditions.push({
            $gte: [safeToInt("$iyear"), parseInt(iyear.$gte)],
          });
        }
        if (iyear.$lte !== undefined) {
          exprConditions.push({
            $lte: [safeToInt("$iyear"), parseInt(iyear.$lte)],
          });
        }
        if (iyear.$gt !== undefined) {
          exprConditions.push({
            $gt: [safeToInt("$iyear"), parseInt(iyear.$gt)],
          });
        }
        if (iyear.$lt !== undefined) {
          exprConditions.push({
            $lt: [safeToInt("$iyear"), parseInt(iyear.$lt)],
          });
        }
        if (iyear.$eq !== undefined) {
          // For equality, string match is fine
          normalized.iyear = iyear.$eq.toString();
        } else {
          // Remove iyear since we're using $expr
          delete normalized.iyear;
        }
      } else if (typeof normalized.iyear === "number") {
        // Convert number to string for exact match
        normalized.iyear = normalized.iyear.toString();
      }
      // String iyear is fine as-is
    }

    // Handle imonth - stored as STRING in GTD (1-12)
    if (normalized.imonth !== undefined) {
      if (typeof normalized.imonth === "number") {
        normalized.imonth = normalized.imonth.toString();
      } else if (typeof normalized.imonth === "string") {
        // Ensure it's a valid month number string (remove leading zeros if any)
        const monthNum = parseInt(normalized.imonth);
        if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
          normalized.imonth = monthNum.toString();
        } else {
          console.log(
            `[Filter Normalizer] Invalid imonth value: ${normalized.imonth}, removing`
          );
          delete normalized.imonth;
        }
      }
      console.log(
        `[Filter Normalizer] Normalized imonth to: ${normalized.imonth}`
      );
    }

    // Handle iday - stored as STRING in GTD (1-31)
    if (normalized.iday !== undefined) {
      if (typeof normalized.iday === "number") {
        normalized.iday = normalized.iday.toString();
      } else if (typeof normalized.iday === "string") {
        // Ensure it's a valid day number string (remove leading zeros if any)
        const dayNum = parseInt(normalized.iday);
        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
          normalized.iday = dayNum.toString();
        } else {
          console.log(
            `[Filter Normalizer] Invalid iday value: ${normalized.iday}, removing`
          );
          delete normalized.iday;
        }
      }
      console.log(`[Filter Normalizer] Normalized iday to: ${normalized.iday}`);
    }

    // Handle nkill - stored as STRING in GTD
    if (normalized.nkill && typeof normalized.nkill === "object") {
      const nkill = normalized.nkill;
      if (nkill.$gte !== undefined) {
        exprConditions.push({
          $gte: [safeToInt("$nkill"), parseInt(nkill.$gte)],
        });
      }
      if (nkill.$lte !== undefined) {
        exprConditions.push({
          $lte: [safeToInt("$nkill"), parseInt(nkill.$lte)],
        });
      }
      if (nkill.$gt !== undefined) {
        exprConditions.push({
          $gt: [safeToInt("$nkill"), parseInt(nkill.$gt)],
        });
      }
      delete normalized.nkill;
    }

    // Handle nwound - stored as STRING in GTD
    if (normalized.nwound && typeof normalized.nwound === "object") {
      const nwound = normalized.nwound;
      if (nwound.$gte !== undefined) {
        exprConditions.push({
          $gte: [safeToInt("$nwound"), parseInt(nwound.$gte)],
        });
      }
      if (nwound.$lte !== undefined) {
        exprConditions.push({
          $lte: [safeToInt("$nwound"), parseInt(nwound.$lte)],
        });
      }
      delete normalized.nwound;
    }

    // Build $expr if we have conditions
    if (exprConditions.length > 0) {
      if (normalized.$expr) {
        // Merge with existing $expr
        if (normalized.$expr.$and) {
          normalized.$expr.$and.push(...exprConditions);
        } else {
          exprConditions.unshift(normalized.$expr);
          normalized.$expr = { $and: exprConditions };
        }
      } else if (exprConditions.length === 1) {
        normalized.$expr = exprConditions[0];
      } else {
        normalized.$expr = { $and: exprConditions };
      }
    }

    // Handle suicide field - LLM might send "Suicide" regex on attacktype1_txt
    // but correct field is suicide: "1"
    if (normalized.attacktype1_txt) {
      const attackType = normalized.attacktype1_txt;
      if (typeof attackType === "object" && attackType.$regex) {
        const regexStr = attackType.$regex.toLowerCase();
        if (regexStr.includes("suicide")) {
          // Convert to proper suicide field
          normalized.suicide = "1";
          delete normalized.attacktype1_txt;
          console.log(
            `[Filter Normalizer] Converted attacktype1_txt suicide regex to suicide: "1"`
          );
        }
      } else if (
        typeof attackType === "string" &&
        attackType.toLowerCase().includes("suicide")
      ) {
        normalized.suicide = "1";
        delete normalized.attacktype1_txt;
        console.log(
          `[Filter Normalizer] Converted attacktype1_txt suicide string to suicide: "1"`
        );
      }
    }

    console.log(
      `[Filter Normalizer] Normalized filter:`,
      JSON.stringify(normalized, null, 2)
    );
    return normalized;
  }

  /**
   * Generate a MongoDB Compass-friendly filter string
   * This creates a filter with proper $expr syntax that can be directly pasted into MongoDB Compass
   *
   * @param {Object} filter - Raw filter from LLM
   * @returns {string} - JSON string ready for MongoDB Compass
   */
  toCompassFilter(filter) {
    if (!filter || typeof filter !== "object") {
      return "{}";
    }

    const compassFilter = {};
    const exprConditions = [];

    for (const [key, value] of Object.entries(filter)) {
      // Skip undefined, null, or empty values
      if (value === undefined || value === null || value === "") {
        continue;
      }

      if (key === "iyear") {
        if (typeof value === "object" && value !== null) {
          // Use $expr with $toInt for year ranges - this is what actually works in Compass
          if (value.$gte !== undefined) {
            exprConditions.push({
              $gte: [safeToInt("$iyear"), parseInt(value.$gte)],
            });
          }
          if (value.$lte !== undefined) {
            exprConditions.push({
              $lte: [safeToInt("$iyear"), parseInt(value.$lte)],
            });
          }
          if (value.$gt !== undefined) {
            exprConditions.push({
              $gt: [safeToInt("$iyear"), parseInt(value.$gt)],
            });
          }
          if (value.$lt !== undefined) {
            exprConditions.push({
              $lt: [safeToInt("$iyear"), parseInt(value.$lt)],
            });
          }
          if (value.$eq !== undefined) {
            // For equality, string match works
            compassFilter.iyear = value.$eq.toString();
          }
        } else if (value) {
          // Single year - string match works
          compassFilter.iyear = value.toString();
        }
      } else if (key === "year_start") {
        // Handle simplified year_start format
        exprConditions.push({ $gte: [safeToInt("$iyear"), parseInt(value)] });
      } else if (key === "year_end") {
        // Handle simplified year_end format
        exprConditions.push({ $lte: [safeToInt("$iyear"), parseInt(value)] });
      } else if (key === "nkill" && typeof value === "object") {
        // Use $expr for nkill ranges
        if (value.$gte !== undefined) {
          exprConditions.push({
            $gte: [safeToInt("$nkill"), parseInt(value.$gte)],
          });
        }
        if (value.$lte !== undefined) {
          exprConditions.push({
            $lte: [safeToInt("$nkill"), parseInt(value.$lte)],
          });
        }
      } else if (key === "nwound" && typeof value === "object") {
        // Use $expr for nwound ranges
        if (value.$gte !== undefined) {
          exprConditions.push({
            $gte: [safeToInt("$nwound"), parseInt(value.$gte)],
          });
        }
        if (value.$lte !== undefined) {
          exprConditions.push({
            $lte: [safeToInt("$nwound"), parseInt(value.$lte)],
          });
        }
      } else {
        compassFilter[key] = value;
      }
    }

    // Add $expr if we have conditions
    if (exprConditions.length > 0) {
      if (exprConditions.length === 1) {
        compassFilter.$expr = exprConditions[0];
      } else {
        compassFilter.$expr = { $and: exprConditions };
      }
    }

    return JSON.stringify(compassFilter, null, 2);
  }

  // Helper to clean MongoDB fields
  cleanMongoDBFields(attack) {
    const cleaned = { ...attack };

    // Handle NaN objects
    if (cleaned.summary && typeof cleaned.summary === "object") {
      if (cleaned.summary.$numberDouble === "NaN") {
        cleaned.summary = null;
      }
    }
    if (cleaned.motive && typeof cleaned.motive === "object") {
      if (cleaned.motive.$numberDouble === "NaN") {
        cleaned.motive = null;
      }
    }

    // Convert string numbers to integers
    cleaned.nkill = parseInt(cleaned.nkill) || 0;
    cleaned.nwound = parseInt(cleaned.nwound) || 0;

    // Handle latitude/longitude as numbers
    cleaned.latitude = parseFloat(cleaned.latitude) || null;
    cleaned.longitude = parseFloat(cleaned.longitude) || null;

    // Format date
    cleaned.formattedDate = this.formatDate(
      cleaned.iyear,
      cleaned.imonth,
      cleaned.iday
    );

    return cleaned;
  }

  formatDate(year, month, day) {
    if (month === "0" || month === "00") month = "Unknown";
    if (day === "0" || day === "00") day = "Unknown";
    return `${month}/${day}/${year}`;
  }

  // Fuzzy string matching for city names (handles typos) - IMPROVED
  fuzzyMatch(str1, str2) {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    // Exact match
    if (s1 === s2) return true;

    // Check if one contains the other (for partial matches)
    // BUT: gate with a minimum length ratio to prevent false positives
    // e.g. "punjab" (6) should NOT match "goth ghulam haider punjabi" (26) â†’ ratio 0.23
    // but "peshwar" (7) SHOULD match "peshawar" (8) â†’ ratio 0.875
    const shorter = Math.min(s1.length, s2.length);
    const longer = Math.max(s1.length, s2.length);
    if ((s1.includes(s2) || s2.includes(s1)) && shorter / longer >= 0.6)
      return true;

    // Improved Levenshtein-like distance calculation
    // Handle character insertions/deletions (e.g., "peshwar" vs "peshawar")
    if (Math.abs(s1.length - s2.length) <= 2) {
      // Calculate similarity using a simple edit distance approach
      const maxLen = Math.max(s1.length, s2.length);
      const minLen = Math.min(s1.length, s2.length);

      // If lengths are very different, unlikely to be a match
      if (maxLen - minLen > 2) return false;

      // Count matching characters (allowing for insertions/deletions)
      let matches = 0;
      let i = 0,
        j = 0;

      while (i < s1.length && j < s2.length) {
        if (s1[i] === s2[j]) {
          matches++;
          i++;
          j++;
        } else if (i + 1 < s1.length && s1[i + 1] === s2[j]) {
          // Character inserted in s1 (skip it)
          i++;
        } else if (j + 1 < s2.length && s1[i] === s2[j + 1]) {
          // Character inserted in s2 (skip it)
          j++;
        } else {
          i++;
          j++;
        }
      }

      // If 75% or more characters match, consider it a match
      const similarity = matches / maxLen;
      if (similarity >= 0.75) {
        console.log(
          `[Fuzzy Match] "${str1}" matches "${str2}" with ${(similarity * 100).toFixed(1)}% similarity`
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Fuzzy match a province name against known corrections
   * @param {string} inputProvince - Lowercase province name to match
   * @param {Object} corrections - Map of misspellings to correct values
   * @returns {string|null} - Corrected province name or null
   */
  fuzzyMatchProvince(inputProvince, corrections) {
    // Calculate Levenshtein distance
    const levenshtein = (a, b) => {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;

      const matrix = [];
      for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
      }
      for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
      }

      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1];
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1, // substitution
              matrix[i][j - 1] + 1, // insertion
              matrix[i - 1][j] + 1 // deletion
            );
          }
        }
      }
      return matrix[b.length][a.length];
    };

    let bestMatch = null;
    let bestDistance = Infinity;
    const threshold = 3; // Allow up to 3 character edits

    for (const [misspelling, correctValue] of Object.entries(corrections)) {
      const distance = levenshtein(inputProvince, misspelling);
      if (distance < bestDistance && distance <= threshold) {
        bestDistance = distance;
        bestMatch = correctValue;
      }
    }

    // Also check against correct values directly (in case input is close to correct)
    const uniqueCorrectValues = [...new Set(Object.values(corrections))];
    for (const correctValue of uniqueCorrectValues) {
      const distance = levenshtein(inputProvince, correctValue.toLowerCase());
      if (distance < bestDistance && distance <= threshold) {
        bestDistance = distance;
        bestMatch = correctValue;
      }
    }

    if (bestMatch) {
      console.log(
        `[Province Fuzzy] Best match for "${inputProvince}": "${bestMatch}" (distance: ${bestDistance})`
      );
    }

    return bestMatch;
  }

  // Verify and get EXACT city value from database (case-sensitive, exact match)
  async verifyAndGetExactCityValue(cityName, country = null) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      if (!db || mongoose.connection.readyState !== 1) {
        return null;
      }

      const attacksCollection = db.collection("attacks");
      const normalizedCityName = cityName.toLowerCase().trim();
      const escapedCityName = normalizedCityName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      // FIX: Use $nin to combine null and empty string checks (duplicate $ne keys don't work)
      const baseQuery = {
        city: { $nin: [null, ""] },
      };
      if (country) {
        baseQuery.country_txt = {
          $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        };
      }

      // Try exact match first (case-insensitive)
      // FIX: Use $and to combine regex with base query instead of spreading (which overwrites city field)
      const exactQuery = {
        $and: [
          { city: { $regex: `^${escapedCityName}$`, $options: "i" } },
          { city: { $nin: [null, ""] } },
          ...(country
            ? [
                {
                  country_txt: {
                    $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                    $options: "i",
                  },
                },
              ]
            : []),
        ],
      };

      const exactCities = await attacksCollection.distinct("city", exactQuery);
      if (exactCities && exactCities.length > 0) {
        // Return the first exact match (should be only one)
        console.log(
          `[City Verifier] Found exact match: "${cityName}" -> "${exactCities[0]}"`
        );
        return exactCities[0];
      }

      // Try fuzzy match against all cities
      const allCities = await attacksCollection.distinct("city", baseQuery);
      if (allCities && allCities.length > 0) {
        for (const dbCity of allCities) {
          // SAFETY: Ensure dbCity is a valid string before calling toLowerCase()
          if (!dbCity || typeof dbCity !== "string") continue;
          if (this.fuzzyMatch(normalizedCityName, dbCity.toLowerCase())) {
            console.log(
              `[City Verifier] Found fuzzy match: "${cityName}" -> "${dbCity}"`
            );
            return dbCity;
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`[City Verifier] Error:`, error.message);
      return null;
    }
  }

  // Verify and get EXACT province/state value from database
  async verifyAndGetExactProvinceValue(provinceName, country = null) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      if (!db || mongoose.connection.readyState !== 1) {
        return null;
      }

      const attacksCollection = db.collection("attacks");
      const normalizedProvinceName = provinceName.toLowerCase().trim();
      const escapedProvinceName = normalizedProvinceName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      // Build base query
      const baseQuery = {
        provstate: { $nin: [null, ""] },
      };
      if (country) {
        baseQuery.country_txt = {
          $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        };
      }

      // Try exact match first (case-insensitive)
      const exactQuery = {
        $and: [
          { provstate: { $regex: `^${escapedProvinceName}$`, $options: "i" } },
          { provstate: { $nin: [null, ""] } },
          ...(country
            ? [
                {
                  country_txt: {
                    $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                    $options: "i",
                  },
                },
              ]
            : []),
        ],
      };

      const exactProvinces = await attacksCollection.distinct(
        "provstate",
        exactQuery
      );
      if (exactProvinces && exactProvinces.length > 0) {
        console.log(
          `[Province Verifier] Found exact match: "${provinceName}" -> "${exactProvinces[0]}"`
        );

        // Get attack count for this province
        const countQuery = { ...baseQuery };
        countQuery.provstate = {
          $regex: `^\\s*${exactProvinces[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
          $options: "i",
        };
        const count = await attacksCollection.countDocuments(countQuery);
        console.log(
          `[Province Verifier] Province "${exactProvinces[0]}" has ${count} attacks`
        );

        return exactProvinces[0];
      }

      // Try fuzzy match against all provinces
      const allProvinces = await attacksCollection.distinct(
        "provstate",
        baseQuery
      );
      if (allProvinces && allProvinces.length > 0) {
        for (const dbProvince of allProvinces) {
          if (!dbProvince || typeof dbProvince !== "string") continue;
          if (
            this.fuzzyMatch(normalizedProvinceName, dbProvince.toLowerCase())
          ) {
            console.log(
              `[Province Verifier] Found fuzzy match: "${provinceName}" -> "${dbProvince}"`
            );
            return dbProvince;
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`[Province Verifier] Error:`, error.message);
      return null;
    }
  }

  // Verify and get EXACT group value from database (case-sensitive, exact match)
  async verifyAndGetExactGroupValue(groupName) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      if (!db || mongoose.connection.readyState !== 1) {
        return null;
      }

      const attacksCollection = db.collection("attacks");
      const normalizedGroupName = groupName.toLowerCase().trim();
      const escapedGroupName = normalizedGroupName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      // CRITICAL: Direct test first - query with exact search term
      // FIX: Use $and to combine multiple conditions on the same field (duplicate keys overwrite in JS objects)
      const directTestQuery = {
        $and: [
          { gname: { $regex: `^${escapedGroupName}$`, $options: "i" } },
          { gname: { $ne: null } },
          { gname: { $ne: "" } },
        ],
      };

      const directCount =
        await attacksCollection.countDocuments(directTestQuery);
      const directGroups = await attacksCollection.distinct(
        "gname",
        directTestQuery
      );

      console.log(
        `[Group Verifier] Direct test: "${groupName}" -> ${directCount} attacks, groups:`,
        directGroups
      );

      if (directGroups && directGroups.length > 0) {
        // Find exact match (case-insensitive)
        const exactGroup =
          directGroups.find(
            (g) => g.toLowerCase().trim() === normalizedGroupName
          ) || directGroups[0];
        const exactCount = await attacksCollection.countDocuments({
          gname: {
            $regex: `^${exactGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            $options: "i",
          },
        });
        console.log(
          `[Group Verifier] âœ… Using direct match: "${exactGroup}" with ${exactCount} attacks`
        );
        return exactGroup;
      }

      // Try exact match first (case-insensitive)
      // FIX: Use $and to combine multiple conditions on the same field
      const exactQuery = {
        $and: [
          { gname: { $regex: `^${escapedGroupName}$`, $options: "i" } },
          { gname: { $ne: null } },
          { gname: { $ne: "" } },
        ],
      };

      const exactGroups = await attacksCollection.distinct("gname", exactQuery);
      if (exactGroups && exactGroups.length > 0) {
        // Return the first exact match
        console.log(
          `[Group Verifier] Found exact match: "${groupName}" -> "${exactGroups[0]}"`
        );
        return exactGroups[0];
      }

      // Try phrase match
      // FIX: Use $and to combine multiple conditions on the same field
      const phraseQuery = {
        $and: [
          { gname: { $regex: escapedGroupName, $options: "i" } },
          { gname: { $ne: null } },
          { gname: { $ne: "" } },
        ],
      };

      const phraseGroups = await attacksCollection.distinct(
        "gname",
        phraseQuery
      );
      if (phraseGroups && phraseGroups.length > 0) {
        // Find exact phrase match (case-insensitive)
        const exactPhrase = phraseGroups.find(
          (g) => g.toLowerCase().trim() === normalizedGroupName
        );
        if (exactPhrase) {
          console.log(
            `[Group Verifier] Found exact phrase match: "${groupName}" -> "${exactPhrase}"`
          );
          return exactPhrase;
        }

        // Return first phrase match
        console.log(
          `[Group Verifier] Found phrase match: "${groupName}" -> "${phraseGroups[0]}"`
        );
        return phraseGroups[0];
      }

      return null;
    } catch (error) {
      console.error(`[Group Verifier] Error:`, error.message);
      return null;
    }
  }

  // Lookup city in database
  async lookupCityInDatabase(cityName, country = null) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      if (!db || mongoose.connection.readyState !== 1) {
        console.log(
          `[Query Parser] MongoDB not connected, skipping city lookup`
        );
        return null;
      }

      const attacksCollection = db.collection("attacks");

      const normalizedCityName = cityName.toLowerCase().trim();
      const escapedCityName = normalizedCityName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      console.log(
        `[Query Parser] Looking up city: "${cityName}" (normalized: "${normalizedCityName}")${country ? ` in country: ${country}` : ""}`
      );

      // Build base query
      // FIX: Use $nin to combine null and empty string checks
      const baseQuery = {
        city: { $nin: [null, ""] },
      };
      if (country) {
        baseQuery.country_txt = {
          $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        };
      }

      // First try exact match (case-insensitive)
      // FIX: Use $and to properly combine conditions
      const exactQuery = {
        $and: [
          { city: { $regex: `^${escapedCityName}$`, $options: "i" } },
          { city: { $nin: [null, ""] } },
          ...(country
            ? [
                {
                  country_txt: {
                    $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                    $options: "i",
                  },
                },
              ]
            : []),
        ],
      };

      let cities = await attacksCollection.distinct("city", exactQuery);

      if (cities && cities.length > 0) {
        const count = await attacksCollection.countDocuments(exactQuery);
        console.log(
          `[Query Parser] âœ… Found exact city match: "${cityName}" -> "${cities[0]}" (${count} attacks)`
        );
        return cities[0];
      }

      // Try fuzzy match - get all cities in the country (or all cities if no country)
      // FIX: Use $nin instead of duplicate $ne keys
      const allCitiesQuery = country
        ? baseQuery
        : { city: { $nin: [null, ""] } };
      const allCities = await attacksCollection.distinct(
        "city",
        allCitiesQuery
      );

      if (allCities && allCities.length > 0) {
        // Try fuzzy matching with all cities
        for (const dbCity of allCities) {
          // SAFETY: Ensure dbCity is a valid string before calling toLowerCase()
          if (!dbCity || typeof dbCity !== "string") continue;
          if (this.fuzzyMatch(normalizedCityName, dbCity.toLowerCase())) {
            // Verify this city exists with the count
            // FIX: Use $and to combine conditions instead of spread (which overwrites city field)
            const verifyQueryParts = [
              {
                city: {
                  $regex: `^${dbCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                  $options: "i",
                },
              },
              { city: { $nin: [null, ""] } },
            ];
            if (country) {
              verifyQueryParts.push({
                country_txt: {
                  $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                  $options: "i",
                },
              });
            }
            const verifyQuery = { $and: verifyQueryParts };
            const count = await attacksCollection.countDocuments(verifyQuery);
            console.log(
              `[Query Parser] âœ… Found city via fuzzy match: "${cityName}" -> "${dbCity}" (${count} attacks)`
            );
            return dbCity;
          }
        }

        // If no fuzzy match, try partial match (contains)
        // Gate with minimum length ratio (0.6) to prevent false positives
        // e.g. "punjab" (6) should NOT match "goth ghulam haider punjabi" (26)
        const partialMatch = allCities.find((c) => {
          // SAFETY: Ensure c is a valid string before calling toLowerCase()
          if (!c || typeof c !== "string") return false;
          const cLower = c.toLowerCase();
          const pShorter = Math.min(cLower.length, normalizedCityName.length);
          const pLonger = Math.max(cLower.length, normalizedCityName.length);
          if (pLonger === 0) return false;
          if (pShorter / pLonger < 0.6) return false;
          return (
            cLower.includes(normalizedCityName) ||
            normalizedCityName.includes(cLower)
          );
        });

        if (partialMatch) {
          // FIX: Use $and to combine conditions instead of spread
          const verifyQueryParts = [
            {
              city: {
                $regex: `^${partialMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                $options: "i",
              },
            },
            { city: { $nin: [null, ""] } },
          ];
          if (country) {
            verifyQueryParts.push({
              country_txt: {
                $regex: `^${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                $options: "i",
              },
            });
          }
          const verifyQuery = { $and: verifyQueryParts };
          const count = await attacksCollection.countDocuments(verifyQuery);
          console.log(
            `[Query Parser] Found city via partial match: "${cityName}" -> "${partialMatch}" (${count} attacks)`
          );
          return partialMatch;
        }
      }

      console.log(
        `[Query Parser] âŒ City "${cityName}" not found in database${country ? ` for country ${country}` : ""}`
      );
      return null;
    } catch (error) {
      console.error(`[Query Parser] Error looking up city:`, error.message);
      return null;
    }
  }

  // Lookup group in database using keyword search
  async lookupGroupInDatabase(groupKeywords) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      if (!db || mongoose.connection.readyState !== 1) {
        console.log(
          `[Query Parser] MongoDB not connected, skipping group lookup`
        );
        return null;
      }

      const attacksCollection = db.collection("attacks");

      // Clean and normalize the group keywords
      const normalizedKeywords = groupKeywords.toLowerCase().trim();
      const escapedKeywords = normalizedKeywords.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      // Block generic dimension or common category words from being looked up as groups
      const genericStopwords = [
        "group",
        "groups",
        "organization",
        "organizations",
        "faction",
        "factions",
        "militant",
        "militants",
        "terrorist",
        "terrorists",
        "party",
        "parties",
        "country",
        "countries",
        "year",
        "years",
        "type",
        "types",
        "weapon",
        "weapons",
        "target",
        "targets",
        "region",
        "regions",
        "city",
        "cities",
        "state",
        "states",
        "province",
        "provinces",
        "all",
        "any",
        "deadliest",
        "top",
        "sample",
        "list",
        "show",
      ];
      if (genericStopwords.includes(normalizedKeywords)) {
        console.log(
          `[Query Parser] ⚠️ Skipping group lookup for generic word: "${groupKeywords}"`
        );
        return null;
      }

      console.log(
        `[Query Parser] Looking up group: "${groupKeywords}" (normalized: "${normalizedKeywords}")`
      );

      // CRITICAL: First, test the exact search term directly to see what count it returns
      // FIX: Use $and to combine multiple conditions on the same field (duplicate keys overwrite in JS objects)
      const directTestQuery = {
        $and: [
          { gname: { $regex: `^${escapedKeywords}$`, $options: "i" } },
          { gname: { $ne: null } },
          { gname: { $ne: "" } },
        ],
      };

      const directCount =
        await attacksCollection.countDocuments(directTestQuery);
      console.log(
        `[Query Parser] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`
      );
      console.log(
        `[Query Parser] DIRECT TEST: Search "${groupKeywords}" returns ${directCount} attacks`
      );

      // Get the actual group name(s) that match this exact search
      const directGroups = await attacksCollection.distinct(
        "gname",
        directTestQuery
      );
      console.log(`[Query Parser] Groups matching exact search:`, directGroups);

      if (directGroups && directGroups.length > 0) {
        // Find the group that exactly matches (case-insensitive)
        const exactGroup =
          directGroups.find(
            (g) => g.toLowerCase().trim() === normalizedKeywords
          ) || directGroups[0];
        const exactGroupCount = await attacksCollection.countDocuments({
          gname: {
            $regex: `^${exactGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            $options: "i",
          },
        });
        console.log(
          `[Query Parser] âœ… Using direct match: "${exactGroup}" with ${exactGroupCount} attacks`
        );
        console.log(
          `[Query Parser] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`
        );
        return exactGroup;
      }

      // First try exact match (case-insensitive) - CRITICAL: Must be exact
      // FIX: Use $and to combine multiple conditions on the same field
      const exactMatchQuery = {
        $and: [
          { gname: { $regex: `^${escapedKeywords}$`, $options: "i" } },
          { gname: { $ne: null } },
          { gname: { $ne: "" } },
        ],
      };

      console.log(
        `[Query Parser] Exact match query:`,
        JSON.stringify(exactMatchQuery, null, 2)
      );

      const exactMatch = await attacksCollection.distinct(
        "gname",
        exactMatchQuery
      );

      if (exactMatch && exactMatch.length > 0) {
        const foundGroup = exactMatch[0];
        console.log(
          `[Query Parser] âœ… Found EXACT group match: "${groupKeywords}" -> "${foundGroup}"`
        );

        // CRITICAL: Verify the match by counting documents with EXACT value
        // FIX: Use $and to combine multiple conditions on the same field
        const verifyQuery = {
          $and: [
            {
              gname: {
                $regex: `^${foundGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                $options: "i",
              },
            },
            { gname: { $ne: null } },
            { gname: { $ne: "" } },
          ],
        };
        const count = await attacksCollection.countDocuments(verifyQuery);
        console.log(
          `[Query Parser] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`
        );
        console.log(
          `[Query Parser] VERIFICATION: Group "${foundGroup}" has ${count} attacks in database`
        );
        console.log(
          `[Query Parser] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`
        );

        // Also test with the original search term to ensure it matches
        // FIX: Use $and to combine multiple conditions on the same field
        const originalTestQuery = {
          $and: [
            { gname: { $regex: `^${escapedKeywords}$`, $options: "i" } },
            { gname: { $ne: null } },
            { gname: { $ne: "" } },
          ],
        };
        const originalCount =
          await attacksCollection.countDocuments(originalTestQuery);
        console.log(
          `[Query Parser] VERIFICATION: Original search "${groupKeywords}" matches ${originalCount} attacks`
        );

        if (count !== originalCount) {
          console.log(
            `[Query Parser] âš ï¸ WARNING: Count mismatch! Found group "${foundGroup}" has ${count} but search "${groupKeywords}" has ${originalCount}`
          );
          // If counts don't match, the found group might be wrong - try to find the right one
          if (originalCount > count) {
            // The original search term might be the correct one
            console.log(
              `[Query Parser] Using original search term as it has more matches`
            );
            // Find the actual group name that matches the original search
            const actualGroups = await attacksCollection.distinct(
              "gname",
              originalTestQuery
            );
            if (actualGroups && actualGroups.length > 0) {
              const actualGroup =
                actualGroups.find(
                  (g) => g.toLowerCase().trim() === normalizedKeywords
                ) || actualGroups[0];
              const actualCount = await attacksCollection.countDocuments({
                gname: {
                  $regex: `^${actualGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                  $options: "i",
                },
              });
              console.log(
                `[Query Parser] âœ… Using actual group: "${actualGroup}" with ${actualCount} attacks`
              );
              return actualGroup;
            }
          }
        }

        return foundGroup;
      }

      console.log(
        `[Query Parser] No exact match found, trying keyword matching...`
      );

      // Try phrase match first (group name contains the exact phrase)
      // FIX: Use $and to combine multiple conditions on the same field
      const phraseMatchQuery = {
        $and: [
          { gname: { $regex: escapedKeywords, $options: "i" } },
          { gname: { $ne: null } },
          { gname: { $ne: "" } },
        ],
      };

      const phraseMatches = await attacksCollection.distinct(
        "gname",
        phraseMatchQuery
      );

      if (phraseMatches && phraseMatches.length > 0) {
        // Find exact phrase match (highest priority)
        const exactPhrase = phraseMatches.find(
          (g) => g.toLowerCase().trim() === normalizedKeywords
        );

        if (exactPhrase) {
          const count = await attacksCollection.countDocuments({
            gname: {
              $regex: `^${exactPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              $options: "i",
            },
          });
          console.log(
            `[Query Parser] âœ… Found exact phrase match: "${groupKeywords}" -> "${exactPhrase}" (${count} attacks)`
          );
          return exactPhrase;
        }

        // If no exact phrase, use the first one that contains the phrase
        const phraseMatch =
          phraseMatches.find((g) =>
            g.toLowerCase().includes(normalizedKeywords)
          ) || phraseMatches[0];

        const count = await attacksCollection.countDocuments({
          gname: {
            $regex: `^${phraseMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            $options: "i",
          },
        });
        console.log(
          `[Query Parser] Found phrase match: "${groupKeywords}" -> "${phraseMatch}" (${count} attacks)`
        );
        return phraseMatch;
      }

      // Split keywords and search for groups containing all of them
      const keywords = normalizedKeywords
        .split(/\s+/)
        .filter((k) => k.length > 2);

      if (keywords.length === 0) {
        console.log(
          `[Query Parser] No valid keywords extracted from: "${groupKeywords}"`
        );
        return null;
      }

      console.log(
        `[Query Parser] Trying keyword matching with keywords:`,
        keywords
      );

      // Build query that requires all keywords to be present
      // Use $and to ensure all keywords are found in the group name
      const keywordQueries = keywords.map((keyword) => ({
        gname: {
          $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      }));

      // Get distinct group names matching all keywords
      // FIX: Use $nin instead of duplicate $ne keys
      const groups = await attacksCollection.distinct("gname", {
        $and: [...keywordQueries, { gname: { $nin: [null, ""] } }],
      });

      console.log(
        `[Query Parser] Found ${groups.length} groups matching all keywords`
      );

      if (groups && groups.length > 0) {
        // Find the best match (contains most keywords, or exact match)
        let bestMatch = groups[0];
        let bestScore = 0;

        for (const group of groups) {
          const groupLower = group.toLowerCase().trim();

          // Calculate score based on keyword matches
          let score = 0;
          for (const keyword of keywords) {
            if (groupLower.includes(keyword)) {
              score += keyword.length * 10; // Longer keywords get more weight
            }
          }

          // HUGE bonus for exact phrase match
          if (groupLower === normalizedKeywords) {
            score += 10000;
          } else if (groupLower.includes(normalizedKeywords)) {
            score += 5000;
          }

          // Penalty for extra words (prefer shorter, more exact matches)
          const extraWords = groupLower.split(/\s+/).length - keywords.length;
          score -= extraWords * 100;

          if (score > bestScore) {
            bestScore = score;
            bestMatch = group;
          }
        }

        // CRITICAL: Verify the best match by counting and ensure it's the right one
        const verifyQuery = {
          gname: {
            $regex: `^${bestMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            $options: "i",
          },
        };
        const count = await attacksCollection.countDocuments(verifyQuery);

        console.log(
          `[Query Parser] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`
        );
        console.log(
          `[Query Parser] VERIFICATION: Best match "${bestMatch}" has ${count} attacks`
        );

        // Also verify the original search term matches this group
        // FIX: Use $and to combine multiple gname conditions
        const originalTestQuery = {
          $and: [
            { gname: { $regex: `^${escapedKeywords}$`, $options: "i" } },
            { gname: { $nin: [null, ""] } },
          ],
        };
        const originalCount =
          await attacksCollection.countDocuments(originalTestQuery);
        console.log(
          `[Query Parser] VERIFICATION: Original search "${groupKeywords}" matches ${originalCount} attacks`
        );

        // If the original search has more matches, prioritize it
        if (originalCount > count && originalCount > 0) {
          const actualGroups = await attacksCollection.distinct(
            "gname",
            originalTestQuery
          );
          if (actualGroups && actualGroups.length > 0) {
            const actualGroup =
              actualGroups.find(
                (g) => g.toLowerCase().trim() === normalizedKeywords
              ) || actualGroups[0];
            const actualCount = await attacksCollection.countDocuments({
              gname: {
                $regex: `^${actualGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                $options: "i",
              },
            });
            console.log(
              `[Query Parser] âš ï¸ Using original search result: "${actualGroup}" with ${actualCount} attacks (better match)`
            );
            console.log(
              `[Query Parser] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`
            );
            return actualGroup;
          }
        }

        console.log(
          `[Query Parser] Using best match: "${bestMatch}" (score: ${bestScore}, count: ${count})`
        );
        console.log(
          `[Query Parser] â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`
        );
        return bestMatch;
      }

      // If no match with all keywords, try with any keyword (fallback)
      if (keywords.length > 1) {
        // FIX: Use $and to combine $or with null check (can't have duplicate gname keys)
        const anyKeywordQuery = {
          $and: [
            {
              $or: keywords.map((keyword) => ({
                gname: {
                  $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                  $options: "i",
                },
              })),
            },
            { gname: { $nin: [null, ""] } },
          ],
        };

        const fallbackGroups = await attacksCollection.distinct(
          "gname",
          anyKeywordQuery
        );

        if (fallbackGroups && fallbackGroups.length > 0) {
          // Find best match
          let bestMatch = fallbackGroups[0];
          let bestScore = 0;

          for (const group of fallbackGroups) {
            const groupLower = group.toLowerCase();
            const score = keywords.reduce((sum, keyword) => {
              return sum + (groupLower.includes(keyword) ? keyword.length : 0);
            }, 0);

            if (score > bestScore) {
              bestScore = score;
              bestMatch = group;
            }
          }

          console.log(
            `[Query Parser] Found group in database (fallback): "${groupKeywords}" -> "${bestMatch}"`
          );
          return bestMatch;
        }
      }

      return null;
    } catch (error) {
      console.error(`[Query Parser] Error looking up group:`, error.message);
      return null;
    }
  }

  /**
   * Load location keywords from database
   * This ensures we have comprehensive coverage of all countries, provinces, and groups
   */
  async loadLocationCache() {
    if (this.cacheLoaded) return;
    if (this.cacheLoadingPromise) return this.cacheLoadingPromise;

    this.cacheLoadingPromise = (async () => {
      try {
        const mongoose = require("mongoose");
        if (mongoose.connection.readyState !== 1) {
          console.log(
            "[Context Extractor] MongoDB not connected, skipping cache load"
          );
          return;
        }

        const db = mongoose.connection.db;
        const attacksCollection = db.collection("attacks");

        console.log(
          "[Context Extractor] Loading location cache from database..."
        );

        // Load distinct Countries
        const countries = await attacksCollection.distinct("country_txt");
        this.knownCountries = countries.filter(
          (c) => c && typeof c === "string"
        );

        // Load distinct Provinces
        const provinces = await attacksCollection.distinct("provstate");
        // Filter out junk
        this.knownProvinces = provinces.filter(
          (p) => p && typeof p === "string" && p.length > 2 && !/^\d+$/.test(p)
        );

        // Load top Groups (by frequency ideally, but distinct is faster to start)
        const groups = await attacksCollection.distinct("gname");
        this.knownGroups = groups.filter(
          (g) => g && typeof g === "string" && g !== "Unknown"
        );

        // We DO NOT load 30k cities into memory for regex looping.
        // We rely on the generic capitalized word extraction + verifying against DB for cities.

        this.cacheLoaded = true;
        console.log(
          `[Context Extractor] Cache loaded: ${this.knownCountries.length} countries, ${this.knownProvinces.length} provinces, ${this.knownGroups.length} groups`
        );
      } catch (error) {
        console.error("[Context Extractor] Error loading cache:", error);
      } finally {
        this.cacheLoadingPromise = null;
      }
    })();

    return this.cacheLoadingPromise;
  }

  // Parse natural language queries for GTD data - COMPREHENSIVE VERSION
  async parseNaturalLanguageQuery(query) {
    // Ensure cache is populated
    if (!this.cacheLoaded) {
      await this.loadLocationCache();
    }

    const lowerQuery = query.toLowerCase().trim();
    const conditions = {};

    console.log(`[Query Parser] Parsing: "${query}"`);

    // Extract event ID (12-digit number) - HIGHEST PRIORITY
    const eventIdMatch = query.match(/\d{12}/);
    if (eventIdMatch) {
      conditions.eventid = eventIdMatch[0];
      console.log(`[Query Parser] Found eventid: ${eventIdMatch[0]}`);
      // If we have an eventid, we should ONLY search by eventid
      return conditions;
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SPECIFIC DATE EXTRACTION - Extract full dates into iyear, imonth, iday
    // This handles queries like "16-12-2014", "December 16, 2014", "16 December 2014"
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Month name to number mapping
    const monthNames = {
      january: "1",
      jan: "1",
      february: "2",
      feb: "2",
      march: "3",
      mar: "3",
      april: "4",
      apr: "4",
      may: "5",
      june: "6",
      jun: "6",
      july: "7",
      jul: "7",
      august: "8",
      aug: "8",
      september: "9",
      sep: "9",
      sept: "9",
      october: "10",
      oct: "10",
      november: "11",
      nov: "11",
      december: "12",
      dec: "12",
    };

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // FUZZY MONTH MATCHING - Handle common typos like "Decemeber", "Febuary", etc.
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const monthTypoCorrections = {
      // December typos
      decemeber: "12",
      decmber: "12",
      deceber: "12",
      deceember: "12",
      dicember: "12",
      desember: "12",
      decenber: "12",
      decmeber: "12",
      // January typos
      janurary: "1",
      janury: "1",
      janaury: "1",
      januaray: "1",
      // February typos
      febuary: "2",
      feburary: "2",
      februrary: "2",
      febrary: "2",
      febraury: "2",
      // March typos
      marhc: "3",
      marh: "3",
      // April typos
      apirl: "4",
      aprile: "4",
      // August typos
      agust: "8",
      augst: "8",
      aguust: "8",
      // September typos
      setember: "9",
      septmber: "9",
      sepetmber: "9",
      spetember: "9",
      // October typos
      ocotber: "10",
      octber: "10",
      ocober: "10",
      // November typos
      novmber: "11",
      noveber: "11",
      novemeber: "11",
      novmeber: "11",
    };

    /**
     * Get month number from month string, with fuzzy matching for typos
     * @param {string} monthStr - The month string (may be misspelled)
     * @returns {string|null} - Month number as string (1-12) or null
     */
    const getMonthNumber = (monthStr) => {
      if (!monthStr) return null;
      const lower = monthStr.toLowerCase();
      // First try exact match
      if (monthNames[lower]) return monthNames[lower];
      // Then try typo corrections
      if (monthTypoCorrections[lower]) {
        console.log(
          `[Query Parser] Corrected month typo: "${monthStr}" â†’ month ${monthTypoCorrections[lower]}`
        );
        return monthTypoCorrections[lower];
      }
      // Fuzzy match: check if input is close to any month name (Levenshtein distance â‰¤ 2)
      const levenshtein = (a, b) => {
        const matrix = Array(b.length + 1)
          .fill(null)
          .map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
        for (let j = 1; j <= b.length; j++) {
          for (let i = 1; i <= a.length; i++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
              matrix[j][i - 1] + 1,
              matrix[j - 1][i] + 1,
              matrix[j - 1][i - 1] + cost
            );
          }
        }
        return matrix[b.length][a.length];
      };

      // Check against full month names with distance threshold
      const fullMonthNames = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
      ];
      for (let i = 0; i < fullMonthNames.length; i++) {
        const dist = levenshtein(lower, fullMonthNames[i]);
        // Allow distance of 2 for longer month names, 1 for shorter ones
        const threshold = fullMonthNames[i].length > 5 ? 2 : 1;
        if (dist <= threshold) {
          console.log(
            `[Query Parser] Fuzzy matched month: "${monthStr}" â†’ "${fullMonthNames[i]}" (distance: ${dist})`
          );
          return (i + 1).toString();
        }
      }
      return null;
    };

    let specificDateFound = false;

    // Pattern 1: DD-MM-YYYY or DD/MM/YYYY (common international format)
    // Must have 4-digit year to distinguish from other patterns
    const ddmmyyyyMatch = query.match(
      /\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\b/
    );
    if (ddmmyyyyMatch) {
      const day = parseInt(ddmmyyyyMatch[1]);
      const month = parseInt(ddmmyyyyMatch[2]);
      const year = ddmmyyyyMatch[3];

      // Validate: day 1-31, month 1-12, year 1970-2017 (GTD range)
      if (
        day >= 1 &&
        day <= 31 &&
        month >= 1 &&
        month <= 12 &&
        parseInt(year) >= 1970 &&
        parseInt(year) <= 2017
      ) {
        conditions.iyear = year;
        conditions.imonth = month.toString();
        conditions.iday = day.toString();
        specificDateFound = true;
        console.log(
          `[Query Parser] Found specific date (DD-MM-YYYY): ${day}-${month}-${year}`
        );
      }
    }

    // Pattern 2: YYYY-MM-DD (ISO format)
    if (!specificDateFound) {
      const yyyymmddMatch = query.match(
        /\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/
      );
      if (yyyymmddMatch) {
        const year = yyyymmddMatch[1];
        const month = parseInt(yyyymmddMatch[2]);
        const day = parseInt(yyyymmddMatch[3]);

        if (
          day >= 1 &&
          day <= 31 &&
          month >= 1 &&
          month <= 12 &&
          parseInt(year) >= 1970 &&
          parseInt(year) <= 2017
        ) {
          conditions.iyear = year;
          conditions.imonth = month.toString();
          conditions.iday = day.toString();
          specificDateFound = true;
          console.log(
            `[Query Parser] Found specific date (YYYY-MM-DD): ${year}-${month}-${day}`
          );
        }
      }
    }

    // Pattern 3: "Month DD, YYYY" or "Month DD YYYY" (e.g., "December 16, 2014")
    // ENHANCED: Uses broader regex to capture potential month words (including typos)
    // Then uses getMonthNumber() for fuzzy matching/correction
    if (!specificDateFound) {
      // Capture any word that looks like a month (4-10 letters) followed by day and year
      const monthDayYearMatch = query.match(
        /\b([a-z]{3,10})\s+(\d{1,2}),?\s+(\d{4})\b/i
      );
      if (monthDayYearMatch) {
        const monthStr = monthDayYearMatch[1];
        const day = parseInt(monthDayYearMatch[2]);
        const year = monthDayYearMatch[3];
        const month = getMonthNumber(monthStr);

        if (
          month &&
          day >= 1 &&
          day <= 31 &&
          parseInt(year) >= 1970 &&
          parseInt(year) <= 2017
        ) {
          conditions.iyear = year;
          conditions.imonth = month;
          conditions.iday = day.toString();
          specificDateFound = true;
          console.log(
            `[Query Parser] Found specific date (Month DD, YYYY): ${monthStr} ${day}, ${year} â†’ month ${month}`
          );
        }
      }
    }

    // Pattern 4: "DD Month YYYY" (e.g., "16 December 2014", "16 Decemeber 2014")
    // ENHANCED: Uses broader regex to capture potential month words (including typos)
    // Then uses getMonthNumber() for fuzzy matching/correction
    if (!specificDateFound) {
      // Capture day followed by any word that looks like a month (4-10 letters) followed by year
      const dayMonthYearMatch = query.match(
        /\b(\d{1,2})\s+([a-z]{3,10})\s+(\d{4})\b/i
      );
      if (dayMonthYearMatch) {
        const day = parseInt(dayMonthYearMatch[1]);
        const monthStr = dayMonthYearMatch[2];
        const year = dayMonthYearMatch[3];
        const month = getMonthNumber(monthStr);

        if (
          month &&
          day >= 1 &&
          day <= 31 &&
          parseInt(year) >= 1970 &&
          parseInt(year) <= 2017
        ) {
          conditions.iyear = year;
          conditions.imonth = month;
          conditions.iday = day.toString();
          specificDateFound = true;
          console.log(
            `[Query Parser] Found specific date (DD Month YYYY): ${day} ${monthStr} ${year} â†’ month ${month}`
          );
        }
      }
    }

    // Pattern 5: "Month YYYY" or "in Month YYYY" (month + year only, no day)
    // ENHANCED: Uses broader regex to capture potential month words (including typos)
    if (!specificDateFound) {
      // Capture optional "in" followed by any word that looks like a month followed by year
      const monthYearMatch = query.match(
        /\b(in\s+)?([a-z]{3,10})\s+(\d{4})\b/i
      );
      if (monthYearMatch) {
        const monthStr = monthYearMatch[2];
        const year = monthYearMatch[3];
        const month = getMonthNumber(monthStr);

        if (month && parseInt(year) >= 1970 && parseInt(year) <= 2017) {
          conditions.iyear = year;
          conditions.imonth = month;
          // No iday - month-only query
          specificDateFound = true;
          console.log(
            `[Query Parser] Found month+year (Month YYYY): ${monthStr} ${year} â†’ month ${month}`
          );
        }
      }
    }

    // Pattern 6: "MM/YYYY" or "MM-YYYY" (month/year only)
    if (!specificDateFound) {
      const mmyyyyMatch = query.match(/\b(\d{1,2})[-\/](\d{4})\b/);
      if (mmyyyyMatch) {
        const month = parseInt(mmyyyyMatch[1]);
        const year = mmyyyyMatch[2];

        if (
          month >= 1 &&
          month <= 12 &&
          parseInt(year) >= 1970 &&
          parseInt(year) <= 2017
        ) {
          conditions.iyear = year;
          conditions.imonth = month.toString();
          specificDateFound = true;
          console.log(
            `[Query Parser] Found month+year (MM/YYYY): ${month}/${year}`
          );
        }
      }
    }

    // If we found a specific date with all components, skip year range parsing
    // Otherwise continue to year range/single year extraction
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Only process year ranges if we didn't find a specific date
    if (!specificDateFound) {
      // Extract year or date range - ENHANCED
      // First check for date ranges: "between 2010 and 2015", "from 2000 to 2010", "2010-2015", "1990s"
      const dateRangePatterns = [
        /between\s+(\d{4})\s+and\s+(\d{4})/i,
        /from\s+(\d{4})\s+to\s+(\d{4})/i,
        /(\d{4})\s*-\s*(\d{4})/,
        /(\d{4})\s+to\s+(\d{4})/i,
      ];

      let dateRangeFound = false;
      for (const pattern of dateRangePatterns) {
        const match = query.match(pattern);
        if (match && match[1] && match[2]) {
          conditions._yearRange = {
            start: match[1],
            end: match[2],
          };
          console.log(
            `[Query Parser] Found date range: ${match[1]} to ${match[2]}`
          );
          dateRangeFound = true;
          break;
        }
      }

      // Check for decade patterns: "1990s", "2000s", "2010s"
      const decadeMatch = query.match(/\b(19[7-9]0s|20[0-1]0s)\b/i);
      if (decadeMatch && !dateRangeFound) {
        const decade = decadeMatch[1].replace("s", "");
        conditions._yearRange = {
          start: decade + "0",
          end: decade + "9",
        };
        console.log(`[Query Parser] Found decade: ${decadeMatch[1]}`);
        dateRangeFound = true;
      }

      // Extract single year if no range found
      if (!dateRangeFound) {
        const yearMatch = query.match(/\b(19[7-9][0-9]|20[0-2][0-9])\b/);
        if (yearMatch) {
          conditions.iyear = yearMatch[0];
          console.log(`[Query Parser] Found year: ${yearMatch[0]}`);
        }
      }
    }

    // KNOWN COUNTRIES LIST - for natural language extraction
    // Use cached countries if available, otherwise fallback to empty (cache should be loaded)
    const knownCountries =
      this.knownCountries && this.knownCountries.length > 0
        ? this.knownCountries
        : [
            "pakistan",
            "india",
            "afghanistan",
            "iraq",
            "syria",
            "iran",
            "turkey",
            "israel",
            "egypt",
            "libya",
            "yemen",
            "saudi arabia",
            "lebanon",
            "jordan",
            "palestine",
            "nigeria",
            "somalia",
            "kenya",
            "algeria",
            "tunisia",
            "morocco",
            "mali",
            "sudan",
            "united states",
            "usa",
            "uk",
            "united kingdom",
            "france",
            "germany",
            "spain",
            "russia",
            "china",
            "japan",
            "philippines",
            "indonesia",
            "thailand",
            "bangladesh",
            "sri lanka",
            "nepal",
            "colombia",
            "peru",
            "mexico",
            "brazil",
            "argentina",
            "ukraine",
            "ireland",
            "greece",
            "italy",
            "belgium",
            "netherlands",
          ];

    // KNOWN CITIES LIST - major cities in terrorism context (expanded)
    const knownCities = [
      "karachi",
      "lahore",
      "peshawar",
      "quetta",
      "islamabad",
      "rawalpindi",
      "gilgit",
      "gujranwala",
      "multan",
      "faisalabad",
      "hyderabad",
      "sialkot",
      "abbottabad",
      "baghdad",
      "kabul",
      "kandahar",
      "mosul",
      "basra",
      "aleppo",
      "damascus",
      "hamah",
      "mumbai",
      "delhi",
      "new delhi",
      "kashmir",
      "srinagar",
      "jerusalem",
      "tel aviv",
      "beirut",
      "tripoli",
      "cairo",
      "london",
      "paris",
      "madrid",
      "new york",
      "boston",
    ];

    // KNOWN PROVINCES/STATES LIST - for province/state level queries
    // Including common spelling variations
    // Use cached provinces if available
    const knownProvinces =
      this.knownProvinces && this.knownProvinces.length > 0
        ? this.knownProvinces
        : [
            // Pakistan provinces (with spelling variations)
            "punjab",
            "sindh",
            "khyber pakhtunkhwa",
            "khyber pakhtunhwa",
            "khyber pakhtonkhwa",
            "khyber-pakhtunkhwa",
            "kpk",
            "nwfp",
            "north west frontier province",
            "balochistan",
            "baluchistan",
            "fata",
            "federally administered tribal areas",
            "islamabad capital territory",
            "gilgit-baltistan",
            "gilgit baltistan",
            "azad kashmir",
            "azad jammu and kashmir",
            // India states (terrorism-relevant)
            "jammu and kashmir",
            "maharashtra",
            "uttar pradesh",
            "bihar",
            "assam",
            "west bengal",
            "manipur",
            "nagaland",
            "chhattisgarh",
            "jharkhand",
            // Afghanistan provinces
            "kabul",
            "kandahar",
            "helmand",
            "nangarhar",
            "kunduz",
            "herat",
            "balkh",
            // Iraq governorates
            "baghdad",
            "nineveh",
            "anbar",
            "basra",
            "diyala",
            "kirkuk",
            "saladin",
            // Syria governorates
            "damascus",
            "aleppo",
            "homs",
            "idlib",
            "deir ez-zor",
            "raqqa",
          ];

    // Province spelling corrections — reference centralized constant (PROVINCE_CORRECTIONS at module-level)
    // Local alias for backward-compatible code that references `provinceCorrections`
    const provinceCorrections = PROVINCE_CORRECTIONS;

    // KNOWN GROUPS LIST
    // Use cached groups if available
    const knownGroups =
      this.knownGroups && this.knownGroups.length > 0
        ? this.knownGroups
        : [
            "taliban",
            "al-qaeda",
            "al qaeda",
            "isis",
            "isil",
            "islamic state",
            "daesh",
            "ttp",
            "tehrik-i-taliban",
            "lashkar-e-taiba",
            "jaish-e-mohammed",
            "boko haram",
            "al-shabaab",
            "hezbollah",
            "hamas",
            "ira",
            "eta",
            "farc",
            "ltte",
            "pkk",
            "unknown",
          ];

    // ATTACK TYPES - Imported from central constants
    const {
      ATTACK_TYPES: attackTypes,
      TARGET_TYPES: targetTypes,
      WEAPON_TYPES: weaponTypes,
      REGIONS: knownRegions,
    } = require("./GTDConstants");

    // Check for sample/random request FIRST
    if (
      lowerQuery.includes("any one") ||
      lowerQuery.includes("random") ||
      lowerQuery.includes("sample") ||
      lowerQuery.includes("example") ||
      lowerQuery.includes("one attack") ||
      lowerQuery.includes("single attack") ||
      lowerQuery.includes("give me an attack") ||
      lowerQuery.includes("show me an attack")
    ) {
      conditions._wantsSample = true;
      console.log(`[Query Parser] Detected sample/random attack request`);
    }

    // Check for statistical queries - be more aggressive in detection
    const statisticalPatterns = [
      "total number",
      "how many",
      "number of",
      "total attacks",
      "count",
      "statistics",
      "how much",
      "how much",
      "occurred",
      "occur",
      "happened",
      "happens",
      "took place",
    ];
    const hasStatisticalKeyword = statisticalPatterns.some((pattern) =>
      lowerQuery.includes(pattern)
    );
    const hasStatisticalWord =
      /\b(count|total|statistics?|how\s+many|number\s+of)\b/i.test(lowerQuery);

    // Also check if query asks for a quantity/number - use ATTACK_SYNONYMS_REGEX for full coverage
    const asksForQuantityPattern = new RegExp(
      `(how\\s+many|number\\s+of|total|count|how\\s+much).*?(${ATTACK_SYNONYMS_REGEX}|case)`,
      "i"
    );
    const asksForQuantity = asksForQuantityPattern.test(lowerQuery);

    if (hasStatisticalKeyword || hasStatisticalWord || asksForQuantity) {
      conditions._isStatistical = true;
      console.log(
        `[Query Parser] Detected statistical query (pattern: ${hasStatisticalKeyword ? "keyword" : hasStatisticalWord ? "word" : "quantity"})`
      );
    }

    // Additional detection: "attacks in <location>" style questions often expect counts
    // CRITICAL FIX: Use full ATTACK_SYNONYMS_REGEX to handle "mishap in Peshawar", "bombing in Iraq", etc.
    // This ensures all attack synonyms trigger statistical mode for location-based queries
    if (!conditions._isStatistical) {
      const wantsListing =
        /\b(list|show|give|display|sample|examples?)\b/i.test(lowerQuery);
      // FIXED: Use ATTACK_SYNONYMS_REGEX instead of hardcoded list
      // ENHANCED: Also handle "Incidents happen in iraq" pattern where verb is between synonym and location
      const locationCountPattern = new RegExp(
        `\\b(${ATTACK_SYNONYMS_REGEX})\\s+(in|within|at)\\s+[a-z]`,
        "i"
      );
      const locationWithVerbPattern = new RegExp(
        `\\b(${ATTACK_SYNONYMS_REGEX})\\s+(happen|happened|occurring|occurred|took\\s+place|take\\s+place)\\s+(in|within|at)\\s+[a-z]`,
        "i"
      );

      if (
        locationCountPattern.test(lowerQuery) ||
        locationWithVerbPattern.test(lowerQuery)
      ) {
        conditions._isStatistical = true;
        console.log(
          `[Query Parser] Detected location-based query ("attacks in ..." or "attacks happen in ...") - Forcing Statistical Mode`
        );

        if (wantsListing) {
          conditions._includeSampleList = true;
          console.log(
            `[Query Parser] User asked to LIST/SHOW - setting _includeSampleList=true`
          );
        }
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // WORLDWIDE QUERY DETECTION - Handle "Incidents around the world?", "Attacks worldwide", etc.
    // CRITICAL: This ensures all attack synonyms + worldwide phrases trigger statistical mode
    // Previously, "Attacks around the world?" worked but "Incidents around the world?" didn't
    // because the LLM inconsistently decided whether to output JSON
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (!conditions._isStatistical) {
      // Worldwide phrases that indicate global scope
      const worldwidePattern =
        /\b(worldwide|world\s*wide|around\s+the\s+world|across\s+the\s+world|in\s+the\s+world|globally|global|across\s+the\s+globe|around\s+the\s+globe|all\s+over\s+the\s+world|throughout\s+the\s+world)\b/i;

      // Check if query mentions worldwide AND contains any attack synonym
      const hasWorldwidePhrase = worldwidePattern.test(lowerQuery);
      const hasAttackSynonym = new RegExp(
        `\\b(${ATTACK_SYNONYMS_REGEX})\\b`,
        "i"
      ).test(lowerQuery);

      if (hasWorldwidePhrase && hasAttackSynonym) {
        conditions._isStatistical = true;
        conditions._isWorldwide = true; // Mark as worldwide for proper handling
        console.log(
          `[Query Parser] Detected WORLDWIDE query with attack synonym - Forcing Statistical Mode`
        );
        console.log(
          `[Query Parser] Matched worldwide phrase: ${lowerQuery.match(worldwidePattern)?.[0]}`
        );
        console.log(
          `[Query Parser] This will return global statistics with JSON output instructions`
        );
      }
    }

    // ── MULTI-COUNTRY OR DETECTION ──────────────────────────────────────
    // Detect "X or Y", "X and Y", "X vs Y", "X, Y and Z" patterns where
    // X, Y, Z are known countries or aliases.  Sets conditions.country_txt
    // as an ARRAY so buildMongoDBFilter can produce { $in: [...] }.
    // ───────────────────────────────────────────────────────────────────────
    const multiCountrySeparatorRx =
      /\b(?:,\s*|\s+(?:or|and|vs\.?|versus|&)\s+)/i;
    let multiCountryResolved = false;

    // Helper: resolve a single token to its canonical GTD country name (or null)
    const resolveCountryToken = (token) => {
      const lower = token.toLowerCase().trim();
      if (!lower) return null;
      // 1) Check aliases first
      if (COUNTRY_ALIASES[lower]) return COUNTRY_ALIASES[lower];
      // 2) Check known-countries list (case-insensitive match)
      const found = knownCountries.find((c) => c.toLowerCase() === lower);
      if (found) {
        return found
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
      return null;
    };

    // Only attempt multi-country parsing when the query contains a separator
    if (multiCountrySeparatorRx.test(lowerQuery)) {
      // Split on separators and try to resolve every fragment
      const fragments = lowerQuery
        .split(multiCountrySeparatorRx)
        .map((f) => f.trim())
        .filter(Boolean);
      if (fragments.length >= 2) {
        const resolved = [];
        for (const frag of fragments) {
          // Trim common prepositions that may be attached ("in Pakistan")
          const cleaned = frag.replace(
            /^(?:in|from|of|between|across)\s+/i,
            ""
          );
          const canon = resolveCountryToken(cleaned);
          if (canon && !resolved.includes(canon)) resolved.push(canon);
        }
        // Only treat as multi-country if we resolved at LEAST 2 distinct countries
        if (resolved.length >= 2) {
          conditions.country_txt = resolved;
          multiCountryResolved = true;
          console.log(
            `[Query Parser] Multi-country detected: ${JSON.stringify(resolved)}`
          );
        }
      }
    }

    // ── COUNTRY ALIAS PRE-PROCESSING ──────────────────────────────────────
    // Resolve abbreviations / alternative names BEFORE the main country loop.
    // e.g. "america" → "United States", "uae" → "United Arab Emirates"
    // Guard: skip the short alias "us" unless the query also contains a GTD keyword,
    // to avoid false positives on sentences that merely contain the word "us".
    // ───────────────────────────────────────────────────────────────────────
    let aliasResolved = false;
    if (!multiCountryResolved) {
      for (const [alias, canonical] of Object.entries(COUNTRY_ALIASES)) {
        // Build a word-boundary regex for the alias (escape regex-special chars first)
        const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const aliasRx = new RegExp(`\\b${escapedAlias}\\b`, "i");

        if (aliasRx.test(lowerQuery)) {
          conditions.country_txt = canonical;
          aliasResolved = true;
          console.log(
            `[Query Parser] Country alias resolved: "${alias}" → "${canonical}"`
          );
          break;
        }
      }
    }

    // NATURAL LANGUAGE COUNTRY EXTRACTION - check for known countries
    // Skip if already resolved via alias or multi-country above
    if (!aliasResolved && !multiCountryResolved) {
      for (const country of knownCountries) {
        // Match patterns: "in pakistan", "from pakistan", "pakistan attacks", "attacks in pakistan"
        const countryPattern = new RegExp(`\\b${country}\\b`, "i");
        if (countryPattern.test(lowerQuery)) {
          // Capitalize properly for database matching
          conditions.country_txt = country
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
          console.log(
            `[Query Parser] Found country: ${conditions.country_txt}`
          );
          break;
        }
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // PROVINCE/STATE EXTRACTION - Handle queries like "Punjab Province of Pakistan"
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let provinceFound = false;

    // Province extraction patterns - detect province/state keywords
    const provincePatterns = [
      // "province of Khyber Pakhtunhwa" - match 2-3 word province names after "province of"
      /province\s+of\s+([a-z]+(?:\s+[a-z]+){1,2})/i,
      // "state of [name]" - match 2-3 word state names
      /state\s+of\s+([a-z]+(?:\s+[a-z]+){1,2})/i,
      // "in Punjab Province of Pakistan" - highest priority
      /in\s+([a-z]+(?:\s+[a-z]+){0,2})\s+province\s+of\s+[a-z]+/i,
      // "attacks in Punjab Province"
      /in\s+([a-z]+(?:\s+[a-z]+){0,2})\s+province/i,
      // "Khyber Pakhtunhwa Province" anywhere - 2-3 word province
      /([a-z]+(?:\s+[a-z]+){1,2})\s+province/i,
      // "[single word] Province" anywhere
      /([a-z]+)\s+province/i,
      // "in [name] state of [country]"
      /in\s+([a-z]+(?:\s+[a-z]+){0,2})\s+state\s+of\s+[a-z]+/i,
      // "[name] state"
      /([a-z]+(?:\s+[a-z]+){0,2})\s+state(?:\s+of)?/i,
    ];

    // First check for known provinces in the query directly
    for (const province of knownProvinces) {
      // Escape special regex chars in province name (like hyphens)
      const escapedProvince = province.replace(
        /[-\/\\^$*+?.()|[\]{}]/g,
        "\\$&"
      );
      const provincePattern = new RegExp(`\\b${escapedProvince}\\b`, "i");
      if (provincePattern.test(lowerQuery)) {
        // Check if query context suggests it's a province (not a city with same name)
        const hasProvinceKeyword = /\b(province|state|region)\b/i.test(
          lowerQuery
        );
        const isKnownCity = knownCities.some(
          (city) => city.toLowerCase() === province.toLowerCase()
        );

        // If it's both a known city and province, prioritize based on context
        if (isKnownCity && !hasProvinceKeyword) {
          console.log(
            `[Query Parser] "${province}" is both city and province - using city (no province keyword found)`
          );
          continue;
        }

        // Check if this province needs correction (spelling variation)
        const lowercaseProvince = province.toLowerCase();
        if (provinceCorrections[lowercaseProvince]) {
          conditions.provstate = provinceCorrections[lowercaseProvince];
          console.log(
            `[Query Parser] Corrected province spelling: "${province}" -> "${conditions.provstate}"`
          );
        } else {
          // Capitalize properly for database matching
          conditions.provstate = province
            .split(/[\s-]+/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        }
        conditions._provinceToVerify = conditions.provstate;
        console.log(
          `[Query Parser] Found province in known list: "${conditions.provstate}" (will verify in database)`
        );
        provinceFound = true;
        break;
      }
    }

    // If no known province found, try pattern matching
    if (!provinceFound) {
      for (const pattern of provincePatterns) {
        const match = lowerQuery.match(pattern);
        if (match && match[1]) {
          const potentialProvince = match[1].trim();

          // Skip common words
          const skipWords = [
            "the",
            "a",
            "an",
            "in",
            "of",
            "by",
            "from",
            "to",
            "how",
            "many",
            "attacks",
          ];
          if (skipWords.includes(potentialProvince.toLowerCase())) continue;

          // Check if extracted province has a spelling correction
          const lowerPotentialProvince = potentialProvince.toLowerCase();
          if (provinceCorrections[lowerPotentialProvince]) {
            conditions.provstate = provinceCorrections[lowerPotentialProvince];
            console.log(
              `[Query Parser] Extracted and corrected province: "${potentialProvince}" -> "${conditions.provstate}"`
            );
          } else {
            // Capitalize properly
            conditions.provstate = potentialProvince
              .split(" ")
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" ");
          }
          conditions._provinceToVerify = conditions.provstate;
          console.log(
            `[Query Parser] Extracted province from pattern: "${conditions.provstate}"`
          );
          provinceFound = true;
          break;
        }
      }
    }

    // NATURAL LANGUAGE CITY EXTRACTION - Enhanced with fuzzy matching
    let cityFound = false;
    for (const city of knownCities) {
      const cityPattern = new RegExp(`\\b${city}\\b`, "i");
      if (cityPattern.test(lowerQuery)) {
        // Mark for database verification to get exact value
        conditions._cityToVerify = city;
        console.log(
          `[Query Parser] Found city in known list: "${city}" (will verify in database for exact value)`
        );
        cityFound = true;
        break;
      }
    }

    // If city not found in known list, try fuzzy matching and database lookup
    if (!cityFound) {
      // Enhanced city extraction patterns - more comprehensive
      const cityPatterns = [
        // "in [city] city of [country]" - highest priority
        /in\s+([a-z]+(?:\s+[a-z]+)?)\s+city\s+of\s+[a-z]+/i,
        // "in [city] city"
        /in\s+([a-z]+(?:\s+[a-z]+)?)\s+city/i,
        // "[city] city of [country]"
        /([a-z]+(?:\s+[a-z]+)?)\s+city\s+of\s+[a-z]+/i,
        // "[city] city"
        /([a-z]+(?:\s+[a-z]+)?)\s+city/i,
        // "city of [city]"
        /city\s+of\s+([a-z]+(?:\s+[a-z]+)?)/i,
        // "in [city]" when followed by country or "city"
        /in\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:city|pakistan|country|state|russia|india|afghanistan|iraq|syria)/i,
        // Standalone city names before country
        /([a-z]+(?:\s+[a-z]+)?)\s+(?:city\s+of\s+)?(?:pakistan|country|state)/i,
      ];

      for (const pattern of cityPatterns) {
        const match = lowerQuery.match(pattern);
        if (match && match[1]) {
          const potentialCity = match[1].trim();

          // Skip common words that aren't cities
          const skipWords = [
            "how",
            "many",
            "attacks",
            "attack",
            "the",
            "a",
            "an",
            "in",
            "of",
            "by",
            "from",
            "to",
          ];
          if (skipWords.includes(potentialCity.toLowerCase())) continue;

          // CRITICAL: Skip if this token is already identified as a province
          // Prevents "Punjab" from being double-interpreted as both province AND city
          // (which would fuzzy-match to "Goth Ghulam Haider Punjabi" and return 0 results)
          // NOTE: This guard is intentionally NOT in the knownCities direct-match loop (line ~2109)
          // because Baghdad, Kabul, Kandahar etc. are legitimately both cities and provinces.
          if (
            conditions.provstate &&
            potentialCity.toLowerCase() === conditions.provstate.toLowerCase()
          ) {
            console.log(
              `[Query Parser] Skipping "${potentialCity}" as city candidate â€” already identified as province "${conditions.provstate}"`
            );
            continue;
          }

          console.log(
            `[Query Parser] Extracted potential city: "${potentialCity}"`
          );

          // Try fuzzy match with known cities (handle typos like "peshwar" -> "peshawar")
          // BUT: We'll verify against database later to get exact value
          for (const knownCity of knownCities) {
            if (this.fuzzyMatch(potentialCity, knownCity)) {
              // Mark for database verification to get exact value
              conditions._cityToVerify = potentialCity;
              conditions._knownCityMatch = knownCity;
              console.log(
                `[Query Parser] âœ… Found city via fuzzy match: "${potentialCity}" -> "${knownCity}" (will verify in database)`
              );
              cityFound = true;
              break;
            }
          }
          if (cityFound) break;

          // If still not found, mark for database lookup (ALWAYS try database lookup)
          if (!cityFound && potentialCity.length > 2) {
            conditions._potentialCity = potentialCity;
            console.log(
              `[Query Parser] Marked potential city for database lookup: "${potentialCity}"`
            );
            break; // Only mark first potential city found
          }
        }
      }
    }

    // GENERIC FALLBACK: Try to find any capitalized word after "in", "at", "near" that might be a city
    if (!cityFound && !conditions._potentialCity && !conditions._cityToVerify) {
      // Look for "in [Word]", excluding known countries and common words
      const genericLocationMatches = [
        ...query.matchAll(
          /\b(?:in|at|near)\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+){0,2})/g
        ),
      ];

      for (const match of genericLocationMatches) {
        if (match && match[1]) {
          const distinctCandidate = match[1].trim();
          const lowerCandidate = distinctCandidate.toLowerCase();

          // Skip known countries (CASE INSENSITIVE CHECK)
          if (knownCountries.some((c) => c.toLowerCase() === lowerCandidate))
            continue;
          if (conditions.country_txt) {
            const countryList = Array.isArray(conditions.country_txt)
              ? conditions.country_txt
              : [conditions.country_txt];
            if (countryList.some((c) => c.toLowerCase() === lowerCandidate))
              continue;
          }

          if (knownProvinces.some((p) => p.toLowerCase() === lowerCandidate))
            continue;
          if (knownRegions.some((r) => r.toLowerCase() === lowerCandidate))
            continue;

          // Skip stop words
          const stopWords = [
            "the",
            "a",
            "an",
            "this",
            "that",
            "my",
            "your",
            "any",
            "some",
            "all",
            "every",
            "major",
            "terrorist",
            "recent",
            "past",
          ];
          if (stopWords.includes(lowerCandidate)) continue;

          console.log(
            `[Query Parser] checking generic potential city candidate: "${distinctCandidate}"`
          );

          // Check if this exists in DB as a city
          // specific check mostly for user's query "Attacks in Gujranwala?"
          if (distinctCandidate.length > 2) {
            conditions._potentialCity = distinctCandidate;
            console.log(
              `[Query Parser] Marked generic candidate for database lookup: "${distinctCandidate}"`
            );
            break; // Attempt first valid candidate
          }
        }
      }
    }

    // NATURAL LANGUAGE GROUP EXTRACTION - Enhanced with keyword matching
    let groupFound = false;
    for (const group of knownGroups) {
      const groupPattern = new RegExp(
        `\\b${group.replace(/-/g, "[- ]?")}\\b`,
        "i"
      );
      if (groupPattern.test(lowerQuery)) {
        conditions.gname = group;
        console.log(
          `[Query Parser] Found group in known list: ${conditions.gname}`
        );
        groupFound = true;
        break;
      }
    }

    // If group not found, try to extract from quoted strings or "by" patterns
    if (!groupFound) {
      // Enhanced group extraction patterns - handle various formats
      const groupPatterns = [
        // "by:"group name"" or "by: 'group name'"
        /(?:by|conducted\s+by|perpetrated\s+by)[:\s]*["']([^"']+)["']/i,
        // "by 'group name'" or "by group name"
        /(?:by|conducted\s+by|perpetrated\s+by)[:\s]+["']?([^"'\n,?]+)["']?/i,
        // Quoted strings anywhere in query
        /["']([^"']+)["']/,
        // "group: name" format
        /group[:\s]+["']?([^"'\n,?]+)["']?/i,
      ];

      for (const pattern of groupPatterns) {
        const match = query.match(pattern); // Use original query to preserve quotes
        if (match && match[1]) {
          const potentialGroup = match[1].trim();

          // Skip if it's too short or common words
          if (potentialGroup.length < 3) continue;
          const skipWords = [
            "how",
            "many",
            "attacks",
            "attack",
            "the",
            "a",
            "an",
            "in",
            "of",
            "by",
            "from",
            "to",
            "have",
            "been",
            // Aggregation and metadata dimension nouns
            "group",
            "groups",
            "country",
            "countries",
            "year",
            "years",
            "type",
            "types",
            "target",
            "targets",
            "weapon",
            "weapons",
            "region",
            "regions",
            "city",
            "cities",
            "state",
            "states",
            "province",
            "provinces",
            "month",
            "months",
            "day",
            "days",
            "date",
            "dates",
            "casualty",
            "casualties",
            "death",
            "deaths",
            "fatalities",
            "fatality",
            "deadliest",
            "wounded",
            "injured",
            "injuries",
          ];
          if (skipWords.includes(potentialGroup.toLowerCase())) continue;

          conditions._potentialGroup = potentialGroup;
          console.log(
            `[Query Parser] Marked potential group for database lookup: "${potentialGroup}"`
          );
          break; // Only mark first potential group found
        }
      }
    }

    const GTDNormalizer = require("./GTDNormalizationService");

    // HELPER: Check if query matches a GTD constant (Exact, or Substring parts)
    const findInQuery = (query, constantList, typeName) => {
      // Sort by length desc to match "Religious Figures" before "Religious"
      const sorted = [...constantList].sort((a, b) => b.length - a.length);

      for (const item of sorted) {
        const lowerItem = item.toLowerCase();
        // 1. Exact phrase match in query (e.g. "Bombing/Explosion")
        if (query.includes(lowerItem)) return item;

        // 2. Split match (e.g. "Bombing" from "Bombing/Explosion")
        // Split by / or ( to get primary terms
        const parts = lowerItem
          .split(/[\/\(\)]/)
          .map((p) => p.trim())
          .filter((p) => p.length > 3);

        // GENERIC TERM BLACKLIST - Do not match on these generic words even if they appear in constants
        const ignoredParts = [
          "attack",
          "attacks",
          "group",
          "groups",
          "unknown",
          "other",
          "general",
          "related",
          "facility",
          "infrastructure", // Too broad if matched alone? Maybe.
          "taking",
          "incident",
          "barricade",
        ];

        for (const part of parts) {
          if (ignoredParts.includes(part)) continue;

          // Use Regex to ensure whole word match (with optional plural 's' or 'es') to avoid false positives
          const pattern = new RegExp(`\\b${part}(?:e?s)?\\b`, "i");
          if (pattern.test(query)) return item;
        }
      }
      return null;
    };

    // ATTACK TYPE EXTRACTION
    const foundAttack = findInQuery(lowerQuery, attackTypes, "Attack Type");
    if (foundAttack) {
      conditions.attacktype1_txt = foundAttack;
      console.log(
        `[Query Parser] Found attack type (Normalized): ${conditions.attacktype1_txt}`
      );
    }

    // TARGET TYPE EXTRACTION
    const foundTarget = findInQuery(lowerQuery, targetTypes, "Target Type");
    if (foundTarget) {
      conditions.targtype1_txt = foundTarget;
      console.log(
        `[Query Parser] Found target type (Normalized): ${conditions.targtype1_txt}`
      );
    }

    // WEAPON TYPE EXTRACTION
    const foundWeapon = findInQuery(lowerQuery, weaponTypes, "Weapon Type");
    if (foundWeapon) {
      conditions.weaptype1_txt = foundWeapon;
      console.log(
        `[Query Parser] Found weapon type (Normalized): ${conditions.weaptype1_txt}`
      );
    }

    // REGION EXTRACTION
    const foundRegion = findInQuery(lowerQuery, knownRegions, "Region");
    if (foundRegion) {
      conditions.region_txt = foundRegion;
      console.log(
        `[Query Parser] Found region (Normalized): ${conditions.region_txt}`
      );
    }

    // SUCCESS/FAILURE EXTRACTION
    if (/\b(successful|succeeded|success)\b/i.test(lowerQuery)) {
      conditions.success = "1";
      console.log(`[Query Parser] Found success filter: successful attacks`);
    } else if (/\b(failed|unsuccessful|failure)\b/i.test(lowerQuery)) {
      conditions.success = "0";
      console.log(`[Query Parser] Found success filter: failed attacks`);
    }

    // SUICIDE ATTACK EXTRACTION
    if (/\b(suicide|suicidal)\b/i.test(lowerQuery)) {
      conditions.suicide = "1";
      console.log(`[Query Parser] Found suicide filter: suicide attacks`);
    }

    // CASUALTY RANGE EXTRACTION (nkill, nwound)
    // Patterns: "more than X killed", "at least X deaths", "X+ killed", "with X casualties"
    const casualtyPatterns = [
      /(?:more than|at least|over|above)\s+(\d+)\s+(?:killed|deaths?|fatalities)/i,
      /(\d+)\s*\+\s*(?:killed|deaths?|fatalities)/i,
      /(?:with|having)\s+(\d+)\s*(?:or\s+more)?\s*(?:killed|deaths?|fatalities|casualties)/i,
      /(?:killed|deaths?|fatalities)\s+(?:of|at|over|more than)\s+(\d+)/i,
    ];

    for (const pattern of casualtyPatterns) {
      const match = lowerQuery.match(pattern);
      if (match && match[1]) {
        const minKilled = parseInt(match[1]);
        conditions._minKilled = minKilled;
        console.log(`[Query Parser] Found minimum killed: ${minKilled}`);
        break;
      }
    }

    // Wounded patterns
    const woundedPatterns = [
      /(?:more than|at least|over)\s+(\d+)\s+(?:wounded|injured|casualties)/i,
      /(\d+)\s*\+\s*(?:wounded|injured)/i,
      /(?:with|having)\s+(\d+)\s*(?:or\s+more)?\s*(?:wounded|injured)/i,
    ];

    for (const pattern of woundedPatterns) {
      const match = lowerQuery.match(pattern);
      if (match && match[1]) {
        const minWounded = parseInt(match[1]);
        conditions._minWounded = minWounded;
        console.log(`[Query Parser] Found minimum wounded: ${minWounded}`);
        break;
      }
    }

    // "Deadliest" or "most casualties" queries
    if (
      /\b(deadliest|most\s+casualties|highest\s+death|most\s+killed)\b/i.test(
        lowerQuery
      )
    ) {
      conditions._sortByCasualties = true;
      console.log(`[Query Parser] Detected deadliest/most casualties query`);
    }

    // Also support explicit patterns for advanced users: field:"value"
    const explicitPatterns = {
      gname: /(?:group|gname)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
      country_txt: /(?:country|country_txt)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
      city: /city\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
      region_txt: /region\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
      attacktype1_txt:
        /(?:attack\s*type|attacktype)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
      targtype1_txt: /(?:target|targtype)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
      weaptype1_txt: /(?:weapon|weaptype)\s*[:=]\s*["']?([^"'\n,]+)["']?/i,
    };

    for (const [field, pattern] of Object.entries(explicitPatterns)) {
      if (!conditions[field]) {
        // Don't override natural language extraction
        const match = query.match(pattern);
        if (match && match[1]) {
          conditions[field] = match[1].trim();
          console.log(
            `[Query Parser] Found explicit ${field}: ${conditions[field]}`
          );
        }
      }
    }

    // DATABASE LOOKUPS for cities and groups not found in known lists
    if (conditions._potentialCity) {
      const originalCity = conditions._potentialCity;
      const dbCity = await this.lookupCityInDatabase(
        originalCity,
        conditions.country_txt
      );
      if (dbCity) {
        // Use EXACT value from database (preserve case, spaces, etc.)
        conditions.city = dbCity;
        delete conditions._potentialCity;
        console.log(
          `[Query Parser] âœ… Resolved city from database: "${originalCity}" -> "${conditions.city}" (using EXACT database value)`
        );
      } else {
        // City not found, try as province/state
        console.log(
          `[Query Parser] City lookup failed for "${originalCity}", checking if it's a province/state...`
        );
        const dbProvince = await this.verifyAndGetExactProvinceValue(
          originalCity,
          conditions.country_txt
        );

        if (dbProvince) {
          conditions.provstate = dbProvince;
          console.log(
            `[Query Parser] âœ… Resolved as Province from database: "${originalCity}" -> "${conditions.provstate}"`
          );
        } else {
          console.log(
            `[Query Parser] âŒ "${originalCity}" not found as City or Province in database`
          );
        }

        delete conditions._potentialCity;
      }
    }

    if (conditions._potentialGroup) {
      const originalGroup = conditions._potentialGroup;
      const dbGroup = await this.lookupGroupInDatabase(originalGroup);
      if (dbGroup) {
        // Use EXACT value from database (preserve case, spaces, etc.)
        conditions.gname = dbGroup;
        delete conditions._potentialGroup;
        console.log(
          `[Query Parser] âœ… Resolved group from database: "${originalGroup}" -> "${conditions.gname}" (using EXACT database value)`
        );
      } else {
        delete conditions._potentialGroup;
        console.log(
          `[Query Parser] âŒ Group "${originalGroup}" not found in database`
        );
      }
    }

    // CRITICAL: Handle cities found via fuzzy match or known list - verify in database to get exact value
    if (conditions._cityToVerify) {
      const cityToCheck =
        conditions._knownCityMatch || conditions._cityToVerify;
      const verifiedCity = await this.verifyAndGetExactCityValue(
        cityToCheck,
        conditions.country_txt
      );
      if (verifiedCity) {
        conditions.city = verifiedCity; // Use EXACT value from database
        console.log(
          `[Query Parser] âœ… Verified city in database: "${cityToCheck}" -> "${verifiedCity}" (EXACT database value)`
        );
      } else {
        // Fallback: try to find any matching city
        const fallbackCity = await this.lookupCityInDatabase(
          cityToCheck,
          conditions.country_txt
        );
        if (fallbackCity) {
          conditions.city = fallbackCity;
          console.log(
            `[Query Parser] âœ… Found city via fallback lookup: "${fallbackCity}"`
          );
        } else {
          console.log(
            `[Query Parser] âš ï¸ WARNING: City "${cityToCheck}" not found in database!`
          );
        }
      }
      delete conditions._cityToVerify;
      delete conditions._knownCityMatch;
    }

    // CRITICAL: Verify ALL extracted city/group values match database exactly
    // This ensures we use the exact value as stored in the database
    if (conditions.city && !conditions._cityToVerify) {
      const verifiedCity = await this.verifyAndGetExactCityValue(
        conditions.city,
        conditions.country_txt
      );
      if (verifiedCity && verifiedCity !== conditions.city) {
        console.log(
          `[Query Parser] âš ï¸ City value corrected to match database: "${conditions.city}" -> "${verifiedCity}"`
        );
        conditions.city = verifiedCity;
      } else if (verifiedCity) {
        console.log(
          `[Query Parser] âœ… City value verified in database: "${conditions.city}"`
        );
      } else {
        // Try lookup as fallback
        const fallbackCity = await this.lookupCityInDatabase(
          conditions.city,
          conditions.country_txt
        );
        if (fallbackCity) {
          console.log(
            `[Query Parser] âš ï¸ City value corrected via lookup: "${conditions.city}" -> "${fallbackCity}"`
          );
          conditions.city = fallbackCity;
        } else {
          console.log(
            `[Query Parser] âš ï¸ WARNING: City "${conditions.city}" not found in database!`
          );
        }
      }
    }

    if (conditions.gname && !conditions._potentialGroup) {
      const verifiedGroup = await this.verifyAndGetExactGroupValue(
        conditions.gname
      );
      if (verifiedGroup && verifiedGroup !== conditions.gname) {
        console.log(
          `[Query Parser] âš ï¸ Group value corrected to match database: "${conditions.gname}" -> "${verifiedGroup}"`
        );
        conditions.gname = verifiedGroup;
      } else if (verifiedGroup) {
        console.log(
          `[Query Parser] âœ… Group value verified in database: "${conditions.gname}"`
        );
      } else {
        // Try lookup as fallback
        const fallbackGroup = await this.lookupGroupInDatabase(
          conditions.gname
        );
        if (fallbackGroup) {
          console.log(
            `[Query Parser] âš ï¸ Group value corrected via lookup: "${conditions.gname}" -> "${fallbackGroup}"`
          );
          conditions.gname = fallbackGroup;
        } else {
          console.log(
            `[Query Parser] âš ï¸ WARNING: Group "${conditions.gname}" not found in database!`
          );
        }
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // PROVINCE/STATE VERIFICATION - Verify extracted province exists in database
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // PROVINCE/STATE VERIFICATION - Verify extracted province exists in database
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (conditions._provinceToVerify) {
      const provinceToCheck = conditions._provinceToVerify;

      // Get all potential names (original + aliases)
      const potentialNames = [provinceToCheck];
      // Check aliases based on the resolved name (if we have one) or the raw input
      const resolvedName = conditions.provstate || provinceToCheck;

      // Use the provinceAliases map defined in the constructor
      if (this.provinceAliases[resolvedName]) {
        potentialNames.push(...this.provinceAliases[resolvedName]);
      }

      const distinctVerifiedProvinces = new Set();
      console.log(
        `[Query Parser] Verifying province variants: ${JSON.stringify(potentialNames)}`
      );

      for (const name of potentialNames) {
        const verified = await this.verifyAndGetExactProvinceValue(
          name,
          conditions.country_txt
        );
        if (verified) {
          distinctVerifiedProvinces.add(verified);
          console.log(
            `[Query Parser] âœ… Verified variant: "${name}" -> "${verified}"`
          );
        }
      }

      const verifiedList = Array.from(distinctVerifiedProvinces);

      if (verifiedList.length > 0) {
        if (verifiedList.length === 1) {
          conditions.provstate = verifiedList[0]; // Keep as string for simple case
          console.log(
            `[Query Parser] Using single verified province: "${conditions.provstate}"`
          );
        } else {
          conditions.provstate = verifiedList; // Set as array for multiple matches
          console.log(
            `[Query Parser] Using multiple verified provinces:`,
            conditions.provstate
          );
        }
      } else {
        // Province not found - clear it to avoid incorrect filtering
        console.log(
          `[Query Parser] âš ï¸ WARNING: Province "${provinceToCheck}" (and aliases) not found in database! Removing from conditions.`
        );
        delete conditions.provstate;
      }
      delete conditions._provinceToVerify;
    }

    // CRITICAL FIX: If provstate is same as Country, delete it (prevents "Russia" in "Russia" redundancy)
    if (
      conditions.provstate &&
      conditions.country_txt &&
      !Array.isArray(conditions.country_txt)
    ) {
      const pState = Array.isArray(conditions.provstate)
        ? conditions.provstate[0]
        : conditions.provstate;
      if (pState.toLowerCase() === conditions.country_txt.toLowerCase()) {
        console.log(
          `[Query Parser] âš ï¸ Removing Redundant Province: "${pState}" matches Country "${conditions.country_txt}"`
        );
        delete conditions.provstate;
      }
    }

    // If we have a province but no city, log it
    if (conditions.provstate && !conditions.city) {
      console.log(
        `[Query Parser] Province filter active: "${conditions.provstate}" (no city filter)`
      );
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // DATE RANGE QUERY DETECTION - Force statistical mode for date range queries
    // Queries like "Incidents in Iraq from 1990 to 2000" should be statistical
    // This ensures proper JSON output instructions are included in the context
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (!conditions._isStatistical && conditions._yearRange) {
      // Date range queries with attack synonyms should be statistical
      const hasAttackSynonym = new RegExp(
        `\\b(${ATTACK_SYNONYMS_REGEX})\\b`,
        "i"
      ).test(lowerQuery);
      if (hasAttackSynonym) {
        conditions._isStatistical = true;
        conditions._hasDateRange = true; // Mark for proper handling in extractGTDContext
        console.log(
          `[Query Parser] Detected DATE RANGE query with attack synonym - Forcing Statistical Mode`
        );
        console.log(
          `[Query Parser] Date range: ${conditions._yearRange.start} to ${conditions._yearRange.end}`
        );
        console.log(
          `[Query Parser] This will return statistics with JSON output instructions`
        );
      }
    }

    console.log(`[Query Parser] Final conditions:`, conditions);
    return conditions;
  }

  // Check if query is GTD-related (synchronous version for quick checks)
  isGTDQuery(query) {
    if (!query || typeof query !== "string") return false;

    // Check for explicit GTD keywords using strict word boundaries \b(word)\b
    const hasGTDKeywords = this.gtdKeywords.some((keyword) => {
      const escaped = this.escapeRegex(keyword);
      return new RegExp(`\\b${escaped}\\b`, "i").test(query);
    });

    // Quick pattern checks without full parsing
    // Use centralized ATTACK_SYNONYMS_REGEX for consistent synonym matching across codebase
    const hasGTDStructure =
      new RegExp(
        `\\b(${ATTACK_SYNONYMS_REGEX}|terrorism|terrorist)\\b`,
        "i"
      ).test(query) ||
      new RegExp(
        `\\b(how\\s+many|count|total|number\\s+of)\\b.*\\b(${ATTACK_SYNONYMS_REGEX})\\b`,
        "i"
      ).test(query) ||
      /\b(in|from|by|city|country|group)\b.*\b(pakistan|afghanistan|iraq|syria|russia|india|indonesia|philippines|nigeria|yemen|somalia|libya|egypt|turkey|israel|palestine|lebanon|jordan|iran|colombia|peru|mexico|france|uk|usa|germany|spain|italy|kenya|mali|tunisia|algeria|morocco|sudan|bangladesh|sri lanka|nepal|thailand|myanmar|bali)\b/i.test(
        query
      ) ||
      /\d{12}/.test(query); // Event ID pattern

    // Also detect queries with specific date + country patterns (likely GTD regardless of action word)
    const hasDateAndCountry =
      /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})\b/i.test(
        query
      ) &&
      /\b(pakistan|afghanistan|iraq|syria|russia|india|indonesia|philippines|nigeria|yemen|somalia|libya|egypt|turkey|israel|palestine|lebanon|jordan|iran|colombia|peru|mexico|france|uk|usa|germany|spain|italy|kenya|mali|tunisia|algeria|morocco|sudan|bangladesh|sri\s*lanka|nepal|thailand|myanmar|bali)\b/i.test(
        query
      );

    return hasGTDKeywords || hasGTDStructure || hasDateAndCountry;
  }

  // Format attack data for context - VERIFIED VERSION WITH EXPLICIT DATA
  formatAttackData(attacks, totalCount = null, warningMsg = null) {
    if (!attacks || attacks.length === 0) {
      return "No terrorist attacks found in the Global Terrorism Database matching your query.";
    }

    const displayCount = totalCount !== null ? totalCount : attacks.length;

    let context = `=== VERIFIED GLOBAL TERRORISM DATABASE RESULTS ===\n\n`;

    if (warningMsg) {
      context += `${warningMsg}\n\n`;
    }

    context += `âš ï¸ CRITICAL: USE ONLY THIS EXACT DATA - DO NOT MODIFY OR HALLUCINATE âš ï¸\n\n`;
    context += `VERIFICATION CODE: GTD-QUERY-${Date.now()}\n`;
    context += `TOTAL VERIFIED RESULTS: ${displayCount}\n`;

    if (displayCount > attacks.length) {
      context += `(Showing first ${attacks.length} results)\n`;
    }
    context += `\n`;

    attacks.forEach((attack, index) => {
      const cleaned = this.cleanMongoDBFields(attack);

      context += `â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—\n`;
      context += `â•‘ VERIFIED ATTACK #${index + 1}                                          â•‘\n`;
      context += `â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£\n`;
      context += `â•‘ VERIFIED Event ID: ${attack.eventid || "N/A"}\n`;
      context += `â•‘ VERIFIED Date: ${cleaned.formattedDate}\n`;
      context += `â•‘ VERIFIED Country: ${attack.country_txt || "Unknown"}\n`;
      context += `â•‘ VERIFIED City: ${attack.city || "Unknown"}\n`;
      context += `â•‘ VERIFIED Province: ${attack.provstate || "Unknown"}\n`;
      context += `â•‘ VERIFIED Region: ${attack.region_txt || "Unknown"}\n`;

      // Include coordinates if available and valid
      if (
        cleaned.latitude &&
        cleaned.longitude &&
        !isNaN(cleaned.latitude) &&
        !isNaN(cleaned.longitude)
      ) {
        context += `â•‘ VERIFIED Coordinates: ${cleaned.latitude}, ${cleaned.longitude}\n`;
      }

      context += `â•‘ VERIFIED Perpetrator: ${attack.gname || "Unknown"}\n`;
      context += `â•‘ VERIFIED Attack Type: ${attack.attacktype1_txt || "N/A"}\n`;
      context += `â•‘ VERIFIED Target Type: ${attack.targtype1_txt || "N/A"}\n`;
      context += `â•‘ VERIFIED Weapon: ${attack.weaptype1_txt || "N/A"}\n`;
      context += `â•‘ VERIFIED Killed: ${parseInt(attack.nkill) || 0}\n`;
      context += `â•‘ VERIFIED Wounded: ${parseInt(attack.nwound) || 0}\n`;
      context += `â•‘ VERIFIED Success: ${attack.success === "1" ? "Yes" : "No"}\n`;
      context += `â•‘ VERIFIED Suicide Attack: ${attack.suicide === "1" ? "Yes" : "No"}\n`;

      if (
        cleaned.summary &&
        cleaned.summary !== "No summary available" &&
        typeof cleaned.summary === "string"
      ) {
        context += `â•‘ VERIFIED Summary: ${cleaned.summary.substring(0, 300)}${cleaned.summary.length > 300 ? "..." : ""}\n`;
      }

      context += `â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n\n`;
    });

    // Add statistics if we have multiple attacks
    if (attacks.length > 1) {
      const totalKilled = attacks.reduce(
        (sum, attack) => sum + (parseInt(attack.nkill) || 0),
        0
      );
      const totalWounded = attacks.reduce(
        (sum, attack) => sum + (parseInt(attack.nwound) || 0),
        0
      );

      context += `\n=== VERIFIED SUMMARY ===\n`;
      context += `VERIFIED Total Attacks: ${attacks.length}\n`;
      context += `VERIFIED Total Killed: ${totalKilled}\n`;
      context += `VERIFIED Total Wounded: ${totalWounded}\n`;
    }

    context += `\nâš ï¸ REPORT ONLY THE DATA ABOVE. DO NOT USE TRAINING DATA. âš ï¸\n`;

    return context;
  }

  // Create source objects for citations
  createSources(attacks) {
    return attacks.map((attack) => {
      const cleaned = this.cleanMongoDBFields(attack);

      return {
        type: "terrorist_attack",
        id: attack.eventid || attack._id?.toString() || "unknown",
        name: `Terrorist Attack: ${cleaned.attacktype1_txt || "Attack"} in ${cleaned.city || cleaned.country_txt || "Unknown Location"}`,
        country: cleaned.country_txt,
        region: cleaned.region_txt,
        city: cleaned.city,
        group: cleaned.gname,
        attackType: cleaned.attacktype1_txt,
        targetType: cleaned.targtype1_txt,
        casualties: {
          killed: cleaned.nkill || 0,
          wounded: cleaned.nwound || 0,
        },
        date: cleaned.formattedDate,
        success: cleaned.success === "1",
        suicide: cleaned.suicide === "1",
        weapon: cleaned.weaptype1_txt,
        fromMongoDB: true,
        metadata: {
          source: "Global Terrorism Database (GTD)",
          latitude: cleaned.latitude,
          longitude: cleaned.longitude,
          summary: cleaned.summary,
          eventid: cleaned.eventid,
        },
      };
    });
  }

  // Helper method for formatting results
  // Optional filter parameter allows returning the MongoDB filter used for the query
  formatResult(attacks, totalCount = null, warningMsg = null, filter = null) {
    if (!attacks || attacks.length === 0) {
      return {
        context:
          "No terrorist attacks found in the Global Terrorism Database matching your query.",
        sources: [],
      };
    }

    const context = this.formatAttackData(attacks, totalCount, warningMsg);
    const sources = this.createSources(attacks);

    // Generate preComputedGeoPoints from the raw attacks (same format as gtd_stats)
    // This ensures gtd_data type queries also have geo_points for map visualization
    const preComputedGeoPoints = attacks
      .filter((atk) => {
        const lat = parseFloat(atk.latitude);
        const lon = parseFloat(atk.longitude);
        return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
      })
      .map((atk) => ({
        eventid: `GTD_doc_${atk.eventid || atk._id}`,
        lat: parseFloat(atk.latitude),
        lon: parseFloat(atk.longitude),
        weight:
          Math.min(
            1.0,
            ((parseInt(atk.nkill) || 0) * 2 + (parseInt(atk.nwound) || 0)) / 10
          ) || 0.5,
        iyear: parseInt(atk.iyear) || null,
        imonth: parseInt(atk.imonth) || null,
        iday: parseInt(atk.iday) || null,
        country_txt: atk.country_txt || "",
        region_txt: atk.region_txt || "",
        city: atk.city || "",
        attacktype1_txt: atk.attacktype1_txt || "",
        weaptype1_txt: atk.weaptype1_txt || "",
        nkill: parseInt(atk.nkill) || 0,
        nwound: parseInt(atk.nwound) || 0,
      }));

    // Calculate totals
    let killed = 0,
      wounded = 0;
    for (const atk of attacks) {
      killed += parseInt(atk.nkill) || 0;
      wounded += parseInt(atk.nwound) || 0;
    }

    const result = {
      context,
      sources,
      type: "gtd_data",
      count: totalCount || attacks.length,
      killed,
      wounded,
      preComputedGeoPoints,
      recordsWithCoordinates: preComputedGeoPoints.length,
    };

    // Include filter if provided - needed for pre-generating gtdFormattedData
    if (filter) {
      result.filter = filter;
    }

    return result;
  }

  // Main function to extract GTD context - COMPREHENSIVE VERSION
  // Accepts workspace, user, and thread to enforce composite session isolation (Figure 10 fix)
  async extractGTDContext(userQuery, workspace = null, user = null, thread = null) {
    console.log(`[GTD Extractor] Checking query: "${userQuery}"`);

    try {
      const sessionKey = this._buildContextKey(workspace, user, thread);
      // Parse the query FIRST to extract all conditions (now async)
      let conditions = await this.parseNaturalLanguageQuery(userQuery);
      const lowerQuery = userQuery.toLowerCase();
      const workspaceId = sessionKey;

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // DATE RANGE VALIDATION (GTD LIMIT: 1970-2017)
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      let outOfRange = false;
      let requestedYears = "";

      if (conditions._yearRange) {
        const start = parseInt(conditions._yearRange.start);
        const end = parseInt(conditions._yearRange.end);
        if (start > 2017) {
          outOfRange = true;
          requestedYears = `${start}-${end}`;
        }
      } else if (conditions.iyear) {
        // Handle single year or operator objects
        let year = 0;
        if (typeof conditions.iyear === "string") {
          year = parseInt(conditions.iyear);
        } else if (typeof conditions.iyear === "object") {
          // Evaluate complex year filters
          if (conditions.iyear.$gte) year = parseInt(conditions.iyear.$gte);
          else if (conditions.iyear.$gt) year = parseInt(conditions.iyear.$gt);
          else if (conditions.iyear.$eq) year = parseInt(conditions.iyear.$eq);
        }

        if (year > 2017) {
          outOfRange = true;
          requestedYears = year.toString();
        }
      }

      // Check for partial overlap (e.g. 2015-2020)
      let dateWarning = "";
      if (!outOfRange && conditions._yearRange) {
        const start = parseInt(conditions._yearRange.start);
        const end = parseInt(conditions._yearRange.end);

        if (end > 2017) {
          console.log(
            `[GTD Extractor] Partial date range detected: ${start}-${end}. Capping to 2017.`
          );

          // Cap the filter to 2017
          conditions._yearRange.end = 2017;

          // Generate strict warning text
          dateWarning = `âš ï¸ DATE RANGE CLARIFICATION: The user asked for data up to ${end}, but the Global Terrorism Database (GTD) ONLY contains data up to 2017. 
You MUST clarify in your answer that you are providing data for ${start}-2017 only. 
DO NOT state "between ${start} and ${end}" without this explicit qualification.`;
        }
      }

      if (outOfRange) {
        console.log(
          `[GTD Extractor] âš ï¸ Out of range date detected: ${requestedYears}`
        );
        const gtdSystemPrompt = require("./gtdSystemPrompt");
        const context = gtdSystemPrompt.buildContextWithJsonInstructions({
          count: 0,
          killed: 0,
          wounded: 0,
          filter: {},
          filterDescription: `in ${requestedYears}`,
          verificationCode: "OUT-OF-RANGE",
          outOfRange: true,
          requestedYears: requestedYears,
        });

        return {
          context: context,
          sources: [],
          type: "gtd_out_of_range",
        };
      }

      // FOLLOW-UP QUERY HANDLING: Check if this references a previous query
      const hasExtractedConditions =
        Object.keys(conditions).filter((k) => !k.startsWith("_")).length > 0;

      if (!hasExtractedConditions && this.isFollowUpQuery(userQuery)) {
        console.log(
          `[GTD Extractor] No conditions extracted, checking for stored context...`
        );
        const storedContext = this.getStoredContext(workspaceId);

        if (storedContext) {
          console.log(
            `[GTD Extractor] Applying stored context from previous query:`,
            storedContext
          );

          // Apply stored conditions (country, city, group, etc.)
          if (storedContext.country_txt)
            conditions.country_txt = storedContext.country_txt;
          if (storedContext.provstate)
            conditions.provstate = storedContext.provstate;
          if (storedContext.city) conditions.city = storedContext.city;
          if (storedContext.gname) conditions.gname = storedContext.gname;
          if (storedContext.iyear) conditions.iyear = storedContext.iyear;
          if (storedContext._yearRange)
            conditions._yearRange = storedContext._yearRange;
          if (storedContext.region_txt)
            conditions.region_txt = storedContext.region_txt;
          if (storedContext.attacktype1_txt)
            conditions.attacktype1_txt = storedContext.attacktype1_txt;
          if (storedContext.targtype1_txt)
            conditions.targtype1_txt = storedContext.targtype1_txt;
          if (storedContext.weaptype1_txt)
            conditions.weaptype1_txt = storedContext.weaptype1_txt;
          if (storedContext.success !== undefined)
            conditions.success = storedContext.success;
          if (storedContext.suicide !== undefined)
            conditions.suicide = storedContext.suicide;

          // Detect if asking for a sample/list from previous results
          const wantsList =
            /\b(list|show|give|details?|some|few|one|1|2|3|4|5)\b/i.test(
              lowerQuery
            );
          if (wantsList) {
            conditions._wantsSample = true;
            console.log(
              `[GTD Extractor] Detected request for sample from previous context`
            );
          }

          console.log(`[GTD Extractor] Merged conditions:`, conditions);
        }
      }

      // Get mongoose connection for direct queries
      const mongoose = require("mongoose");
      if (!mongoose.connection || mongoose.connection.readyState !== 1) {
        console.error(
          "[GTD Extractor] MongoDB connection not ready (readyState:",
          mongoose.connection?.readyState,
          ")"
        );
        return {
          context:
            "The database connection is not available right now. Please try again in a moment.",
          sources: [],
        };
      }
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      // CASE 1: Sample/Random attack request
      if (conditions._wantsSample) {
        console.log(`[GTD Extractor] Handling sample attack request`);

        // Build filter using helper function
        const filter = this.buildMongoDBFilter(conditions);

        // Get a random sample using aggregation
        const pipeline =
          Object.keys(filter).length > 0
            ? [{ $match: filter }, { $sample: { size: 1 } }]
            : [{ $sample: { size: 1 } }];

        const randomAttacks = await attacksCollection
          .aggregate(pipeline)
          .toArray();

        if (randomAttacks.length > 0) {
          const attack = randomAttacks[0];
          console.log(
            `[GTD Extractor] Returning VERIFIED sample attack: ${attack.eventid} from ${attack.country_txt}`
          );

          // STORE CONTEXT for follow-up queries - store the filter used
          this.storeContext(workspaceId, {
            country_txt: conditions.country_txt || attack.country_txt,
            provstate: conditions.provstate,
            city: conditions.city || attack.city,
            gname: conditions.gname,
            iyear: conditions.iyear,
            lastQuery: userQuery,
            lastResult: "sample",
          });

          // Create explicit context with verification
          const cleaned = this.cleanMongoDBFields(attack);
          const explicitContext = `=== VERIFIED ATTACK FROM GLOBAL TERRORISM DATABASE ===

âš ï¸ CRITICAL: USE ONLY THIS EXACT DATA - DO NOT HALLUCINATE OR MODIFY âš ï¸

â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘ VERIFIED EVENT ID: ${attack.eventid}                              â•‘
â•‘ VERIFIED DATE: ${cleaned.formattedDate}                           â•‘
â•‘ VERIFIED COUNTRY: ${attack.country_txt}                           â•‘
â•‘ VERIFIED CITY: ${attack.city || "Unknown"}                        â•‘
â•‘ VERIFIED PROVINCE: ${attack.provstate || "Unknown"}               â•‘
â•‘ VERIFIED REGION: ${attack.region_txt || "Unknown"}                â•‘
â•‘ VERIFIED LATITUDE: ${attack.latitude || "N/A"}                    â•‘
â•‘ VERIFIED LONGITUDE: ${attack.longitude || "N/A"}                  â•‘
â•‘ VERIFIED GROUP: ${attack.gname || "Unknown"}                      â•‘
â•‘ VERIFIED ATTACK TYPE: ${attack.attacktype1_txt || "Unknown"}      â•‘
â•‘ VERIFIED TARGET TYPE: ${attack.targtype1_txt || "Unknown"}        â•‘
â•‘ VERIFIED WEAPON: ${attack.weaptype1_txt || "Unknown"}             â•‘
â•‘ VERIFIED KILLED: ${parseInt(attack.nkill) || 0}                   â•‘
â•‘ VERIFIED WOUNDED: ${parseInt(attack.nwound) || 0}                 â•‘
â•‘ VERIFIED SUCCESS: ${attack.success === "1" ? "Yes" : "No"}        â•‘
â•‘ VERIFIED SUICIDE: ${attack.suicide === "1" ? "Yes" : "No"}        â•‘
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

SUMMARY: ${cleaned.summary || "No summary available"}

VERIFICATION CODE: GTD-SAMPLE-${attack.eventid}
 
âš ï¸ THIS IS A SINGLE SAMPLE ATTACK. There may be many others. Report ONLY on this specific event ID. âš ï¸`;

          return {
            context: explicitContext,
            sources: this.createSources([attack]),
            type: "gtd_sample",
          };
        } else {
          return {
            context:
              "No matching attacks found in the database for sample request.",
            sources: [],
          };
        }
      }

      // CASE 2: Statistical query - handle "how many" type questions
      if (conditions._isStatistical) {
        console.log(`[GTD Extractor] Handling statistical query`);
        console.log(
          `[GTD Extractor] Extracted conditions:`,
          JSON.stringify(conditions, null, 2)
        );

        // Check if we have filters (country, city, etc.) - expanded
        const hasFilters =
          conditions.country_txt ||
          conditions.city ||
          conditions.provstate ||
          conditions.gname ||
          conditions.iyear ||
          conditions._yearRange ||
          conditions.attacktype1_txt ||
          conditions.region_txt ||
          conditions.targtype1_txt ||
          conditions.weaptype1_txt ||
          conditions.success !== undefined ||
          conditions.suicide !== undefined ||
          conditions._minKilled !== undefined ||
          conditions._minWounded !== undefined;

        console.log(`[GTD Extractor] Has filters: ${hasFilters}`);
        console.log(`[GTD Extractor] City: ${conditions.city || "none"}`);
        console.log(`[GTD Extractor] Group: ${conditions.gname || "none"}`);
        console.log(
          `[GTD Extractor] Country: ${conditions.country_txt || "none"}`
        );

        if (hasFilters) {
          // Build aggregation pipeline for filtered count using helper
          const matchStage = this.buildMongoDBFilter(conditions);

          console.log(
            `[GTD Extractor] Statistical query with filters:`,
            JSON.stringify(matchStage, null, 2)
          );

          // Get count with filters
          const count = await attacksCollection.countDocuments(matchStage);

          console.log(`[GTD Extractor] FINAL COUNT with all filters: ${count}`);

          // Get aggregated casualty statistics
          const statsResult = await attacksCollection
            .aggregate([
              { $match: matchStage },
              {
                $group: {
                  _id: null,
                  totalKilled: {
                    $sum: {
                      $convert: {
                        input: "$nkill",
                        to: "int",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  },
                  totalWounded: {
                    $sum: {
                      $convert: {
                        input: "$nwound",
                        to: "int",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  },
                },
              },
            ])
            .toArray();

          const killed = statsResult[0]?.totalKilled || 0;
          const wounded = statsResult[0]?.totalWounded || 0;

          // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          // PRE-COMPUTE GEO_POINTS FROM THE SAME QUERY THAT PRODUCED COUNT
          // This ensures geo_points MATCH the count the LLM will report in its answer
          // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          let preComputedGeoPoints = [];
          let recordsWithCoordinates = 0; // Count of records that have valid geo coordinates

          if (count > 0) {
            try {
              // First, count how many records have valid coordinates
              recordsWithCoordinates = await attacksCollection.countDocuments({
                ...matchStage,
                latitude: { $exists: true, $ne: null, $ne: "", $ne: "NaN" },
                longitude: { $exists: true, $ne: null, $ne: "", $ne: "NaN" },
              });
              console.log(
                `[GTD Extractor] Records with valid coordinates: ${recordsWithCoordinates} of ${count} total`
              );

              // Configurable via GTD_WORLDWIDE_GEO_LIMIT env var (default: 200000)
              const geoLimitConfig =
                parseInt(process.env.GTD_WORLDWIDE_GEO_LIMIT) || 200000;
              const geoLimit = Math.min(recordsWithCoordinates, geoLimitConfig);
              const geoResults = await attacksCollection
                .aggregate([
                  { $match: matchStage },
                  {
                    $match: {
                      latitude: {
                        $exists: true,
                        $ne: null,
                        $ne: "",
                        $ne: "NaN",
                      },
                      longitude: {
                        $exists: true,
                        $ne: null,
                        $ne: "",
                        $ne: "NaN",
                      },
                    },
                  },
                  { $sample: { size: geoLimit } },
                  {
                    $project: {
                      eventid: 1,
                      latitude: 1,
                      longitude: 1,
                      iyear: 1,
                      country_txt: 1,
                      city: 1,
                      region_txt: 1,
                      provstate: 1,
                      attacktype1_txt: 1,
                      targtype1_txt: 1,
                      weaptype1_txt: 1,
                      gname: 1,
                      nkill: 1,
                      nwound: 1,
                      summary: 1,
                    },
                  },
                ])
                .toArray();

              preComputedGeoPoints = geoResults
                .map((r) => {
                  const lat = parseFloat(r.latitude);
                  const lon = parseFloat(r.longitude);
                  // Skip records with invalid coordinates
                  if (isNaN(lat) || isNaN(lon)) return null;
                  return {
                    eventid: r.eventid || `GTD_doc_${r._id}`,
                    lat: lat,
                    lon: lon,
                    weight:
                      Math.min(
                        1.0,
                        ((parseInt(r.nkill) || 0) * 2 +
                          (parseInt(r.nwound) || 0)) /
                          10
                      ) || 0.5,
                    iyear: parseInt(r.iyear) || null,
                    country_txt: r.country_txt || "",
                    region_txt: r.region_txt || "",
                    city: r.city || "",
                    provstate: r.provstate || "",
                    attacktype1_txt: r.attacktype1_txt || "",
                    targtype1_txt: r.targtype1_txt || "",
                    weaptype1_txt: r.weaptype1_txt || "",
                    gname: r.gname || "",
                    nkill: parseInt(r.nkill) || 0,
                    nwound: parseInt(r.nwound) || 0,
                    summary: r.summary || "",
                  };
                })
                .filter((p) => p !== null); // Remove invalid entries

              console.log(
                `[GTD Extractor] âœ… Pre-computed ${preComputedGeoPoints.length} geo_points from SAME query as count (${count})`
              );
            } catch (geoError) {
              console.error(
                `[GTD Extractor] âš ï¸ Failed to pre-compute geo_points:`,
                geoError.message
              );
              preComputedGeoPoints = [];
            }
          }

          // Build descriptive filter string
          const filterParts = [];
          if (conditions.country_txt)
            filterParts.push(`in ${conditions.country_txt}`);
          if (conditions.city) filterParts.push(`in ${conditions.city}`);
          if (conditions.provstate) {
            const displayProv = Array.isArray(conditions.provstate)
              ? conditions.provstate.join("/")
              : conditions.provstate;
            filterParts.push(`in ${displayProv}`);
          }
          if (conditions.gname) filterParts.push(`by ${conditions.gname}`);
          if (conditions._yearRange) {
            filterParts.push(
              `between ${conditions._yearRange.start} and ${conditions._yearRange.end}`
            );
          } else if (conditions.iyear) {
            filterParts.push(`in year ${conditions.iyear}`);
          }
          if (conditions.attacktype1_txt)
            filterParts.push(`of type ${conditions.attacktype1_txt}`);
          if (conditions.targtype1_txt)
            filterParts.push(`targeting ${conditions.targtype1_txt}`);
          if (conditions.weaptype1_txt)
            filterParts.push(`using ${conditions.weaptype1_txt}`);
          if (conditions._minKilled !== undefined)
            filterParts.push(`with at least ${conditions._minKilled} killed`);
          if (conditions.success === "1") filterParts.push(`successful`);
          if (conditions.suicide === "1") filterParts.push(`suicide attacks`);

          const filterDescription =
            filterParts.length > 0 ? filterParts.join(", ") : "";

          // STORE CONTEXT for follow-up queries
          this.storeContext(workspaceId, {
            country_txt: conditions.country_txt,
            provstate: conditions.provstate,
            city: conditions.city,
            gname: conditions.gname,
            iyear: conditions.iyear,
            _yearRange: conditions._yearRange,
            region_txt: conditions.region_txt,
            attacktype1_txt: conditions.attacktype1_txt,
            targtype1_txt: conditions.targtype1_txt,
            weaptype1_txt: conditions.weaptype1_txt,
            success: conditions.success,
            suicide: conditions.suicide,
            lastQuery: userQuery,
            lastResult: "stats",
            resultCount: count,
          });

          // ALWAYS return context, even if count is 0
          // Generate a SIMPLE filter for LLM to output (server will normalize it)
          // Don't use $expr format as LLMs have trouble with $ character
          const simpleFilter = {};
          if (conditions.country_txt)
            simpleFilter.country_txt = conditions.country_txt;
          if (conditions.provstate)
            simpleFilter.provstate = conditions.provstate;
          if (conditions.city) simpleFilter.city = conditions.city;
          if (conditions.gname) simpleFilter.gname = conditions.gname;
          if (conditions.suicide) simpleFilter.suicide = conditions.suicide;
          if (conditions.success) simpleFilter.success = conditions.success;
          if (conditions.attacktype1_txt)
            simpleFilter.attacktype1_txt = conditions.attacktype1_txt;
          if (conditions.targtype1_txt)
            simpleFilter.targtype1_txt = conditions.targtype1_txt;
          if (conditions.weaptype1_txt)
            simpleFilter.weaptype1_txt = conditions.weaptype1_txt;
          if (conditions._yearRange) {
            simpleFilter.year_start = parseInt(conditions._yearRange.start);
            simpleFilter.year_end = parseInt(conditions._yearRange.end);
          } else if (conditions.iyear) {
            simpleFilter.iyear = conditions.iyear;
          }

          const simpleFilterString = JSON.stringify(simpleFilter, null, 2);

          // Also generate the compass-ready filter for reference
          const compassFilterString = this.toCompassFilter({
            country_txt: conditions.country_txt,
            provstate: conditions.provstate,
            city: conditions.city,
            gname: conditions.gname,
            suicide: conditions.suicide,
            success: conditions.success,
            attacktype1_txt: conditions.attacktype1_txt,
            targtype1_txt: conditions.targtype1_txt,
            weaptype1_txt: conditions.weaptype1_txt,
            iyear: conditions._yearRange
              ? {
                  $gte: conditions._yearRange.start,
                  $lte: conditions._yearRange.end,
                }
              : conditions.iyear,
          });

          console.log(
            `[GTD Extractor] STATS RESULT: ${count} attacks for filter: ${filterDescription}`
          );

          // CRITICAL: If user asked to LIST/SHOW, append a small sample (Top 5) to the context
          // This prevents "listing" queries from crashing by limiting them to 5, while still satisfying the user
          let sampleListContext = "";
          if (conditions._includeSampleList && count > 0) {
            console.log(
              `[GTD Extractor] User requested list - fetching Top 5 sample for context`
            );
            const top5Attacks = await attacksCollection
              .aggregate([
                { $match: matchStage },
                {
                  $addFields: {
                    numericKill: {
                      $convert: {
                        input: "$nkill",
                        to: "int",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  },
                },
                { $sort: { numericKill: -1, iyear: -1 } },
                { $limit: 5 },
              ])
              .toArray();

            if (top5Attacks.length > 0) {
              sampleListContext += `\n\n=== REQUESTED SAMPLE LISTING (Top ${top5Attacks.length}) ===\n`;
              sampleListContext += `You may list these examples in your text response:\n\n`;

              top5Attacks.forEach((atk, i) => {
                const c = this.cleanMongoDBFields(atk);
                sampleListContext += `${i + 1}. ${c.formattedDate}: ${c.city || c.country_txt} - ${c.attacktype1_txt} by ${c.gname} (${c.nkill} killed)\n`;
                sampleListContext += `   Summary: ${c.summary ? c.summary.substring(0, 150) + "..." : "N/A"}\n`;
              });
              sampleListContext += `\n(User can see all ${count.toLocaleString()} points on the map)`;
            }

            // If user asked "by group", also provide Top 5 perpetrator groups
            if (/\bby\s+(?:perpetrator\s+)?groups?\b/i.test(lowerQuery)) {
              try {
                const topGroups = await attacksCollection
                  .aggregate([
                    { $match: matchStage },
                    {
                      $group: {
                        _id: "$gname",
                        attackCount: { $sum: 1 },
                        killed: {
                          $sum: {
                            $convert: {
                              input: "$nkill",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                        },
                      },
                    },
                    { $sort: { killed: -1, attackCount: -1 } },
                    { $limit: 5 },
                  ])
                  .toArray();

                if (topGroups.length > 0) {
                  sampleListContext += `\n\n=== DEADLIEST ATTACKS BREAKDOWN BY GROUP ===\n`;
                  sampleListContext += `Top perpetrator groups for this query:\n`;
                  topGroups.forEach((g, i) => {
                    sampleListContext += `${i + 1}. ${g._id || "Unknown"}: ${g.attackCount.toLocaleString()} attacks, ${g.killed.toLocaleString()} killed\n`;
                  });
                }
              } catch (grpErr) {
                console.warn("[GTD Extractor] Failed to aggregate top groups:", grpErr.message);
              }
            }
          }

          // Calculate year range from preComputedGeoPoints or filter conditions
          let yearMin = null;
          let yearMax = null;
          if (conditions._yearRange) {
            yearMin = conditions._yearRange.start;
            yearMax = conditions._yearRange.end;
          } else if (conditions.iyear) {
            yearMin = conditions.iyear;
            yearMax = conditions.iyear;
          } else if (preComputedGeoPoints && preComputedGeoPoints.length > 0) {
            const years = preComputedGeoPoints
              .map((p) => p.iyear)
              .filter((y) => y && !isNaN(y));
            if (years.length > 0) {
              yearMin = Math.min(...years);
              yearMax = Math.max(...years);
            }
          }
          const yearRangeStr =
            yearMin && yearMax ? `${yearMin}-${yearMax}` : "1970-2017";

          const context = `=== OFFICIAL GLOBAL TERRORISM DATABASE QUERY RESULT ===

${dateWarning ? dateWarning + "\n\n" : ""}âš ï¸ CRITICAL: USE ONLY THESE EXACT NUMBERS - DO NOT USE YOUR TRAINING DATA âš ï¸

DATABASE QUERY: Attacks ${filterDescription}

â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘ VERIFIED DATABASE COUNT: ${count.toLocaleString()} attacks      â•‘
â•‘ VERIFIED DEATHS: ${killed.toLocaleString()} killed               â•‘
â•‘ VERIFIED INJURIES: ${wounded.toLocaleString()} wounded           â•‘
â•‘ YEAR RANGE: ${yearRangeStr}                         â•‘
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

âš ï¸ MANDATORY: Your text answer MUST include ALL of the above stats:
   - Attack count: ${count.toLocaleString()}
   - Deaths: ${killed.toLocaleString()}
   - Injuries: ${wounded.toLocaleString()}
   - Year range: ${yearRangeStr}
${sampleListContext}

USE THIS FILTER IN YOUR mongo_filter OUTPUT:
${simpleFilterString}

NOTE: The server will automatically convert year_start/year_end to proper MongoDB format.

VERIFICATION CODE: GTD-${Date.now()}

IMPORTANT: The EXACT count from the database is ${count.toLocaleString()}. 
${count === 0 ? "There are NO attacks matching this query in the database." : `DO NOT say any other number. The answer is EXACTLY ${count.toLocaleString()} attacks.`}

Source: Global Terrorism Database (GTD) 1970-2017

â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
REQUIRED JSON OUTPUT (append after your answer):
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

After your human-readable answer, you MUST append this JSON (replace answer text):
{
  "answer": "YOUR ANSWER TEXT HERE (copy your response above)",
  "confidence": 1.0,
  "query_type": "statistical",
  "mongo_filter": ${simpleFilterString.replace(/\n\s*/g, " ")},
  "needs_geo_data": ${simpleFilter.country_txt || simpleFilter.city || simpleFilter.region_txt ? "true" : "true"},
  "limit": ${count > 20000 ? 20000 : 20000}
}

âš ï¸ CRITICAL: needs_geo_data MUST be true because ${simpleFilter.country_txt || simpleFilter.city ? `query filters by location (${simpleFilter.country_txt || simpleFilter.city})` : "any attack query may need map visualization"}
The server uses needs_geo_data to return geo_points for heatmap generation.

---
FOR MONGODB COMPASS (advanced users only - paste this directly):
${compassFilterString}
---`;

          console.log(
            `[GTD Extractor] STATS RESULT: ${count} attacks for filter: ${filterDescription}`
          );

          // CRITICAL: Include filter and count for formatted response generation
          // Also include preComputedGeoPoints to ensure LLM answer matches displayed geo_points
          return {
            context,
            sources: [],
            type: "gtd_stats",
            filter: matchStage, // The actual MongoDB filter used
            simpleFilter: simpleFilter, // The simplified filter for LLM
            count: count,
            killed: killed,
            wounded: wounded,
            conditions: conditions,
            preComputedGeoPoints: preComputedGeoPoints, // Geo_points from SAME query as count
            recordsWithCoordinates: recordsWithCoordinates, // Number of records with valid coordinates
          };
        } else {
          // No filters - return total database statistics
          const totalCount = await attacksCollection.estimatedDocumentCount();

          const statsResult = await attacksCollection
            .aggregate([
              {
                $group: {
                  _id: null,
                  totalKilled: {
                    $sum: {
                      $convert: {
                        input: "$nkill",
                        to: "int",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  },
                  totalWounded: {
                    $sum: {
                      $convert: {
                        input: "$nwound",
                        to: "int",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  },
                },
              },
            ])
            .toArray();

          const killed = statsResult[0]?.totalKilled || 0;
          const wounded = statsResult[0]?.totalWounded || 0;

          // Pre-compute geo points for worldwide queries so API consumers can
          // render a heatmap even when the LLM response does not include JSON.
          let preComputedGeoPoints = [];
          let recordsWithCoordinates = 0;

          if (totalCount > 0) {
            try {
              recordsWithCoordinates = await attacksCollection.countDocuments({
                latitude: { $exists: true, $nin: [null, "", "NaN"] },
                longitude: { $exists: true, $nin: [null, "", "NaN"] },
              });

              const geoLimitConfig =
                parseInt(process.env.GTD_WORLDWIDE_GEO_LIMIT) || 200000;
              const geoLimit = Math.min(recordsWithCoordinates, geoLimitConfig);

              const geoResults = await attacksCollection
                .aggregate([
                  {
                    $match: {
                      latitude: {
                        $exists: true,
                        $nin: [null, "", "NaN"],
                      },
                      longitude: {
                        $exists: true,
                        $nin: [null, "", "NaN"],
                      },
                    },
                  },
                  { $sample: { size: geoLimit } },
                  {
                    $project: {
                      eventid: 1,
                      latitude: 1,
                      longitude: 1,
                      iyear: 1,
                      country_txt: 1,
                      city: 1,
                      region_txt: 1,
                      provstate: 1,
                      attacktype1_txt: 1,
                      targtype1_txt: 1,
                      weaptype1_txt: 1,
                      gname: 1,
                      nkill: 1,
                      nwound: 1,
                      summary: 1,
                    },
                  },
                ])
                .toArray();

              preComputedGeoPoints = geoResults
                .map((r) => {
                  const lat = parseFloat(r.latitude);
                  const lon = parseFloat(r.longitude);
                  if (isNaN(lat) || isNaN(lon)) return null;

                  return {
                    eventid: r.eventid || `GTD_doc_${r._id}`,
                    lat,
                    lon,
                    weight:
                      Math.min(
                        1.0,
                        ((parseInt(r.nkill) || 0) * 2 +
                          (parseInt(r.nwound) || 0)) /
                          10
                      ) || 0.5,
                    iyear: parseInt(r.iyear) || null,
                    country_txt: r.country_txt || "",
                    region_txt: r.region_txt || "",
                    city: r.city || "",
                    provstate: r.provstate || "",
                    attacktype1_txt: r.attacktype1_txt || "",
                    targtype1_txt: r.targtype1_txt || "",
                    weaptype1_txt: r.weaptype1_txt || "",
                    gname: r.gname || "",
                    nkill: parseInt(r.nkill) || 0,
                    nwound: parseInt(r.nwound) || 0,
                    summary: r.summary || "",
                  };
                })
                .filter((point) => point !== null);
            } catch (geoError) {
              console.error(
                `[GTD Extractor] Failed to pre-compute worldwide geo_points:`,
                geoError.message
              );
              preComputedGeoPoints = [];
            }
          }

          const context = `=== GLOBAL TERRORISM DATABASE STATISTICS ===

âš ï¸ CRITICAL: USE ONLY THESE EXACT NUMBERS - DO NOT USE YOUR TRAINING DATA âš ï¸

DATABASE QUERY: Attacks across the globe (1970-2017)

â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘ VERIFIED DATABASE COUNT: ${totalCount.toLocaleString()} attacks                                      â•‘
â•‘ VERIFIED DEATHS: ${killed.toLocaleString()} killed                                              â•‘
â•‘ VERIFIED INJURIES: ${wounded.toLocaleString()} wounded                                          â•‘
â•‘ YEAR RANGE: 1970-2017                                                          â•‘
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

âš ï¸ MANDATORY: Your text answer MUST include ALL of the above stats:
   - Attack count: ${totalCount.toLocaleString()}
   - Deaths: ${killed.toLocaleString()}
   - Injuries: ${wounded.toLocaleString()}
   - Year range: 1970-2017

VERIFICATION CODE: GTD-GLOBAL-${Date.now()}

Note: The Global Terrorism Database (GTD) contains detailed information on terrorist attacks worldwide from 1970-2017.

After your human-readable answer, you MUST append this JSON (replace answer text):
{
  "answer": "YOUR ANSWER TEXT HERE (copy your response above)",
  "confidence": 1.0,
  "query_type": "statistical",
  "mongo_filter": {},
  "needs_geo_data": true,
  "limit": 20000
}

âš ï¸ CRITICAL: needs_geo_data MUST be true to show global heatmap visualization.
The server uses needs_geo_data to return geo_points for the heatmap.`;

          console.log(
            `[GTD Extractor] GLOBAL STATS RESULT: ${totalCount} attacks`
          );

          return {
            context,
            sources: [],
            type: "gtd_stats",
            count: totalCount,
            killed: killed,
            wounded: wounded,
            filter: {},
            simpleFilter: {},
            filterDescription: "across the globe",
            preComputedGeoPoints,
            recordsWithCoordinates,
          };
        }
      }

      // CASE 3: Event ID query - get specific attack
      if (conditions.eventid) {
        console.log(
          `[GTD Extractor] Searching for specific eventid: ${conditions.eventid}`
        );
        const result = await attackService.getAttackById(conditions.eventid);

        if (result.success && result.attack) {
          console.log(
            `[GTD Extractor] Found attack for eventid: ${conditions.eventid}`
          );
          // Pass the eventid filter for gtdFormattedData generation
          return this.formatResult([result.attack], null, null, {
            eventid: conditions.eventid,
          });
        } else {
          return {
            context: `No terrorist attack found with Event ID: ${conditions.eventid}`,
            sources: [],
          };
        }
      }

      // CASE 4: Filtered search (country, city, group, etc.)
      const searchFilters = this.buildMongoDBFilter(conditions);

      if (Object.keys(searchFilters).length > 0) {
        console.log(`[GTD Extractor] Searching with filters:`, searchFilters);

        // Determine sort order - if sorting by casualties, use aggregation
        let attacks;
        if (conditions._sortByCasualties) {
          // Use aggregation to sort by total casualties
          const pipeline = [
            { $match: searchFilters },
            {
              $addFields: {
                totalCasualties: {
                  $add: [
                    {
                      $convert: {
                        input: "$nkill",
                        to: "int",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                    {
                      $convert: {
                        input: "$nwound",
                        to: "int",
                        onError: 0,
                        onNull: 0,
                      },
                    },
                  ],
                },
              },
            },
            { $sort: { totalCasualties: -1, iyear: -1, imonth: -1, iday: -1 } },
            { $limit: 10 },
          ];
          attacks = await attacksCollection.aggregate(pipeline).toArray();
        } else {
          attacks = await attacksCollection
            .find(searchFilters)
            .limit(10)
            .sort({ iyear: -1, imonth: -1, iday: -1 })
            .toArray();
        }

        if (attacks.length > 0) {
          // Get total count for context
          const totalCount =
            await attacksCollection.countDocuments(searchFilters);
          console.log(
            `[GTD Extractor] Found ${attacks.length} attacks with filters (Total in DB: ${totalCount})`
          );

          // STORE CONTEXT for follow-up queries
          this.storeContext(workspaceId, {
            country_txt: conditions.country_txt,
            provstate: conditions.provstate,
            city: conditions.city,
            gname: conditions.gname,
            iyear: conditions.iyear,
            _yearRange: conditions._yearRange,
            region_txt: conditions.region_txt,
            attacktype1_txt: conditions.attacktype1_txt,
            targtype1_txt: conditions.targtype1_txt,
            weaptype1_txt: conditions.weaptype1_txt,
            success: conditions.success,
            suicide: conditions.suicide,
            lastQuery: userQuery,
            lastResult: "list",
            resultCount: totalCount,
          });

          // Pass searchFilters as the filter so gtdFormattedData can be generated
          return this.formatResult(
            attacks,
            totalCount,
            dateWarning,
            searchFilters
          );
        } else {
          // No results with filters
          const filterDesc = Object.entries(conditions)
            .filter(([k, v]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}="${v}"`)
            .join(", ");

          return {
            context: `No terrorist attacks found in the Global Terrorism Database matching: ${filterDesc}`,
            sources: [],
          };
        }
      }

      // CASE 5: No specific conditions - check if this is a GTD-related query at all
      if (!this.isGTDQuery(userQuery)) {
        console.log(`[GTD Extractor] Query not GTD-related, skipping`);
        return { context: "", sources: [] };
      }

      // CASE 6: GTD query but no extractable conditions - return general info
      console.log(`[GTD Extractor] GTD query but no extractable conditions`);
      const totalCount = await attacksCollection.estimatedDocumentCount();
      const context = `=== GLOBAL TERRORISM DATABASE INFO ===

The Global Terrorism Database (GTD) is available with ${totalCount.toLocaleString()} terrorist attack records from 1970-2017.

To query specific data, you can ask questions like:
- "How many attacks happened in Pakistan?"
- "Show attacks in Karachi"
- "List attacks by Taliban in 2010"
- "Give me details of attack 201112210009"
- "Show me a random attack"

Please be more specific about what information you're looking for.`;

      return { context, sources: [], type: "gtd_info" };
    } catch (error) {
      console.error("Error extracting GTD context:", error);
      return { context: "", sources: [] };
    }
  }

  // Main extractor function (for backward compatibility)
  async extractEmployeeContext(userQuery, workspace = null) {
    return await this.extractGTDContext(userQuery, workspace);
  }

  // Combine with existing context
  async augmentContextWithMongoDB(
    userQuery,
    existingContext,
    workspace = null
  ) {
    const gtdContext = await this.extractGTDContext(userQuery, workspace);

    if (
      !gtdContext.context ||
      gtdContext.context.includes("No terrorist attacks found")
    ) {
      return existingContext;
    }

    return {
      ...existingContext,
      contextTexts: [
        ...(existingContext.contextTexts || []),
        gtdContext.context,
      ],
      sources: [...(existingContext.sources || []), ...gtdContext.sources],
      hasGTDData: true,
      gtdSourceCount: gtdContext.sources.length,
    };
  }

  /**
   * Generate a MongoDB filter from a user query without executing it
   * This is useful for the two-step LLM pipeline where:
   * 1. LLM emits a query/filter
   * 2. Server executes and formats the response
   *
   * @param {string} userQuery - The natural language query
   * @returns {Object} - { conditions, filter, isValid, estimatedCount }
   */
  async generateFilter(userQuery) {
    try {
      const conditions = await this.parseNaturalLanguageQuery(userQuery);
      const filter = this.buildMongoDBFilter(conditions);
      const isValid = Object.keys(filter).length > 0;

      let estimatedCount = 0;
      if (isValid) {
        const mongoose = require("mongoose");
        if (!mongoose.connection || mongoose.connection.readyState !== 1) {
          console.error(
            "[generateFilter] MongoDB connection not ready (readyState:",
            mongoose.connection?.readyState,
            ")"
          );
          return {
            success: false,
            error: "Database connection not available",
            filter: {},
          };
        }
        const db = mongoose.connection.db;
        const attacksCollection = db.collection("attacks");
        estimatedCount = await attacksCollection.countDocuments(filter);
      }

      return {
        success: true,
        query: userQuery,
        conditions,
        filter,
        isValid,
        estimatedCount,
        filterString: JSON.stringify(filter),
      };
    } catch (error) {
      console.error("Error generating GTD filter:", error);
      return {
        success: false,
        query: userQuery,
        conditions: {},
        filter: {},
        isValid: false,
        estimatedCount: 0,
        error: error.message,
      };
    }
  }

  /**
   * Execute a filter and return formatted results
   * This combines filter execution with response formatting
   *
   * @param {Object} filter - MongoDB filter object
   * @param {Object} options - Execution options (limit, skip, etc.)
   * @returns {Object} - Formatted response with geo_points, segments, etc.
   */
  async executeAndFormat(filter, options = {}) {
    try {
      const attackService = require("./services/attackService");
      const gtdResponseFormatter = require("./gtdResponseFormatter");

      const {
        limit = 5000,
        skip = 0,
        includeGeoJSON = true,
        includeClusters = true,
        country = null,
        useRandomSample = true, // Default to random sampling for better distribution
      } = options;

      // Execute the filter with random sampling for representative results
      const result = await attackService.executeFilter(filter, {
        limit: Math.min(limit, 200000),
        skip,
        maxLimit: 200000,
        useRandomSample: useRandomSample,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          answer: `Error executing query: ${result.error}`,
          confidence: 0.0,
          total_count: 0,
          returned_count: 0,
          geo_points: [],
        };
      }

      // Generate human-readable answer
      const totalKilled = result.results.reduce(
        (sum, a) => sum + (parseInt(a.nkill) || 0),
        0
      );
      const totalWounded = result.results.reduce(
        (sum, a) => sum + (parseInt(a.nwound) || 0),
        0
      );
      const countryText = country ? ` in ${country}` : "";

      const humanReadableAnswer = `From the Global Terrorism Database (1970-2017), there were ${result.totalCount.toLocaleString()} recorded attacks${countryText}, resulting in ${totalKilled.toLocaleString()} fatalities and ${totalWounded.toLocaleString()} wounded.`;

      // Format the response
      const formattedResponse = gtdResponseFormatter.formatResponse(
        result,
        humanReadableAnswer,
        {
          country,
          includeGeoJSON,
          includeClusters,
          maxReturned: Math.min(limit, 200000),
        }
      );

      formattedResponse.success = true;
      formattedResponse.filter = filter;

      return formattedResponse;
    } catch (error) {
      console.error("Error in executeAndFormat:", error);
      return {
        success: false,
        error: error.message,
        answer: `Error: ${error.message}`,
        confidence: 0.0,
        total_count: 0,
        returned_count: 0,
        geo_points: [],
      };
    }
  }

  /**
   * Full pipeline: Parse query -> Generate filter -> Execute -> Format
   * This is the complete two-step pipeline in one call
   *
   * @param {string} userQuery - Natural language query
   * @param {Object} options - Options for execution and formatting
   * @returns {Object} - Complete formatted response
   */
  async queryAndFormat(userQuery, options = {}) {
    try {
      // Step 1: Parse and generate filter
      const filterResult = await this.generateFilter(userQuery);

      if (!filterResult.isValid) {
        return {
          success: false,
          error: "Could not parse query into a valid filter",
          query: userQuery,
          answer:
            "Unable to parse your query into a valid GTD database filter.",
          confidence: 0.0,
          total_count: 0,
          returned_count: 0,
          geo_points: [],
        };
      }

      // Extract country from conditions for answer generation
      const country = filterResult.conditions.country_txt || null;

      // Step 2: Execute and format
      const formattedResult = await this.executeAndFormat(filterResult.filter, {
        ...options,
        country,
      });

      // Add query metadata
      formattedResult.query = userQuery;
      formattedResult.conditions = filterResult.conditions;
      formattedResult.filter = filterResult.filter;

      return formattedResult;
    } catch (error) {
      console.error("Error in queryAndFormat:", error);
      return {
        success: false,
        error: error.message,
        query: userQuery,
        answer: `Error processing query: ${error.message}`,
        confidence: 0.0,
        total_count: 0,
        returned_count: 0,
        geo_points: [],
      };
    }
  }

  /**
   * LLM Fallback Handler: When LLM fails, return verified database results directly
   * This ensures the API always returns usable data even if LLM is unavailable
   *
   * @param {string} userQuery - Original user query
   * @param {Object} options - Options for execution and formatting
   * @param {Error|string} error - The error that occurred (for logging)
   * @returns {Object} - Formatted response with fallback indicator
   */
  async getFallbackResponse(userQuery, options = {}, error = null) {
    console.log(
      `[LLM Fallback] LLM failed, attempting fallback for: "${userQuery}"`
    );
    if (error) {
      console.log(`[LLM Fallback] Error was: ${error.message || error}`);
    }

    try {
      // Try to parse the query and execute directly
      const filterResult = await this.generateFilter(userQuery);

      if (!filterResult.isValid) {
        // Return minimal fallback response
        return {
          success: false,
          fallback: true,
          fallback_reason: "LLM unavailable and could not parse query",
          llm_error: error ? error.message || String(error) : "Unknown error",
          query: userQuery,
          answer:
            "I was unable to process your query due to a service issue. Please try again or rephrase your question.",
          confidence: 0.0,
          total_count: 0,
          returned_count: 0,
          geo_points: [],
          segments: [],
          clusters: [],
          geojson: { type: "FeatureCollection", features: [] },
        };
      }

      // Execute the query and format the response
      const country = filterResult.conditions.country_txt || null;
      const formattedResult = await this.executeAndFormat(filterResult.filter, {
        ...options,
        country,
      });

      // Mark as fallback response
      formattedResult.fallback = true;
      formattedResult.fallback_reason =
        "LLM unavailable - using direct database results";
      formattedResult.llm_error = error ? error.message || String(error) : null;
      formattedResult.query = userQuery;
      formattedResult.conditions = filterResult.conditions;
      formattedResult.filter = filterResult.filter;

      // Generate a simple fallback answer
      if (!formattedResult.answer || formattedResult.answer.includes("Error")) {
        const total = formattedResult.total_count || 0;
        const countryText = country ? ` in ${country}` : "";
        formattedResult.answer = `Found ${total.toLocaleString()} attacks${countryText} in the Global Terrorism Database (1970-2017). Note: LLM service was unavailable, showing raw database results.`;
      }

      console.log(
        `[LLM Fallback] Successfully generated fallback with ${formattedResult.total_count} results`
      );
      return formattedResult;
    } catch (fallbackError) {
      console.error(`[LLM Fallback] Fallback also failed:`, fallbackError);
      return {
        success: false,
        fallback: true,
        fallback_reason: "Both LLM and fallback failed",
        llm_error: error ? error.message || String(error) : "Unknown error",
        fallback_error: fallbackError.message,
        query: userQuery,
        answer: "Service temporarily unavailable. Please try again later.",
        confidence: 0.0,
        total_count: 0,
        returned_count: 0,
        geo_points: [],
        segments: [],
        clusters: [],
        geojson: { type: "FeatureCollection", features: [] },
      };
    }
  }
}

module.exports = new MongoDBContextExtractor();
