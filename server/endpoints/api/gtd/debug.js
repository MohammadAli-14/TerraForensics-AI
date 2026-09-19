// server/endpoints/api/gtd/debug.js
const { reqBody } = require("../../../utils/http");
const attackService = require("../../../utils/mongoDB/services/attackService");
const Attack = require("../../../utils/mongoDB/models/Attack");

function gtdDebugEndpoints(app) {
  if (!app) return;

  // Debug endpoint to test queries
  app.post("/api/gtd/debug", async (request, response) => {
    try {
      const { query, action = "test" } = reqBody(request);

      console.log(`[Debug] Action: ${action}, Query: "${query}"`);

      let results = { query, timestamp: new Date().toISOString() };

      if (action === "test") {
        // Test different search methods
        results.tests = {};

        // Test 1: Direct event ID search
        const eventidMatch = query.match(/\d{12}/);
        if (eventidMatch) {
          const eventResult = await attackService.getAttackById(
            eventidMatch[0]
          );
          results.tests.eventIdSearch = {
            eventid: eventidMatch[0],
            success: eventResult.success,
            found: !!eventResult.attack,
            data: eventResult.attack || null,
          };
        }

        // Test 2: Direct MongoDB query
        if (eventidMatch) {
          const directQuery = await Attack.findOne({
            eventid: eventidMatch[0],
          }).lean();
          results.tests.directMongoQuery = {
            found: !!directQuery,
            eventid: directQuery?.eventid,
            rawData: directQuery || null,
          };
        }

        // Test 3: Count total records
        const count = await Attack.countDocuments();
        results.stats = {
          totalRecords: count,
          sampleEventIds: (
            await Attack.find().limit(5).select("eventid").lean()
          ).map((doc) => doc.eventid),
        };
      } else if (action === "verify") {
        // Verify specific event exists
        const attack = await Attack.findOne({ eventid: query }).lean();
        results.verification = {
          exists: !!attack,
          eventid: attack?.eventid,
          country: attack?.country_txt,
          city: attack?.city,
          fullDocument: attack || null,
        };
      } else if (action === "schema") {
        // Check schema
        const sample = await Attack.findOne().lean();
        results.schema = {
          fields: Object.keys(sample || {}),
          sample: sample,
        };
      }

      response.status(200).json(results);
    } catch (error) {
      console.error("Debug error:", error);
      response.status(500).json({ success: false, error: error.message });
    }
  });

  // Additional endpoint to check all event IDs
  app.get("/api/gtd/debug/eventids", async (_, response) => {
    try {
      const eventids = await Attack.find()
        .select("eventid country_txt city attacktype1_txt")
        .limit(50)
        .sort({ eventid: 1 })
        .lean();

      response.status(200).json({
        count: eventids.length,
        eventids: eventids.map((doc) => ({
          eventid: doc.eventid,
          country: doc.country_txt,
          city: doc.city,
          attackType: doc.attacktype1_txt,
        })),
      });
    } catch (error) {
      console.error("Error getting eventids:", error);
      response.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { gtdDebugEndpoints };
