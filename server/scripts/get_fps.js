const fs = require('fs');
const lines = fs.readFileSync('results/evaluation_metrics.csv', 'utf8').split('\n');
let fps = [];
for (let i = 1; i < lines.length; i++) {
  const l = lines[i];
  if (!l) continue;
  // Split by comma but handle quotes
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let j = 0; j < l.length; j++) {
    if (l[j] === '"') {
      inQuotes = !inQuotes;
    } else if (l[j] === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += l[j];
    }
  }
  parts.push(current);
  if (parts[3] === 'FP') {
    fps.push({ query: parts[7], keyword: parts[6] || '<Matched by Regex>' });
  }
}
fps.forEach(fp => console.log(`- "${fp.query}" (Triggered by: ${fp.keyword})`));
