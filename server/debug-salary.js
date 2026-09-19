// server/debug-salary.js
const { mongoDB } = require("./utils/mongoDB/connection");
const employeeService = require("./utils/mongoDB/services/employeeService");
const extractor = require("./utils/mongoDB/contextExtractor"); // Already an instance

async function debugSalary() {
  try {
    await mongoDB.connect();
    
    console.log("=== DEBUGGING SALARY QUERY ===\n");
    
    // Test 1: Direct MongoDB query
    console.log("1. DIRECT MONGO QUERY for Mike Chen:");
    const directResult = await employeeService.searchEmployees("Mike Chen", 1);
    
    if (directResult.success && directResult.employees.length > 0) {
      const mike = directResult.employees[0];
      console.log("   Found Mike Chen:");
      console.log("   - Name:", mike.name);
      console.log("   - Salary field exists:", 'salary' in mike);
      console.log("   - Salary value:", mike.salary);
      console.log("   - Salary type:", typeof mike.salary);
      console.log("   - All fields:", Object.keys(mike));
      
      // Check actual document structure
      console.log("   - Full document:");
      console.log(JSON.stringify(mike, null, 2));
    }
    
    // Test 2: Context Extractor test - Using the instance directly
    console.log("\n2. CONTEXT EXTRACTOR TEST:");
    
    const testQueries = [
      "Mike Chen salary",
      "his salary",
      "What is Mike Chen's salary?",
      "salary of Mike Chen",
      "how much does Mike Chen make"
    ];
    
    for (const query of testQueries) {
      console.log(`\n   Query: "${query}"`);
      const context = await extractor.extractEmployeeContext(query);
      console.log(`   Has context: ${!!context.context}`);
      console.log(`   Context length: ${context.context.length}`);
      
      // Check if salary appears in context
      const hasSalaryInText = context.context.toLowerCase().includes("salary");
      console.log(`   Contains 'salary' in text: ${hasSalaryInText}`);
      
      if (context.context.length > 0) {
        // Look for salary pattern in context
        const salaryMatch = context.context.match(/salary.*?\$?(\d[\d,]*)/i);
        if (salaryMatch) {
          console.log(`   Found salary pattern: ${salaryMatch[0]}`);
        }
        
        console.log(`   Full context:\n${'='.repeat(50)}`);
        console.log(context.context);
        console.log(`${'='.repeat(50)}`);
      }
      
      if (context.sources && context.sources.length > 0) {
        console.log(`   Sources (${context.sources.length}):`);
        context.sources.forEach((source, i) => {
          console.log(`     ${i+1}. ${source.name} - Salary in source: ${source.salary || 'NO SALARY'}`);
        });
      }
    }
    
    // Test 3: Check what the LLM actually receives
    console.log("\n3. SIMULATING FULL PIPELINE:");
    
    // Simulate the query processing
    const query = "What is Mike Chen's salary?";
    console.log(`   Original query: "${query}"`);
    
    const potentialName = extractor.extractPotentialName(query);
    console.log(`   Extracted name: "${potentialName}"`);
    
    const isEmployeeQuery = extractor.isEmployeeQuery(query);
    console.log(`   Is employee query: ${isEmployeeQuery}`);
    
    // Test 4: Check the context builder logic directly
    console.log("\n4. CONTEXT BUILDER TEST:");
    if (directResult.success && directResult.employees.length > 0) {
      const mike = directResult.employees[0];
      console.log("   Testing context builder with Mike's data:");
      console.log("   - Salary from DB:", mike.salary);
      console.log("   - Formatted salary:", extractor.formatDate ? 
        "formatDate method exists" : "formatDate method missing");
      
      // Simulate what the context builder should produce
      const formattedSalary = new Intl.NumberFormat('en-US').format(mike.salary);
      console.log("   - Manual formatting result: $" + formattedSalary);
      
      // Check if all fields are accessible
      console.log("   - Available employee fields:");
      for (const key in mike) {
        if (key !== '_doc' && key !== '$__') {
          console.log(`     ${key}: ${mike[key]}`);
        }
      }
    }
    
    await mongoDB.disconnect();
    
  } catch (error) {
    console.error("Debug failed:", error);
    console.error("Stack trace:", error.stack);
  }
}

debugSalary();