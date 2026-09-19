// server/utils/mongoDB/index.js
const mongoose = require("mongoose");
const MongoDBConnection = require("./connection");

// Export components without requiring them immediately
module.exports = {
  mongoose,
  MongoDBConnection,
  // Export functions that require components
  getAttackService: () => require("./services/attackService"),
  getContextExtractor: () => require("./contextExtractor"),
  getAttackModel: () => require("./models/Attack"),
  initMongoDBIntegration: () => require("./initialize").initMongoDBIntegration,
};
