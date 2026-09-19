// File: server/fixMongoDB.js
require("dotenv").config({ path: ".env.development" }); // Load environment variables
const { mongoDB } = require("./utils/mongoDB/connection");

async function testAndFix() {
  console.log("🔧 Testing and fixing MongoDB integration...\n");
  
  try {
    console.log("1. Testing connection...");
    const connection = await mongoDB.connect();
    
    if (mongoDB.isReady() && connection) {
      console.log("✅ MongoDB connection successful");
      
      // Get database
      const db = connection.db;
      
      if (!db) {
        console.error("❌ Cannot access database");
        return;
      }
      
      // List collections
      console.log("\n2. Available collections:");
      try {
        const collections = await db.listCollections().toArray();
        collections.forEach(col => {
          console.log(`   - ${col.name}`);
        });
        
        // Count documents
        console.log("\n3. Document counts:");
        for (const col of collections) {
          const count = await db.collection(col.name).countDocuments();
          console.log(`   - ${col.name}: ${count.toLocaleString()} documents`);
        }
        
      } catch (error) {
        console.error("Error accessing collections:", error.message);
      }
      
      console.log("\n🎉 MongoDB is properly configured!");
      console.log("\nNext steps:");
      console.log("1. Restart VertexAI server");
      console.log("2. Test with: http://localhost:3001/api/places/connection-test");
      console.log("3. Try searching: http://localhost:3001/api/places/search?q=Islamabad");
      
    } else {
      console.log("❌ MongoDB connection failed");
      console.log("\nTroubleshooting:");
      console.log("1. Check MONGODB_URI in .env.development");
      console.log("2. Ensure MongoDB Atlas IP whitelist includes your IP");
      console.log("3. Verify username/password");
      console.log("Current MONGODB_URI:", process.env.MONGODB_URI ? "Set (hidden)" : "NOT SET");
    }
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.log("\nCheck your MongoDB connection string format:");
    console.log("MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority");
  } finally {
    await mongoDB.disconnect();
  }
}

testAndFix();