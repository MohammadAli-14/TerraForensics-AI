const mongoose = require('mongoose');

async function inspect() {
    try {
        const mongoUri = 'mongodb+srv://rajaaliking789_db_user:DBf6KUg3Jt8f6kv9@cluster0.htbeolp.mongodb.net/?appName=Cluster0';
        console.log(`Connecting to MongoDB...`);
        await mongoose.connect(mongoUri, { dbName: 'GTD_Database' });
        const db = mongoose.connection.db;

        // Find sample with latitude
        const attacks = await db.collection('attacks').find({
            latitude: { $exists: true, $ne: '', $ne: null }
        }).limit(5).toArray();

        console.log("--- GEO SAMPLE ---");
        attacks.forEach(a => {
            console.log(`ID: ${a.eventid}, Lat: "${a.latitude}" (${typeof a.latitude}), Lon: "${a.longitude}" (${typeof a.longitude})`);
        });

        // Total stats
        const totalCount = await db.collection('attacks').countDocuments({});
        const totalWithLat = await db.collection('attacks').countDocuments({
            latitude: { $exists: true, $ne: '', $ne: null }
        });

        console.log(`\nTotal Records: ${totalCount}`);
        console.log(`Records with Latitude/Longitude: ${totalWithLat}`);
        console.log(`Percentage with Geo: ${((totalWithLat / totalCount) * 100).toFixed(2)}%`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

inspect();
