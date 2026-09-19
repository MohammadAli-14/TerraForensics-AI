// File: E:\VertexAI-Database -AdminUI - Copy\anything-llm\server\testPlaceDb.js

// Load environment variables FIRST
const path = require('path');

// Set NODE_ENV to development for this test
process.env.NODE_ENV = 'development';

// Load the correct .env file
if (process.env.NODE_ENV === 'development') {
  require('dotenv').config({ path: path.join(__dirname, '.env.development') });
} else {
  require('dotenv').config();
}

// Debug: Check if env variables are loaded
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MONGODB_URI set:', !!process.env.MONGODB_URI);

const { mongoDB } = require('./utils/mongoDB/connection');
const placeService = require('./utils/mongoDB/services/placeService');

async function testDatabase() {
  console.log('🧪 Testing Pakistan Place Database Integration\n');
  
  try {
    // Connect to MongoDB
    console.log('1. Connecting to MongoDB...');
    const connection = await mongoDB.connect();
    
    if (!connection) {
      console.error('❌ Failed to connect to MongoDB');
      return;
    }
    
    console.log('✅ MongoDB connected\n');

    // Add collection checking code
    console.log('📋 Checking collection contents...');
    const db = mongoDB.getDatabase();

    // List ALL documents in each collection
    for (const collectionName of ['city', 'village', 'district', 'local', 'town']) {
      try {
        const count = await db.collection(collectionName).countDocuments();
        console.log(`   ${collectionName}: ${count} documents`);
        
        // Show first document structure
        if (count > 0) {
          const firstDoc = await db.collection(collectionName).findOne({});
          console.log(`     First document structure:`, Object.keys(firstDoc));
          console.log(`     Sample: name="${firstDoc.name}", type="${firstDoc.type}"`);
        }
      } catch (error) {
        console.log(`   ${collectionName}: Error - ${error.message}`);
      }
    }
    console.log();
    
    // Test 1: Get statistics
    console.log('2. Getting database statistics...');
    const stats = await placeService.getPlaceStats();
    
    if (stats.success) {
      console.log(`✅ Total places: ${stats.stats.totalPlaces.toLocaleString()}`);
      console.log('📊 By collection:');
      Object.entries(stats.stats.byCollection).forEach(([collection, count]) => {
        console.log(`   ${collection}: ${count.toLocaleString()}`);
      });
    } else {
      console.log('❌ Failed to get statistics');
    }
    console.log();
    
    // Test 2: Search for places
    console.log('3. Testing search functionality...');
    const searchTests = ['Islamabad', 'Khan', 'G-6', 'Lahore', 'Town'];
    
    for (const testQuery of searchTests) {
      console.log(`\n   Searching for "${testQuery}"...`);
      const result = await placeService.searchAllPlaces(testQuery, 5);
      
      if (result.success && result.places.length > 0) {
        console.log(`   ✅ Found ${result.places.length} places:`);
        result.places.slice(0, 3).forEach(place => {
          console.log(`      - ${place.name} (${place.type || place.collectionType})`);
        });
        if (result.places.length > 3) {
          console.log(`      ... and ${result.places.length - 3} more`);
        }
      } else {
        console.log(`   ⚠️  No places found for "${testQuery}"`);
      }
    }
    console.log();
    
    // Test 3: Get sample places
    console.log('4. Getting sample places...');
    const samples = await placeService.getSamplePlaces(5);
    
    if (samples.success && samples.places.length > 0) {
      console.log('✅ Sample places:');
      samples.places.forEach(place => {
        console.log(`   - ${place.name} (${place.collectionType})`);
      });
    }
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Disconnect
    await mongoDB.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run tests
testDatabase().catch(console.error);