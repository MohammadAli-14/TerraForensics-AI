// File: server/testCompletePlaceDb.js
const path = require('path');
process.env.NODE_ENV = 'development';
require('dotenv').config({ path: path.join(__dirname, '.env.development') });

const { mongoDB } = require('./utils/mongoDB/connection');

async function testComplete() {
  console.log('🧪 Comprehensive Database Test\n');
  
  try {
    // Connect
    console.log('1. Connecting to MongoDB...');
    await mongoDB.connect();
    const db = mongoDB.getDatabase();
    
    // Test 1: Direct database query
    console.log('\n2. Testing direct database access...');
    const collections = ['city', 'village', 'district', 'local', 'town'];
    
    for (const coll of collections) {
      const count = await db.collection(coll).countDocuments();
      console.log(`   ${coll}: ${count} documents`);
      
      if (count > 0) {
        const sample = await db.collection(coll).findOne({});
        console.log(`     Sample: name="${sample.name}", type="${sample.type}"`);
      }
    }
    
    // Test 2: Test Mongoose models
    console.log('\n3. Testing Mongoose models...');
    const { City } = require('./utils/mongoDB/models/Place');
    
    // Count with Mongoose
    const cityCount = await City.countDocuments();
    console.log(`   City count via Mongoose: ${cityCount}`);
    
    // Find one with Mongoose
    if (cityCount > 0) {
      const city = await City.findOne({});
      console.log(`   Sample city via Mongoose: ${city.name} (ID: ${city._id})`);
      console.log(`   Has geom field: ${!!city.geom}`);
      console.log(`   Has osm_id field: ${!!city.osm_id} (type: ${typeof city.osm_id})`);
    }
    
    // Test 3: Test search
    console.log('\n4. Testing search...');
    const placeService = require('./utils/mongoDB/services/placeService');
    
    // Test exact match
    const searchResult = await placeService.searchAllPlaces('Muzaffarabad', 5);
    console.log(`   Search for "Muzaffarabad": ${searchResult.places.length} results`);
    
    if (searchResult.places.length > 0) {
      searchResult.places.forEach((place, i) => {
        console.log(`     ${i+1}. ${place.name} (${place.type || place.collectionType})`);
      });
    }
    
    // Test partial match
    const partialResult = await placeService.searchAllPlaces('abad', 3);
    console.log(`\n   Search for "abad": ${partialResult.places.length} results`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoDB.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

testComplete().catch(console.error);