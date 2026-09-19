const {
  ATTACK_TYPES,
  TARGET_TYPES,
  WEAPON_TYPES,
  REGIONS,
} = require("./GTDConstants");

/**
 * GTDNormalizationService
 *
 * Responsible for mapping loose/fuzzy user or LLM inputs to EXACT MongoDB schema values.
 * Solves "Bombing" -> "Bombing/Explosion" and "Religious" -> "Religious Figures/Institutions" issues.
 */
class GTDNormalizationService {
  constructor() {
    this.attackTypes = ATTACK_TYPES;
    this.targetTypes = TARGET_TYPES;
    this.weaponTypes = WEAPON_TYPES;
    this.regions = REGIONS;
  }

  /**
   * Main normalization method for a full filter object
   * @param {Object} filter - The mongo_filter object from LLM or ContextExtractor
   * @returns {Object} - A new filter object with normalized string values
   */
  normalizeFilter(filter) {
    if (!filter || typeof filter !== "object") return filter;

    const normalized = { ...filter };

    console.log(`[GTD Normalizer] Normalizing filter:`, JSON.stringify(filter));

    // Normalize Attack Type
    if (normalized.attacktype1_txt) {
      normalized.attacktype1_txt = this.findBestMatch(
        normalized.attacktype1_txt,
        this.attackTypes,
        "Attack Type"
      );
    }

    // Normalize Target Type
    if (normalized.targtype1_txt) {
      normalized.targtype1_txt = this.findBestMatch(
        normalized.targtype1_txt,
        this.targetTypes,
        "Target Type"
      );
    }

    // Normalize Weapon Type
    if (normalized.weaptype1_txt) {
      normalized.weaptype1_txt = this.findBestMatch(
        normalized.weaptype1_txt,
        this.weaponTypes,
        "Weapon Type"
      );
    }

    // Normalize Region
    if (normalized.region_txt) {
      normalized.region_txt = this.findBestMatch(
        normalized.region_txt,
        this.regions,
        "Region"
      );
    }

    return normalized;
  }

  /**
   * Finds the best matching constant for a given input string.
   * Prioritizes:
   * 1. Exact case-insensitive match
   * 2. "Starts with" match (for input being a prefix)
   * 3. "Includes" match (for input being a substring)
   *
   * CRITICAL: Checks against LONGEST constants first to avoid partial match errors
   * (e.g. "Religious" matching "Religious Figures" instead of "Religious" if both existed)
   */
  findBestMatch(input, validValues, typeLabel) {
    if (!input || typeof input !== "string") return input;

    const cleanInput = input.trim().toLowerCase();

    // Sort valid values by length descending to ensure specific matches first
    // e.g. "Religious Figures/Institutions" checked before "Religious"
    const sortedValues = [...validValues].sort((a, b) => b.length - a.length);

    // 1. Exact Match Check
    const exactMatch = sortedValues.find(
      (val) => val.toLowerCase() === cleanInput
    );
    if (exactMatch) {
      console.log(
        `[GTD Normalizer] ${typeLabel} Exact Match: "${input}" -> "${exactMatch}"`
      );
      return exactMatch; // Return the properly cased DB value
    }

    // 2. Starts With Check (e.g. "Bombing" -> "Bombing/Explosion")
    const startsWithMatch = sortedValues.find((val) =>
      val.toLowerCase().startsWith(cleanInput)
    );
    if (startsWithMatch) {
      console.log(
        `[GTD Normalizer] ${typeLabel} Prefix Match: "${input}" -> "${startsWithMatch}"`
      );
      return startsWithMatch;
    }

    // 3. Includes Check (e.g. "Dipolmatic" -> "Government (Diplomatic)")
    const partialMatch = sortedValues.find((val) =>
      val.toLowerCase().includes(cleanInput)
    );
    if (partialMatch) {
      console.log(
        `[GTD Normalizer] ${typeLabel} Partial Match: "${input}" -> "${partialMatch}"`
      );
      return partialMatch;
    }

    // 4. Reverse Include Check (Input contains the constant - e.g. "Attacks involving firearms" -> "Firearms")
    const reverseMatch = sortedValues.find((val) =>
      cleanInput.includes(val.toLowerCase())
    );
    if (reverseMatch) {
      console.log(
        `[GTD Normalizer] ${typeLabel} Reverse Match: "${input}" -> "${reverseMatch}"`
      );
      return reverseMatch;
    }

    console.log(
      `[GTD Normalizer] ⚠️ No match found for ${typeLabel}: "${input}". Keeping original.`
    );
    return input;
  }
}

module.exports = new GTDNormalizationService();
