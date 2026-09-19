const { mongoDB } = require("./connection");
const Attack = require("./models/Attack");

async function verifyData() {
  try {
    await mongoDB.connect();

    if (!mongoDB.isReady()) {
      console.error("❌ MongoDB not connected.");
      return;
    }

    // Count documents
    const count = await Attack.countDocuments();
    console.log(`✅ MongoDB connected. Found ${count} attacks in database.`);

    // Sample query
    const sample = await Attack.findOne().lean();
    console.log("\n📊 Sample attack data:");
    console.log(`Event ID: ${sample.eventid}`);
    console.log(`Date: ${sample.iyear}-${sample.imonth}-${sample.iday}`);
    console.log(`Country: ${sample.country_txt}`);
    console.log(`Group: ${sample.gname}`);
    console.log(`Casualties: ${sample.nkill} killed, ${sample.nwound} wounded`);

    // Get some statistics
    const recent = await Attack.find()
      .sort({ iyear: -1, imonth: -1, iday: -1 })
      .limit(3)
      .lean();

    console.log("\n🎯 Recent attacks:");
    recent.forEach((attack) => {
      console.log(
        `- ${attack.iyear}: ${attack.city || attack.country_txt} - ${attack.gname || "Unknown"}`
      );
    });

    await mongoDB.disconnect();
  } catch (error) {
    console.error("❌ Error verifying data:", error);
  }
}

// Run if called directly
if (require.main === module) {
  verifyData();
}

module.exports = { verifyData };
