function normalizeJsonQuotes(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
}

function safeParseJson(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch (e1) {
    try {
      return JSON.parse(normalizeJsonQuotes(jsonStr));
    } catch (e2) {
      return null;
    }
  }
}

/**
 * Extract JSON object from LLM response text
 * The LLM outputs a human-readable answer followed by a JSON object
 * This function finds and parses that JSON
 *
 * @param {string} text - The complete LLM response text
 * @returns {Object|null} - Null if not found, otherwise object with:
 *   - parsed: The parsed JSON object
 *   - raw: The raw JSON string
 *   - startIndex: Start index of JSON in original text
 *   - endIndex: End index of JSON in original text
 */
function extractJsonFromLLMResponse(text) {
  if (!text || typeof text !== "string") return null;

  try {
    // Strategy 1: Find JSON starting with {"answer": pattern (including smart quotes)
    const jsonPatterns = [
      /\{[\s]*["“\u201C]answer["”\u201D][\s]*:[\s]*["“\u201C][^]*\}/,
      /\{[\s]*["“\u201C]confidence["”\u201D][\s]*:[\s]*[^]*\}/,
      /\{[\s]*["“\u201C]query_type["”\u201D][\s]*:[\s]*["“\u201C][^]*\}/,
      /\{[\s]*["“\u201C]mongo_filter["”\u201D][\s]*:[\s]*[^]*\}/,
    ];

    for (const pattern of jsonPatterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          // Clean up the matched string and parse
          let jsonStr = match[0];
          const startIndex = match.index;

          // Handle potential trailing content with string-aware brace matching
          let inString = false;
          let isEscaping = false;
          let braceCount = 0;
          let endIndex = 0;
          for (let i = 0; i < jsonStr.length; i++) {
            const c = jsonStr[i];
            if (inString) {
              if (
                (c === '"' || c === "\u201C" || c === "\u201D" || c === "'") &&
                !isEscaping
              ) {
                inString = false;
              } else if (c === "\\" && !isEscaping) {
                isEscaping = true;
              } else {
                isEscaping = false;
              }
            } else {
              if (c === '"' || c === "\u201C" || c === "\u201D" || c === "'") {
                inString = true;
              } else if (c === "{") {
                braceCount++;
              } else if (c === "}") {
                braceCount--;
                if (braceCount === 0) {
                  endIndex = i + 1;
                  break;
                }
              }
            }
          }
          if (endIndex > 0) {
            jsonStr = jsonStr.substring(0, endIndex);
          }

          const parsed = safeParseJson(jsonStr);
          if (parsed && typeof parsed === "object") {
            return {
              parsed,
              raw: jsonStr,
              startIndex: startIndex,
              endIndex: startIndex + jsonStr.length,
            };
          }
        } catch (parseError) {
          console.log(
            `[JSON Extractor] Pattern matched but parse failed: ${parseError.message}`
          );
          continue;
        }
      }
    }

    // Strategy 2: Find last { and try to parse from there to matching }
    const lastBraceIndex = text.lastIndexOf("{");
    if (lastBraceIndex !== -1) {
      let inString = false;
      let isEscaping = false;
      let braceCount = 0;
      let jsonStart = lastBraceIndex;
      let jsonEnd = -1;

      for (let i = jsonStart; i < text.length; i++) {
        const c = text[i];
        if (inString) {
          if (
            (c === '"' || c === "\u201C" || c === "\u201D" || c === "'") &&
            !isEscaping
          ) {
            inString = false;
          } else if (c === "\\" && !isEscaping) {
            isEscaping = true;
          } else {
            isEscaping = false;
          }
        } else {
          if (c === '"' || c === "\u201C" || c === "\u201D" || c === "'") {
            inString = true;
          } else if (c === "{") {
            braceCount++;
          } else if (c === "}") {
            braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }
      }

      if (jsonEnd > jsonStart) {
        const potentialJson = text.substring(jsonStart, jsonEnd);
        try {
          const parsed = safeParseJson(potentialJson);
          if (parsed && typeof parsed === "object") {
            return {
              parsed,
              raw: potentialJson,
              startIndex: jsonStart,
              endIndex: jsonEnd,
            };
          }
        } catch (e) {
          // Not valid JSON
        }
      }
    }

    // Strategy 3: Use extract-json-from-string library if available
    try {
      const extractJson = require("extract-json-from-string");
      const extracted = extractJson(text);
      if (extracted && extracted.length > 0) {
        // Find the one with mongo_filter or answer key
        const gtdJson = extracted.find(
          (obj) => obj.mongo_filter || obj.answer || obj.query_type
        );
        if (gtdJson) {
          // This fallback strategy doesn't give us indices easily,
          // so we might not be able to strip it perfectly without regex search again.
          // But identifying it is better than nothing.
          return {
            parsed: gtdJson,
            raw: null, // We don't know the exact raw string or position easily
            startIndex: -1,
            endIndex: -1,
          };
        }
      }
    } catch (libError) {
      // Library not available or failed
    }

    return null;
  } catch (error) {
    console.error(`[JSON Extractor] Error extracting JSON:`, error.message);
    return null;
  }
}

module.exports = {
  extractJsonFromLLMResponse,
};
