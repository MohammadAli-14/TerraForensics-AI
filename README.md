# 🌍 TerraForensics AI

> **Sovereign Geospatial Threat & Incident Intelligence Platform**  
> *Engineered for Air-Gapped Forensic Analysis, Global Terrorism Database (GTD) Knowledge Synthesis, and Offline Spatial Telemetry.*

---

## 📌 Overview

**TerraForensics AI** is an enterprise-grade, air-gapped forensic intelligence platform designed for defense analysts, counter-terrorism researchers, and incident investigators. Evolving beyond generic conversational assistants, the system combines structured relational queries over **181,691 Global Terrorism Database (GTD) incident records** (1970–2021) with local Large Language Model (LLM) reasoning, embedded vector retrieval, and offline geospatial visualization.

### Key Pillars

- 🛡️ **Zero External Egress (Air-Gapped Sovereign Stack)**: Zero outbound network calls for inference or vector search. Fully operable in air-gapped environments using local Ollama (`llama3.1:8b`), local MongoDB, and embedded LanceDB vector partitions.
- 🗺️ **Interactive Forensic Map Telemetry**: High-performance spatial analysis engine featuring multi-level coordinate clustering, casualty-weighted heatmaps, and bounding-box incident inspection over offline vector tiles (Esri Dark & Carto Dark).
- 🔬 **Scientific Grounding & Telemetry**: Eliminates hallucinations by coupling structured MongoDB aggregation with dynamic confidence scoring:
  $$\mathcal{C} = 0.35\,\mathcal{S}_{\text{schema}} + 0.35\,\mathcal{S}_{\text{grounding}} + 0.30\,\mathcal{S}_{\text{faithfulness}}$$
  Every response displays execution duration, source database verification badges, and citation metrics.
- 🔒 **Multi-Analyst Concurrency Isolation**: Thread-safe session tracking keyed by `${workspaceId}:${threadId}:${userId}` to guarantee state isolation across concurrent workstations.
- 🎨 **Tactical Dark Aesthetic**: Purpose-built operator UI adhering to defense visualization standards (`#0B0F19` obsidian background, `#0F172A` command panels, emerald `#34D399` and amber `#F59E0B` telemetry pills).

---

## 🏗️ System Architecture

```
                                  [ User / Analyst ]
                                          │
                                 Tactical Web UI
                         (React 18 + Vite + TailwindCSS)
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         Forensic Chat Stream                          Offline Map Workstation
      (Historical GTD Inspector)                      (MapLibre GL / Vector Tiles)
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          │
                                   Express Gateway
                                  (REST & SSE APIs)
                                          │
             ┌────────────────────────────┼────────────────────────────┐
             ▼                            ▼                            ▼
     Ollama LLM Engine           MongoDB GTD Cluster           LanceDB Vector Store
     (Local Llama 3.1 8B)     (181,691 Incident Records)    (Local Embedded Partitions)
```

---

## 📁 Repository Layout

| Directory | Purpose |
|---|---|
| **`frontend/`** | React 18 client, Vite build pipeline, MapLibre GL geospatial panel, custom GTD historical message renderers, and workspace configuration. |
| **`server/`** | Core Node.js / Express backend, GTD context extractor (`server/utils/mongoDB/`), grounding scorers, MongoDB aggregation pipelines, and chat streaming handlers. |
| **`collector/`** | Document ingestion, background text extraction, and embedding engine. |
| **`scripts/`** | Benchmark runners for latency decomposition, routing evaluation, and structured query accuracy verification. |
| **`results/`** | Empirical evaluation benchmarks, latency datasets, and publication-ready LaTeX tables (`benchmark_table.tex`). |
| **`docs/`** | Architecture specs, schema migration plans, and verification procedures. |
| **`docker/`** | Production containerization configs and deployment templates. |

---

## 🚀 Quick Start (Local Setup)

### Prerequisites

- **Node.js**: `v18.x` or `v20.x`
- **Yarn**: `v1.22+`
- **MongoDB**: Local or networked instance with the GTD `attacks` collection loaded
- **Ollama Models**:
  - **Production Deployment Target**: `llama3.1:8b` (`ollama run llama3.1:8b`) — recommended for defense workstations with 16GB+ RAM or discrete GPU.
  - **Empirical CPU Evaluation Proxy**: `llama3.2:3b` (`ollama run llama3.2:3b`) — utilized in Table 10 of our IEEE Access manuscript for low-cost, edge CPU latency decomposition.

---

### 1. Installation

Clone your repository and install dependencies across all services:

```bash
git clone https://github.com/MohammadAli-14/TerraForensics-AI.git
cd TerraForensics-AI

# Install all dependencies and generate configuration files
yarn setup
```

---

### 2. Environment Configuration

Ensure `server/.env` (or `server/.env.development`) contains your local database connection:

```env
# MongoDB GTD Database Connection
MONGODB_URI=mongodb://localhost:27017/gtd_database
MONGODB_DB_NAME=gtd_database

# Local Vector Storage & Database
STORAGE_DIR=storage

# Ollama Air-Gapped Inference (Target: llama3.1:8b, Proxy: llama3.2:3b)
LLM_PROVIDER=ollama
OLLAMA_BASE_PATH=http://127.0.0.1:11434
OLLAMA_MODEL_PREF=llama3.1:8b
```

---

### 3. Launching the Services

Run all core components concurrently:

```bash
yarn dev:all
```

Or start individual services independently:

```bash
# Terminal 1: Backend API & GTD Pipeline
yarn dev:server

# Terminal 2: Tactical Web UI (http://localhost:3000)
yarn dev:frontend

# Terminal 3: Document Ingestion Collector
yarn dev:collector
```

---

## 🗄️ GTD Forensic Engine Details

1. **Early Database Lifecycle**: The GTD MongoDB connector initializes at server startup in [`server/index.js`](server/index.js), running non-blocking schema checks.
2. **Deterministic Semantic Firewall (DSF)**: Queries pass through [`server/utils/mongoDB/contextExtractor.js`](server/utils/mongoDB/contextExtractor.js) before LLM invocation.
   - **Zero-Pollution Guarantee**: Formally defined as **Structural Context Isolation**:
     $$\mathcal{I}_{\text{str}}(q) \cdot \mathcal{I}_{\text{doc}}(q) = 0 \quad \forall q$$
     The firewall guarantees mutual exclusivity between structured database retrieval and unstructured document retrieval. Cross-channel contamination is eliminated by construction.
3. **Structured Geospatial Aggregation**: Queries are translated into optimized MongoDB aggregation pipelines with indexed filters on:
   - Temporal: `iyear`, `imonth`, `iday` (typed as `Number`)
   - Spatial: `country_txt`, `region_txt`, `city`, `latitude`, `longitude`, and native GeoJSON `location` (`Point` with sparse `2dsphere` indexing)
   - Perpetrators & Targets: `gname`, `targtype1_txt`, `weaptype1_txt`
   - Impact: `nkill`, `nwound` (typed as `Number`, indexed on `idx_nkill_desc`)
4. **Dynamic Telemetry & Grounding**: Results pass through [`server/utils/mongoDB/gtdGroundingScorer.js`](server/utils/mongoDB/gtdGroundingScorer.js), calculating factual alignment:
   $$\mathcal{C} = 0.35\,\mathcal{S}_{\text{schema}} + 0.35\,\mathcal{S}_{\text{grounding}} + 0.30\,\mathcal{S}_{\text{faithfulness}}$$
5. **Air-Gapped Sovereign Vector Tiles**: Offline basemaps are served via local Protomaps PMTiles (`frontend/public/tiles/world.pmtiles`) without external network egress.

---

## 📊 Benchmarks & Empirical Evaluation

To reproduce the benchmark figures reported in our IEEE Access research paper:

```bash
# 1. Run schema and geospatial 2dsphere migration
node scripts/migrate_gtd_schema.cjs --dry-run
node scripts/migrate_gtd_schema.cjs

# 2. Verify or provision offline vector tiles for air-gapped map rendering
python scripts/setup_offline_tiles.py --check

# 3. Run structured query accuracy test (90 hand-curated queries)
node scripts/evaluate_structured_query_accuracy.cjs

# 4. Run end-to-end classifier routing evaluation
# (Generates both 5-Fold Stratified CV and Zero-Leakage Spatio-Temporal Disjoint tables)
python scripts/benchmark_classifiers.py

# 5. Run latency decomposition benchmark (Local Edge vs Hosted)
node scripts/benchmark_latency_decomposition.cjs
```

Benchmark output matrices and LaTeX formatting tables are generated automatically in `results/`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
