/**
 * GTDConstants.js
 *
 * Single source of truth for Global Terrorism Database (GTD) schema values.
 * Used for normalization of user queries and LLM outputs to match exact DB strings.
 */

const GTD_CONSTANTS = {
  // ATTACK TYPES (attacktype1_txt) - Exact DB Values
  ATTACK_TYPES: [
    "Bombing/Explosion",
    "Armed Assault",
    "Assassination",
    "Hostage Taking (Kidnapping)",
    "Hostage Taking (Barricade Incident)",
    "Facility/Infrastructure Attack",
    "Hijacking",
    "Unarmed Assault",
    "Unknown",
  ],

  // TARGET TYPES (targtype1_txt) - Exact DB Values
  TARGET_TYPES: [
    "Private Citizens & Property",
    "Military",
    "Police",
    "Government (General)",
    "Business",
    "Transportation",
    "Utilities",
    "Religious Figures/Institutions",
    "Educational Institution",
    "Government (Diplomatic)",
    "Terrorists/Non-State Militia",
    "Journalists & Media",
    "Violent Political Party",
    "Airports & Aircraft",
    "Telecommunication",
    "NGO",
    "Tourists",
    "Maritime",
    "Food or Water Supply",
    "Abortion Related",
    "Other",
  ],

  // WEAPON TYPES (weaptype1_txt) - Exact DB Values
  WEAPON_TYPES: [
    "Explosives",
    "Firearms",
    "Incendiary",
    "Melee",
    "Chemical",
    "Sabotage Equipment",
    "Vehicle (not to include vehicle-borne explosives, i.e., car or truck bombs)",
    "Fake Weapons",
    "Radiological",
    "Biological",
    "Other",
    "Unknown",
  ],

  // REGIONS (region_txt) - Exact DB Values
  REGIONS: [
    "North America",
    "Central America & Caribbean",
    "South America",
    "East Asia",
    "Southeast Asia",
    "South Asia",
    "Central Asia",
    "Western Europe",
    "Eastern Europe",
    "Middle East & North Africa",
    "Sub-Saharan Africa",
    "Australasia & Oceania",
  ],
};

module.exports = GTD_CONSTANTS;
