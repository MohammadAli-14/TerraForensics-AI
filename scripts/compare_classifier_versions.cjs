/**
 * compare_classifier_versions.cjs
 *
 * Demonstrates and reproduces the exact Pre-Fix vs Post-Fix Routing Classifier behavior
 * across the 180 benchmark queries in results/labeled_benchmark_dataset.json.
 *
 * Pre-Fix:  Unanchored substring match  new RegExp(escaped, "i")
 * Post-Fix: Word-boundary anchored      new RegExp(`\\b${escaped}\\b`, "i")
 */

const fs = require("fs");
const path = require("path");

const datasetPath = path.resolve(__dirname, "../results/labeled_benchmark_dataset.json");
const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

const contextExtractor = require("../server/utils/mongoDB/contextExtractor");

function classifyPreFix(query) {
  if (!query || typeof query !== "string") return false;
  // Pre-fix: unanchored substring matching
  const hasGTDKeywords = contextExtractor.gtdKeywords.some((keyword) => {
    const escaped = contextExtractor.escapeRegex(keyword);
    return new RegExp(escaped, "i").test(query);
  });

  const ATTACK_SYNONYMS_REGEX = contextExtractor.ATTACK_SYNONYMS_REGEX;
  const hasGTDStructure =
    new RegExp(`(${ATTACK_SYNONYMS_REGEX}|terrorism|terrorist)`, "i").test(query) ||
    new RegExp(`(how\\s+many|count|total|number\\s+of).*(${ATTACK_SYNONYMS_REGEX})`, "i").test(query) ||
    /\b(in|from|by|city|country|group)\b.*\b(pakistan|afghanistan|iraq|syria|russia|india|indonesia|philippines|nigeria|yemen|somalia|libya|egypt|turkey|israel|palestine|lebanon|jordan|iran|colombia|peru|mexico|france|uk|usa|germany|spain|italy|kenya|mali|tunisia|algeria|morocco|sudan|bangladesh|sri lanka|nepal|thailand|myanmar|bali)\b/i.test(query) ||
    /\d{12}/.test(query);

  const hasDateAndCountry =
    /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})\b/i.test(query) &&
    /\b(pakistan|afghanistan|iraq|syria|russia|india|indonesia|philippines|nigeria|yemen|somalia|libya|egypt|turkey|israel|palestine|lebanon|jordan|iran|colombia|peru|mexico|france|uk|usa|germany|spain|italy|kenya|mali|tunisia|algeria|morocco|sudan|bangladesh|sri\s*lanka|nepal|thailand|myanmar|bali)\b/i.test(query);

  return hasGTDKeywords || hasGTDStructure || hasDateAndCountry;
}

function classifyPostFix(query) {
  return contextExtractor.isGTDQuery(query);
}

function evaluate(classifierFn) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const fpQueries = [];

  for (const item of dataset) {
    const isGTDPredicted = classifierFn(item.query);
    const isGTDActual = item.expectedIsGTD === true;

    if (isGTDPredicted && isGTDActual) tp++;
    else if (isGTDPredicted && !isGTDActual) {
      fp++;
      fpQueries.push(item);
    }
    else if (!isGTDPredicted && !isGTDActual) tn++;
    else if (!isGTDPredicted && isGTDActual) fn++;
  }

  const precision = Number((tp / (tp + fp)).toFixed(4));
  const recall = Number((tp / (tp + fn)).toFixed(4));
  const f1 = Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
  const accuracy = Number(((tp + tn) / dataset.length).toFixed(4));

  return { tp, fp, tn, fn, precision, recall, f1, accuracy, fpQueries };
}

const pre = evaluate(classifyPreFix);
const post = evaluate(classifyPostFix);

const flippedQueries = pre.fpQueries.filter(
  (preItem) => !post.fpQueries.some((postItem) => postItem.id === preItem.id)
);

console.log("===============================================================================");
console.log("  PRE-FIX VS POST-FIX ROUTING CLASSIFIER COMPARISON (180 Queries)");
console.log("===============================================================================\n");

console.log(`Pre-Fix  (Substring Match):  TP=${pre.tp}, FP=${pre.fp}, TN=${pre.tn}, FN=${pre.fn} | Prec=${(pre.precision*100).toFixed(2)}%, Rec=${(pre.recall*100).toFixed(2)}%, Acc=${(pre.accuracy*100).toFixed(2)}%`);
console.log(`Post-Fix (Word Boundaries):  TP=${post.tp}, FP=${post.fp}, TN=${post.tn}, FN=${post.fn} | Prec=${(post.precision*100).toFixed(2)}%, Rec=${(post.recall*100).toFixed(2)}%, Acc=${(post.accuracy*100).toFixed(2)}%\n`);

console.log("Flipped Queries (Substrings Fixed by Word Boundaries \\b):");
flippedQueries.forEach(q => {
  console.log(`  - Query #${q.id}: "${q.query}"`);
});

const outPath = path.resolve(__dirname, "../results/classifier_prefix_vs_postfix.json");
fs.writeFileSync(outPath, JSON.stringify({
  comparisonSummary: {
    totalQueries: dataset.length,
    preFix: { tp: pre.tp, fp: pre.fp, tn: pre.tn, fn: pre.fn, precision: pre.precision, recall: pre.recall, accuracy: pre.accuracy, f1Score: pre.f1 },
    postFix: { tp: post.tp, fp: post.fp, tn: post.tn, fn: post.fn, precision: post.precision, recall: post.recall, accuracy: post.accuracy, f1Score: post.f1 },
    delta: { fpReduction: pre.fp - post.fp, precisionGainPercent: Number(((post.precision - pre.precision) * 100).toFixed(2)) }
  },
  flippedQueries: flippedQueries.map(q => ({ id: q.id, query: q.query, channel: q.target_channel }))
}, null, 2), "utf8");

console.log(`\nSaved comparison evidence to ${outPath}`);
