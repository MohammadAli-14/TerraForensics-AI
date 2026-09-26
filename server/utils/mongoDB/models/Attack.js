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
      type: Number,
      index: true,
    },
    imonth: {
      type: Number,
    },
    iday: {
      type: Number,
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
      type: Number,
    },
    longitude: {
      type: Number,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude] in GeoJSON standard order
      },
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
      type: Number,
      default: 0,
      index: true,
    },
    nwound: {
      type: Number,
      default: 0,
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

  // Populate GeoJSON location if valid coordinates exist
  if (
    typeof this.latitude === "number" &&
    typeof this.longitude === "number" &&
    !isNaN(this.latitude) &&
    !isNaN(this.longitude) &&
    this.latitude >= -90 &&
    this.latitude <= 90 &&
    this.longitude >= -180 &&
    this.longitude <= 180
  ) {
    this.location = {
      type: "Point",
      coordinates: [this.longitude, this.latitude],
    };
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

// High-performance geospatial 2dsphere index for bounding box and proximity queries
attackSchema.index(
  { location: "2dsphere" },
  { sparse: true, name: "geospatial_2dsphere_index" }
);

// High-performance compound indexes for forensic temporal and casualty aggregations
attackSchema.index({ country_txt: 1, iyear: -1 }, { name: "idx_country_year" });
attackSchema.index({ nkill: -1 }, { name: "idx_nkill_desc" });

const Attack = mongoose.model("Attack", attackSchema);

module.exports = Attack;
