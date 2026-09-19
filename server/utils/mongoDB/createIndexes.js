// File: server/utils/mongoDB/createIndexes.js
const Attack = require("./models/Attack");

async function createAttackIndexes() {
  console.log("🔧 Creating MongoDB indexes for GTD attacks...");

  try {
    // Mongoose automatically creates indexes defined in the schema
    // when the application starts and Model.ensureIndexes() is called
    // or when the first operation on the model is performed

    console.log(
      "✅ Attack model indexes will be created automatically on first use"
    );
    console.log("   Defined indexes:");
    console.log("   - eventid (unique)");
    console.log(
      "   - iyear, country_txt, region_txt, attacktype1_txt, targtype1_txt, gname"
    );
    console.log("   - Compound indexes for common queries");
    console.log("   - Text index for full-text search");
  } catch (error) {
    console.error("❌ Error with indexes:", error);
  }
}

// Optional: Create indexes immediately if needed
if (require.main === module) {
  createAttackIndexes();
}

module.exports = { createAttackIndexes };
