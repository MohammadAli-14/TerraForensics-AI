#!/usr/bin/env node
/**
 * Routing Intent Classifier Evaluation Benchmark
 *
 * Evaluates contextExtractor.isGTDQuery against the 180-query labeled dataset
 * (90 GTD ground-truth, 90 Document ground-truth).
 *
 * Computes:
 * - Confusion Matrix (TP, FP, FN, TN)
 * - Precision, Recall, F1-Score, Accuracy, Specificity
 * - Detailed error analysis on misrouted queries
 * - Updates results/routing_benchmark_results.json and results/evaluation_metrics.csv
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Resolve paths regardless of whether script is run from repo root or server/
const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_DIR = path.resolve(ROOT_DIR, "server");
const DATASET_PATH = path.resolve(ROOT_DIR, "results/labeled_benchmark_dataset.json");
const ROUTING_RESULTS_PATH = path.resolve(ROOT_DIR, "results/routing_benchmark_results.json");
const CSV_RESULTS_PATH = path.resolve(ROOT_DIR, "results/evaluation_metrics.csv");

// Load contextExtractor module
const contextExtractor = require(path.resolve(SERVER_DIR, "utils/mongoDB/contextExtractor"));

export function runEvaluation() {
  if (!fs.existsSync(DATASET_PATH)) {
    console.error(`Error: Dataset not found at ${DATASET_PATH}`);
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
  const totalQueries = dataset.length;
  const gtdExpectedCount = dataset.filter((d) => d.expectedIsGTD).length;
  const docExpectedCount = dataset.filter((d) => !d.expectedIsGTD).length;
  const genericAmbigCount = dataset.filter((d) => d.hasGenericKeyword).length;

  console.log("===============================================================================");
  console.log("  INTENT CLASSIFIER EVALUATION (isGTDQuery Word-Boundary Anchor Benchmark)");
  console.log("===============================================================================");
  console.log(`Total Dataset:        ${totalQueries} queries`);
  console.log(`- GTD Ground Truth:     ${gtdExpectedCount} queries`);
  console.log(`- Document Ground Truth:${docExpectedCount} queries (including ${genericAmbigCount} with generic keywords)`);
  console.log("-------------------------------------------------------------------------------\n");

  let tp = 0; // Expected GTD, Detected GTD
  let fp = 0; // Expected Doc, Detected GTD
  let fn = 0; // Expected GTD, Detected Doc
  let tn = 0; // Expected Doc, Detected Doc

  const detailedEvaluations = [];
  const genericKeywordStats = {
    report: { total: 0, falsePositives: 0 },
    find: { total: 0, falsePositives: 0 },
    list: { total: 0, falsePositives: 0 },
    data: { total: 0, falsePositives: 0 },
    search: { total: 0, falsePositives: 0 },
    query: { total: 0, falsePositives: 0 },
  };

  const falsePositiveList = [];
  const falseNegativeList = [];

  for (const item of dataset) {
    const t0 = process.hrtime();
    const detectedGTD = contextExtractor.isGTDQuery(item.query);
    const tDiff = process.hrtime(t0);
    const latencyMs = Number((tDiff[0] * 1000 + tDiff[1] / 1e6).toFixed(4));

    const actualGTD = item.expectedIsGTD;
    let outcome;

    if (detectedGTD && actualGTD) {
      tp++;
      outcome = "TP";
    } else if (detectedGTD && !actualGTD) {
      fp++;
      outcome = "FP";
      falsePositiveList.push({ id: item.id, query: item.query, keyword: item.keyword, category: item.category });
    } else if (!detectedGTD && actualGTD) {
      fn++;
      outcome = "FN";
      falseNegativeList.push({ id: item.id, query: item.query, category: item.category });
    } else {
      tn++;
      outcome = "TN";
    }

    if (item.hasGenericKeyword && item.keyword && genericKeywordStats[item.keyword]) {
      genericKeywordStats[item.keyword].total++;
      if (detectedGTD) {
        genericKeywordStats[item.keyword].falsePositives++;
      }
    }

    detailedEvaluations.push({
      id: item.id,
      query: item.query,
      expectedType: item.expectedType,
      expectedIsGTD: actualGTD,
      detectedIsGTD: detectedGTD,
      outcome,
      latencyMs,
      category: item.category,
      hasGenericKeyword: !!item.hasGenericKeyword,
      keyword: item.keyword || null,
    });
  }

  // Calculate Metrics
  const precision = tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(4)) : 0;
  const recall = tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(4)) : 0;
  const f1 = precision + recall > 0 ? Number(((2 * precision * recall) / (precision + recall)).toFixed(4)) : 0;
  const accuracy = totalQueries > 0 ? Number(((tp + tn) / totalQueries).toFixed(4)) : 0;
  const specificity = tn + fp > 0 ? Number((tn / (tn + fp)).toFixed(4)) : 0;

  // Print Confusion Matrix
  console.log("CONFUSION MATRIX:");
  console.log("-----------------------------------------------------------------");
  console.log("                    |  Predicted GTD       |  Predicted Document");
  console.log("--------------------+----------------------+---------------------");
  console.log(` Actual GTD         |  TP: ${String(tp).padEnd(16)}|  FN: ${String(fn).padEnd(16)}`);
  console.log(` Actual Document    |  FP: ${String(fp).padEnd(16)}|  TN: ${String(tn).padEnd(16)}`);
  console.log("-----------------------------------------------------------------\n");

  // Print Metrics
  console.log("CLASSIFICATION METRICS (GTD Class as Positive):");
  console.log("-----------------------------------------------------------------");
  console.log(`- Precision:          ${(precision * 100).toFixed(2)}% (${tp}/${tp + fp})`);
  console.log(`- Recall:             ${(recall * 100).toFixed(2)}% (${tp}/${tp + fn})`);
  console.log(`- F1-Score:           ${(f1 * 100).toFixed(2)}%`);
  console.log(`- Overall Accuracy:   ${(accuracy * 100).toFixed(2)}% (${tp + tn}/${totalQueries})`);
  console.log(`- Specificity:        ${(specificity * 100).toFixed(2)}% (${tn}/${tn + fp})`);
  console.log("-----------------------------------------------------------------\n");

  // Ambiguous Keyword Breakdown
  console.log("GENERIC KEYWORD ERROR BREAKDOWN (Document Queries Misrouted):");
  console.log("-----------------------------------------------------------------");
  let totalAmbigFP = 0;
  for (const [kw, stats] of Object.entries(genericKeywordStats)) {
    totalAmbigFP += stats.falsePositives;
    console.log(`  * Keyword "${kw}": ${stats.falsePositives}/${stats.total} misrouted as GTD FP`);
  }
  console.log(`  Total generic keyword false positives: ${totalAmbigFP}/${genericAmbigCount} (${((totalAmbigFP / genericAmbigCount) * 100).toFixed(1)}%)\n`);

  if (falseNegativeList.length > 0) {
    console.log(`FALSE NEGATIVES (Missed GTD Queries) [Total: ${falseNegativeList.length}]:`);
    console.log("-----------------------------------------------------------------");
    for (const fnItem of falseNegativeList) {
      console.log(`  [ID ${fnItem.id}] "${fnItem.query}" (Category: ${fnItem.category})`);
    }
    console.log("");
  } else {
    console.log("FALSE NEGATIVES: 0 (100% GTD Recall preserved)\n");
  }

  console.log(`FALSE POSITIVES [Total: ${falsePositiveList.length}]:`);
  console.log("-----------------------------------------------------------------");
  for (const fpItem of falsePositiveList) {
    console.log(`  [ID ${fpItem.id}] "${fpItem.query}" (Keyword: ${fpItem.keyword || "non-ambiguous"})`);
  }
  console.log("");

  // Persist updated results to disk
  let existingResults = {};
  if (fs.existsSync(ROUTING_RESULTS_PATH)) {
    try {
      existingResults = JSON.parse(fs.readFileSync(ROUTING_RESULTS_PATH, "utf8"));
    } catch (_) {}
  }

  const routingResults = {
    ...existingResults,
    datasetSummary: {
      totalQueries,
      gtdQueries: gtdExpectedCount,
      documentQueries: docExpectedCount,
      ambiguousGenericQueries: genericAmbigCount,
    },
    confusionMatrix: {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
    },
    metrics: {
      precision,
      recall,
      f1Score: f1,
      accuracy,
      specificity,
    },
    ambiguousKeywordBreakdown: genericKeywordStats,
    evaluations: detailedEvaluations,
  };

  fs.writeFileSync(ROUTING_RESULTS_PATH, JSON.stringify(routingResults, null, 2), "utf8");
  console.log(`Updated routing results: ${path.relative(process.cwd(), ROUTING_RESULTS_PATH)}`);

  // Write evaluation_metrics.csv
  const csvHeaders = "id,expected_type,detected_type,outcome,latency_ms,is_ambiguous,keyword,query\n";
  const csvLines = detailedEvaluations.map((d) => {
    const escapedQuery = `"${d.query.replace(/"/g, '""')}"`;
    return `${d.id},${d.expectedType},${d.detectedIsGTD ? "gtd" : "document"},${d.outcome},${d.latencyMs},${d.hasGenericKeyword},${d.keyword || ""},${escapedQuery}`;
  });
  fs.writeFileSync(CSV_RESULTS_PATH, csvHeaders + csvLines.join("\n"), "utf8");
  console.log(`Updated CSV metrics:     ${path.relative(process.cwd(), CSV_RESULTS_PATH)}\n`);

  return { tp, fp, fn, tn, precision, recall, f1, accuracy, specificity };
}

runEvaluation();
