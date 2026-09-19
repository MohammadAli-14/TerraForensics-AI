const ce = require("./server/utils/mongoDB/contextExtractor");
const q = "Can you find the section describing the refund policy in the user handbook?";
console.log("ce.isGTDQuery(q):", ce.isGTDQuery(q));

for (const kw of ce.gtdKeywords) {
  const esc = ce.escapeRegex(kw);
  const re = new RegExp(`\\b${esc}\\b`, "i");
  if (re.test(q)) {
    console.log("Matched keyword:", kw);
  }
}
