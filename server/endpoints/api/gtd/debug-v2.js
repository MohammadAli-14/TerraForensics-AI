const mongoose = require("mongoose");

function gtdDebugV2Endpoints(app) {
  if (!app) return;

  // Direct MongoDB test endpoint
  app.get("/api/gtd/debug-v2/test", async (_, response) => {
    try {
      const db = mongoose.connection.db;
      const attacksCollection = db.collection("attacks");

      // Test 1: Count total documents
      const totalCount = await attacksCollection.estimatedDocumentCount();

      // Test 2: Get specific event
      const event197001050001 = await attacksCollection.findOne({
        eventid: "197001050001",
      });

      // Test 3: Search for group
      const nationalAwamiParty = await attacksCollection
        .find({
          gname: { $regex: "National Awami Party", $options: "i" },
        })
        .limit(5)
        .toArray();

      // Test 4: Search statistics
      const stats = await attacksCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalKilled: {
                $sum: {
                  $convert: {
                    input: "$nkill",
                    to: "int",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
          },
        ])
        .toArray();

      response.status(200).json({
        success: true,
        totalCount,
        event197001050001: {
          found: !!event197001050001,
          data: event197001050001
            ? {
                eventid: event197001050001.eventid,
                country: event197001050001.country_txt,
                city: event197001050001.city,
                group: event197001050001.gname,
                killed: event197001050001.nkill,
                wounded: event197001050001.nwound,
              }
            : null,
        },
        nationalAwamiParty: {
          count: nationalAwamiParty.length,
          attacks: nationalAwamiParty.map((a) => ({
            eventid: a.eventid,
            country: a.country_txt,
            city: a.city,
            group: a.gname,
            date: `${a.iyear}-${a.imonth}-${a.iday}`,
          })),
        },
        stats: {
          totalKilled: stats[0]?.totalKilled || 0,
        },
      });
    } catch (error) {
      console.error("Debug V2 error:", error);
      response.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { gtdDebugV2Endpoints };
