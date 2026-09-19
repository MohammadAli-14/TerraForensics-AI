const { reqBody } = require("../../../utils/http");
const {
  validatedRequest,
} = require("../../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../../utils/middleware/multiUserProtected");
const attackService = require("../../../utils/mongoDB/services/attackService");
const contextExtractor = require("../../../utils/mongoDB/contextExtractor");
const gtdResponseFormatter = require("../../../utils/mongoDB/gtdResponseFormatter");
const { gtdDebugEndpoints } = require("./debug");
const { gtdTestEndpoints } = require("./test");

function gtdEndpoints(app) {
  if (!app) return;

  // Add test endpoints first
  gtdTestEndpoints(app);

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC ENDPOINTS (No authentication required - for testing/development)
  // ══════════════════════════════════════════════════════════════════════════

  // Public pipeline endpoint - for external integrations without auth
  app.post("/api/gtd/public/pipeline", async (request, response) => {
    try {
      const {
        query: naturalLanguageQuery = "",
        filter: explicitFilter = null,
        limit = 5000,
        skip = 0,
        includeGeoJSON = true,
        includeClusters = true,
      } = reqBody(request);

      let result;

      // If explicit filter is provided (including empty {} for all global records)
      if (explicitFilter !== null && typeof explicitFilter === "object") {
        // CRITICAL: Normalize the filter for GTD's string-typed numeric fields
        const normalizedFilter =
          contextExtractor.normalizeGTDFilter(explicitFilter);

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

        result = await contextExtractor.executeAndFormat(normalizedFilter, {
          limit,
          skip,
          includeGeoJSON,
          includeClusters,
          country: detectedCountry,
        });
        result.query = naturalLanguageQuery || "Global Terrorism Database (1970–2017)";
        result.filter = normalizedFilter;
        result.originalFilter = explicitFilter; // Keep original for debugging
        result.compassFilter = contextExtractor.toCompassFilter(explicitFilter); // Compass-ready filter
      } else if (
        typeof naturalLanguageQuery === "string" &&
        naturalLanguageQuery.trim().length > 0
      ) {
        result = await contextExtractor.queryAndFormat(naturalLanguageQuery, {
          limit,
          skip,
          includeGeoJSON,
          includeClusters,
        });
        // Add compass filter if we have conditions
        if (result.filter) {
          result.compassFilter = contextExtractor.toCompassFilter(
            result.filter
          );
        }
      } else {
        // Default global GTD overview (no filter and empty query)
        result = await contextExtractor.executeAndFormat({}, {
          limit,
          skip,
          includeGeoJSON,
          includeClusters,
        });
        result.query = "Global Terrorism Database (1970–2017)";
        result.filter = {};
      }

      if (!result.success) {
        return response.status(400).json(result);
      }

      response.status(200).json(result);
    } catch (error) {
      console.error("Error in public GTD pipeline:", error);
      response.status(500).json({
        success: false,
        error: error.message,
        answer: `Error: ${error.message}`,
        confidence: 0.0,
        total_count: 0,
        returned_count: 0,
        geo_points: [],
      });
    }
  });

  // Public parse endpoint - for testing query parsing
  app.post("/api/gtd/public/parse", async (request, response) => {
    try {
      const { query: naturalLanguageQuery = "" } = reqBody(request);

      if (!naturalLanguageQuery || typeof naturalLanguageQuery !== "string") {
        return response.status(400).json({
          success: false,
          error: "A natural language query string is required.",
        });
      }

      const conditions =
        await contextExtractor.parseNaturalLanguageQuery(naturalLanguageQuery);
      const mongoFilter = contextExtractor.buildMongoDBFilter(conditions);

      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      let estimatedCount = 0;
      if (Object.keys(mongoFilter).length > 0) {
        estimatedCount = await attacksCollection.countDocuments(mongoFilter);
      }

      response.status(200).json({
        success: true,
        query: naturalLanguageQuery,
        conditions: conditions,
        filter: mongoFilter,
        filterString: JSON.stringify(mongoFilter),
        estimatedCount: estimatedCount,
        filterValid: Object.keys(mongoFilter).length > 0,
      });
    } catch (error) {
      console.error("Error in public GTD parse:", error);
      response.status(500).json({ success: false, error: error.message });
    }
  });

  // Health check endpoint
  app.get("/api/gtd/health", async (_, response) => {
    try {
      const mongoose = require("mongoose");
      const Attack = require("../../../utils/mongoDB/models/Attack");

      const health = {
        mongodb: {
          readyState: mongoose.connection.readyState,
          state:
            ["disconnected", "connected", "connecting", "disconnecting"][
              mongoose.connection.readyState
            ] || "unknown",
          host: mongoose.connection.host,
          name: mongoose.connection.name,
        },
        collections: {
          attacks: await Attack.countDocuments(),
        },
        sample: await Attack.findOne()
          .select("eventid country_txt city")
          .lean(),
        timestamp: new Date().toISOString(),
      };

      response.status(200).json(health);
    } catch (error) {
      response.status(500).json({
        error: error.message,
        readyState: mongoose?.connection?.readyState || "unknown",
      });
    }
  });

  // Direct query endpoint for debugging
  app.get("/api/gtd/direct/:eventid", async (request, response) => {
    try {
      const { eventid } = request.params;

      const mongoose = require("mongoose");
      if (mongoose.connection.readyState !== 1) {
        return response.status(500).json({ error: "MongoDB not connected" });
      }

      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      // Try multiple query formats
      let attack = await attacksCollection.findOne({ eventid: eventid });

      if (!attack) {
        // Try with regex for case-insensitive
        attack = await attacksCollection.findOne({
          eventid: { $regex: new RegExp(`^${eventid}$`, "i") },
        });
      }

      if (!attack) {
        // Try aggregation
        const results = await attacksCollection
          .aggregate([
            {
              $match: {
                $expr: {
                  $eq: [{ $toString: "$eventid" }, eventid],
                },
              },
            },
          ])
          .toArray();

        attack = results[0] || null;
      }

      if (!attack) {
        return response.status(404).json({
          success: false,
          message: "Attack not found",
          eventid: eventid,
        });
      }

      // Clean the data
      const cleanAttack = { ...attack };
      delete cleanAttack._id; // Remove MongoDB _id

      response.status(200).json({
        success: true,
        attack: cleanAttack,
      });
    } catch (error) {
      console.error("Direct query error:", error);
      response.status(500).json({ success: false, error: error.message });
    }
  });

  // Get attack statistics
  app.get(
    "/api/gtd/stats",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (_, response) => {
      try {
        const result = await attackService.getAttackStats();
        response.status(200).json(result);
      } catch (error) {
        console.error("Error getting GTD stats:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Search attacks
  app.post(
    "/api/gtd/search",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { query, limit = 10 } = reqBody(request);
        const result = await attackService.searchAttacks(query, limit);
        response.status(200).json(result);
      } catch (error) {
        console.error("Error searching GTD:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Unified query endpoint: accepts natural language or explicit MongoDB-style filter
  app.post(
    "/api/gtd/query",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const {
          query: naturalLanguageQuery = "",
          filter: explicitFilter = null,
          limit = 100,
          skip = 0,
        } = reqBody(request);

        let conditions = {};
        let mongoFilter = {};

        // Prefer an explicit filter when provided
        if (explicitFilter && typeof explicitFilter === "object") {
          mongoFilter = explicitFilter;
        } else if (
          naturalLanguageQuery &&
          typeof naturalLanguageQuery === "string"
        ) {
          // Derive filter from natural language using the existing GTD parser
          conditions =
            await contextExtractor.parseNaturalLanguageQuery(
              naturalLanguageQuery
            );
          mongoFilter = contextExtractor.buildMongoDBFilter(conditions);
        }

        // If no filter could be derived, fail fast
        if (!mongoFilter || Object.keys(mongoFilter).length === 0) {
          return response.status(400).json({
            success: false,
            error: "No queryable GTD filter could be derived from the input.",
          });
        }

        const result = await attackService.executeFilter(mongoFilter, {
          limit,
          skip,
          useRandomSample: true, // Use random sampling for API queries to get representative distribution
        });

        if (!result.success) {
          return response
            .status(500)
            .json({ success: false, error: result.error });
        }

        response.status(200).json({
          success: true,
          query: naturalLanguageQuery,
          conditions,
          filter: mongoFilter,
          totalCount: result.totalCount,
          returnedCount: result.returnedCount,
          truncated: result.totalCount > result.limit + result.skip,
          limit: result.limit,
          skip: result.skip,
          results: result.results,
        });
      } catch (error) {
        console.error("Error running GTD query:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Formatted query endpoint - returns full heatmap JSON schema
  // This is the main endpoint for the two-step LLM pipeline
  app.post(
    "/api/gtd/query-formatted",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const {
          query: naturalLanguageQuery = "",
          filter: explicitFilter = null,
          limit = 5000,
          skip = 0,
          includeGeoJSON = true,
          includeClusters = true,
        } = reqBody(request);

        let conditions = {};
        let mongoFilter = {};
        let detectedCountry = null;

        // Prefer an explicit filter when provided
        if (explicitFilter && typeof explicitFilter === "object") {
          mongoFilter = explicitFilter;
          // Try to extract country from filter
          if (explicitFilter.country_txt) {
            if (typeof explicitFilter.country_txt === "string") {
              detectedCountry = explicitFilter.country_txt;
            } else if (explicitFilter.country_txt.$regex) {
              // Extract from regex pattern
              const match = explicitFilter.country_txt.$regex.match(
                /\^\\s\*([^\\]+)\\s\*\$/
              );
              detectedCountry = match ? match[1] : null;
            }
          }
        } else if (
          naturalLanguageQuery &&
          typeof naturalLanguageQuery === "string"
        ) {
          // Derive filter from natural language using the existing GTD parser
          conditions =
            await contextExtractor.parseNaturalLanguageQuery(
              naturalLanguageQuery
            );
          mongoFilter = contextExtractor.buildMongoDBFilter(conditions);
          detectedCountry = conditions.country_txt || null;
        }

        // If no filter could be derived, fail fast
        if (!mongoFilter || Object.keys(mongoFilter).length === 0) {
          return response.status(400).json({
            success: false,
            error: "No queryable GTD filter could be derived from the input.",
            answer: "Unable to parse query into a valid GTD filter.",
            confidence: 0.0,
            heatmap_schema: "segment",
            total_count: 0,
            returned_count: 0,
            truncated: false,
            max_returned: limit,
            geo_points: [],
            segments: [],
          });
        }

        // Execute the query with higher limit for formatted responses
        const result = await attackService.executeFilter(mongoFilter, {
          limit: Math.min(limit, 200000), // Allow up to 200k for worldwide/country queries
          skip,
          maxLimit: 200000,
          useRandomSample: true, // Use random sampling for representative distribution across all years
        });

        if (!result.success) {
          return response
            .status(500)
            .json({ success: false, error: result.error });
        }

        // Generate human-readable answer
        const countryText = detectedCountry ? ` in ${detectedCountry}` : "";
        const yearText = conditions.iyear
          ? ` in ${conditions.iyear}`
          : conditions._yearRange
            ? ` between ${conditions._yearRange.start} and ${conditions._yearRange.end}`
            : "";
        const cityText = conditions.city ? ` in ${conditions.city}` : "";

        const totalKilled = result.results.reduce(
          (sum, a) => sum + (parseInt(a.nkill) || 0),
          0
        );
        const totalWounded = result.results.reduce(
          (sum, a) => sum + (parseInt(a.nwound) || 0),
          0
        );

        const humanReadableAnswer = `From the Global Terrorism Database (1970-2017), there were ${result.totalCount.toLocaleString()} recorded attacks${countryText}${cityText}${yearText}, resulting in ${totalKilled.toLocaleString()} fatalities and ${totalWounded.toLocaleString()} wounded.`;

        // Format the response using the GTD response formatter
        const formattedResponse = gtdResponseFormatter.formatResponse(
          result,
          humanReadableAnswer,
          {
            country: detectedCountry,
            query: naturalLanguageQuery,
            includeGeoJSON,
            includeClusters,
            maxReturned: Math.min(limit, 200000),
          }
        );

        // Add query metadata
        formattedResponse.query_metadata = {
          original_query: naturalLanguageQuery,
          parsed_conditions: conditions,
          mongo_filter: mongoFilter,
          execution_limit: result.limit,
          execution_skip: result.skip,
        };

        response.status(200).json(formattedResponse);
      } catch (error) {
        console.error("Error running formatted GTD query:", error);
        response.status(500).json({
          success: false,
          error: error.message,
          answer: `Error processing query: ${error.message}`,
          confidence: 0.0,
          heatmap_schema: "segment",
          total_count: 0,
          returned_count: 0,
          truncated: false,
          max_returned: 5000,
          geo_points: [],
          segments: [],
        });
      }
    }
  );

  // Parse-only endpoint - returns just the MongoDB filter without executing
  // This allows the LLM to emit a filter that can be validated before execution
  app.post(
    "/api/gtd/parse-query",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { query: naturalLanguageQuery = "" } = reqBody(request);

        if (!naturalLanguageQuery || typeof naturalLanguageQuery !== "string") {
          return response.status(400).json({
            success: false,
            error: "A natural language query string is required.",
          });
        }

        // Parse the query to extract conditions
        const conditions =
          await contextExtractor.parseNaturalLanguageQuery(
            naturalLanguageQuery
          );
        const mongoFilter = contextExtractor.buildMongoDBFilter(conditions);

        // Get a quick count without fetching all results
        const mongoose = require("mongoose");
        const db = mongoose.connection.db;
        const attacksCollection = db.collection("attacks");

        let estimatedCount = 0;
        if (Object.keys(mongoFilter).length > 0) {
          estimatedCount = await attacksCollection.countDocuments(mongoFilter);
        }

        response.status(200).json({
          success: true,
          query: naturalLanguageQuery,
          conditions: conditions,
          filter: mongoFilter,
          estimatedCount: estimatedCount,
          filterValid: Object.keys(mongoFilter).length > 0,
          suggestedLimit: Math.min(estimatedCount, 200000),
          message:
            estimatedCount > 200000
              ? `Query matches ${estimatedCount} records. Consider using pagination or increasing limit.`
              : `Query matches ${estimatedCount} records.`,
        });
      } catch (error) {
        console.error("Error parsing GTD query:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Complete pipeline endpoint - Parse, Execute, and Format in one call
  // This is the main endpoint for the full LLM-to-heatmap pipeline
  app.post(
    "/api/gtd/pipeline",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const {
          query: naturalLanguageQuery = "",
          filter: explicitFilter = null,
          limit = 5000,
          skip = 0,
          includeGeoJSON = true,
          includeClusters = true,
        } = reqBody(request);

        let result;

        // If explicit filter is provided, use it directly
        if (
          explicitFilter &&
          typeof explicitFilter === "object" &&
          Object.keys(explicitFilter).length > 0
        ) {
          // CRITICAL: Normalize the filter for GTD's string-typed numeric fields
          const normalizedFilter =
            contextExtractor.normalizeGTDFilter(explicitFilter);

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

          result = await contextExtractor.executeAndFormat(normalizedFilter, {
            limit,
            skip,
            includeGeoJSON,
            includeClusters,
            country: detectedCountry,
          });
          result.query = naturalLanguageQuery || "(explicit filter)";
          result.filter = normalizedFilter;
          result.originalFilter = explicitFilter; // Keep original for debugging
        }
        // Otherwise, use natural language query
        else if (
          naturalLanguageQuery &&
          typeof naturalLanguageQuery === "string"
        ) {
          result = await contextExtractor.queryAndFormat(naturalLanguageQuery, {
            limit,
            skip,
            includeGeoJSON,
            includeClusters,
          });
        } else {
          return response.status(400).json({
            success: false,
            error:
              "Either 'query' (natural language) or 'filter' (MongoDB filter object) is required.",
          });
        }

        if (!result.success) {
          return response.status(400).json(result);
        }

        response.status(200).json(result);
      } catch (error) {
        console.error("Error in GTD pipeline:", error);
        response.status(500).json({
          success: false,
          error: error.message,
          answer: `Error: ${error.message}`,
          confidence: 0.0,
          total_count: 0,
          returned_count: 0,
          geo_points: [],
        });
      }
    }
  );

  // Get attacks by year
  app.get(
    "/api/gtd/year/:year",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { year } = request.params;
        const { limit = 20 } = request.query;
        const result = await attackService.getAttacksByYear(
          year,
          parseInt(limit)
        );
        response.status(200).json(result);
      } catch (error) {
        console.error("Error getting attacks by year:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Get attacks by country
  app.get(
    "/api/gtd/country/:country",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { country } = request.params;
        const { limit = 20 } = request.query;
        const result = await attackService.getAttacksByCountry(
          country,
          parseInt(limit)
        );
        response.status(200).json(result);
      } catch (error) {
        console.error("Error getting attacks by country:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Get attacks by group
  app.get(
    "/api/gtd/group/:group",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { group } = request.params;
        const { limit = 20 } = request.query;
        const result = await attackService.getAttacksByGroup(
          group,
          parseInt(limit)
        );
        response.status(200).json(result);
      } catch (error) {
        console.error("Error getting attacks by group:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Advanced search
  app.post(
    "/api/gtd/advanced-search",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const criteria = reqBody(request);
        const result = await attackService.advancedSearch(criteria);
        response.status(200).json(result);
      } catch (error) {
        console.error("Error in advanced search:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Get timeline data
  app.get(
    "/api/gtd/timeline/:startYear/:endYear",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { startYear, endYear } = request.params;
        const { groupBy = "year" } = request.query;
        const result = await attackService.getTimeline(
          startYear,
          endYear,
          groupBy
        );
        response.status(200).json(result);
      } catch (error) {
        console.error("Error getting timeline:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Add debug endpoints
  gtdDebugEndpoints(app);
}

module.exports = { gtdEndpoints };
