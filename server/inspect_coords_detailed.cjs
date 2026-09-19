require('dotenv').config();
const mongoose = require('mongoose');

async function inspect() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/GTD_Database';
        await mongoose.connect(mongoUri, { dbName: 'GTD_Database' });
        const db = mongoose.connection.db;

        const count0 = await db.collection('attacks').countDocuments({ latitude: "0" });
        const countEmpty = await db.collection('attacks').countDocuments({ latitude: "" });
        const countNull = await db.collection('attacks').countDocuments({ latitude: null });
        const countNaN = await db.collection('attacks').countDocuments({ latitude: "NaN" });
        const total = await db.collection('attacks').countDocuments({});

        console.log(`Total: ${total}`);
        console.log(`Lat "0": ${count0}`);
        console.log(`Lat "": ${countEmpty}`);
        console.log(`Lat null: ${countNull}`);
        console.log(`Lat "NaN": ${countNaN}`);

        const sample = await db.collection('attacks').find({
            latitude: { $nin: ["0", "", null, "NaN"] }
        }).limit(3).toArray();

        console.log("\n--- Valid Sample ---");
        sample.forEach(s => console.log(`Lat: ${s.latitude}, type: ${typeof s.latitude}`));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

inspect();
