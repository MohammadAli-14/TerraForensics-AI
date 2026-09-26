# 🌍 TerraForensics AI — GTD Sovereign Execution Notes

Operational reference for running the **TerraForensics AI** sovereign geospatial intelligence platform with the Global Terrorism Database (GTD) integration.

---

## 🚀 Commands

- `yarn setup` — Install all service dependencies and build packages
- `yarn dev:server` — Start backend Express gateway and GTD MongoDB pipelines
- `yarn dev:frontend` — Start tactical React 18 / MapLibre operator interface
- `yarn dev:collector` — Start background document parser & vector ingestion engine
- `yarn dev:all` — Concurrently run server, frontend, and collector

---

## 🗄️ GTD Server Lifecycle & Pipeline

- `server/index.js` initializes the MongoDB connection on boot when `MONGODB_URI` is specified in `server/.env`.
- Database initialization is non-blocking, ensuring rapid service startup.
- The **Deterministic Semantic Firewall (DSF)** ([`server/utils/mongoDB/contextExtractor.js`](server/utils/mongoDB/contextExtractor.js)) enforces structural context isolation:
  $$\mathcal{I}_{\text{str}}(q) \cdot \mathcal{I}_{\text{doc}}(q) = 0 \quad \forall q$$
- Structured queries are evaluated against MongoDB indexed collections:
  - Coordinate points: Standard GeoJSON `location` with sparse `2dsphere` index
  - Casualties: `nkill` (indexed on `idx_nkill_desc`) and `nwound` (Number)
  - Temporal: `iyear`, `imonth`, `iday` (Number)
- Telemetry confidence is scored via [`server/utils/mongoDB/gtdGroundingScorer.js`](server/utils/mongoDB/gtdGroundingScorer.js):
  $$\mathcal{C} = 0.35\,\mathcal{S}_{\text{schema}} + 0.35\,\mathcal{S}_{\text{grounding}} + 0.30\,\mathcal{S}_{\text{faithfulness}}$$

---

## 🧠 Model Tiers & Deployment Environments

- **Production Sovereign Target**: `llama3.1:8b` served locally via Ollama (`http://127.0.0.1:11434`) for workstations with 16GB+ RAM or discrete GPU.
- **Empirical CPU Evaluation Proxy**: `llama3.2:3b` utilized in Table 10 of the IEEE Access manuscript for low-cost edge CPU latency decomposition.
- **Air-Gapped Vector Tiles**: Offline basemaps are loaded from [`frontend/public/tiles/world.pmtiles`](frontend/public/tiles/). Run `python scripts/setup_offline_tiles.py --check` to verify readiness.