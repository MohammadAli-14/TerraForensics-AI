// server/utils/mongoDB/testConnection.js
const mongoose = require("mongoose");

async function testMongoDBConnection() {
  try {
    const uri = process.env.MONGODB_URI;
    console.log("Testing MongoDB connection...");
    console.log("URI length:", uri ? uri.length : "undefined");
    console.log(
      "First 50 chars:",
      uri ? uri.substring(0, 50) + "..." : "undefined"
    );

    // Connect with minimal options
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log("✅ Connected successfully");

    // List all databases
    const adminDb = mongoose.connection.db.admin();
    const dbs = await adminDb.listDatabases();
    console.log(
      "Available databases:",
      dbs.databases.map((db) => db.name)
    );

    // Check attacks collection
    const collections = await mongoose.connection.db
      .listCollections()
      .toArray();
    console.log(
      "Collections:",
      collections.map((c) => c.name)
    );

    // Direct query without model
    const attacksDb = mongoose.connection.db.collection("attacks");
    const count = await attacksDb.countDocuments();
    console.log(`Total attacks: ${count}`);

    // Find the specific event
    const attack = await attacksDb.findOne({ eventid: "197000000002" });
    console.log("Specific attack found:", !!attack);
    if (attack) {
      console.log("Attack details:", JSON.stringify(attack, null, 2));
    }

    await mongoose.disconnect();
    return true;
  } catch (error) {
    console.error("❌ Connection test failed:", error.message);
    return false;
  }
}

module.exports = { testMongoDBConnection };
