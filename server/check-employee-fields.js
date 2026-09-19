// server/check-employee-fields.js
const { mongoDB } = require("./utils/mongoDB/connection");
const mongoose = require("mongoose");

async function checkFields() {
  try {
    await mongoDB.connect();
    
    console.log("Checking employee document structure...\n");
    
    // Get one employee record to see all fields
    const db = mongoose.connection.db;
    const collection = db.collection('employees'); // Adjust collection name if different
    
    const employee = await collection.findOne({});
    
    console.log("Employee document fields:");
    console.log("=========================");
    console.log(JSON.stringify(employee, null, 2));
    
    await mongoDB.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

checkFields();