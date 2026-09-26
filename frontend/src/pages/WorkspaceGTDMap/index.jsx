import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
const LOAD_MORE_CHUNK = 50000; // geo_points per "Load More" click
const SERVER_PAGE_SIZE = 25000; // records per server round-trip (fits in 50K cap)
const BATCH_SIZE = 20000; // render-batch increment
const BATCH_DELAY_MS = 400;

function buildGeoJson(points = [], maxPoints = MAX_RENDER_POINTS) {
  const toRender =
    points.length > maxPoints ? points.slice(0, maxPoints) : points;
  return {
    type: "FeatureCollection",
    features: toRender
      .map((point) => {
        const lat = Number(point.lat ?? point.latitude);
        const lon = Number(point.lon ?? point.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        if (lat < -85.05112878 || lat > 85.05112878) return null;
        if (lon < -180 || lon > 180) return null;
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lon, lat],
          },
          properties: {
            eventid: point.eventid,
            nkill: Number(point.nkill) || 0,
            nwound: Number(point.nwound) || 0,
          },
        };
      })
      .filter(Boolean),
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
    [maxLon, maxLat],
  ];
}

// ─── Build basemap style object for MapLibre ───
// Supports: Esri Satellite Recon raster, Esri Dark Gray Canvas raster, CARTO dark raster, OSM light raster, and PMTiles vector
const MAP_GLYPHS_URL =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";

function buildMapStyle(basemapMode, pmtilesOk) {
  if (pmtilesOk && basemapMode !== "satellite") {
    const flavor = basemapMode === "light" ? "light" : "dark";
    return {
      version: 8,
      glyphs: MAP_GLYPHS_URL,
      sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`,
      sources: {
        basemap: {
          type: "vector",
          url: `pmtiles://${PMTILES_URL}`,
          attribution:
            "<a href='https://github.com/protomaps/basemaps'>Protomaps</a> \u00a9 <a href='https://openstreetmap.org'>OpenStreetMap</a>",
        },
      },
      layers: basemaps.layers("basemap", basemaps.namedFlavor(flavor), {
        lang: "en",
      }),
    };
  }

  // 1. High-Resolution Satellite Reconnaissance (Esri World Imagery + Boundaries & Places)
  if (basemapMode === "satellite") {
    return {
      version: 8,
      glyphs: MAP_GLYPHS_URL,
      sources: {
        "esri-satellite-base": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution: "\u00a9 Esri, Maxar, Earthstar Geographics",
        },
        "esri-satellite-ref": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution: "\u00a9 Esri, HERE, Garmin",
        },
      },
      layers: [
        {
          id: "basemap-bg",
          type: "background",
          paint: { "background-color": "#061320" },
        },
        {
          id: "esri-sat-base-tiles",
          type: "raster",
          source: "esri-satellite-base",
          minzoom: 0,
          maxzoom: 19,
        },
        {
          id: "esri-sat-ref-tiles",
          type: "raster",
          source: "esri-satellite-ref",
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    };
  }

  // 2. Tactical Dark Canvas (Esri Dark Gray Base + Reference Labels, or optional Carto)
  if (basemapMode === "dark" || !basemapMode) {
    const cartoKey = import.meta.env.VITE_CARTO_API_KEY;
    if (cartoKey) {
      return {
        version: 8,
        glyphs: MAP_GLYPHS_URL,
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [
              `https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`,
              `https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`,
              `https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`,
              `https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?api_key=${cartoKey}`,
            ],
            tileSize: 256,
            attribution:
              "\u00a9 <a href='https://openstreetmap.org/copyright'>OpenStreetMap</a> \u00a9 <a href='https://carto.com/attributions'>CARTO</a>",
          },
        },
        layers: [
          {
            id: "basemap-bg",
            type: "background",
            paint: { "background-color": "#14171a" },
          },
          {
            id: "carto-dark-tiles",
            type: "raster",
            source: "carto-dark",
            minzoom: 0,
            maxzoom: 20,
          },
        ],
      };
    }

    // Free, high-performance, dark basemap with zero API key required and no watermarks (Esri Dark Gray Canvas)
    return {
      version: 8,
      glyphs: MAP_GLYPHS_URL,
      sources: {
        "esri-dark-base": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution:
            "\u00a9 <a href='https://www.esri.com/'>Esri</a> \u00a9 <a href='https://openstreetmap.org/copyright'>OpenStreetMap contributors</a>",
        },
        "esri-dark-ref": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
        },
      },
      layers: [
        {
          id: "basemap-bg",
          type: "background",
          paint: { "background-color": "#14171a" },
        },
        {
          id: "esri-dark-base-tiles",
          type: "raster",
          source: "esri-dark-base",
          minzoom: 0,
          maxzoom: 16,
        },
        {
          id: "esri-dark-ref-tiles",
          type: "raster",
          source: "esri-dark-ref",
          minzoom: 0,
          maxzoom: 16,
        },
      ],
    };
  }

  // 3. Light raster fallback (OSM)
  return {
    version: 8,
    glyphs: MAP_GLYPHS_URL,
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          "\u00a9 <a href='https://openstreetmap.org/copyright'>OpenStreetMap contributors</a>",
      },
    },
    layers: [
      {
        id: "basemap-bg",
        type: "background",
        paint: { "background-color": "#aad3df" },
      },
      {
        id: "osm-tiles",
        type: "raster",
        source: "osm-raster",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
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
      clusterRadius: 50,
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
        "circle-stroke-width": 1,
      },
    });
  }

  if (!map.getLayer("gtd-cluster-count")) {
    map.addLayer({
      id: "gtd-cluster-count",
      type: "symbol",
      source: "gtd-points",
      filter: ["has", "point_count"],
      layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 },
      paint: { "text-color": isDark ? "#f9fafb" : "#111827" },
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
        "circle-stroke-width": 1,
      },
    });
  }

  if (!map.getLayer("gtd-heatmap")) {
    map.addLayer({
      id: "gtd-heatmap",
      type: "heatmap",
      source: "gtd-points",
      maxzoom: 10,
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "weight"],
          0,
          0,
          1,
          1,
        ],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 3],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(34,197,94,0)",
          0.2,
          "rgba(34,197,94,0.4)",
          0.4,
          "rgba(59,130,246,0.5)",
          0.6,
          "rgba(249,115,22,0.6)",
          0.8,
          "rgba(239,68,68,0.7)",
          1,
          "rgba(185,28,28,0.85)",
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 10, 25],
        "heatmap-opacity": 0.8,
      },
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
  const loadMoreAbortRef = useRef(null); // AbortController for Load More fetch loop
  const loadingMoreRef = useRef(false); // synchronous guard — immune to React batched state updates
  // Tracks deterministic pagination cursor across "Load More" clicks.
  // $sample (initial refetch) returns random rows, so we always restart from skip=0
  // with deterministic _id sort when the user clicks "Load More".
  const paginationRef = useRef({ skip: 0, deterministicStarted: false });
  const cachedTotalsRef = useRef(null); // cache killed/wounded once computed
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
  const [basemapMode, setBasemapMode] = useState(() => {
    if (typeof window !== "undefined") {
      const urlParam = searchParams.get("basemap");
      if (urlParam && ["dark", "satellite", "light"].includes(urlParam)) {
        return urlParam;
      }
      const saved = localStorage.getItem("tf_preferred_basemap");
      if (saved && ["dark", "satellite", "light"].includes(saved)) {
        return saved;
      }
    }
    return "dark";
  });
  const isDarkMode = basemapMode !== "light";
  const pmtilesAvailableRef = useRef(false);
  const basemapInitRef = useRef(true); // skip first style-switch effect (initMap handles it)
  const geoJsonRef = useRef(null); // mutable ref for style-switch closure
  const showHeatmapRef = useRef(false); // mutable ref for style-switch closure

  const key = searchParams.get("key");

  const geoJson = useMemo(
    () => buildGeoJson(geoPoints, renderLimit),
    [geoPoints, renderLimit]
  );
  geoJsonRef.current = geoJson; // keep ref in sync for style-switch closure
  showHeatmapRef.current = showHeatmap; // keep ref in sync for style-switch closure
  const bounds = useMemo(() => calculateBounds(geoPoints), [geoPoints]);

  // Reliably detect whether there's more data to load
  const totalExpected =
    payload?.records_with_coordinates || payload?.total_count || 0;
  const hasMoreData =
    !allLoaded && totalExpected > 0 && geoPoints.length < totalExpected;
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
        point.iyear,
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
      // 1. If key is present in localStorage, or active workspace chat data exists
      let stored = null;
      let isChatQuery = false;

      if (key) {
        stored = localStorage.getItem(`gtd-map:${key}`);
        isChatQuery = true;
      } else if (slug) {
        if (typeof window !== "undefined" && window.__tfLatestGtdData) {
          stored = JSON.stringify(window.__tfLatestGtdData);
          isChatQuery = true;
        } else {
          const cached = localStorage.getItem(`tf:latest-gtd-data:${slug}`);
          if (cached) {
            stored = cached;
            isChatQuery = true;
          }
        }
      }

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

          if (
            Array.isArray(parsed.geo_points) &&
            parsed.geo_points.length > 0
          ) {
            setStatus(
              isChatQuery && parsed.query
                ? `Showing ${parsed.geo_points.length.toLocaleString()} points for query: "${parsed.query}"`
                : `Showing ${parsed.geo_points.length.toLocaleString()} points`
            );
            return;
          }

          const filter =
            parsed.filter || parsed.simpleFilter || parsed.originalFilter;
          if (filter) {
            setStatus("Plotting query points from database...");
            const res = await fetch(
              `${API_BASE}/workspace/${slug}/gtd-refetch`,
              {
                method: "POST",
                headers: {
                  ...baseHeaders(),
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  mongo_filter: filter,
                  limit: MAX_REFETCH_LIMIT,
                  page_size: MAX_REFETCH_LIMIT,
                }),
                signal: abortController.signal,
              }
            );

            if (cancelled) return;
            if (res.ok) {
              const result = await res.json();
              if (result.success) {
                const refetchedPoints = result.geo_points || [];
                setGeoPoints(refetchedPoints);
                setPayload((prev) => ({
                  ...prev,
                  total_count: result.total_count || prev.total_count,
                  ...(result.total_killed != null && {
                    total_killed: result.total_killed,
                  }),
                  ...(result.total_wounded != null && {
                    total_wounded: result.total_wounded,
                  }),
                  geo_points: refetchedPoints,
                }));
                setStatus(
                  `Showing ${refetchedPoints.length.toLocaleString()} of ${(
                    result.total_count || refetchedPoints.length
                  ).toLocaleString()} points`
                );
                return;
              }
            }
          }
        } catch (e) {
          console.warn(
            "Failed to parse stored chat key, falling back to global dataset:",
            e
          );
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
        if (!result.success)
          throw new Error(result.error || "Failed to load GTD database");

        const points = result.geo_points || [];
        const total = result.total_count || 181691;
        const totalKilled = points.reduce(
          (sum, p) => sum + (Number(p.nkill) || 0),
          0
        );
        const totalWounded = points.reduce(
          (sum, p) => sum + (Number(p.nwound) || 0),
          0
        );

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
        setStatus(
          `Showing ${points.length.toLocaleString()} of ${total.toLocaleString()} global incident records`
        );
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
      popupRef.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
      });
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
      let chunkPoints = []; // points fetched in THIS click
      let currentSkip = paginationRef.current.skip;
      const chunkTarget = currentSkip + LOAD_MORE_CHUNK; // fetch up to this skip value
      let totalCount = payload?.total_count || 0;
      let hasMore = true;
      let serverKilled = 0;
      let serverWounded = 0;

      setStatus(
        `Fetching records from skip=${currentSkip.toLocaleString()}...`
      );

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
        if (!result.success)
          throw new Error(result.error || "Failed to fetch records");

        const pagePoints = result.geo_points || [];
        // Use push for O(1) amortised append instead of concat (which copies the entire array)
        for (let i = 0; i < pagePoints.length; i++)
          chunkPoints.push(pagePoints[i]);
        totalCount = result.total_count || totalCount;
        hasMore = result.has_more === true;
        currentSkip = result.next_skip || currentSkip + pagePoints.length;

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
      const isFirstDeterministicChunk =
        currentSkip <= LOAD_MORE_CHUNK + SERVER_PAGE_SIZE;
      let mergedPoints;
      if (isFirstDeterministicChunk) {
        // Replace $sample data with deterministic page 0–50K
        mergedPoints = chunkPoints;
      } else {
        // Append — reuse the existing array to avoid copying 100K+ elements
        mergedPoints = geoPoints.slice(); // shallow copy to avoid mutating React state
        for (let i = 0; i < chunkPoints.length; i++)
          mergedPoints.push(chunkPoints[i]);
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
      setPayload((prev) => ({ ...prev, total_count: totalCount }));
      setAllLoaded(fullyLoaded);

      // Progressive render-limit ramp-up to avoid MapLibre freeze
      if (mergedPoints.length > MAX_RENDER_POINTS) {
        // Start from current renderLimit (user may have already seen 50K) or MAX_RENDER_POINTS
        let currentLimit = Math.max(renderLimit, MAX_RENDER_POINTS);
        const total = mergedPoints.length;

        const renderNextBatch = () => {
          currentLimit = Math.min(currentLimit + BATCH_SIZE, total);
          setRenderLimit(currentLimit);
          const pct =
            85 +
            Math.floor(
              ((currentLimit - MAX_RENDER_POINTS) /
                (total - MAX_RENDER_POINTS)) *
                15
            );
          setLoadMoreProgress(Math.min(pct, 100));
          setStatus(
            `Rendering points... ${currentLimit.toLocaleString()} / ${total.toLocaleString()}`
          );

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
      setStatus(
        `Showing ${total.toLocaleString()} points — click Load More for the next batch`
      );
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
        if (!result.success)
          throw new Error(result.error || "Failed to fetch records");

        const pagePoints = result.geo_points || [];
        for (let i = 0; i < pagePoints.length; i++)
          allFetchedPoints.push(pagePoints[i]);

        totalCount = result.total_count || totalCount;
        hasMore = result.has_more === true;
        currentSkip = result.next_skip || currentSkip + pagePoints.length;

        if (result.total_killed) serverKilled = result.total_killed;
        if (result.total_wounded) serverWounded = result.total_wounded;

        const fetchPct =
          totalCount > 0
            ? Math.min(
                80,
                Math.floor((allFetchedPoints.length / totalCount) * 80)
              )
            : Math.min(
                80,
                Math.floor((allFetchedPoints.length / TOTAL_LIMIT) * 80)
              );
        setLoadMoreProgress(fetchPct);
        setStatus(
          `Loading all records... ${allFetchedPoints.length.toLocaleString()} of ${totalCount.toLocaleString()}`
        );

        if (pagePoints.length === 0) break;
      }

      if (abortController.signal.aborted) return;

      paginationRef.current.skip = currentSkip;

      if (serverKilled > 0 || serverWounded > 0) {
        cachedTotalsRef.current = {
          totalKilled: serverKilled,
          totalWounded: serverWounded,
        };
      } else {
        cachedTotalsRef.current = null;
      }

      setLoadMoreProgress(85);
      setStatus(
        `Rendering ${allFetchedPoints.length.toLocaleString()} points...`
      );

      const fullyLoaded = !hasMore || currentSkip >= totalCount;

      setGeoPoints(allFetchedPoints);
      setPayload((prev) => ({ ...prev, total_count: totalCount }));
      setAllLoaded(fullyLoaded);

      // Progressive render ramp-up
      if (allFetchedPoints.length > MAX_RENDER_POINTS) {
        let currentLimit = Math.max(renderLimit, MAX_RENDER_POINTS);
        const total = allFetchedPoints.length;

        const renderNextBatch = () => {
          currentLimit = Math.min(currentLimit + BATCH_SIZE, total);
          setRenderLimit(currentLimit);
          const pct =
            85 +
            Math.floor(
              ((currentLimit - MAX_RENDER_POINTS) /
                (total - MAX_RENDER_POINTS)) *
                15
            );
          setLoadMoreProgress(Math.min(pct, 100));
          setStatus(
            `Rendering points... ${currentLimit.toLocaleString()} / ${total.toLocaleString()}`
          );

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
            ...(PMTILES_URL.startsWith("http")
              ? { headers: { Range: "bytes=0-127" } }
              : {}),
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
          console.warn(
            "[GTDMap] PMTiles reachability check failed:",
            pingErr.message,
            "— falling back to OSM raster tiles."
          );
          pmtilesAvailable = false;
        }

        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);

        // Store PMTiles availability for later style switches
        pmtilesAvailableRef.current = pmtilesAvailable;

        // Build initial style from active basemapMode (dark, satellite, or light)
        const style = buildMapStyle(basemapMode, pmtilesAvailable);

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style,
          center: [0, 20],
          zoom: 2,
          attributionControl: true,
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
          addGTDDataLayers(map, isDarkMode);

          map.on("click", "gtd-clusters", (event) => {
            const features = map.queryRenderedFeatures(event.point, {
              layers: ["gtd-clusters"],
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
                  return eventId
                    ? pointByEventIdRef.current.get(eventId) || props
                    : props;
                });
              setClusterPoints(points);
              setClusterInfo({ count: clusterCount });
            });

            source.getClusterExpansionZoom(clusterId, (err, zoom) => {
              if (err) return;
              map.easeTo({
                center: features[0].geometry.coordinates,
                zoom,
              });
            });
          });

          map.on("click", "gtd-unclustered", (event) => {
            const feature = event.features?.[0];
            if (!feature) return;
            const props = feature.properties || {};
            const eventId = props.eventid ? String(props.eventid) : null;
            const point = eventId
              ? pointByEventIdRef.current.get(eventId)
              : null;
            setSelectedPoint(point || props);
            showPointPopup(point || props, feature.geometry.coordinates);
          });

          map.on("click", (event) => {
            const features = map.queryRenderedFeatures(event.point, {
              layers: ["gtd-unclustered", "gtd-clusters"],
            });
            if (!features.length) {
              clearSelection();
            }
          });

          requestAnimationFrame(() => {
            if (mapRef.current) mapRef.current.resize();
          });
        });

        const onResize = () => {
          if (mapRef.current) mapRef.current.resize();
        };
        window.addEventListener("resize", onResize);
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
      map.setLayoutProperty(
        "gtd-cluster-count",
        "visibility",
        pointsVisibility
      );
    }
    if (map.getLayer("gtd-unclustered")) {
      map.setLayoutProperty("gtd-unclustered", "visibility", pointsVisibility);
    }
  }, [showHeatmap]);

  // ─── Style switch effect: swap basemap when basemapMode changes ───
  // Skips the initial render (initMap handles first load). Only fires on toggle.
  useEffect(() => {
    if (basemapInitRef.current) {
      basemapInitRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;

    if (typeof window !== "undefined") {
      localStorage.setItem("tf_preferred_basemap", basemapMode);
    }

    const newStyle = buildMapStyle(basemapMode, pmtilesAvailableRef.current);
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
        if (map.getLayer("gtd-heatmap"))
          map.setLayoutProperty("gtd-heatmap", "visibility", heatVis);
        if (map.getLayer("gtd-clusters"))
          map.setLayoutProperty("gtd-clusters", "visibility", pointsVis);
        if (map.getLayer("gtd-cluster-count"))
          map.setLayoutProperty("gtd-cluster-count", "visibility", pointsVis);
        if (map.getLayer("gtd-unclustered"))
          map.setLayoutProperty("gtd-unclustered", "visibility", pointsVis);

        requestAnimationFrame(() => {
          if (mapRef.current) mapRef.current.resize();
        });
      } catch (err) {
        console.warn(
          "[GTDMap] Style switch: layers not ready, retrying...",
          err.message
        );
        setTimeout(reAddLayers, 100);
      }
    };

    map.once("style.load", () => requestAnimationFrame(reAddLayers));
    map.once("styledata", () => requestAnimationFrame(reAddLayers));
  }, [basemapMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (styleEl && styleEl.parentNode)
        styleEl.parentNode.removeChild(styleEl);
    };
  }, [isDarkMode]);

  return (
    <div className="relative w-full h-screen overflow-hidden select-none bg-slate-950">
      {/* ── Base Map Canvas ── */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 w-full h-full"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
        }}
      />

      {/* ── Top-left Intelligence Panel ── */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 pointer-events-auto">
        {/* Back button */}
        <Link
          to={`/workspace/${slug}`}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg shadow-md w-fit font-medium bg-gray-900 text-gray-300 border border-gray-700 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          <span>Back to chat</span>
        </Link>

        {/* GTD Intelligence Card */}
        <div
          className="rounded-xl min-w-[240px] max-w-[300px] shadow-2xl"
          style={{
            backgroundColor: "#111827",
            border: "1px solid #374151",
            color: "#e5e7eb",
            fontSize: "12px",
          }}
        >
          {/* Card header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 14px 10px 14px",
              borderBottom: "1px solid #374151",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#22d3ee",
                flexShrink: 0,
                animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontWeight: 600,
                fontSize: "12px",
                letterSpacing: "0.02em",
                color: "#ffffff",
              }}
            >
              GTD Geospatial Intelligence
            </span>
          </div>

          {/* Status line */}
          <div
            style={{
              padding: "10px 14px",
              fontSize: "11px",
              color: "#9ca3af",
              lineHeight: 1.4,
            }}
          >
            {status}
          </div>

          {/* Load-more controls */}
          {hasMoreData && !loadingMore && (
            <div
              style={{
                padding: "8px 14px 12px 14px",
                borderTop: "1px solid #374151",
              }}
            >
              <div
                style={{
                  color: "#fbbf24",
                  fontSize: "11px",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Showing {geoPoints.length.toLocaleString()} of{" "}
                {totalExpected.toLocaleString()}
              </div>
              {hasFilter && (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={handleLoadMore}
                    className="px-2.5 py-1 text-[11px] rounded font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                  >
                    {totalExpected - geoPoints.length > LOAD_MORE_CHUNK
                      ? `Load Next ${LOAD_MORE_CHUNK.toLocaleString()} Records`
                      : `Load Remaining ${(totalExpected - geoPoints.length).toLocaleString()} Records`}
                  </button>
                  <button
                    onClick={handleLoadAll}
                    className="px-2.5 py-1 text-[11px] rounded font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                  >
                    Load All {totalExpected.toLocaleString()} Records
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          {loadingMore && (
            <div
              style={{
                padding: "8px 14px 12px 14px",
                borderTop: "1px solid #374151",
              }}
            >
              <div className="mb-1 text-[11px] text-cyan-400">{status}</div>
              <div
                style={{
                  width: "100%",
                  height: "6px",
                  borderRadius: "3px",
                  overflow: "hidden",
                  backgroundColor: "#1f2937",
                }}
              >
                <div
                  className="h-full bg-cyan-500 transition-all duration-300 rounded-full"
                  style={{ width: `${loadMoreProgress}%` }}
                />
              </div>
              <div
                style={{ marginTop: "4px", fontSize: "10px", color: "#6b7280" }}
              >
                {loadMoreProgress}% complete
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3.5 pb-3 text-rose-400 text-[11px] font-medium">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-20 w-[340px] max-h-[92vh] overflow-hidden rounded border border-theme-sidebar-border bg-theme-bg-secondary text-theme-text-primary">
        <div className="px-3 py-2 border-b border-theme-sidebar-border">
          <div className="text-xs font-semibold">Summary</div>
          <div className="mt-1 text-[11px] text-theme-text-secondary">
            <div>
              Total attacks: {summaryTotals.totalCount.toLocaleString()}
            </div>
            {yearRange && (
              <div>
                Year range: {yearRange.start}–{yearRange.end}
              </div>
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
            {/* Tactical 3-Way Basemap Controller */}
            <div className="flex items-center gap-0.5 bg-slate-950/70 p-0.5 rounded border border-slate-800/80 font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setBasemapMode("dark")}
                className={`px-2 py-1 rounded transition-all cursor-pointer ${
                  basemapMode === "dark"
                    ? "bg-slate-800 text-cyan-400 font-semibold border border-cyan-500/50 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Tactical Dark Canvas (Esri)"
              >
                DARK
              </button>
              <button
                type="button"
                onClick={() => setBasemapMode("satellite")}
                className={`px-2 py-1 rounded transition-all cursor-pointer ${
                  basemapMode === "satellite"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/50 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Satellite Orbital Recon (Esri World Imagery)"
              >
                SAT
              </button>
              <button
                type="button"
                onClick={() => setBasemapMode("light")}
                className={`px-2 py-1 rounded transition-all cursor-pointer ${
                  basemapMode === "light"
                    ? "bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/50 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Daylight Cartographic (OSM)"
              >
                OSM
              </button>
            </div>
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

          <div className="mt-3 text-xs font-semibold">
            Attacks ({filteredPoints.length.toLocaleString()})
          </div>
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
            const label =
              `${point.city || "Unknown"}, ${point.country_txt || ""}`.trim();
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
                    map.easeTo({
                      center: [lon, lat],
                      zoom: Math.max(map.getZoom(), 8),
                    });
                  }
                }}
                className="w-full text-left px-3 py-2 text-xs border-b border-theme-sidebar-border hover:bg-theme-bg-primary"
              >
                <div className="font-semibold">
                  #{displayIndex} {point.eventid || ""}
                </div>
                <div className="text-theme-text-secondary">
                  {label || "Unknown location"}
                </div>
                <div className="text-theme-text-secondary">
                  {point.iyear || "N/A"} • {point.attacktype1_txt || "Unknown"}
                </div>
              </button>
            );
          })}
        </div>

        {clusterInfo && (
          <div className="px-3 py-2 border-t border-theme-sidebar-border">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>
                Cluster points (showing {clusterPoints.length} of{" "}
                {clusterInfo.count})
              </span>
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
                    map.easeTo({
                      center: [lon, lat],
                      zoom: Math.max(map.getZoom(), 10),
                    });
                  }
                }}
                className="w-full text-left px-3 py-2 text-xs border-t border-theme-sidebar-border hover:bg-theme-bg-primary"
              >
                <div className="font-semibold">
                  {point.eventid || "Unknown"}
                </div>
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
    </div>
  );
}
