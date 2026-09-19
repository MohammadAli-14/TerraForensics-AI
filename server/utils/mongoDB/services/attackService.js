const Attack = require("../models/Attack");
const MongoDBConnection = require("../connection");

class AttackService {
  // IMPROVED search that intelligently parses the query
  async searchAttacks(query, limit = 10) {
    try {
      console.log(`[AttackService] Searching for: "${query}"`);

      // Use direct MongoDB driver for better control
      const mongoose = require("mongoose");
      if (!mongoose.connection || mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
        return [];
      }
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      // Build a smart query based on extracted terms
      const searchQuery = {};
      const lowerQuery = query.toLowerCase();

      // Check for numeric eventid (12 digits)
      const eventIdMatch = query.match(/\d{12}/);
      if (eventIdMatch) {
        searchQuery.eventid = eventIdMatch[0];
        console.log(`[AttackService] Searching by eventid: ${eventIdMatch[0]}`);
      } else {
        // SMART TERM EXTRACTION - Don't use full sentence as regex!
        const extractedTerms = this.extractSearchTerms(query);

        if (extractedTerms.length > 0) {
          // Build OR conditions only for meaningful extracted terms
          const orConditions = [];

          for (const term of extractedTerms) {
            // Each term gets checked against relevant fields
            orConditions.push({ country_txt: { $regex: term, $options: "i" } });
            orConditions.push({ city: { $regex: term, $options: "i" } });
            orConditions.push({ gname: { $regex: term, $options: "i" } });
          }

          if (orConditions.length > 0) {
            searchQuery.$or = orConditions;
          }
        }
      }

      // If we couldn't build a meaningful query, return empty
      if (Object.keys(searchQuery).length === 0) {
        console.log(
          `[AttackService] No meaningful search terms extracted, returning empty`
        );
        return { success: true, attacks: [] };
      }

      console.log(
        `[AttackService] Executing query:`,
        JSON.stringify(searchQuery, null, 2)
      );

      const attacks = await attacksCollection
        .find(searchQuery)
        .limit(limit)
        .sort({ iyear: -1, imonth: -1, iday: -1 })
        .toArray();

      // Clean the data
      const cleanedAttacks = attacks.map((attack) =>
        this.cleanAttackData(attack)
      );

      console.log(`[AttackService] Found ${cleanedAttacks.length} attacks`);
      return { success: true, attacks: cleanedAttacks };
    } catch (error) {
      console.error("Error searching attacks:", error);
      return { success: false, error: error.message };
    }
  }

  // Extract meaningful search terms from natural language query
  extractSearchTerms(query) {
    const terms = [];
    const lowerQuery = query.toLowerCase();

    // List of known searchable terms (countries, cities, groups)
    const knownTerms = {
      countries: [
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
        "nigeria",
        "somalia",
        "kenya",
        "usa",
        "uk",
        "france",
        "germany",
        "spain",
        "russia",
        "philippines",
        "indonesia",
        "thailand",
        "bangladesh",
        "sri lanka",
        "colombia",
        "peru",
        "mexico",
        "brazil",
        "ireland",
        "ukraine",
      ],
      cities: [
        "karachi",
        "lahore",
        "peshawar",
        "quetta",
        "islamabad",
        "baghdad",
        "kabul",
        "kandahar",
        "mosul",
        "aleppo",
        "damascus",
        "mumbai",
        "delhi",
        "kashmir",
        "jerusalem",
        "beirut",
        "tripoli",
        "cairo",
        "london",
        "paris",
        "madrid",
        "new york",
        "boston",
      ],
      groups: [
        "taliban",
        "al-qaeda",
        "isis",
        "isil",
        "islamic state",
        "boko haram",
        "al-shabaab",
        "hezbollah",
        "hamas",
        "ira",
        "eta",
        "farc",
        "ltte",
        "pkk",
        "ttp",
      ],
    };

    // Check for known countries
    for (const country of knownTerms.countries) {
      if (lowerQuery.includes(country)) {
        terms.push(country.charAt(0).toUpperCase() + country.slice(1));
      }
    }

    // Check for known cities
    for (const city of knownTerms.cities) {
      if (lowerQuery.includes(city)) {
        terms.push(city.charAt(0).toUpperCase() + city.slice(1));
      }
    }

    // Check for known groups
    for (const group of knownTerms.groups) {
      if (lowerQuery.includes(group)) {
        terms.push(group);
      }
    }

    // Extract years
    const yearMatch = query.match(/\b(19[7-9][0-9]|20[0-2][0-9])\b/);
    if (yearMatch) {
      terms.push(yearMatch[0]);
    }

    console.log(`[AttackService] Extracted search terms:`, terms);
    return terms;
  }

  // Clean attack data - IMPROVED
  cleanAttackData(attack) {
    const cleaned = { ...attack };

    // Remove MongoDB _id
    delete cleaned._id;

    // Handle BSON types
    const cleanBSONValue = (value) => {
      if (!value) return null;
      if (typeof value === "object") {
        // Handle BSON types
        if (value.$numberDouble === "NaN") return null;
        if (value.$numberInt) return parseInt(value.$numberInt);
        if (value.$numberDouble) return parseFloat(value.$numberDouble);
        if (value.$date) return new Date(value.$date);
        return null;
      }
      return value;
    };

    cleaned.summary = cleanBSONValue(cleaned.summary);
    cleaned.motive = cleanBSONValue(cleaned.motive);

    // Convert numeric fields
    cleaned.nkill = parseInt(cleaned.nkill) || 0;
    cleaned.nwound = parseInt(cleaned.nwound) || 0;

    // Handle latitude/longitude
    cleaned.latitude = parseFloat(cleaned.latitude) || null;
    cleaned.longitude = parseFloat(cleaned.longitude) || null;

    // Format date
    const month =
      cleaned.imonth === "0" || cleaned.imonth === "00" || !cleaned.imonth
        ? "Unknown"
        : cleaned.imonth;
    const day =
      cleaned.iday === "0" || cleaned.iday === "00" || !cleaned.iday
        ? "Unknown"
        : cleaned.iday;
    cleaned.formattedDate = `${month}/${day}/${cleaned.iyear}`;

    return cleaned;
  }

  // SIMPLIFIED getAttackById
  async getAttackById(eventId) {
    try {
      console.log(`[AttackService] Getting attack by ID: "${eventId}"`);

      // Use direct MongoDB driver
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      // Try multiple formats
      let attack = await attacksCollection.findOne({ eventid: eventId });

      if (!attack) {
        attack = await attacksCollection.findOne({ eventid: String(eventId) });
      }

      if (!attack) {
        return { success: false, error: "Attack not found" };
      }

      const cleanedAttack = this.cleanAttackData(attack);
      return { success: true, attack: cleanedAttack };
    } catch (error) {
      console.error("[AttackService] Error getting attack:", error.message);
      return { success: false, error: error.message };
    }
  }

  // SIMPLIFIED advanced search - no regex wrapping
  async advancedSearch(criteria, limit = 20) {
    try {
      console.log(`[AttackService] Advanced search with criteria:`, criteria);

      // Use direct MongoDB driver
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      const query = {};

      // Simple field mapping - NO REGEX WRAPPING
      if (criteria.country_txt && typeof criteria.country_txt === "string") {
        query.country_txt = { $regex: criteria.country_txt, $options: "i" };
      }
      if (criteria.region_txt && typeof criteria.region_txt === "string") {
        query.region_txt = { $regex: criteria.region_txt, $options: "i" };
      }
      if (criteria.city && typeof criteria.city === "string") {
        query.city = { $regex: criteria.city, $options: "i" };
      }
      if (criteria.gname && typeof criteria.gname === "string") {
        query.gname = { $regex: criteria.gname, $options: "i" };
      }
      if (
        criteria.attacktype1_txt &&
        typeof criteria.attacktype1_txt === "string"
      ) {
        query.attacktype1_txt = {
          $regex: criteria.attacktype1_txt,
          $options: "i",
        };
      }
      if (
        criteria.targtype1_txt &&
        typeof criteria.targtype1_txt === "string"
      ) {
        query.targtype1_txt = { $regex: criteria.targtype1_txt, $options: "i" };
      }
      if (criteria.iyear && typeof criteria.iyear === "string") {
        query.iyear = criteria.iyear;
      }
      if (criteria.eventid && typeof criteria.eventid === "string") {
        query.eventid = criteria.eventid;
      }

      console.log(
        `[AttackService] Advanced search query:`,
        JSON.stringify(query, null, 2)
      );

      const attacks = await attacksCollection
        .find(query)
        .limit(limit)
        .sort({ iyear: -1, imonth: -1, iday: -1 })
        .toArray();

      const cleanedAttacks = attacks.map((attack) =>
        this.cleanAttackData(attack)
      );

      return { success: true, attacks: cleanedAttacks };
    } catch (error) {
      console.error("Error in advanced search:", error);
      return { success: false, error: error.message };
    }
  }

  // Execute an arbitrary MongoDB filter with count and bounded limits
  async executeFilter(filter = {}, options = {}) {
    try {
      const {
        limit = 100,
        skip = 0,
        sort = { iyear: -1, imonth: -1, iday: -1 },
        projection = null,
        maxLimit = 200000, // Allow up to 200k for worldwide queries and large countries
        countOnly = false, // If true, only return count without fetching records
        useRandomSample = false, // If true, use $sample for random distribution across all matching records
        skipClean = false, // If true, skip cleanAttackData to reduce memory (for geo-point-only paths)
      } = options;

      const mongoose = require("mongoose");
      if (!mongoose.connection || mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
        return {
          success: false,
          error: "MongoDB connection is offline. Verify MONGODB_URI in server/.env",
          totalCount: 0,
          returnedCount: 0,
          results: [],
        };
      }
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      // Get total count first (needed for all queries)
      // Use estimatedDocumentCount() for empty filters — avoids 32MB sort limit on Atlas
      const isEmptyFilter = !filter || Object.keys(filter).length === 0;
      const totalCount = isEmptyFilter
        ? await attacksCollection.estimatedDocumentCount()
        : await attacksCollection.countDocuments(filter);

      // For count-only queries, return just the count with empty results
      if (countOnly) {
        console.log(
          `[Attack Service] COUNT-ONLY mode: returning count ${totalCount} without fetching records`
        );
        return {
          success: true,
          totalCount,
          returnedCount: 0,
          limit: 0,
          skip: 0,
          results: [],
          isCountOnly: true,
        };
      }

      // Enforce reasonable bounds - allow higher limits for full country queries
      const parsedLimit = Math.max(
        1,
        Math.min(parseInt(limit, 10) || 1, maxLimit)
      );
      const parsedSkip = Math.max(0, parseInt(skip, 10) || 0);

      let results;

      // Use random sampling for large datasets to get representative distribution
      // This is especially important for date range queries spanning many years
      if (useRandomSample && parsedLimit < totalCount) {
        // Random SAMPLE — only when we need a subset, NOT when loading all records.
        // $sample with size >= totalCount causes full-collection in-memory shuffle
        // which crashes local MongoDB and exceeds Atlas memory limits.
        console.log(
          `[Attack Service] Using $sample aggregation for random distribution (${parsedLimit} of ${totalCount})`
        );

        const pipeline = [];

        // Add $match stage if filter is not empty
        if (!isEmptyFilter) {
          pipeline.push({ $match: filter });
        }

        // $sample only for a true subset
        pipeline.push({ $sample: { size: parsedLimit } });

        // Add projection if specified
        if (projection) {
          pipeline.push({ $project: projection });
        }

        results = await attacksCollection
          .aggregate(pipeline, { allowDiskUse: true })
          .toArray();
      } else if (
        parsedLimit >= totalCount ||
        (isEmptyFilter && useRandomSample)
      ) {
        // User wants ALL records (or close to all) — plain .find() with NO sort.
        // Sorting 181K docs by multiple fields exceeds 32MB memory limit.
        // No $sample needed when grabbing everything.
        console.log(
          `[Attack Service] Loading all ${totalCount} records without sort (limit=${parsedLimit})`
        );
        const cursor = attacksCollection.find(
          isEmptyFilter ? {} : filter,
          projection ? { projection } : undefined
        );

        results = await cursor.toArray();
      } else {
        // Standard query with sort for filtered/smaller datasets
        console.log(
          `[Attack Service] Standard find+sort query (${parsedLimit} records)`
        );
        const cursor = attacksCollection
          .find(filter, projection ? { projection } : undefined)
          .sort(sort)
          .skip(parsedSkip)
          .limit(parsedLimit)
          .allowDiskUse();

        results = await cursor.toArray();
      }

      return {
        success: true,
        totalCount,
        returnedCount: results.length,
        limit: parsedLimit,
        skip: parsedSkip,
        results: skipClean
          ? results
          : results.map((attack) => this.cleanAttackData(attack)),
        usedRandomSample: useRandomSample && totalCount > parsedLimit,
      };
    } catch (error) {
      console.error("Error executing GTD filter:", error);
      return { success: false, error: error.message };
    }
  }

  // Other methods remain mostly the same but use direct MongoDB
  async getAttacksByYear(year, limit = 20) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      const attacks = await attacksCollection
        .find({ iyear: year })
        .limit(limit)
        .sort({ imonth: 1, iday: 1 })
        .toArray();

      const cleanedAttacks = attacks.map((attack) =>
        this.cleanAttackData(attack)
      );
      return { success: true, attacks: cleanedAttacks };
    } catch (error) {
      console.error("Error getting attacks by year:", error);
      return { success: false, error: error.message };
    }
  }

  async getAttacksByCountry(country, limit = 20) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      const attacks = await attacksCollection
        .find({
          country_txt: { $regex: country, $options: "i" },
        })
        .limit(limit)
        .sort({ iyear: -1 })
        .toArray();

      const cleanedAttacks = attacks.map((attack) =>
        this.cleanAttackData(attack)
      );
      return { success: true, attacks: cleanedAttacks };
    } catch (error) {
      console.error("Error getting attacks by country:", error);
      return { success: false, error: error.message };
    }
  }

  async getAttacksByRegion(region, limit = 20) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      const attacks = await attacksCollection
        .find({
          region_txt: { $regex: region, $options: "i" },
        })
        .limit(limit)
        .sort({ iyear: -1 })
        .toArray();

      const cleanedAttacks = attacks.map((attack) =>
        this.cleanAttackData(attack)
      );
      return { success: true, attacks: cleanedAttacks };
    } catch (error) {
      console.error("Error getting attacks by region:", error);
      return { success: false, error: error.message };
    }
  }

  async getAttacksByGroup(group, limit = 20) {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      const attacks = await attacksCollection
        .find({
          gname: { $regex: group, $options: "i" },
        })
        .limit(limit)
        .sort({ iyear: -1, imonth: -1, iday: -1 })
        .toArray();

      const cleanedAttacks = attacks.map((attack) =>
        this.cleanAttackData(attack)
      );
      return { success: true, attacks: cleanedAttacks };
    } catch (error) {
      console.error("Error getting attacks by group:", error);
      return { success: false, error: error.message };
    }
  }

  async getTimeline(startYear, endYear, groupBy = "year") {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      // Build date range filter
      const yearFilter = {};
      if (startYear) {
        yearFilter.$gte = startYear.toString();
      }
      if (endYear) {
        yearFilter.$lte = endYear.toString();
      }

      const matchStage = {};
      if (Object.keys(yearFilter).length > 0) {
        matchStage.iyear = yearFilter;
      }

      // Group by the specified field
      let groupField = "$iyear";
      if (groupBy === "month") {
        groupField = { year: "$iyear", month: "$imonth" };
      } else if (groupBy === "country") {
        groupField = "$country_txt";
      } else if (groupBy === "region") {
        groupField = "$region_txt";
      }

      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: groupField,
            count: { $sum: 1 },
            totalKilled: {
              $sum: {
                $convert: { input: "$nkill", to: "int", onError: 0, onNull: 0 },
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
        { $sort: { _id: 1 } },
      ];

      const results = await attacksCollection
        .aggregate(pipeline, { allowDiskUse: true })
        .toArray();

      return {
        success: true,
        timeline: results,
        groupBy,
        startYear: startYear || null,
        endYear: endYear || null,
      };
    } catch (error) {
      console.error("Error getting timeline:", error);
      return { success: false, error: error.message };
    }
  }

  async getAttackStats() {
    try {
      const mongoose = require("mongoose");
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      const totalAttacks = await attacksCollection.estimatedDocumentCount();

      // Get aggregation for total casualties
      const casualtyResult = await attacksCollection
        .aggregate(
          [
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
          ],
          { allowDiskUse: true }
        )
        .toArray();

      const stats = {
        totalAttacks,
        totalKilled: casualtyResult[0]?.totalKilled || 0,
        totalWounded: casualtyResult[0]?.totalWounded || 0,
      };

      return { success: true, stats };
    } catch (error) {
      console.error("Error getting attack stats:", error);
      return { success: false, error: error.message };
    }
  }

  // Remove deprecated methods
  parseQueryConditions(query) {
    // This method is no longer used but kept for compatibility
    console.log(`[AttackService] parseQueryConditions called but deprecated`);
    return {};
  }

  extractFieldFromQuery(query, fieldType) {
    // This method is no longer used but kept for compatibility
    console.log(`[AttackService] extractFieldFromQuery called but deprecated`);
    return null;
  }
}

module.exports = new AttackService();
