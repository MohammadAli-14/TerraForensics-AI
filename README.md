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
- **Ollama**: Running locally with `llama3.1:8b` pulled (`ollama run llama3.1:8b`)

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

# Ollama Air-Gapped Inference
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
2. **Context Extractor**: Incoming user queries are parsed by [`server/utils/mongoDB/contextExtractor.js`](server/utils/mongoDB/contextExtractor.js) to identify spatial bounding boxes, target groups, weapon types, and casualty thresholds.
3. **Structured Aggregation**: Queries are translated into optimized MongoDB aggregation pipelines with pre-indexed filters on:
   - Temporal: `iyear`, `imonth`, `iday`
   - Spatial: `country_txt`, `region_txt`, `city`, `latitude`, `longitude`
   - Perpetrators & Targets: `gname`, `targtype1_txt`, `weaptype1_txt`
   - Impact: `nkill`, `nwound`
4. **Dynamic Telemetry & Grounding**: Results pass through [`server/utils/mongoDB/gtdGroundingScorer.js`](server/utils/mongoDB/gtdGroundingScorer.js), calculating factual alignment before streaming to the client.

---

## 📊 Benchmarks & Empirical Evaluation

To reproduce the benchmark figures reported in our research papers:

```bash
# Run structured query accuracy test
node scripts/evaluate_structured_query_accuracy.js

# Run latency decomposition benchmark
node scripts/benchmark_latency_decomposition.cjs

# Run end-to-end classifier routing evaluation
python scripts/benchmark_classifiers.py
```

Benchmark output matrices and LaTeX formatting tables are generated automatically in `results/`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
