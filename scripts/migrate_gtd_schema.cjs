/**
 * scripts/migrate_gtd_schema.cjs
 *
 * Sovereign GTD Schema & Geospatial Migration Script
 *
 * Transforms the 181,691 GTD incident records:
 *   1. Casts string coordinates ('latitude', 'longitude') to native Number.
 *   2. Generates standard GeoJSON 'location' Point objects: [longitude, latitude].
 *   3. Casts casualty metrics ('nkill', 'nwound') and dates ('iyear', 'imonth', 'iday') to Number.
 *   4. Builds high-performance indexes:
 *      - 2dsphere sparse index on 'location'
 *      - Compound index on { country_txt: 1, iyear: -1 }
 *      - Index on { nkill: -1 }
 *
 * Usage:
 *   node scripts/migrate_gtd_schema.cjs --dry-run
 *   node scripts/migrate_gtd_schema.cjs --limit 500
 *   node scripts/migrate_gtd_schema.cjs
 */

const path = require("path");
const mongoose = require(path.resolve(__dirname, "../server/node_modules/mongoose"));

// Load environment variables
try {
  require(path.resolve(__dirname, "../server/node_modules/dotenv")).config({
    path: path.resolve(__dirname, "../server/.env"),
  });
} catch (_) {}

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/GTD_Database";

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const docLimit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 0;
const batchIdx = args.indexOf("--batch-size");
const BATCH_SIZE = batchIdx !== -1 && args[batchIdx + 1] ? parseInt(args[batchIdx + 1], 10) : 1000;

function isValidCoordinate(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

async function runMigration() {
  console.log("================================================================================");
  console.log(" 🌍 TerraForensics AI — GTD Schema & Geospatial Migration");
  console.log("================================================================================");
  console.log(`[Config] Target URI: ${MONGODB_URI.replace(/:\/\/[^:]+:[^@]+@/, "://***:***@")}`);
  console.log(`[Config] Mode: ${isDryRun ? "DRY RUN (No writes)" : "PRODUCTION MIGRATION"}`);
  if (docLimit > 0) console.log(`[Config] Document Limit: ${docLimit}`);
  console.log(`[Config] Batch Size: ${BATCH_SIZE}`);
  console.log("--------------------------------------------------------------------------------");

  const startTime = Date.now();

  try {
    console.log("[1/4] Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    const db = mongoose.connection.db;
    const collection = db.collection("attacks");

    const totalDocs = await collection.countDocuments();
    console.log(`[2/4] Total documents in 'attacks' collection: ${totalDocs.toLocaleString()}`);

    const cursor = collection.find({}).project({
      _id: 1,
      latitude: 1,
      longitude: 1,
      location: 1,
      nkill: 1,
      nwound: 1,
      iyear: 1,
      imonth: 1,
      iday: 1,
    });

    if (docLimit > 0) cursor.limit(docLimit);

    let processedCount = 0;
    let convertedCoordsCount = 0;
    let missingCoordsCount = 0;
    let bulkOps = [];

    console.log("[3/4] Streaming and transforming records...");

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      processedCount++;

      const lat = parseFloat(doc.latitude);
      const lon = parseFloat(doc.longitude);
      const hasValidCoords = isValidCoordinate(lat, lon);

      const nkillVal = parseInt(doc.nkill, 10);
      const nwoundVal = parseInt(doc.nwound, 10);
      const iyearVal = parseInt(doc.iyear, 10);
      const imonthVal = parseInt(doc.imonth, 10);
      const idayVal = parseInt(doc.iday, 10);

      const updateSet = {
        nkill: Number.isFinite(nkillVal) ? nkillVal : 0,
        nwound: Number.isFinite(nwoundVal) ? nwoundVal : 0,
        iyear: Number.isFinite(iyearVal) ? iyearVal : null,
      };

      if (Number.isFinite(imonthVal)) updateSet.imonth = imonthVal;
      if (Number.isFinite(idayVal)) updateSet.iday = idayVal;

      const updateUnset = {};

      if (hasValidCoords) {
        convertedCoordsCount++;
        updateSet.latitude = lat;
        updateSet.longitude = lon;
        updateSet.location = {
          type: "Point",
          coordinates: [lon, lat], // GeoJSON order: [longitude, latitude]
        };
      } else {
        missingCoordsCount++;
        updateSet.latitude = null;
        updateSet.longitude = null;
        updateUnset.location = "";
      }

      const updateDoc = { $set: updateSet };
      if (Object.keys(updateUnset).length > 0) {
        updateDoc.$unset = updateUnset;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: updateDoc,
        },
      });

      if (bulkOps.length >= BATCH_SIZE) {
        if (!isDryRun) {
          await collection.bulkWrite(bulkOps, { ordered: false });
        }
        bulkOps = [];
        if (processedCount % 10000 === 0 || processedCount === totalDocs) {
          console.log(
            `   -> Processed ${processedCount.toLocaleString()} / ${totalDocs.toLocaleString()} records (${convertedCoordsCount.toLocaleString()} with GeoJSON points)...`
          );
        }
      }
    }

    if (bulkOps.length > 0 && !isDryRun) {
      await collection.bulkWrite(bulkOps, { ordered: false });
    }

    console.log("--------------------------------------------------------------------------------");
    console.log(
      `[Summary] Records processed: ${processedCount.toLocaleString()}`
    );
    console.log(
      `[Summary] Valid GeoJSON Points created: ${convertedCoordsCount.toLocaleString()}`
    );
    console.log(
      `[Summary] Missing/Null coordinates safely omitted: ${missingCoordsCount.toLocaleString()}`
    );

    if (!isDryRun) {
      console.log("[4/4] Creating optimized MongoDB indexes...");

      console.log("   - Building sparse 2dsphere index on 'location'...");
      await collection.createIndex(
        { location: "2dsphere" },
        { sparse: true, background: true, name: "geospatial_2dsphere_index" }
      );

      console.log("   - Building compound temporal index { country_txt: 1, iyear: -1 }...");
      await collection.createIndex(
        { country_txt: 1, iyear: -1 },
        { background: true, name: "idx_country_year" }
      );

      console.log("   - Building casualty impact index { nkill: -1 }...");
      await collection.createIndex(
        { nkill: -1 },
        { background: true, name: "idx_nkill_desc" }
      );

      console.log("   ✔ All indexes built successfully.");
    } else {
      console.log("[4/4] DRY RUN COMPLETE: No database modifications or index builds executed.");
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`================================================================================`);
    console.log(` ✔ Migration procedure completed in ${elapsed}s.`);
    console.log(`================================================================================`);
  } catch (err) {
    console.error("Migration error:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

runMigration();
