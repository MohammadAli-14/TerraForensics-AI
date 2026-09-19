const { reqBody, userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { Telemetry } = require("../models/telemetry");
const placeService = require("../utils/mongoDB/services/placeService");
const { mongoDB } = require("../utils/mongoDB/connection");

function placeEndpoints(app) {
  if (!app) return;

  // Middleware to check MongoDB connection
  const checkMongoDB = async (req, res, next) => {
    try {
      if (!mongoDB.isReady()) {
        await mongoDB.connect();
      }

      if (!mongoDB.isReady()) {
        return res.status(503).json({
          success: false,
          error: "MongoDB connection unavailable",
        });
      }
      next();
    } catch (error) {
      console.error("MongoDB connection error:", error);
      res.status(500).json({
        success: false,
        error: "Database connection failed",
      });
    }
  };

  // Search places
  app.get(
    "/api/places/search",
    [validatedRequest, checkMongoDB],
    async (req, res) => {
      try {
        const { q, limit = 10 } = req.query;

        if (!q || q.trim().length < 2) {
          return res.status(400).json({
            success: false,
            error: "Search query must be at least 2 characters",
          });
        }

        const result = await placeService.searchAllPlaces(q, parseInt(limit));

        if (!result.success) {
          return res.status(500).json(result);
        }

        res.status(200).json({
          success: true,
          query: q,
          places: result.places,
          count: result.places.length,
        });
      } catch (error) {
        console.error("Error searching places:", error);
        res.status(500).json({
          success: false,
          error: "Failed to search places",
        });
      }
    }
  );

  // Get place by exact name
  app.get(
    "/api/places/name/:name",
    [validatedRequest, checkMongoDB],
    async (req, res) => {
      try {
        const { name } = req.params;
        const result = await placeService.getPlaceByName(name);

        if (!result.success) {
          return res.status(404).json(result);
        }

        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching place:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch place",
        });
      }
    }
  );

  // Get places by collection type
  app.get(
    "/api/places/collection/:type",
    [validatedRequest, checkMongoDB],
    async (req, res) => {
      try {
        const { type } = req.params;
        const { limit = 50, page = 1 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const result = await placeService.getPlacesByCollection(
          type,
          parseInt(limit),
          skip
        );

        if (!result.success) {
          return res.status(400).json(result);
        }

        res.status(200).json({
          success: true,
          collection: type,
          places: result.places,
          count: result.places.length,
          page: parseInt(page),
          limit: parseInt(limit),
        });
      } catch (error) {
        console.error("Error fetching places by collection:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch places",
        });
      }
    }
  );

  // Get place statistics
  app.get(
    "/api/places/stats",
    [validatedRequest, checkMongoDB],
    async (req, res) => {
      try {
        const result = await placeService.getPlaceStats();

        if (!result.success) {
          return res.status(500).json(result);
        }

        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching place stats:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch place statistics",
        });
      }
    }
  );

  // Get sample places
  app.get(
    "/api/places/sample",
    [validatedRequest, checkMongoDB],
    async (req, res) => {
      try {
        const { limit = 10 } = req.query;
        const result = await placeService.getSamplePlaces(parseInt(limit));

        if (!result.success) {
          return res.status(500).json(result);
        }

        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching sample places:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch sample places",
        });
      }
    }
  );

  // Test MongoDB connection
  app.get(
    "/api/places/connection-test",
    [validatedRequest, checkMongoDB],
    async (req, res) => {
      try {
        const stats = await placeService.getPlaceStats();

        if (stats.success) {
          res.status(200).json({
            success: true,
            connected: true,
            stats: {
              totalPlaces: stats.stats.totalPlaces,
              collections: stats.stats.byCollection,
            },
            message: "MongoDB connection successful",
          });
        } else {
          res.status(500).json({
            success: false,
            connected: false,
            error: stats.error,
          });
        }
      } catch (error) {
        console.error("Connection test failed:", error);
        res.status(500).json({
          success: false,
          connected: false,
          error: error.message,
        });
      }
    }
  );
}

module.exports = { placeEndpoints };
