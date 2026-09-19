// server/endpoints/api/gtd/test.js
const mongoose = require("mongoose");

function gtdTestEndpoints(app) {
  if (!app) return;

  // Simple test endpoint that bypasses all services
  app.get("/api/gtd/test/:eventid", async (request, response) => {
    try {
      const { eventid } = request.params;

      console.log(`[Test Endpoint] Testing eventid: ${eventid}`);

      // Check MongoDB connection
      if (!mongoose.connection || mongoose.connection.readyState !== 1) {
        return response.status(500).json({
          success: false,
          error: "MongoDB not connected",
          readyState: mongoose.connection?.readyState,
        });
      }

      const db = mongoose.connection.db;
      if (!db) {
        return response.status(500).json({
          success: false,
          error: "Database not available",
        });
      }

      const attacksCollection = db.collection("attacks");

      // Try multiple query methods
      const methods = [];

      // Method 1: Direct query
      const result1 = await attacksCollection.findOne({ eventid: eventid });
      methods.push({ method: "direct", found: !!result1, result: result1 });

      // Method 2: String query
      const result2 = await attacksCollection.findOne({
        eventid: String(eventid),
      });
      methods.push({ method: "string", found: !!result2, result: result2 });

      // Method 3: Regex
      const result3 = await attacksCollection.findOne({
        eventid: { $regex: new RegExp(`^${eventid}$`, "i") },
      });
      methods.push({ method: "regex", found: !!result3, result: result3 });

      // Method 4: Aggregation
      const result4 = await attacksCollection
        .aggregate([
          {
            $match: {
              $expr: {
                $eq: [{ $toString: "$eventid" }, String(eventid)],
              },
            },
          },
          { $limit: 1 },
        ])
        .toArray();
      methods.push({
        method: "aggregation",
        found: result4.length > 0,
        result: result4[0],
      });

      // Count total documents
      const totalCount = await attacksCollection.estimatedDocumentCount();

      // Get sample of eventids
      const sample = await attacksCollection
        .find(
          {},
          {
            projection: { eventid: 1, country_txt: 1, city: 1, _id: 0 },
          }
        )
        .limit(5)
        .toArray();

      response.status(200).json({
        success: true,
        eventid,
        queryMethods: methods,
        stats: {
          totalDocuments: totalCount,
          sampleEventIds: sample,
        },
        connection: {
          readyState: mongoose.connection.readyState,
          host: mongoose.connection.host,
          database: db.databaseName,
        },
      });
    } catch (error) {
      console.error("[Test Endpoint] Error:", error);
      response.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // Simple health check
  app.get("/api/gtd/test-health", async (_, response) => {
    try {
      const readyState = mongoose.connection?.readyState;
      const states = [
        "disconnected",
        "connected",
        "connecting",
        "disconnecting",
      ];

      response.status(200).json({
        mongodb: {
          readyState,
          state: states[readyState] || "unknown",
          connected: readyState === 1,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  });
}

module.exports = { gtdTestEndpoints };
