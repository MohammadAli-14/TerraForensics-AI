// server/utils/mongoDB/connection.js
const mongoose = require("mongoose");

class MongoDBConnection {
  constructor() {
    this.connection = null;
    this.isConnected = false;
    this.connectionPromise = null;
    this.maxRetries = 3;
    this.retryCount = 0;
  }

  async connect() {
    // Return existing connection if available
    if (
      this.isConnected &&
      this.connection &&
      this.connection.readyState === 1
    ) {
      console.log("✅ Using existing MongoDB connection");
      return this.connection;
    }

    // Return existing promise if connection is in progress
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error("❌ MONGODB_URI is not defined in environment variables");
      throw new Error("MONGODB_URI is not defined");
    }

    console.log("🔗 Connecting to MongoDB...");

    this.connectionPromise = this._connectWithRetry(uri);
    return this.connectionPromise;
  }

  async _connectWithRetry(uri) {
    try {
      // Close existing connection if any
      if (this.connection) {
        await mongoose.disconnect();
      }

      // Connect with minimal options
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      this.connection = mongoose.connection;

      // Set up event listeners
      this.connection.on("error", (err) => {
        console.error("❌ MongoDB connection error:", err.message);
        this.isConnected = false;
      });

      this.connection.on("disconnected", () => {
        console.log("⚠️ MongoDB disconnected");
        this.isConnected = false;
        this.connectionPromise = null;
      });

      this.connection.on("connected", () => {
        console.log("✅ MongoDB connected successfully");
        this.isConnected = true;
        this.retryCount = 0;
      });

      const onReady = async () => {
        try {
          console.log(
            "📊 Connected to database:",
            this.connection.db.databaseName
          );

          const db = this.connection.db;
          if (!db) {
            throw new Error("Database object is undefined");
          }

          const collections = await db.listCollections().toArray();
          console.log(
            `📊 Available collections: ${collections.map((c) => c.name).join(", ")}`
          );

          const attacksCollection = db.collection("attacks");
          const count = await attacksCollection.estimatedDocumentCount();
          console.log(`📊 Attacks collection has ${count} documents`);
        } catch (err) {
          console.error("❌ Error initializing database:", err.message);
          throw err;
        }
      };

      // If connection is already open (readyState === 1), initialize immediately
      if (this.connection.readyState === 1) {
        await onReady();
      } else {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("MongoDB connection timeout"));
          }, 15000);

          this.connection.once("open", async () => {
            clearTimeout(timeout);
            try {
              await onReady();
              resolve();
            } catch (err) {
              reject(err);
            }
          });

          this.connection.once("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      }

      return this.connection;
    } catch (error) {
      console.error(
        `❌ MongoDB connection failed (attempt ${this.retryCount + 1}/${this.maxRetries}):`,
        error.message
      );

      this.retryCount++;
      if (this.retryCount < this.maxRetries) {
        console.log(`🔄 Retrying in 2 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return this._connectWithRetry(uri);
      } else {
        throw new Error(
          `Failed to connect to MongoDB after ${this.maxRetries} attempts: ${error.message}`
        );
      }
    }
  }

  async ensureConnected() {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.connection;
  }

  getConnection() {
    return this.connection;
  }

  isReady() {
    return (
      this.isConnected && this.connection && this.connection.readyState === 1
    );
  }

  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      this.isConnected = false;
      this.connection = null;
      this.connectionPromise = null;
      console.log("✅ MongoDB disconnected");
    }
  }
}

module.exports = new MongoDBConnection();
