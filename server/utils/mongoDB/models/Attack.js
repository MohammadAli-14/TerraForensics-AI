// server/utils/mongoDB/models/Attack.js
const mongoose = require("mongoose");

const attackSchema = new mongoose.Schema(
  {
    // Remove _id field - let MongoDB handle it
    eventid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    iyear: {
      type: String,
      index: true,
      trim: true,
    },
    imonth: {
      type: String,
      trim: true,
    },
    iday: {
      type: String,
      trim: true,
    },
    country_txt: {
      type: String,
      index: true,
      trim: true,
    },
    region_txt: {
      type: String,
      index: true,
      trim: true,
    },
    provstate: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    latitude: {
      type: String,
      trim: true,
    },
    longitude: {
      type: String,
      trim: true,
    },
    summary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    success: {
      type: String,
      trim: true,
    },
    suicide: {
      type: String,
      trim: true,
    },
    attacktype1_txt: {
      type: String,
      index: true,
      trim: true,
    },
    targtype1_txt: {
      type: String,
      index: true,
      trim: true,
    },
    gname: {
      type: String,
      index: true,
      trim: true,
    },
    motive: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    weaptype1_txt: {
      type: String,
      trim: true,
    },
    nkill: {
      type: String,
      trim: true,
    },
    nwound: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: false,
    collection: "attacks",
    strict: false, // Important for BSON types
    bufferCommands: false,
    autoIndex: true,
  }
);

// Middleware to handle BSON types
attackSchema.pre("save", function (next) {
  // Convert NaN objects to null
  if (
    this.summary &&
    typeof this.summary === "object" &&
    this.summary.$numberDouble === "NaN"
  ) {
    this.summary = null;
  }
  if (
    this.motive &&
    typeof this.motive === "object" &&
    this.motive.$numberDouble === "NaN"
  ) {
    this.motive = null;
  }
  next();
});

// Static method for direct eventid query
attackSchema.statics.findByEventId = async function (eventId) {
  try {
    console.log(`[Attack Model] Searching for eventid: "${eventId}"`);

    // Method 1: Direct string match
    let attack = await this.findOne({ eventid: eventId.toString() }).lean();

    if (!attack) {
      // Method 2: Try as number string
      attack = await this.findOne({ eventid: eventId }).lean();
    }

    if (!attack) {
      // Method 3: Use aggregation for case-insensitive
      const result = await this.aggregate([
        {
          $match: {
            $expr: {
              $eq: [{ $toString: "$eventid" }, eventId.toString()],
            },
          },
        },
      ]);
      attack = result[0] || null;
    }

    return attack;
  } catch (error) {
    console.error(`[Attack Model] Error finding by eventid:`, error);
    return null;
  }
};

// Update text index
attackSchema.index(
  {
    country_txt: "text",
    region_txt: "text",
    city: "text",
    gname: "text",
    attacktype1_txt: "text",
    targtype1_txt: "text",
    provstate: "text",
  },
  {
    name: "text_search_index",
    weights: {
      country_txt: 10,
      city: 8,
      gname: 6,
      attacktype1_txt: 4,
    },
  }
);

const Attack = mongoose.model("Attack", attackSchema);

module.exports = Attack;
