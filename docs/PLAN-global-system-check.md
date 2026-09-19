
# PLAN-global-system-check

## Task: Global System Analysis & Verification

**Goal**: Verify that the recent "GTD Global Schema Fixes" are correctly integrated across Server, Frontend, and Collector, and ensure no regressions in global functionality.

## 1. Analysis Scope

We will coordinate three specialist agents to audit the codebase:

1.  **Backend Specialist** (`server/`)
    *   **Focus**: `GTDNormalizationService`, `contextExtractor.js`, `stream.js`, `apiChatHandler.js`.
    *   **Verify**: consistent usage of normalization, error handling, and data flow.

2.  **Frontend Specialist** (`frontend/`)
    *   **Focus**: `GTDDataDisplay.jsx`, API response handling in `useChat`.
    *   **Verify**: Frontend correctly renders the normalized `gtdData` payload (geo_points, clusters).

3.  **Test Engineer** (Verification)
    *   **Focus**: Running verification scripts (`test_normalization.cjs`) and general linting/safety checks.
    *   **Verify**: System stability.

## 2. Execution Plan

### Phase 1: Backend Audit (Agent: `backend-specialist`)
- [ ] Audit `GTDNormalizationService.js`: Ensure fuzzy matching logic is robust.
- [ ] Audit `contextExtractor.js`: Confirm `parseNaturalLanguageQuery` uses the service correctly.
- [ ] Audit `stream.js` & `apiChatHandler.js`: Confirm LLM filters are normalized BEFORE execution.

### Phase 2: Frontend Audit (Agent: `frontend-specialist`)
- [ ] Review `frontend/src/components/GTDDataDisplay.jsx` (or similar): Ensure it expects the data format returning from the server.
- [ ] Check for any hardcoded schema assumptions that might contradict the new normalization.

### Phase 3: Verification (Agent: `test-engineer`)
- [ ] Run `node test_normalization.cjs`.
- [ ] Run `python .agent/scripts/checklist.py .` (if available) or manual safety checks.

## 3. Deliverables
- [ ] System Health Report.
- [ ] Confirmation of Global GTD Functionality.

## 4. Agent Assignments
- **Orchestration**: `orchestrator`
- **Backend**: `backend-specialist`
- **Frontend**: `frontend-specialist`
- **Testing**: `test-engineer`
