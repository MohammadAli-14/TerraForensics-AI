// server/utils/mongoDB/initialize.js
const mongoose = require("mongoose");

let isConnecting = false;
let connectionPromise = null;
let reconnectTimer = null;
let retryAttempt = 0;

async function initMongoDBIntegration(isRetry = false) {
  try {
    if (!process.env.MONGODB_URI) {
      console.log("ℹ️ MONGODB_URI not set, skipping MongoDB integration");
      return { success: false, reason: "No URI" };
    }

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      return { success: true, connection: mongoose.connection };
    }

    if (isConnecting && connectionPromise) {
      console.log(
        "🔗 MongoDB connection already in progress, awaiting existing promise..."
      );
      return await connectionPromise;
    }

    isConnecting = true;
    console.log(
      isRetry
        ? `🔄 Retrying MongoDB connection (attempt ${retryAttempt})...`
        : "🔧 Initializing MongoDB integration..."
    );

    mongoose.set("strictQuery", false);
    mongoose.set("bufferCommands", false);

    console.log("🔗 Connecting to MongoDB...");

    connectionPromise = (async () => {
      try {
        await mongoose.connect(process.env.MONGODB_URI, {
          serverSelectionTimeoutMS: 30000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 30000,
          maxPoolSize: 10,
        });

        console.log("✅ MongoDB connected successfully");
        retryAttempt = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        // Wait a moment for connection to stabilize
        await new Promise((resolve) => setTimeout(resolve, 500));

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

        // Setup disconnect listeners once
        if (!mongoose.connection._listenersSetup) {
          mongoose.connection._listenersSetup = true;

          mongoose.connection.on("disconnected", () => {
            console.log(
              "⚠️ MongoDB disconnected. Scheduling auto-reconnect..."
            );
            scheduleAutoReconnect();
          });

          mongoose.connection.on("error", (err) => {
            console.error("❌ MongoDB connection error:", err.message);
          });
        }

        return {
          success: true,
          connection: mongoose.connection,
          count,
        };
      } catch (connectError) {
        console.error("❌ MongoDB connection failed:", connectError.message);
        scheduleAutoReconnect();
        return {
          success: false,
          error: connectError.message,
          reason: "Connection failed",
        };
      } finally {
        isConnecting = false;
        connectionPromise = null;
      }
    })();

    return await connectionPromise;
  } catch (error) {
    isConnecting = false;
    connectionPromise = null;
    console.error("❌ MongoDB integration failed:", error.message);
    scheduleAutoReconnect();
    return { success: false, error: error.message };
  }
}

function scheduleAutoReconnect() {
  if (reconnectTimer) return;
  if (!process.env.MONGODB_URI) return;
  if (mongoose.connection && mongoose.connection.readyState === 1) return;

  const delay = Math.min(3000 * Math.pow(1.5, retryAttempt), 30000);
  retryAttempt++;
  console.log(
    `⏱️ MongoDB auto-reconnect scheduled in ${Math.round(delay / 1000)}s (attempt ${retryAttempt})...`
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      await initMongoDBIntegration(true);
    }
  }, delay);
}

/**
 * Ensures MongoDB is connected, waiting up to timeoutMs if a connection is currently pending
 * or initiating a connection if disconnected.
 */
async function ensureMongoDBConnected(timeoutMs = 15000) {
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    return true;
  }

  if (isConnecting && connectionPromise) {
    try {
      await Promise.race([
        connectionPromise,
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
      return mongoose.connection && mongoose.connection.readyState === 1;
    } catch (e) {
      return false;
    }
  }

  try {
    const res = await Promise.race([
      initMongoDBIntegration(false),
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ success: false, reason: "Timeout" }),
          timeoutMs
        )
      ),
    ]);
    return Boolean(
      res &&
      res.success &&
      mongoose.connection &&
      mongoose.connection.readyState === 1
    );
  } catch (e) {
    return false;
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
  ensureMongoDBConnected,
  checkMongoDBHealth,
  mongoose,
};
