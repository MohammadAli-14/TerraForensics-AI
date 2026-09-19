#!/usr/bin/env node
/**
 * evaluate_structured_query_accuracy.js
 *
 * Implements Task C: Structured Query Accuracy & RAG Baseline (Experiments 3 & 4)
 * Evaluates entity extraction and MongoDB filter generation across all 90 GTD queries
 * in results/labeled_benchmark_dataset.json.
 */

const fs = require("fs");
const path = require("path");

const DATASET_PATH = path.resolve(__dirname, "../results/labeled_benchmark_dataset.json");
const OUTPUT_PATH = path.resolve(__dirname, "../results/structured_query_accuracy.json");

const contextExtractor = require("../server/utils/mongoDB/contextExtractor");

// Ground truth entity mapping for the 90 GTD queries
// Ground truth labels annotated based on query text requirements
function getGroundTruthEntities(query, category) {
  const q = query.toLowerCase();
  const gt = {
    hasCountry: false,
    hasYear: false,
    hasAttackType: false,
    hasCasualties: false,
    hasGroup: false,
    hasCity: false,
    isWorldwide: false,
  };

  // Country detection
  const countries = [
    "iraq", "pakistan", "afghanistan", "nigeria", "colombia", "india", "philippines",
    "somalia", "syria", "france", "egypt", "yemen", "northern ireland", "peru", "algeria",
    "spain", "sri lanka", "israel", "kenya", "turkey", "thailand", "indonesia", "lebanon",
    "russia", "mali", "mexico", "germany", "uk", "usa", "italy", "bangladesh", "nepal"
  ];
  for (const c of countries) {
    if (new RegExp(`\\b${c}\\b`, "i").test(q)) {
      gt.hasCountry = true;
      gt.country = c;
      break;
    }
  }

  // Year detection
  if (/\b(19\d\d|20\d\d)\b/.test(q) || /\bbetween \d{4} and \d{4}\b/i.test(q) || /\bfrom \d{4} to \d{4}\b/i.test(q)) {
    gt.hasYear = true;
  }

  // Attack type
  const attackTypes = [
    "bombing", "bombings", "suicide", "armed assault", "assassination", "hostage",
    "kidnapping", "hijacking", "facility", "infrastructure", "unarmed assault"
  ];
  for (const at of attackTypes) {
    if (new RegExp(`\\b${at}\\b`, "i").test(q)) {
      gt.hasAttackType = true;
      break;
    }
  }

  // Casualties
  if (/casualt|fatalit|injur|killed|wounded/i.test(q)) {
    gt.hasCasualties = true;
  }

  // Group
  if (/boko haram|al-qaeda|eta|liberation tigers|isis|taliban|farc|hamas|hezbollah|lashkar/i.test(q)) {
    gt.hasGroup = true;
  }

  // City
  if (/paris|baghdad|london|kabul|mumbai|peshawar|madrid|beirut|moscow|karachi/i.test(q)) {
    gt.hasCity = true;
  }

  // Worldwide / Global
  if (/globally|worldwide|global/i.test(q)) {
    gt.isWorldwide = true;
  }

  return gt;
}

async function runEvaluation() {
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
  const gtdQueries = dataset.filter((d) => d.expectedIsGTD);

  console.log("===============================================================================");
  console.log(`  EXPERIMENTS 3 & 4: STRUCTURED QUERY ACCURACY & ENTITY EXTRACTION EVALUATION`);
  console.log(`  Evaluating ${gtdQueries.length} GTD queries from labeled benchmark dataset`);
  console.log("===============================================================================\n");

  let countryCorrect = 0, countryExpected = 0, countryDetected = 0;
  let yearCorrect = 0, yearExpected = 0, yearDetected = 0;
  let attackTypeCorrect = 0, attackTypeExpected = 0, attackTypeDetected = 0;
  let casualtyCorrect = 0, casualtyExpected = 0, casualtyDetected = 0;
  let validFilterGenerated = 0;
  let exactFieldMatch = 0;

  const queryDetails = [];

  for (const item of gtdQueries) {
    const q = item.query;
    const gt = getGroundTruthEntities(q, item.category);

    const conditions = await contextExtractor.parseNaturalLanguageQuery(q);
    const filter = contextExtractor.buildMongoDBFilter(conditions);

    // Check entity extractions
    const detCountry = !!(conditions.country_txt || filter.country_txt);
    const detYear = !!(conditions.iyear || conditions._yearRange || filter.iyear || filter.$expr);
    const detAttackType = !!(conditions.attacktype1_txt || conditions.suicide || filter.attacktype1_txt || filter.suicide);
    const detCasualty = !!(conditions._minWounded || conditions._minKilled || conditions.nkill || conditions.nwound);

    if (gt.hasCountry) countryExpected++;
    if (detCountry) countryDetected++;
    if (gt.hasCountry && detCountry) countryCorrect++;

    if (gt.hasYear) yearExpected++;
    if (detYear) yearDetected++;
    if (gt.hasYear && detYear) yearCorrect++;

    if (gt.hasAttackType) attackTypeExpected++;
    if (detAttackType) attackTypeDetected++;
    if (gt.hasAttackType && detAttackType) attackTypeCorrect++;

    if (gt.hasCasualties) casualtyExpected++;
    if (detCasualty) casualtyDetected++;
    if (gt.hasCasualties && detCasualty) casualtyCorrect++;

    // Check if filter is valid (non-empty object with executable criteria)
    const filterKeys = Object.keys(filter);
    const isFilterValid = filterKeys.length > 0;
    if (isFilterValid) validFilterGenerated++;

    // Check if fields match expectation
    let matchesExpectation = true;
    if (gt.hasCountry !== detCountry) matchesExpectation = false;
    if (gt.hasYear !== detYear) matchesExpectation = false;
    if (gt.hasAttackType !== detAttackType) matchesExpectation = false;
    if (matchesExpectation) exactFieldMatch++;

    queryDetails.push({
      id: item.id,
      query: q,
      category: item.category,
      gt,
      detected: {
        country: detCountry,
        year: detYear,
        attackType: detAttackType,
        casualty: detCasualty,
      },
      filterKeys,
      matchesExpectation,
    });
  }

  // Calculate Precision, Recall, F1 for entities
  const calcPRF1 = (correct, expected, detected) => {
    const prec = detected > 0 ? (correct / detected) * 100 : 100;
    const rec = expected > 0 ? (correct / expected) * 100 : 100;
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
    return { precision: prec, recall: rec, f1 };
  };

  const countryMetrics = calcPRF1(countryCorrect, countryExpected, countryDetected);
  const yearMetrics = calcPRF1(yearCorrect, yearExpected, yearDetected);
  const attackTypeMetrics = calcPRF1(attackTypeCorrect, attackTypeExpected, attackTypeDetected);
  const casualtyMetrics = calcPRF1(casualtyCorrect, casualtyExpected, casualtyDetected);

  const filterAccuracyPct = (exactFieldMatch / gtdQueries.length) * 100;
  const validFilterPct = (validFilterGenerated / gtdQueries.length) * 100;

  console.log("-------------------------------------------------------------------------------");
  console.log("  ENTITY EXTRACTION ACCURACY BREAKDOWN (N=90 GTD Queries)");
  console.log("-------------------------------------------------------------------------------");
  console.log(`- Country Entity:     Precision: ${countryMetrics.precision.toFixed(2)}% | Recall: ${countryMetrics.recall.toFixed(2)}% | F1: ${countryMetrics.f1.toFixed(2)}% (${countryCorrect}/${countryExpected})`);
  console.log(`- Year / Date Range:  Precision: ${yearMetrics.precision.toFixed(2)}% | Recall: ${yearMetrics.recall.toFixed(2)}% | F1: ${yearMetrics.f1.toFixed(2)}% (${yearCorrect}/${yearExpected})`);
  console.log(`- Attack Type:        Precision: ${attackTypeMetrics.precision.toFixed(2)}% | Recall: ${attackTypeMetrics.recall.toFixed(2)}% | F1: ${attackTypeMetrics.f1.toFixed(2)}% (${attackTypeCorrect}/${attackTypeExpected})`);
  console.log(`- Casualty / Metric:  Precision: ${casualtyMetrics.precision.toFixed(2)}% | Recall: ${casualtyMetrics.recall.toFixed(2)}% | F1: ${casualtyMetrics.f1.toFixed(2)}% (${casualtyCorrect}/${casualtyExpected})`);
  console.log("-------------------------------------------------------------------------------");
  console.log(`  STRUCTURED FILTER ACCURACY & EXECUTION`);
  console.log("-------------------------------------------------------------------------------");
  console.log(`- Valid MongoDB Filters Generated:     ${validFilterPct.toFixed(2)}% (${validFilterGenerated}/${gtdQueries.length})`);
  console.log(`- Exact Field Matching Accuracy:       ${filterAccuracyPct.toFixed(2)}% (${exactFieldMatch}/${gtdQueries.length})\n`);

  const results = {
    totalGTDQueries: gtdQueries.length,
    validFilterRate: validFilterPct,
    exactFieldMatchRate: filterAccuracyPct,
    entityMetrics: {
      country: countryMetrics,
      year: yearMetrics,
      attackType: attackTypeMetrics,
      casualty: casualtyMetrics,
    },
    queryDetails,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), "utf8");
  console.log(`Saved structured query accuracy report to ${OUTPUT_PATH}`);
}

runEvaluation();
