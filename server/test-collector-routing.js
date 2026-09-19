#!/usr/bin/env node

/**
 * Collector & Routing Verification Script
 * 
 * This script tests the new GTD intent routing safeguards and verifies
 * workspace document attachment state to diagnose retrieval failures.
 * 
 * Usage:
 *   node test-collector-routing.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Check MongoDB integration status
async function checkMongoDBStatus() {
  const mongoose = require('mongoose');
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('MONGODB CONNECTION STATUS');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`Connection state: ${mongoose.connection.readyState}`);
  console.log(`  0 = disconnected`);
  console.log(`  1 = connected`);
  console.log(`  2 = connecting`);
  console.log(`  3 = disconnecting`);
  
  if (mongoose.connection.readyState === 1) {
    console.log('✅ MongoDB is connected');
    console.log(`Database: ${mongoose.connection.db.databaseName}`);
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`Collections: ${collections.map(c => c.name).join(', ')}`);
  } else {
    console.log('⚠️ MongoDB is NOT connected');
  }
}

// Check GTD intent detection
async function testGTDIntentDetection() {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('GTD INTENT DETECTION TEST');
  console.log('════════════════════════════════════════════════════════════════');
  
  const mongoDBContextExtractor = require('./utils/mongoDB/contextExtractor');
  
  const testQueries = [
    { query: 'What is CODE OF THE WARRIOR?', expectedGTD: false },
    { query: 'How many terrorist attacks in Pakistan in 2010?', expectedGTD: true },
    { query: 'Show me attacks by Taliban', expectedGTD: true },
    { query: 'What is the weather today?', expectedGTD: false },
    { query: 'India 2004 doctrine analysis', expectedGTD: false },
  ];
  
  for (const test of testQueries) {
    const isGTD = mongoDBContextExtractor.isGTDQuery(test.query);
    const status = isGTD === test.expectedGTD ? '✅' : '⚠️';
    console.log(`${status} "${test.query}"`);
    console.log(`   Expected GTD: ${test.expectedGTD}, Got: ${isGTD}`);
  }
}

// Check workspace document attachments
async function checkWorkspaceDocuments(workspaceId) {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`WORKSPACE ${workspaceId} DOCUMENT STATUS`);
  console.log('════════════════════════════════════════════════════════════════');
  
  const { Workspace } = require('./models/workspace');
  const { Document } = require('./models/documents');
  
  const workspace = await Workspace.get({ id: parseInt(workspaceId) });
  if (!workspace) {
    console.log(`⚠️ Workspace ${workspaceId} not found`);
    return;
  }
  
  console.log(`Workspace: ${workspace.name} (slug: ${workspace.slug})`);
  console.log(`Chat mode: ${workspace.chatMode || 'chat'}`);
  console.log(`TopN: ${workspace.topN || 4}`);
  console.log(`Similarity threshold: ${workspace.similarityThreshold || 0.25}`);
  
  const docs = await Document.where({ workspaceId: parseInt(workspaceId) });
  console.log(`\nAttached documents: ${docs.length}`);
  
  if (docs.length === 0) {
    console.log('⚠️ No documents attached to this workspace!');
    console.log('   This explains contextTexts.length === 0');
    return;
  }
  
  docs.forEach((doc, i) => {
    console.log(`\n  Document ${i + 1}:`);
    console.log(`    DocPath: ${doc.docpath}`);
    console.log(`    Name: ${doc.filename}`);
    console.log(`    Published: ${doc.published}`);
    console.log(`    Cached Vectors: ${doc.cached || 'N/A'}`);
  });
  
  // Check vector embeddings count
  const { getVectorDbClass } = require('./utils/helpers');
  const VectorDb = getVectorDbClass();
  const hasNamespace = await VectorDb.hasNamespace(workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);
  
  console.log(`\nVector DB Status:`);
  console.log(`  Has namespace: ${hasNamespace}`);
  console.log(`  Embeddings count: ${embeddingsCount}`);
  
  if (embeddingsCount === 0) {
    console.log('  ⚠️ No embeddings found! Documents may not be vectorized.');
    console.log('  Action: Try re-embedding documents via workspace settings.');
  }
}

// Check collector document processing state
async function checkCollectorDocuments() {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('COLLECTOR DOCUMENT STORAGE');
  console.log('════════════════════════════════════════════════════════════════');
  
  const fs = require('fs');
  const path = require('path');
  const documentsPath = path.join(__dirname, 'storage', 'documents');
  
  if (!fs.existsSync(documentsPath)) {
    console.log('⚠️ Documents storage directory does not exist');
    return;
  }
  
  const files = fs.readdirSync(documentsPath);
  const indiaFiles = files.filter(f => f.toLowerCase().includes('india'));
  
  console.log(`Total processed documents: ${files.length}`);
  console.log(`India-related documents: ${indiaFiles.length}`);
  
  if (indiaFiles.length > 0) {
    console.log('\nIndia documents found:');
    indiaFiles.forEach(file => {
      const filePath = path.join(documentsPath, file);
      const stats = fs.statSync(filePath);
      console.log(`  ${file}`);
      console.log(`    Size: ${stats.size} bytes`);
      console.log(`    Modified: ${stats.mtime.toISOString()}`);
    });
  }
}

// Main execution
async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('COLLECTOR & ROUTING VERIFICATION');
  console.log('════════════════════════════════════════════════════════════════');
  
  try {
    await checkMongoDBStatus();
    await testGTDIntentDetection();
    await checkCollectorDocuments();
    
    // Prompt for workspace ID
    const workspaceId = process.argv[2] || '16';
    await checkWorkspaceDocuments(workspaceId);
    
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('VERIFICATION COMPLETE');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('\nNext steps:');
    console.log('1. If workspace has 0 documents/embeddings, upload and re-embed');
    console.log('2. Test question "What is CODE OF THE WARRIOR?" in both workspaces');
    console.log('3. Expected: workspace with docs answers from docs, empty workspace returns refusal');
    console.log('4. GTD queries should still work in both workspaces');
    
  } catch (error) {
    console.error('Error during verification:', error);
  } finally {
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { checkWorkspaceDocuments, testGTDIntentDetection };
