// server/utils/mongoDB/debug.js
const mongoose = require("mongoose");

async function debugMongoDB() {
  console.log("🔍 DEBUGGING MONGODB");
  console.log("====================");

  try {
    // 1. Check environment
    console.log("\n1. Environment Check:");
    console.log(
      "MONGODB_URI:",
      process.env.MONGODB_URI ? "Set (hidden)" : "Not set"
    );

    // 2. Check mongoose state
    console.log("\n2. Mongoose State:");
    console.log("ReadyState:", mongoose.connection.readyState);
    console.log("States:", [
      "disconnected",
      "connected",
      "connecting",
      "disconnecting",
    ]);
    console.log(
      "Current State:",
      ["disconnected", "connected", "connecting", "disconnecting"][
        mongoose.connection.readyState
      ] || "unknown"
    );

    // 3. Try to connect if not connected
    if (mongoose.connection.readyState !== 1) {
      console.log("\n3. Attempting connection...");

      if (process.env.MONGODB_URI) {
        await mongoose.connect(process.env.MONGODB_URI, {
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
        });
        console.log("✅ Connected successfully");
      } else {
        console.log("❌ No MONGODB_URI available");
        return;
      }
    }

    // 4. Test direct query
    console.log("\n4. Testing direct query...");
    const db = mongoose.connection.db;
    const attacksCollection = db.collection("attacks");

    const testEventId = "197001000002";
    console.log(`Testing eventid: ${testEventId}`);

    const result = await attacksCollection.findOne({ eventid: testEventId });

    if (result) {
      console.log("✅ FOUND DOCUMENT:");
      console.log({
        eventid: result.eventid,
        country: result.country_txt,
        city: result.city,
        attackType: result.attacktype1_txt,
        nkill: result.nkill,
        nwound: result.nwound,
      });
    } else {
      console.log("❌ Document not found");

      // List some documents to see what's there
      const sample = await attacksCollection
        .find(
          {},
          {
            projection: { eventid: 1, _id: 0 },
          }
        )
        .limit(5)
        .toArray();

      console.log(
        "Sample eventids:",
        sample.map((d) => d.eventid)
      );
    }

    // 5. Count documents
    const count = await attacksCollection.estimatedDocumentCount();
    console.log(`\n5. Total documents in attacks collection: ${count}`);
  } catch (error) {
    console.error("\n❌ DEBUG ERROR:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Run if called directly
if (require.main === module) {
  debugMongoDB()
    .then(() => {
      console.log("\n🔍 DEBUG COMPLETE");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Debug failed:", error);
      process.exit(1);
    });
}

module.exports = { debugMongoDB };
