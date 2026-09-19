const { mongoDB } = require("./utils/mongoDB/connection");
const employeeService = require("./utils/mongoDB/services/employeeService");

async function testSearch() {
  try {
    await mongoDB.connect();
    
    console.log("Testing employee search...\n");
    
    // Test queries
    const testQueries = [
      "give email of Mike Chen?",
      "Mike Chen",
      "email",
      "engineering",
      "how many employees",
      "John Smith skills"
    ];
    
    for (const query of testQueries) {
      console.log(`\n=== Testing query: "${query}" ===`);
      const result = await employeeService.searchEmployees(query, 5);
      
      if (result.success) {
        console.log(`Found ${result.employees.length} employees:`);
        result.employees.forEach(emp => {
          console.log(`  - ${emp.name} (${emp.email}) - ${emp.department}`);
        });
      } else {
        console.log(`Error: ${result.error}`);
      }
    }
    
    await mongoDB.disconnect();
  } catch (error) {
    console.error("Test failed:", error);
  }
}

testSearch();