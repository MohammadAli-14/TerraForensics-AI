import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import * as basemaps from "@protomaps/basemaps";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const PMTILES_URL = import.meta.env.VITE_PMTILES_URL || "/tiles/world.pmtiles";
const PAGE_SIZE = 50;
const MAX_RENDER_POINTS = 50000;
const MAX_REFETCH_LIMIT = 50000;
const LOAD_MORE_CHUNK = 50000;     // geo_points per "Load More" click
const SERVER_PAGE_SIZE = 25000;    // records per server round-trip (fits in 50K cap)
const BATCH_SIZE = 20000;          // render-batch increment
const BATCH_DELAY_MS = 400;

function buildGeoJson(points = [], maxPoints = MAX_RENDER_POINTS) {
  const toRender = points.length > maxPoints ? points.slice(0, maxPoints) : points;
  return {
    type: "FeatureCollection",
    features: toRender
      .map((point) => {
        const lat = Number(point.lat ?? point.latitude);
        const lon = Number(point.lon ?? point.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lon, lat]
          },
          properties: {
            eventid: point.eventid,
            iyear: point.iyear,
            country_txt: point.country_txt,
            city: point.city,
            region_txt: point.region_txt,
            attacktype1_txt: point.attacktype1_txt,
            weaptype1_txt: point.weaptype1_txt,
            targtype1_txt: point.targtype1_txt,
            gname: point.gname,
            nkill: point.nkill,
            nwound: point.nwound,
            summary: point.summary
          }
        };
      })
      .filter(Boolean)
  };
}

function calculateBounds(points = []) {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;

  for (const point of points) {
    const lat = Number(point.lat ?? point.latitude);
    const lon = Number(point.lon ?? point.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
  return [
    [minLon, minLat],
    [maxLon, maxLat]
  ];
}

// ─── Build basemap style object for MapLibre ───
// Supports 4 combinations: PMTiles dark/light, CARTO dark raster, OSM light raster
function buildMapStyle(isDark, pmtilesOk) {
  if (pmtilesOk) {
    const flavor = isDark ? "dark" : "light";
    return {
      version: 8,
      glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`,
      sources: {
        basemap: {
          type: "vector",
          url: `pmtiles://${PMTILES_URL}`,
          attribution: "<a href='https://github.com/protomaps/basemaps'>Protomaps</a> \u00a9 <a href='https://openstreetmap.org'>OpenStreetMap</a>"
        }
      },
      layers: basemaps.layers("basemap", basemaps.namedFlavor(flavor), { lang: "en" })
    };
  }
  if (isDark) {
    const cartoKey = import.meta.env.VITE_CARTO_API_KEY;
    if (cartoKey) {
      return {
        version: 8,
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [
              `https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`,
              `https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`,
              `https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`,
              `https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`
            ],
            tileSize: 256,
            attribution: "\u00a9 <a href='https://openstreetmap.org/copyright'>OpenStreetMap</a> \u00a9 <a href='https://carto.com/attributions'>CARTO</a>"
          }
        },
        layers: [{ id: "carto-dark-tiles", type: "raster", source: "carto-dark", minzoom: 0, maxzoom: 20 }]
      };
    }

    // Free, high-performance, dark basemap with zero API key required and no watermarks (Esri Dark Gray Canvas)
    return {
      version: 8,
      sources: {
        "esri-dark-base": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          ],
          tileSize: 256,
          attribution: "\u00a9 <a href='https://www.esri.com/'>Esri</a> \u00a9 <a href='https://openstreetmap.org/copyright'>OpenStreetMap contributors</a>"
        },
        "esri-dark-ref": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          ],
          tileSize: 256
        }
      },
      layers: [
        { id: "esri-dark-base-tiles", type: "raster", source: "esri-dark-base", minzoom: 0, maxzoom: 16 },
        { id: "esri-dark-ref-tiles", type: "raster", source: "esri-dark-ref", minzoom: 0, maxzoom: 16 }
      ]
    };
  }
  // Light raster fallback (OSM)
  return {
    version: 8,
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "\u00a9 <a href='https://openstreetmap.org/copyright'>OpenStreetMap contributors</a>"
      }
    },
    layers: [{ id: "osm-tiles", type: "raster", source: "osm-raster", minzoom: 0, maxzoom: 19 }]
  };
}

// ─── Add GTD data source + visualization layers to a map instance ───
// Called on initial load and after each style switch.
function addGTDDataLayers(map, isDark) {
  const emptyGeoJson = { type: "FeatureCollection", features: [] };

  if (!map.getSource("gtd-points")) {
    map.addSource("gtd-points", {
      type: "geojson",
      data: emptyGeoJson,
      cluster: true,
      clusterMaxZoom: 6,
      clusterRadius: 50
    });
  }

  if (!map.getLayer("gtd-clusters")) {
    map.addLayer({
      id: "gtd-clusters",
      type: "circle",
      source: "gtd-points",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#f97316",
        "circle-radius": ["step", ["get", "point_count"], 12, 100, 18, 750, 26],
        "circle-stroke-color": isDark ? "#374151" : "#1f2937",
        "circle-stroke-width": 1
      }
    });
  }

  if (!map.getLayer("gtd-cluster-count")) {
    map.addLayer({
      id: "gtd-cluster-count",
      type: "symbol",
      source: "gtd-points",
      filter: ["has", "point_count"],
      layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 },
      paint: { "text-color": isDark ? "#f9fafb" : "#111827" }
    });
  }

  if (!map.getLayer("gtd-unclustered")) {
    map.addLayer({
      id: "gtd-unclustered",
      type: "circle",
      source: "gtd-points",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#22c55e",
        "circle-radius": 5,
        "circle-stroke-color": isDark ? "#1e293b" : "#0f172a",
        "circle-stroke-width": 1
      }
    });
  }

  if (!map.getLayer("gtd-heatmap")) {
    map.addLayer({
      id: "gtd-heatmap",
      type: "heatmap",
      source: "gtd-points",
      maxzoom: 10,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 3],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(34,197,94,0)",
          0.2, "rgba(34,197,94,0.4)",
          0.4, "rgba(59,130,246,0.5)",
          0.6, "rgba(249,115,22,0.6)",
          0.8, "rgba(239,68,68,0.7)",
          1, "rgba(185,28,28,0.85)"
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 10, 25],
        "heatmap-opacity": 0.8
      }
    });
    map.setLayoutProperty("gtd-heatmap", "visibility", "none");
  }
}

export default function WorkspaceGTDMap() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const pointByEventIdRef = useRef(new Map());
  const initialBoundsRef = useRef(null);
  const batchTimerRef = useRef(null);
  const refetchAbortRef = useRef(null);
  const loadMoreAbortRef = useRef(null);   // AbortController for Load More fetch loop
  const loadingMoreRef = useRef(false);    // synchronous guard — immune to React batched state updates
  // Tracks deterministic pagination cursor across "Load More" clicks.
  // $sample (initial refetch) returns random rows, so we always restart from skip=0
  // with deterministic _id sort when the user clicks "Load More".
  const paginationRef = useRef({ skip: 0, deterministicStarted: false });
  const cachedTotalsRef = useRef(null);    // cache killed/wounded once computed
  const [status, setStatus] = useState("Loading map...");
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [geoPoints, setGeoPoints] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [clusterPoints, setClusterPoints] = useState([]);
  const [clusterInfo, setClusterInfo] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreProgress, setLoadMoreProgress] = useState(0);
  const [renderLimit, setRenderLimit] = useState(MAX_RENDER_POINTS);
  const [allLoaded, setAllLoaded] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);  // dark by default (world-monitor style)
  const pmtilesAvailableRef = useRef(false);
  const darkModeInitRef = useRef(true);   // skip first style-switch effect (initMap handles it)
  const geoJsonRef = useRef(null);        // mutable ref for style-switch closure
  const showHeatmapRef = useRef(false);   // mutable ref for style-switch closure

  const key = searchParams.get("key");

  const geoJson = useMemo(() => buildGeoJson(geoPoints, renderLimit), [geoPoints, renderLimit]);
  geoJsonRef.current = geoJson;             // keep ref in sync for style-switch closure
  showHeatmapRef.current = showHeatmap;     // keep ref in sync for style-switch closure
  const bounds = useMemo(() => calculateBounds(geoPoints), [geoPoints]);

  // Reliably detect whether there's more data to load
  const totalExpected = payload?.total_count || 0;
  const hasMoreData = !allLoaded && totalExpected > 0 && geoPoints.length < totalExpected;
  const hasFilter = Boolean(payload?.filter || payload?.simpleFilter);
  const yearRange = useMemo(() => {
    if (payload?.year_range?.start && payload?.year_range?.end) {
      return payload.year_range;
    }
    if (!geoPoints.length) return null;
    // CRITICAL: Do NOT use Math.min(...spread) / Math.max(...spread) here.
    // With 181K+ points the spread pushes every element onto the call stack
    // as a function argument, exceeding the JS engine limit (~60K-125K) and
    // crashing with "Maximum call stack size exceeded".
    let minYear = Infinity;
    let maxYear = -Infinity;
    for (const point of geoPoints) {
      const y = Number(point.iyear);
      if (!Number.isFinite(y)) continue;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (!Number.isFinite(minYear)) return null;
    return { start: minYear, end: maxYear };
  }, [payload, geoPoints]);

  const summaryTotals = useMemo(() => {
    let totalKilled = payload?.total_killed || 0;
    let totalWounded = payload?.total_wounded || 0;

    // If payload already has totals, cache them and skip expensive reduce
    if (totalKilled > 0 && totalWounded > 0) {
      cachedTotalsRef.current = { totalKilled, totalWounded };
    } else if (cachedTotalsRef.current) {
      // Reuse cached computation instead of re-reducing 181K points
      totalKilled = cachedTotalsRef.current.totalKilled;
      totalWounded = cachedTotalsRef.current.totalWounded;
    } else if (geoPoints.length > 0) {
      // Fallback: compute from loaded geo_points (first time only, then cache)
      totalKilled = 0;
      totalWounded = 0;
      for (const p of geoPoints) {
        totalKilled += parseInt(p.nkill) || 0;
        totalWounded += parseInt(p.nwound) || 0;
      }
      cachedTotalsRef.current = { totalKilled, totalWounded };
    }

    return {
      totalCount: payload?.total_count || geoPoints.length || 0,
      totalKilled,
      totalWounded,
    };
  }, [payload, geoPoints]);

  const filteredPoints = useMemo(() => {
    if (!search) return geoPoints;
    const needle = search.toLowerCase();
    return geoPoints.filter((point) => {
      return [
        point.eventid,
        point.city,
        point.country_txt,
        point.region_txt,
        point.attacktype1_txt,
        point.weaptype1_txt,
        point.targtype1_txt,
        point.gname,
        point.iyear
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [geoPoints, search]);

  const totalPages = Math.max(1, Math.ceil(filteredPoints.length / PAGE_SIZE));
  const pageItems = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredPoints.slice(start, start + PAGE_SIZE);
  }, [filteredPoints, page]);

  // Incrementally update pointByEventIdRef — avoid rebuilding a 181K Map from scratch
  // each time geoPoints grows by a chunk. We track the size and only process new entries.
  const lastIndexedCountRef = useRef(0);
  useEffect(() => {
    const existing = pointByEventIdRef.current;
    // If geoPoints shrunk (reset), rebuild from scratch
    if (geoPoints.length < lastIndexedCountRef.current) {
      const map = new Map();
      for (const point of geoPoints) {
        if (point.eventid) map.set(String(point.eventid), point);
      }
      pointByEventIdRef.current = map;
      lastIndexedCountRef.current = geoPoints.length;
      return;
    }
    // Otherwise only index new entries
    for (let i = lastIndexedCountRef.current; i < geoPoints.length; i++) {
      const point = geoPoints[i];
      if (point.eventid) existing.set(String(point.eventid), point);
    }
    lastIndexedCountRef.current = geoPoints.length;
  }, [geoPoints]);

  // ─── Combined localStorage parse + initial / global refetch ───
  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    refetchAbortRef.current = abortController;

    const loadMapData = async () => {
      // 1. If key is present in localStorage, use specific query results
      if (key) {
        const stored = localStorage.getItem(`gtd-map:${key}`);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            setPayload(parsed);
            setGeoPoints(parsed.geo_points || []);
            setAllLoaded(false);
            setPage(0);
            setSelectedPoint(null);
            setClusterPoints([]);
            setClusterInfo(null);
            setError(null);

            if (Array.isArray(parsed.geo_points) && parsed.geo_points.length > 0) {
              setStatus(`Showing ${parsed.geo_points.length.toLocaleString()} points`);
              return;
            }

            const filter = parsed.filter || parsed.simpleFilter;
            if (filter) {
              setStatus("Re-fetching query points...");
              const res = await fetch(`${API_BASE}/workspace/${slug}/gtd-refetch`, {
                method: "POST",
                headers: { ...baseHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                  mongo_filter: filter,
                  limit: MAX_REFETCH_LIMIT,
                  page_size: MAX_REFETCH_LIMIT,
                }),
                signal: abortController.signal,
              });

              if (cancelled) return;
              if (res.ok) {
                const result = await res.json();
                if (result.success) {
                  const refetchedPoints = result.geo_points || [];
                  setGeoPoints(refetchedPoints);
                  setPayload(prev => ({
                    ...prev,
                    total_count: result.total_count || prev.total_count,
                    ...(result.total_killed != null && { total_killed: result.total_killed }),
                    ...(result.total_wounded != null && { total_wounded: result.total_wounded }),
                    geo_points: refetchedPoints,
                  }));
                  setStatus(`Showing ${refetchedPoints.length.toLocaleString()} of ${(result.total_count || refetchedPoints.length).toLocaleString()} points`);
                  return;
                }
              }
            }
          } catch (e) {
            console.warn("Failed to parse stored chat key, falling back to global dataset:", e);
          }
        }
      }

      // 2. Direct Navigation / Global GTD View (No key or key not in storage)
      try {
        setStatus("Loading global GTD dataset (1970–2017)...");
        setError(null);

        const res = await fetch(`${API_BASE}/gtd/public/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            limit: 5000,
            skip: 0,
            includeGeoJSON: true,
            includeClusters: true,
          }),
          signal: abortController.signal,
        });

        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const result = await res.json();
        if (cancelled) return;
        if (!result.success) throw new Error(result.error || "Failed to load GTD database");

        const points = result.geo_points || [];
        const total = result.total_count || 181691;
        const totalKilled = points.reduce((sum, p) => sum + (Number(p.nkill) || 0), 0);
        const totalWounded = points.reduce((sum, p) => sum + (Number(p.nwound) || 0), 0);

        setPayload({
          total_count: total,
          total_killed: result.total_killed || totalKilled,
          total_wounded: result.total_wounded || totalWounded,
          query: "Global Terrorism Database (1970–2017)",
          geo_points: points,
        });
        setGeoPoints(points);
        setAllLoaded(false);
        setPage(0);
        setSelectedPoint(null);
        setClusterPoints([]);
        setClusterInfo(null);
        setStatus(`Showing ${points.length.toLocaleString()} of ${total.toLocaleString()} global incident records`);
      } catch (fetchError) {
        if (cancelled || fetchError.name === "AbortError") return;
        console.error("Global GTD load failed:", fetchError);
        setError("Failed to load GTD map data. Ensure MongoDB is connected.");
        setStatus("Failed to load data");
      }
    };

    loadMapData();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [key, slug]);

  const showPointPopup = (point, coordinatesOverride = null) => {
    const map = mapRef.current;
    if (!map || !point) return;

    const lat = Number(point.lat ?? point.latitude);
    const lon = Number(point.lon ?? point.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const textColor = isDarkMode ? "#f9fafb" : "#111827";
    const html = `
      <div style="font-size:12px;line-height:1.4;color:${textColor};">
        <div><strong>Event:</strong> ${point.eventid || "N/A"}</div>
        <div><strong>Year:</strong> ${point.iyear || "N/A"}</div>
        <div><strong>Country:</strong> ${point.country_txt || "N/A"}</div>
        <div><strong>City:</strong> ${point.city || "N/A"}</div>
        <div><strong>Region:</strong> ${point.region_txt || "N/A"}</div>
        <div><strong>Group:</strong> ${point.gname || "N/A"}</div>
        <div><strong>Type:</strong> ${point.attacktype1_txt || "N/A"}</div>
        <div><strong>Weapon:</strong> ${point.weaptype1_txt || "N/A"}</div>
        <div><strong>Target:</strong> ${point.targtype1_txt || "N/A"}</div>
        <div><strong>Killed:</strong> ${point.nkill ?? "N/A"}</div>
        <div><strong>Wounded:</strong> ${point.nwound ?? "N/A"}</div>
      </div>
    `;

    if (!popupRef.current) {
      popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false });
    }

    const coordinates = coordinatesOverride || [lon, lat];
    popupRef.current.setLngLat(coordinates).setHTML(html).addTo(map);
  };

  const clearSelection = () => {
    setSelectedPoint(null);
    if (popupRef.current) popupRef.current.remove();
  };

  const clearClusterPoints = () => {
    setClusterPoints([]);
    setClusterInfo(null);
  };

  // ─── Load More handler — fetches next LOAD_MORE_CHUNK (50K) geo_points ───
  // The first click restarts from skip=0 with deterministic _id sort (replacing
  // the initial $sample set). Subsequent clicks resume from the saved skip.
  const handleLoadMore = useCallback(async () => {
    // Synchronous ref guard — immune to React batched state updates
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;

    const filter = payload?.filter || payload?.simpleFilter;
    if (!filter) {
      setError("No filter available to load more records.");
      loadingMoreRef.current = false;
      return;
    }

    // Abort any in-flight initial refetch to prevent duplicate requests
    if (refetchAbortRef.current) {
      refetchAbortRef.current.abort();
      refetchAbortRef.current = null;
    }

    // Clear any running render-batch timer
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }

    const abortController = new AbortController();
    loadMoreAbortRef.current = abortController;

    setLoadingMore(true);
    setLoadMoreProgress(5);
    setError(null);

    try {
      // On the FIRST "Load More" click the initial data was from $sample
      // (random, non-deterministic). We must restart from skip=0 with
      // deterministic _id sort to avoid duplicates / gaps.
      if (!paginationRef.current.deterministicStarted) {
        paginationRef.current = { skip: 0, deterministicStarted: true };
      }

      const TOTAL_LIMIT = 200000; // hard cap, communicated to server
      let chunkPoints = [];       // points fetched in THIS click
      let currentSkip = paginationRef.current.skip;
      const chunkTarget = currentSkip + LOAD_MORE_CHUNK; // fetch up to this skip value
      let totalCount = payload?.total_count || 0;
      let hasMore = true;
      let serverKilled = 0;
      let serverWounded = 0;

      setStatus(`Fetching records from skip=${currentSkip.toLocaleString()}...`);

      // Paginated fetch loop — SERVER_PAGE_SIZE records per round-trip
      while (hasMore && currentSkip < chunkTarget) {
        if (abortController.signal.aborted) break;

        const res = await fetch(`${API_BASE}/workspace/${slug}/gtd-refetch`, {
          method: "POST",
          headers: { ...baseHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            mongo_filter: filter,
            limit: TOTAL_LIMIT,
            skip: currentSkip,
            page_size: SERVER_PAGE_SIZE,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Server error ${res.status}: ${errText}`);
        }

        const result = await res.json();
        if (!result.success) throw new Error(result.error || "Failed to fetch records");

        const pagePoints = result.geo_points || [];
        // Use push for O(1) amortised append instead of concat (which copies the entire array)
        for (let i = 0; i < pagePoints.length; i++) chunkPoints.push(pagePoints[i]);
        totalCount = result.total_count || totalCount;
        hasMore = result.has_more === true;
        currentSkip = result.next_skip || (currentSkip + pagePoints.length);

        // Pick up server-computed killed/wounded if available
        if (result.total_killed) serverKilled = result.total_killed;
        if (result.total_wounded) serverWounded = result.total_wounded;

        // Progress: 0–80% for fetching within this chunk
        const fetchPct = Math.min(
          80,
          Math.floor((chunkPoints.length / LOAD_MORE_CHUNK) * 80)
        );
        setLoadMoreProgress(fetchPct);
        setStatus(
          `Fetching records... ${chunkPoints.length.toLocaleString()} of ~${LOAD_MORE_CHUNK.toLocaleString()}`
        );

        // Safety: prevent infinite loop
        if (pagePoints.length === 0) break;
      }

      if (abortController.signal.aborted) return;

      // Save pagination cursor for next click
      paginationRef.current.skip = currentSkip;

      // Merge with existing geoPoints.
      // Because we restarted from skip=0 on the first click, the first chunk
      // covers rows 0–50K which overlaps/replaces the initial $sample set.
      // For simplicity and correctness, on the first click we REPLACE;
      // on subsequent clicks we APPEND.
      const isFirstDeterministicChunk = currentSkip <= LOAD_MORE_CHUNK + SERVER_PAGE_SIZE;
      let mergedPoints;
      if (isFirstDeterministicChunk) {
        // Replace $sample data with deterministic page 0–50K
        mergedPoints = chunkPoints;
      } else {
        // Append — reuse the existing array to avoid copying 100K+ elements
        mergedPoints = geoPoints.slice(); // shallow copy to avoid mutating React state
        for (let i = 0; i < chunkPoints.length; i++) mergedPoints.push(chunkPoints[i]);
      }

      setLoadMoreProgress(85);
      setStatus(`Rendering ${mergedPoints.length.toLocaleString()} points...`);

      // Update totals from server if we received them
      if (serverKilled > 0 || serverWounded > 0) {
        cachedTotalsRef.current = {
          totalKilled: serverKilled,
          totalWounded: serverWounded,
        };
      } else {
        // Invalidate cache so summaryTotals recalculates from new data
        cachedTotalsRef.current = null;
      }

      // Check if we've loaded everything
      const fullyLoaded = !hasMore || currentSkip >= totalCount;

      setGeoPoints(mergedPoints);
      setPayload(prev => ({ ...prev, total_count: totalCount }));
      setAllLoaded(fullyLoaded);

      // Progressive render-limit ramp-up to avoid MapLibre freeze
      if (mergedPoints.length > MAX_RENDER_POINTS) {
        // Start from current renderLimit (user may have already seen 50K) or MAX_RENDER_POINTS
        let currentLimit = Math.max(renderLimit, MAX_RENDER_POINTS);
        const total = mergedPoints.length;

        const renderNextBatch = () => {
          currentLimit = Math.min(currentLimit + BATCH_SIZE, total);
          setRenderLimit(currentLimit);
          const pct = 85 + Math.floor(((currentLimit - MAX_RENDER_POINTS) / (total - MAX_RENDER_POINTS)) * 15);
          setLoadMoreProgress(Math.min(pct, 100));
          setStatus(`Rendering points... ${currentLimit.toLocaleString()} / ${total.toLocaleString()}`);

          if (currentLimit < total) {
            batchTimerRef.current = setTimeout(renderNextBatch, BATCH_DELAY_MS);
          } else {
            finishLoadMore(total, fullyLoaded);
          }
        };

        // Let React settle geoPoints state, then start batching
        batchTimerRef.current = setTimeout(renderNextBatch, 300);
      } else {
        setRenderLimit(mergedPoints.length);
        finishLoadMore(mergedPoints.length, fullyLoaded);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message);
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoadMoreProgress(0);
      setStatus("Failed to load more records");
    }
  }, [payload, slug, geoPoints, renderLimit]);

  // Helper to finalize Load More state
  const finishLoadMore = useCallback((total, fullyLoaded) => {
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreProgress(100);
    if (fullyLoaded) {
      setStatus(`Map ready — all ${total.toLocaleString()} records loaded`);
    } else {
      setStatus(`Showing ${total.toLocaleString()} points — click Load More for the next batch`);
    }
  }, []);

  // ─── Load ALL handler — fetches every remaining record until has_more=false ───
  // Deterministic pagination from skip=0, replaces $sample data, loops until done or cap.
  const handleLoadAll = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;

    const filter = payload?.filter || payload?.simpleFilter;
    if (!filter) {
      setError("No filter available to load all records.");
      loadingMoreRef.current = false;
      return;
    }

    // Abort any in-flight initial refetch
    if (refetchAbortRef.current) {
      refetchAbortRef.current.abort();
      refetchAbortRef.current = null;
    }
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }

    const abortController = new AbortController();
    loadMoreAbortRef.current = abortController;

    setLoadingMore(true);
    setLoadMoreProgress(0);
    setError(null);

    try {
      // Always start from skip=0 deterministic to avoid gaps/duplicates
      paginationRef.current = { skip: 0, deterministicStarted: true };

      const TOTAL_LIMIT = 200000;
      let allFetchedPoints = [];
      let currentSkip = 0;
      let totalCount = payload?.total_count || 0;
      let hasMore = true;
      let serverKilled = 0;
      let serverWounded = 0;

      setStatus("Loading all records from skip=0...");

      while (hasMore && currentSkip < TOTAL_LIMIT) {
        if (abortController.signal.aborted) break;

        const res = await fetch(`${API_BASE}/workspace/${slug}/gtd-refetch`, {
          method: "POST",
          headers: { ...baseHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            mongo_filter: filter,
            limit: TOTAL_LIMIT,
            skip: currentSkip,
            page_size: SERVER_PAGE_SIZE,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Server error ${res.status}: ${errText}`);
        }

        const result = await res.json();
        if (!result.success) throw new Error(result.error || "Failed to fetch records");

        const pagePoints = result.geo_points || [];
        for (let i = 0; i < pagePoints.length; i++) allFetchedPoints.push(pagePoints[i]);

        totalCount = result.total_count || totalCount;
        hasMore = result.has_more === true;
        currentSkip = result.next_skip || (currentSkip + pagePoints.length);

        if (result.total_killed) serverKilled = result.total_killed;
        if (result.total_wounded) serverWounded = result.total_wounded;

        const fetchPct = totalCount > 0
          ? Math.min(80, Math.floor((allFetchedPoints.length / totalCount) * 80))
          : Math.min(80, Math.floor((allFetchedPoints.length / TOTAL_LIMIT) * 80));
        setLoadMoreProgress(fetchPct);
        setStatus(
          `Loading all records... ${allFetchedPoints.length.toLocaleString()} of ${totalCount.toLocaleString()}`
        );

        if (pagePoints.length === 0) break;
      }

      if (abortController.signal.aborted) return;

      paginationRef.current.skip = currentSkip;

      if (serverKilled > 0 || serverWounded > 0) {
        cachedTotalsRef.current = { totalKilled: serverKilled, totalWounded: serverWounded };
      } else {
        cachedTotalsRef.current = null;
      }

      setLoadMoreProgress(85);
      setStatus(`Rendering ${allFetchedPoints.length.toLocaleString()} points...`);

      const fullyLoaded = !hasMore || currentSkip >= totalCount;

      setGeoPoints(allFetchedPoints);
      setPayload(prev => ({ ...prev, total_count: totalCount }));
      setAllLoaded(fullyLoaded);

      // Progressive render ramp-up
      if (allFetchedPoints.length > MAX_RENDER_POINTS) {
        let currentLimit = Math.max(renderLimit, MAX_RENDER_POINTS);
        const total = allFetchedPoints.length;

        const renderNextBatch = () => {
          currentLimit = Math.min(currentLimit + BATCH_SIZE, total);
          setRenderLimit(currentLimit);
          const pct = 85 + Math.floor(((currentLimit - MAX_RENDER_POINTS) / (total - MAX_RENDER_POINTS)) * 15);
          setLoadMoreProgress(Math.min(pct, 100));
          setStatus(`Rendering points... ${currentLimit.toLocaleString()} / ${total.toLocaleString()}`);

          if (currentLimit < total) {
            batchTimerRef.current = setTimeout(renderNextBatch, BATCH_DELAY_MS);
          } else {
            finishLoadMore(total, fullyLoaded);
          }
        };

        batchTimerRef.current = setTimeout(renderNextBatch, 300);
      } else {
        setRenderLimit(allFetchedPoints.length);
        finishLoadMore(allFetchedPoints.length, fullyLoaded);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err.message);
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoadMoreProgress(0);
      setStatus("Failed to load all records");
    }
  }, [payload, slug, renderLimit, finishLoadMore]);

  // Cleanup batch timer + abort controller on unmount
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      if (loadMoreAbortRef.current) loadMoreAbortRef.current.abort();
    };
  }, []);

  // Initialize map ONCE — no dependency on geoJson so it won't be destroyed/recreated
  useEffect(() => {
    let isMounted = true;

    const initMap = async () => {
      try {
        setStatus("Loading basemap...");

        // Pre-flight: check WebGL availability before MapLibre tries (and fails opaquely)
        const testCanvas = document.createElement("canvas");
        const gl =
          testCanvas.getContext("webgl2") ||
          testCanvas.getContext("webgl") ||
          testCanvas.getContext("experimental-webgl");
        if (!gl) {
          throw new Error(
            "WebGL is not available. Please enable hardware acceleration in your browser " +
            "(Chrome: Settings \u2192 System \u2192 Use hardware acceleration when available, then restart)."
          );
        }

        // Validate PMTiles availability — check both local paths AND remote URLs.
        // Remote CDN builds (e.g., build.protomaps.com) expire after a few days, so
        // a 404 here is the most common reason the basemap appears as blank grey.
        let pmtilesAvailable = false;
        try {
          const pmtilesCheck = await fetch(PMTILES_URL, {
            method: "HEAD",
            // Only send the pmtiles protocol Range header for remote URLs
            ...(PMTILES_URL.startsWith("http") ? { headers: { Range: "bytes=0-127" } } : {}),
          });
          // 200 or 206 (Partial Content for range request) both mean the file is reachable
          pmtilesAvailable = pmtilesCheck.ok || pmtilesCheck.status === 206;
          if (!pmtilesAvailable) {
            console.warn(
              `[GTDMap] PMTiles URL returned ${pmtilesCheck.status} — falling back to OpenStreetMap raster tiles.`,
              `\nURL: ${PMTILES_URL}`,
              "\nFix: update VITE_PMTILES_URL in frontend/.env to a valid PMTiles file or download world.pmtiles to frontend/public/tiles/"
            );
          }
        } catch (pingErr) {
          console.warn("[GTDMap] PMTiles reachability check failed:", pingErr.message, "— falling back to OSM raster tiles.");
          pmtilesAvailable = false;
        }

        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);

        // Store PMTiles availability for later style switches
        pmtilesAvailableRef.current = pmtilesAvailable;

        // Build initial style — dark by default
        const style = buildMapStyle(true, pmtilesAvailable);

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style,
          center: [0, 20],
          zoom: 2,
          attributionControl: true
        });

        // Catch runtime WebGL / tile-loading errors so they surface in the UI
        map.on("error", (e) => {
          const msg = e?.error?.message || e?.message || "Unknown map error";
          console.error("[MapLibre error]", msg);
          if (/webgl/i.test(msg)) {
            setError(
              "WebGL context lost. Try closing other GPU-heavy tabs or enable hardware acceleration."
            );
          }
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: true }));
        mapRef.current = map;

        map.on("load", () => {
          if (!isMounted) return;
          setStatus("Map ready");

          // Add data layers (source + clusters/points/heatmap) using shared helper
          addGTDDataLayers(map, true);

          map.on("click", "gtd-clusters", (event) => {
            const features = map.queryRenderedFeatures(event.point, {
              layers: ["gtd-clusters"]
            });
            const clusterId = features[0]?.properties?.cluster_id;
            const clusterCount = features[0]?.properties?.point_count || 0;
            const source = map.getSource("gtd-points");
            if (!source || clusterId === undefined) return;

            source.getClusterLeaves(clusterId, PAGE_SIZE, 0, (err, leaves) => {
              if (err) return;
              const points = leaves
                .map((leaf) => leaf.properties || {})
                .map((props) => {
                  const eventId = props.eventid ? String(props.eventid) : null;
                  return eventId ? pointByEventIdRef.current.get(eventId) || props : props;
                });
              setClusterPoints(points);
              setClusterInfo({ count: clusterCount });
            });

            source.getClusterExpansionZoom(clusterId, (err, zoom) => {
              if (err) return;
              map.easeTo({
                center: features[0].geometry.coordinates,
                zoom
              });
            });
          });

          map.on("click", "gtd-unclustered", (event) => {
            const feature = event.features?.[0];
            if (!feature) return;
            const props = feature.properties || {};
            const eventId = props.eventid ? String(props.eventid) : null;
            const point = eventId ? pointByEventIdRef.current.get(eventId) : null;
            setSelectedPoint(point || props);
            showPointPopup(point || props, feature.geometry.coordinates);
          });

          map.on("click", (event) => {
            const features = map.queryRenderedFeatures(event.point, {
              layers: ["gtd-unclustered", "gtd-clusters"]
            });
            if (!features.length) {
              clearSelection();
            }
          });
        });
      } catch (mapError) {
        if (!isMounted) return;
        setError(mapError.message);
        setStatus("No data");
      }
    };

    initMap();

    return () => {
      isMounted = false;
      if (popupRef.current) popupRef.current.remove();
      if (mapRef.current) mapRef.current.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push data to map source whenever geoJson changes (separate from map init)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // If map style not loaded yet, wait for it
    const pushData = () => {
      const source = map.getSource("gtd-points");
      if (source) {
        source.setData(geoJson);
      }

      // Only fitBounds on the FIRST data push (or when bounds become available
      // for the first time). During batch rendering / Load More the user has
      // already seen the map — resetting the viewport is disorienting.
      if (bounds && !initialBoundsRef.current) {
        initialBoundsRef.current = bounds;
        map.fitBounds(bounds, { padding: 40, maxZoom: 8 });
      }
    };

    if (map.isStyleLoaded()) {
      pushData();
    } else {
      map.once("load", pushData);
    }
  }, [geoJson, bounds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const visibility = showHeatmap ? "visible" : "none";
    const pointsVisibility = showHeatmap ? "none" : "visible";

    if (map.getLayer("gtd-heatmap")) {
      map.setLayoutProperty("gtd-heatmap", "visibility", visibility);
    }
    if (map.getLayer("gtd-clusters")) {
      map.setLayoutProperty("gtd-clusters", "visibility", pointsVisibility);
    }
    if (map.getLayer("gtd-cluster-count")) {
      map.setLayoutProperty("gtd-cluster-count", "visibility", pointsVisibility);
    }
    if (map.getLayer("gtd-unclustered")) {
      map.setLayoutProperty("gtd-unclustered", "visibility", pointsVisibility);
    }
  }, [showHeatmap]);

  // ─── Style switch effect: swap basemap when isDarkMode changes ───
  // Skips the initial render (initMap handles first load). Only fires on toggle.
  useEffect(() => {
    if (darkModeInitRef.current) {
      darkModeInitRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;

    const newStyle = buildMapStyle(isDarkMode, pmtilesAvailableRef.current);
    map.setStyle(newStyle);

    // After setStyle() all custom sources/layers are removed.
    // "styledata" fires when the new style JSON is parsed — addSource/addLayer
    // are safe at that point even if basemap tiles haven't loaded yet.
    // Use requestAnimationFrame as a micro-delay to guarantee the internal
    // style object is fully initialised before we mutate it.
    const reAddLayers = () => {
      try {
        addGTDDataLayers(map, isDarkMode);

        // Push current data to the new source
        const source = map.getSource("gtd-points");
        const currentGeoJson = geoJsonRef.current;
        if (source && currentGeoJson) {
          source.setData(currentGeoJson);
        }

        // Re-apply heatmap visibility
        const currentHeatmap = showHeatmapRef.current;
        const heatVis = currentHeatmap ? "visible" : "none";
        const pointsVis = currentHeatmap ? "none" : "visible";
        if (map.getLayer("gtd-heatmap")) map.setLayoutProperty("gtd-heatmap", "visibility", heatVis);
        if (map.getLayer("gtd-clusters")) map.setLayoutProperty("gtd-clusters", "visibility", pointsVis);
        if (map.getLayer("gtd-cluster-count")) map.setLayoutProperty("gtd-cluster-count", "visibility", pointsVis);
        if (map.getLayer("gtd-unclustered")) map.setLayoutProperty("gtd-unclustered", "visibility", pointsVis);
      } catch (err) {
        // Style not ready yet — retry after a short delay
        console.warn("[GTDMap] Style switch: layers not ready, retrying...", err.message);
        setTimeout(reAddLayers, 120);
      }
    };

    map.once("styledata", () => requestAnimationFrame(reAddLayers));
  }, [isDarkMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Popup CSS: override MapLibre popup container colors for dark/light mode ───
  useEffect(() => {
    const styleId = "gtd-map-popup-style";
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const bg = isDarkMode ? "#1f2937" : "#ffffff";
    const text = isDarkMode ? "#f9fafb" : "#111827";
    const closeBtnColor = isDarkMode ? "#9ca3af" : "#333";
    const shadow = isDarkMode ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.15)";
    styleEl.textContent = `
      .maplibregl-popup-content {
        background: ${bg} !important;
        color: ${text} !important;
        box-shadow: 0 2px 8px ${shadow} !important;
      }
      .maplibregl-popup-anchor-bottom .maplibregl-popup-tip { border-top-color: ${bg} !important; }
      .maplibregl-popup-anchor-top .maplibregl-popup-tip { border-bottom-color: ${bg} !important; }
      .maplibregl-popup-anchor-left .maplibregl-popup-tip { border-right-color: ${bg} !important; }
      .maplibregl-popup-anchor-right .maplibregl-popup-tip { border-left-color: ${bg} !important; }
      .maplibregl-popup-close-button { color: ${closeBtnColor} !important; }
    `;
    return () => {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    };
  }, [isDarkMode]);

  return (
    <div className={`w-full h-screen text-theme-text-primary ${isDarkMode ? "bg-gray-900" : "bg-theme-bg-primary"}`}>
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
        <Link
          to={`/workspace/${slug}`}
          className="text-xs px-3 py-2 rounded bg-theme-bg-secondary border border-theme-sidebar-border hover:text-theme-text-primary"
        >
          Back to chat
        </Link>
        <div className="text-xs px-3 py-2 rounded bg-theme-bg-secondary border border-theme-sidebar-border">
          <div className="font-semibold">GTD Map</div>
          <div className="text-theme-text-secondary">{status}</div>
          {hasMoreData && !loadingMore && (
            <div className="text-yellow-500">
              <div>
                Showing {geoPoints.length.toLocaleString()} of {totalExpected.toLocaleString()} points
              </div>
              {hasFilter && (
                <div className="flex flex-col gap-1 mt-1">
                  <button
                    onClick={handleLoadMore}
                    className="px-2 py-1 text-[11px] rounded bg-yellow-600 hover:bg-yellow-700 text-white"
                  >
                    {totalExpected - geoPoints.length > LOAD_MORE_CHUNK
                      ? `Load Next ${LOAD_MORE_CHUNK.toLocaleString()} Records`
                      : `Load Remaining ${(totalExpected - geoPoints.length).toLocaleString()} Records`}
                  </button>
                  <button
                    onClick={handleLoadAll}
                    className="px-2 py-1 text-[11px] rounded bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Load All {totalExpected.toLocaleString()} Records
                  </button>
                </div>
              )}
            </div>
          )}
          {allLoaded && (
            <div className="text-green-400 text-[11px]">
              All {geoPoints.length.toLocaleString()} records loaded
            </div>
          )}
          {loadingMore && (
            <div className="text-blue-400">
              <div className="mb-1">{status}</div>
              <div className="w-full h-2 bg-theme-bg-primary rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${loadMoreProgress}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-theme-text-secondary">{loadMoreProgress}% complete</div>
            </div>
          )}
          {error && <div className="text-red-500">{error}</div>}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 w-[340px] max-h-[92vh] overflow-hidden rounded border border-theme-sidebar-border bg-theme-bg-secondary text-theme-text-primary">
        <div className="px-3 py-2 border-b border-theme-sidebar-border">
          <div className="text-xs font-semibold">Summary</div>
          <div className="mt-1 text-[11px] text-theme-text-secondary">
            <div>Total attacks: {summaryTotals.totalCount.toLocaleString()}</div>
            {yearRange && (
              <div>Year range: {yearRange.start}–{yearRange.end}</div>
            )}
            <div>Killed: {summaryTotals.totalKilled.toLocaleString()}</div>
            <div>Wounded: {summaryTotals.totalWounded.toLocaleString()}</div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-1 text-xs">
            <button
              onClick={() => setShowHeatmap((prev) => !prev)}
              className="px-2 py-1 rounded border border-theme-sidebar-border"
            >
              {showHeatmap ? "Points" : "Heatmap"}
            </button>
            <button
              onClick={() => setIsDarkMode((prev) => !prev)}
              className="px-2 py-1 rounded border border-theme-sidebar-border"
            >
              {isDarkMode ? "\u2600\uFE0F Light" : "\uD83C\uDF19 Dark"}
            </button>
            <button
              onClick={() => {
                const map = mapRef.current;
                const targetBounds = bounds || initialBoundsRef.current;
                if (map && targetBounds) {
                  map.fitBounds(targetBounds, { padding: 40, maxZoom: 8 });
                }
              }}
              className="px-2 py-1 rounded border border-theme-sidebar-border"
            >
              Reset View
            </button>
          </div>

          <div className="mt-3 text-xs font-semibold">Attacks ({filteredPoints.length.toLocaleString()})</div>
          <input
            type="text"
            placeholder="Search city, year, group..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="mt-2 w-full text-xs px-2 py-1 rounded bg-theme-bg-primary border border-theme-sidebar-border outline-none"
          />
          <div className="mt-2 flex items-center justify-between text-xs">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-theme-sidebar-border disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded border border-theme-sidebar-border disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto">
          {pageItems.map((point, idx) => {
            const displayIndex = page * PAGE_SIZE + idx + 1;
            const label = `${point.city || "Unknown"}, ${point.country_txt || ""}`.trim();
            return (
              <button
                key={`${point.eventid || displayIndex}`}
                onClick={() => {
                  setSelectedPoint(point);
                  showPointPopup(point);
                  const map = mapRef.current;
                  const lat = Number(point.lat ?? point.latitude);
                  const lon = Number(point.lon ?? point.longitude);
                  if (map && Number.isFinite(lat) && Number.isFinite(lon)) {
                    map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8) });
                  }
                }}
                className="w-full text-left px-3 py-2 text-xs border-b border-theme-sidebar-border hover:bg-theme-bg-primary"
              >
                <div className="font-semibold">#{displayIndex} {point.eventid || ""}</div>
                <div className="text-theme-text-secondary">{label || "Unknown location"}</div>
                <div className="text-theme-text-secondary">{point.iyear || "N/A"} • {point.attacktype1_txt || "Unknown"}</div>
              </button>
            );
          })}
        </div>

        {clusterInfo && (
          <div className="px-3 py-2 border-t border-theme-sidebar-border">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Cluster points (showing {clusterPoints.length} of {clusterInfo.count})</span>
              <button
                onClick={clearClusterPoints}
                className="px-2 py-1 rounded border border-theme-sidebar-border text-[11px]"
              >
                Clear
              </button>
            </div>
          </div>
        )}
        {clusterPoints.length > 0 && (
          <div className="max-h-[20vh] overflow-y-auto border-b border-theme-sidebar-border">
            {clusterPoints.map((point, idx) => (
              <button
                key={`${point.eventid || idx}-cluster`}
                onClick={() => {
                  setSelectedPoint(point);
                  showPointPopup(point);
                  const map = mapRef.current;
                  const lat = Number(point.lat ?? point.latitude);
                  const lon = Number(point.lon ?? point.longitude);
                  if (map && Number.isFinite(lat) && Number.isFinite(lon)) {
                    map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 10) });
                  }
                }}
                className="w-full text-left px-3 py-2 text-xs border-t border-theme-sidebar-border hover:bg-theme-bg-primary"
              >
                <div className="font-semibold">{point.eventid || "Unknown"}</div>
                <div className="text-theme-text-secondary">
                  {point.city || "Unknown"}, {point.country_txt || ""}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="px-3 py-2 border-t border-theme-sidebar-border max-h-[30vh] overflow-y-auto">
          <div className="flex items-center justify-between text-xs font-semibold mb-2">
            <span>Details</span>
            <button
              onClick={clearSelection}
              className="px-2 py-1 rounded border border-theme-sidebar-border text-[11px]"
            >
              Clear
            </button>
          </div>
          {selectedPoint ? (
            <pre className="text-[11px] whitespace-pre-wrap break-all bg-theme-bg-primary rounded p-2">
{JSON.stringify(selectedPoint, null, 2)}
            </pre>
          ) : (
            <div className="text-xs text-theme-text-secondary">
              Select a point from the list or click a dot on the map.
            </div>
          )}
        </div>
      </div>

      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
