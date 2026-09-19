require('dotenv').config();
const mongoose = require('mongoose');

async function inspect() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/GTD_Database';
        console.log("Connecting...");
        await mongoose.connect(mongoUri, { dbName: 'GTD_Database' });
        const db = mongoose.connection.db;

        console.log("Counting valid geo records...");
        // Count records that have valid-looking coordinates (not empty, not NaN, etc.)
        const total = await db.collection('attacks').countDocuments({});

        // Check various types of "invalid"
        const countEmpty = await db.collection('attacks').countDocuments({ latitude: "" });
        const countNull = await db.collection('attacks').countDocuments({ latitude: null });
        const countNaN = await db.collection('attacks').countDocuments({ latitude: "NaN" });
        const countZero = await db.collection('attacks').countDocuments({ latitude: "0" });

        // Also check for any other non-numeric strings
        // In MongoDB, we can use regex to find strings that don't look like decimals/integers
        const nonNumeric = await db.collection('attacks').countDocuments({
            latitude: { $not: /^-?\d+(\.\d+)?$/ }
        });

        console.log(`Total Records: ${total}`);
        console.log(`Empty Latitude: ${countEmpty}`);
        console.log(`Null Latitude: ${countNull}`);
        console.log(`"NaN" Latitude: ${countNaN}`);
        console.log(`"0" Latitude: ${countZero}`);
        console.log(`Non-numeric Latitude: ${nonNumeric}`);

        const validCount = await db.collection('attacks').countDocuments({
            latitude: { $regex: /^-?\d+(\.\d+)?$/ },
            longitude: { $regex: /^-?\d+(\.\d+)?$/ }
        });

        console.log(`Total Valid Geo: ${validCount}`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

inspect();
