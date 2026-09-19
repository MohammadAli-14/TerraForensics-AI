# GTD Pipeline API Documentation

## Overview

The GTD (Global Terrorism Database) Pipeline provides a two-step architecture for querying terrorism data:

1. **Step 1 (LLM):** Generate MongoDB filter from natural language
2. **Step 2 (Server):** Execute filter and return structured JSON response

## Key Features

- **Filter Normalization:** Automatically handles GTD's string-typed numeric fields (iyear, nkill, etc.)
- **LLM Fallback:** Returns database results directly if LLM fails
- **Geographic Detection:** Automatically identifies when geo output is needed
- **Safe Defaults:** Configurable token limits and timeouts

---

## API Endpoints

### 1. Public Pipeline Endpoint (No Auth)

**POST** `/api/gtd/public/pipeline`

For external integrations and testing. No authentication required.

#### Request Body

```json
{
  "query": "attacks in Iraq between 2010 and 2015",
  "filter": null,
  "limit": 5000,
  "skip": 0,
  "includeGeoJSON": true,
  "includeClusters": true
}
```

| Field             | Type    | Default | Description                                |
| ----------------- | ------- | ------- | ------------------------------------------ |
| `query`           | string  | ""      | Natural language query                     |
| `filter`          | object  | null    | Explicit MongoDB filter (takes precedence) |
| `limit`           | number  | 5000    | Maximum records to return                  |
| `skip`            | number  | 0       | Records to skip (pagination)               |
| `includeGeoJSON`  | boolean | true    | Include GeoJSON output                     |
| `includeClusters` | boolean | true    | Include clustered data                     |

#### Response (Success)

```json
{
  "success": true,
  "query": "attacks in Iraq between 2010 and 2015",
  "filter": {
    "country_txt": { "$regex": "^\\s*Iraq\\s*$", "$options": "i" },
    "$expr": {
      "$and": [
        { "$gte": [{ "$toInt": "$iyear" }, 2010] },
        { "$lte": [{ "$toInt": "$iyear" }, 2015] }
      ]
    }
  },
  "compassFilter": "{\"country_txt\":{\"$regex\":\"^\\\\s*Iraq\\\\s*$\",\"$options\":\"i\"},\"$expr\":{\"$and\":[{\"$gte\":[{\"$toInt\":\"$iyear\"},2010]},{\"$lte\":[{\"$toInt\":\"$iyear\"},2015]}]}}",
  "answer": "From the Global Terrorism Database (1970-2017), there were 14,523 recorded attacks in Iraq between 2010 and 2015, resulting in 45,231 fatalities and 67,892 wounded.",
  "confidence": 1.0,
  "heatmap_schema": "segment",
  "total_count": 14523,
  "returned_count": 5000,
  "truncated": true,
  "max_returned": 5000,
  "geo_points": [
    {
      "id": "200701010001",
      "latitude": 33.3406,
      "longitude": 44.4009,
      "weight": 0.85,
      "label": "Baghdad, Iraq",
      "metadata": {
        "date": "2010-01-01",
        "attackType": "Bombing/Explosion",
        "targetType": "Private Citizens & Property",
        "group": "Unknown",
        "killed": 5,
        "wounded": 12
      }
    }
  ],
  "segments": [
    {
      "id": "iraq_2010",
      "label": "Iraq - 2010",
      "count": 2453,
      "weight": 0.75
    }
  ],
  "clusters": [
    {
      "id": "cluster_baghdad",
      "center": { "latitude": 33.3406, "longitude": 44.4009 },
      "radius_km": 25,
      "count": 3456,
      "weight": 0.92
    }
  ],
  "geojson": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Point",
          "coordinates": [44.4009, 33.3406]
        },
        "properties": {
          "eventid": "200701010001",
          "date": "2010-01-01",
          "country": "Iraq",
          "city": "Baghdad"
        }
      }
    ]
  }
}
```

---

### 2. Using Explicit Filters

When LLMs generate filters, use the simplified format that the server normalizes:

#### Simplified Filter Format (Recommended for LLMs)

```json
{
  "filter": {
    "country_txt": "Pakistan",
    "suicide": "1",
    "year_start": 2010,
    "year_end": 2017
  }
}
```

The server automatically converts this to:

```json
{
  "country_txt": { "$regex": "^\\s*Pakistan\\s*$", "$options": "i" },
  "suicide": "1",
  "$expr": {
    "$and": [
      { "$gte": [{ "$toInt": "$iyear" }, 2010] },
      { "$lte": [{ "$toInt": "$iyear" }, 2017] }
    ]
  }
}
```

#### Why Year Ranges Need Special Handling

GTD stores `iyear` as **STRING**, not integer. This means:

| Query                                               | Result                                     |
| --------------------------------------------------- | ------------------------------------------ |
| `{"iyear": {"$gte": 2010}}`                         | ❌ **0 results** (string comparison fails) |
| `{"$expr": {"$gte": [{"$toInt": "$iyear"}, 2010]}}` | ✅ **Correct results**                     |

---

### 3. LLM System Prompt Format

When instructing an LLM to generate filters, use this system prompt:

```
MONGODB FILTER FORMAT FOR GTD QUERIES:

YEAR RANGES - use year_start/year_end (server normalizes these):
  {"country_txt": "Pakistan", "suicide": "1", "year_start": 2010, "year_end": 2017}

SINGLE YEAR:
  {"country_txt": "Iraq", "iyear": "2015"}

IMPORTANT: All string fields use EXACT values from database:
- country_txt: "Iraq", "Pakistan", "Afghanistan", etc.
- attacktype1_txt: "Bombing/Explosion", "Armed Assault", etc.
- targtype1_txt: "Private Citizens & Property", "Government", etc.
- gname: "Islamic State of Iraq and the Levant (ISIL)", etc.

DO NOT use MongoDB operators like $gte, $regex in the filter.
The server handles all operator conversion automatically.
```

---

### 4. Fallback Response

When LLM fails, the API returns a fallback response:

```json
{
  "success": true,
  "fallback": true,
  "fallback_reason": "LLM unavailable - using direct database results",
  "llm_error": "429 Too Many Requests",
  "query": "attacks in Iraq 2015",
  "answer": "Found 2,453 attacks in Iraq in the Global Terrorism Database (1970-2017). Note: LLM service was unavailable, showing raw database results.",
  "total_count": 2453,
  "returned_count": 2453,
  "geo_points": [...]
}
```

---

## Configuration

### Environment Variables

Add to `.env`:

```env
# OpenRouter Settings (for LLM)
OPENROUTER_MAX_TOKENS=4096       # CRITICAL: Prevents 402 "insufficient credits" errors

# GTD Pipeline Settings
GTD_LLM_MAX_TOKENS=4096          # Safe default for most models
GTD_LLM_TIMEOUT_MS=30000         # 30 second timeout
GTD_ENABLE_FALLBACK=true         # Enable fallback when LLM fails
GTD_MAX_RECORDS=30000            # Max records (handles Iraq's 24k+)
```

### Model-Specific Token Limits

| Model      | Safe max_tokens |
| ---------- | --------------- |
| GPT-4      | 8192            |
| GPT-3.5    | 4096            |
| Claude 3   | 4096            |
| Gemini Pro | 8192            |
| Llama 2/3  | 4096            |

---

## Error Handling

### Common Errors

| Error                                  | Cause                      | Solution                           |
| -------------------------------------- | -------------------------- | ---------------------------------- |
| `402 Payment Required`                 | Token limit too high       | Reduce `GTD_LLM_MAX_TOKENS`        |
| `dbCity.toLowerCase is not a function` | Null city in database      | Fixed in v2.1 with type check      |
| `0 results` for year range             | String comparison on iyear | Use `year_start`/`year_end` format |

### Database Schema Notes

**Critical:** GTD stores ALL numeric fields as strings:

```javascript
// Field types in MongoDB
iyear: "2015"; // STRING, not number
nkill: "5"; // STRING, not number
nwound: "12"; // STRING, not number
latitude: 33.3406; // FLOAT (exception)
longitude: 44.4009; // FLOAT (exception)
```

---

## Testing

### cURL Examples

**Natural Language Query:**

```bash
curl -X POST http://localhost:3001/api/gtd/public/pipeline \
  -H "Content-Type: application/json" \
  -d '{
    "query": "suicide bombings in Pakistan 2015",
    "limit": 100
  }'
```

**Explicit Filter:**

```bash
curl -X POST http://localhost:3001/api/gtd/public/pipeline \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "country_txt": "Pakistan",
      "suicide": "1",
      "year_start": 2015,
      "year_end": 2015
    },
    "limit": 1000
  }'
```

### MongoDB Compass Test

Copy the `compassFilter` from the response and paste directly into MongoDB Compass:

```json
{
  "country_txt": { "$regex": "^\\s*Iraq\\s*$", "$options": "i" },
  "$expr": {
    "$and": [
      { "$gte": [{ "$toInt": "$iyear" }, 2010] },
      { "$lte": [{ "$toInt": "$iyear" }, 2015] }
    ]
  }
}
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Query    │────>│  LLM Provider    │────>│  MongoDB Filter │
│  (Natural Lang) │     │  (OpenRouter,    │     │  {year_start:   │
│                 │     │   Gemini, etc.)  │     │   2010, ...}    │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌─────────────────────────────────┘
                        ▼
              ┌─────────────────────┐
              │  contextExtractor   │
              │  normalizeGTDFilter │ ◄── Converts to $expr
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   attackService     │
              │   executeFilter     │ ◄── Executes on MongoDB
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  gtdResponseFormatter│
              │  formatResponse     │ ◄── Generates heatmap JSON
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   JSON Response     │
              │  {geo_points, ...}  │
              └─────────────────────┘
```

---

## Version History

| Version | Changes                                                      |
| ------- | ------------------------------------------------------------ |
| 2.1     | Fixed dbCity.toLowerCase crash, added needsGeoData detection |
| 2.0     | Added LLM fallback mechanism, GTD configuration module       |
| 1.5     | Implemented year_start/year_end normalization                |
| 1.0     | Initial pipeline with gtdResponseFormatter                   |
