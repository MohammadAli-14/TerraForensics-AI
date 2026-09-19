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
    // Strategy 1: Find JSON starting with {"answer": pattern
    const jsonPatterns = [
      /\{[\s]*"answer"[\s]*:[\s]*"[^]*\}/, // {"answer": ...}
      /\{[\s]*"confidence"[\s]*:[\s]*[^]*\}/, // {"confidence": ...}
      /\{[\s]*"query_type"[\s]*:[\s]*"[^]*\}/, // {"query_type": ...}
    ];

    for (const pattern of jsonPatterns) {
      const match = text.match(pattern);
      if (match) {
        try {
          // Clean up the matched string and parse
          let jsonStr = match[0];
          const startIndex = match.index;

          // Handle potential trailing content
          let braceCount = 0;
          let endIndex = 0;
          for (let i = 0; i < jsonStr.length; i++) {
            if (jsonStr[i] === "{") braceCount++;
            if (jsonStr[i] === "}") braceCount--;
            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
          if (endIndex > 0) {
            jsonStr = jsonStr.substring(0, endIndex);
          }

          const parsed = JSON.parse(jsonStr);
          return {
            parsed,
            raw: jsonStr,
            startIndex: startIndex,
            endIndex: startIndex + jsonStr.length,
          };
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
      let braceCount = 0;
      let jsonStart = lastBraceIndex;
      let jsonEnd = -1;

      for (let i = jsonStart; i < text.length; i++) {
        if (text[i] === "{") braceCount++;
        if (text[i] === "}") braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }

      if (jsonEnd > jsonStart) {
        const potentialJson = text.substring(jsonStart, jsonEnd);
        try {
          const parsed = JSON.parse(potentialJson);
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
