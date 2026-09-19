
# PLAN-gtd-global-schema-fix

## Task: Global GTD Data Normalization & Schema Fix

**Goal**: Implement a centralized normalization layer that ensures ALL queries (Natural Language, LLM-generated JSON, API Streams) map user-friendly terms (e.g., "Bombing", "Religious Figures") to the EXACT values required by the MongoDB schema (e.g., "Bombing/Explosion", "Religious Figures/Institutions").

## 1. Problem Analysis

The system currently fails to return results for certain queries because of exact-match filters against strict database values.
*   **User Query**: "Bombing"
*   **Current Filter**: `{ attacktype1_txt: /^Bombing$/i }`
*   **Database Value**: "Bombing/Explosion"
*   **Result**: 0 matches (Mismatch)

This issue affects:
1.  **Context Extractor** (Initial NLP parsing)
2.  **Stream Processing** (LLM JSON execution)
3.  **API Chat Handler** (External API usage)

## 2. Proposed Architecture: Centralized Normalization

We will create a single source of truth for GTD values and a helper service to normalize inputs.

### Core Components
1.  **`GTDConstants.js`**: A file containing the exact valid arrays from the database (Attack Types, Target Types, Weapon Types).
2.  **`GTDNormalizationService.js`**: A service with a `normalizeFilter(filter)` method that:
    *   Takes a loose filter object (e.g., `{ attacktype1_txt: "Bombing" }`).
    *   Fuzzy-matches or maps the value to the correct constant (e.g., "Bombing/Explosion").
    *   Returns the corrected filter.

## 3. Implementation Steps

- [ ] **Step 1: Create `server/utils/mongoDB/GTDConstants.js`**
    *   Export `ATTACK_TYPES` (full strings).
    *   Export `TARGET_TYPES` (full strings).
    *   Export `WEAPON_TYPES` (full strings).
    *   *Source these values from the user's report (e.g., "Facility/Infrastructure Attack", "Government (Diplomatic)").*

- [ ] **Step 2: Create `server/utils/mongoDB/GTDNormalizationService.js`**
    *   Implement `normalizeString(input, type)` function.
    *   Use fuzzy matching or "includes" logic (e.g., if input is "Religious", match "Religious Figures/Institutions").
    *   Prioritize length (longer matches first) to solve the "Religious" vs "Religious Figures" precedence bug.

- [ ] **Step 3: Refactor `contextExtractor.js`**
    *   Import `GTDNormalizationService`.
    *   Replace local array definitions with imports from `GTDConstants`.
    *   In `parseNaturalLanguageQuery`, run extracted terms through the normalizer before setting `conditions`.

- [ ] **Step 4: Refactor `stream.js` & `apiChatHandler.js`**
    *   Locate `executeFilterFromLLMResponse`.
    *   Inject a call to `GTDNormalizationService.normalizeFilter(llmParsedJson.mongo_filter)` *before* execution.
    *   This ensures that if the LLM hallucinates "Firearms" (correct) or "Guns" (incorrect), it gets mapped to "Firearms" (DB Value).

## 4. Verification

| Input | Process | Expected Output |
|-------|---------|-----------------|
| "Attack was Bombing" | Normalizer | Filter: "Bombing/Explosion" -> Results found |
| "Target Religious" | Normalizer | Filter: "Religious Figures/Institutions" -> Results found |
| "ByType Facility" | Normalizer | Filter: "Facility/Infrastructure Attack" -> Results found |

## 5. Agent Assignment
*   **Agent**: `orchestrator` / `backend-developer`
*   **Skill**: `node-mongo`, `clean-code`
