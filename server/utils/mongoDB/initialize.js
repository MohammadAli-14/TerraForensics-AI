// server/utils/mongoDB/initialize.js
const mongoose = require("mongoose");

async function initMongoDBIntegration() {
  try {
    console.log("🔧 Initializing MongoDB integration...");

    if (!process.env.MONGODB_URI) {
      console.log("ℹ️ MONGODB_URI not set, skipping MongoDB integration");
      return { success: false, reason: "No URI" };
    }

    // Get connection without circular dependencies
    const MongoDBConnection = require("./connection");

    // Set global mongoose options
    mongoose.set("strictQuery", false);
    mongoose.set("bufferCommands", false);

    console.log("🔗 Connecting to MongoDB...");

    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
      });

      console.log("✅ MongoDB connected successfully");

      // Wait a moment for connection to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Test the connection
      const db = mongoose.connection.db;
      if (!db) {
        throw new Error("Database connection not established");
      }

      console.log(`📊 Connected to database: ${db.databaseName}`);

      // List collections
      const collections = await db.listCollections().toArray();
      console.log(
        `📊 Available collections: ${collections.map((c) => c.name).join(", ")}`
      );

      // Get the attacks collection directly
      const attacksCollection = db.collection("attacks");
      const count = await attacksCollection.estimatedDocumentCount();
      console.log(`📊 Attacks collection has ${count} documents`);

      // Test a specific query
      const testDoc = await attacksCollection.findOne({
        eventid: "197000000001",
      });
      if (testDoc) {
        console.log(
          `✅ Test query successful: Found eventid ${testDoc.eventid}`
        );
      } else {
        console.log("⚠️ Test query returned no results (might be expected)");
      }

      // Load the Attack model AFTER connection is established
      const Attack = require("./models/Attack");

      // Sync indexes
      await Attack.syncIndexes();
      console.log("✅ MongoDB indexes synchronized");

      return {
        success: true,
        connection: mongoose.connection,
        count,
      };
    } catch (connectError) {
      console.error("❌ MongoDB connection failed:", connectError.message);

      // Don't throw, just return failure
      return {
        success: false,
        error: connectError.message,
        reason: "Connection failed",
      };
    }
  } catch (error) {
    console.error("❌ MongoDB integration failed:", error.message);
    return { success: false, error: error.message };
  }
}

// Add a health check function
async function checkMongoDBHealth() {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return {
        healthy: false,
        reason: "Not connected",
        readyState: mongoose.connection?.readyState,
      };
    }

    const Attack = require("./models/Attack");
    const count = await Attack.estimatedDocumentCount().catch(() => 0);

    return {
      healthy: true,
      readyState: mongoose.connection.readyState,
      database: mongoose.connection.db?.databaseName,
      collectionCount: count,
      host: mongoose.connection.host,
    };
  } catch (error) {
    return { healthy: false, error: error.message };
  }
}

module.exports = {
  initMongoDBIntegration,
  checkMongoDBHealth,
  mongoose,
};
