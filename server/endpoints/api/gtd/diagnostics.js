// server/endpoints/api/gtd/diagnostics.js
const mongoose = require("mongoose");
const {
  testMongoDBConnection,
} = require("../../../utils/mongoDB/testConnection");

function gtdDiagnosticEndpoints(app) {
  if (!app) return;

  app.get("/api/gtd/diagnostics", async (_, response) => {
    try {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        environment: {
          MONGODB_URI: process.env.MONGODB_URI ? "Set (hidden)" : "Not set",
          NODE_ENV: process.env.NODE_ENV,
        },
        mongoose: {
          readyState: mongoose.connection.readyState,
          state:
            ["disconnected", "connected", "connecting", "disconnecting"][
              mongoose.connection.readyState
            ] || "unknown",
          models: Object.keys(mongoose.models),
          connections: mongoose.connections.length,
        },
        connectionTest: {},
      };

      // Test connection
      const connectionResult = await testMongoDBConnection();
      diagnostics.connectionTest = connectionResult;

      // Test specific event ID query
      if (mongoose.connection.readyState === 1) {
        try {
          const Attack = require("../../../utils/mongoDB/models/Attack");
          const db = mongoose.connection.db;
          const attacksCollection = db.collection("attacks");

          // Direct query
          const directResult = await attacksCollection.findOne({
            eventid: "197000000002",
          });
          diagnostics.specificEvent = {
            viaDriver: !!directResult,
            document: directResult
              ? {
                  eventid: directResult.eventid,
                  country: directResult.country_txt,
                  city: directResult.city,
                }
              : null,
          };

          // Via model
          const modelResult = await Attack.findOne({
            eventid: "197000000002",
          }).lean();
          diagnostics.specificEvent.viaModel = !!modelResult;

          // Count all
          diagnostics.collectionStats = {
            total: await attacksCollection.estimatedDocumentCount(),
            sample: await attacksCollection.find().limit(3).toArray(),
          };
        } catch (queryError) {
          diagnostics.queryError = queryError.message;
        }
      }

      response.status(200).json(diagnostics);
    } catch (error) {
      console.error("Diagnostic error:", error);
      response.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { gtdDiagnosticEndpoints };
