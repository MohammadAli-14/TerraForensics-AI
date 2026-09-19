import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Fire,
  CirclesThreePlus,
  ArrowsIn,
  ShieldCheck,
  WarningCircle,
  Database,
  Crosshair,
  MapPin,
  Calendar,
  Users,
  Skull,
  X,
  ArrowClockwise,
  CircleNotch,
  Globe,
  Stack,
} from "@phosphor-icons/react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

// Multi-provider sovereign dark map style configuration
// Carto Dark Matter: XYZ format ({z}/{x}/{y}) with crisp labels & borders
// Esri Dark Gray: ArcGIS REST format ({z}/{y}/{x}) Base + Reference labels
const SOVEREIGN_MAP_STYLE = {
  version: 8,
  sources: {
    "carto-dark-base": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
    "esri-dark-base": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri, HERE, Garmin, © OpenStreetMap",
    },
    "esri-dark-ref": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri, HERE, Garmin, © OpenStreetMap",
    },
  },
  layers: [
    {
      id: "carto-dark-layer",
      type: "raster",
      source: "carto-dark-base",
      minzoom: 0,
      maxzoom: 20,
      layout: { visibility: "visible" },
    },
    {
      id: "esri-dark-base-layer",
      type: "raster",
      source: "esri-dark-base",
      minzoom: 0,
      maxzoom: 20,
      layout: { visibility: "none" },
    },
    {
      id: "esri-dark-ref-layer",
      type: "raster",
      source: "esri-dark-ref",
      minzoom: 0,
      maxzoom: 20,
      layout: { visibility: "none" },
    },
  ],
};

export default function WorkstationMapPanel({ workspace, onClose }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [activeData, setActiveData] = useState(null);
  const [mapMode, setMapMode] = useState("clusters"); // "clusters" | "heatmap"
  const [basemap, setBasemap] = useState("carto"); // "carto" | "esri"
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState(null);
  const [mouseCoords, setMouseCoords] = useState(null);
  const [totalCatalogCount] = useState(181691);

  // Setup dual-source GeoJSON layers
  const setupMapLayers = useCallback((map) => {
    // 1. Clustered source for cluster bubbles & counts
    if (!map.getSource("gtd-clustered-source")) {
      map.addSource("gtd-clustered-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 48,
      });

      // Cluster circles
      map.addLayer({
        id: "gtd-clusters",
        type: "circle",
        source: "gtd-clustered-source",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#f59e0b", // amber (<25)
            25,
            "#f97316", // orange (25-99)
            100,
            "#ef4444", // red (100-499)
            500,
            "#dc2626", // deep red (500-1999)
            2000,
            "#991b1b", // intense crimson (>=2000)
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            14,
            25,
            18,
            100,
            22,
            500,
            28,
            2000,
            34,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(255, 255, 255, 0.45)",
          "circle-opacity": 0.92,
        },
      });

      // Cluster Count Text
      map.addLayer({
        id: "gtd-cluster-count",
        type: "symbol",
        source: "gtd-clustered-source",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-size": 11,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // Individual unclustered incident points
      map.addLayer({
        id: "gtd-unclustered-points",
        type: "circle",
        source: "gtd-clustered-source",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#38bdf8", // tactical cyan
          "circle-radius": 5,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.95,
        },
      });
    }

    // 2. Raw unclustered source for Casualty Heatmap
    if (!map.getSource("gtd-raw-source")) {
      map.addSource("gtd-raw-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: false,
      });

      // Casualty Heatmap Layer
      map.addLayer({
        id: "gtd-heatmap",
        type: "heatmap",
        source: "gtd-raw-source",
        maxzoom: 15,
        paint: {
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["get", "nkill"],
            0, 0.2,
            5, 0.5,
            25, 0.8,
            100, 1.0,
          ],
          "heatmap-intensity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 1,
            9, 3,
          ],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(15, 23, 42, 0)",
            0.15, "rgba(56, 189, 248, 0.4)",
            0.35, "rgba(245, 158, 11, 0.6)",
            0.65, "rgba(239, 68, 68, 0.8)",
            0.9, "rgba(220, 38, 38, 0.95)",
            1.0, "rgba(254, 240, 138, 1.0)",
          ],
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0, 4,
            9, 22,
            15, 35,
          ],
          "heatmap-opacity": 0.85,
        },
        layout: { visibility: "none" },
      });

      // Zoomed-in precision dots under heatmap
      map.addLayer({
        id: "gtd-heatmap-points",
        type: "circle",
        source: "gtd-raw-source",
        minzoom: 8,
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#fb7185",
          "circle-opacity": 0.7,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
        layout: { visibility: "none" },
      });
    }

    // Click cluster to zoom in
    map.on("click", "gtd-clusters", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["gtd-clusters"] });
      if (!features || !features.length) return;
      const clusterId = features[0].properties.cluster_id;
      const source = map.getSource("gtd-clustered-source");
      if (source && typeof source.getClusterExpansionZoom === "function") {
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom + 1 });
        });
      }
    });

    // Click individual point to inspect in drawer
    map.on("click", "gtd-unclustered-points", (e) => {
      if (e.features && e.features[0]) {
        setSelectedIncident(e.features[0].properties);
      }
    });

    map.on("click", "gtd-heatmap-points", (e) => {
      if (e.features && e.features[0]) {
        setSelectedIncident(e.features[0].properties);
      }
    });

    // Hover cursors
    map.on("mouseenter", "gtd-clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "gtd-clusters", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "gtd-unclustered-points", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "gtd-unclustered-points", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "gtd-heatmap-points", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "gtd-heatmap-points", () => {
      map.getCanvas().style.cursor = "";
    });

    // Mouse coordinates readout
    map.on("mousemove", (e) => {
      setMouseCoords({
        lat: e.lngLat.lat.toFixed(3),
        lng: e.lngLat.lng.toFixed(3),
        zoom: map.getZoom().toFixed(1),
      });
    });
  }, []);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: SOVEREIGN_MAP_STYLE,
      center: [20, 20],
      zoom: 1.8,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      mapRef.current = map;
      setupMapLayers(map);
      setMapReady(true);
    });

    map.on("error", (e) => {
      console.warn("[Workstation MapLibre]", e?.message || e);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [setupMapLayers]);

  // Push GeoJSON data into dual sources and fit bounds
  const updateMapData = useCallback((dataset) => {
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;
    const clusterSource = map.getSource("gtd-clustered-source");
    const rawSource = map.getSource("gtd-raw-source");
    if (!clusterSource || !rawSource) return;

    const points = dataset?.geo_points || dataset?.geo_samples || [];
    if (!Array.isArray(points) || points.length === 0) {
      clusterSource.setData({ type: "FeatureCollection", features: [] });
      rawSource.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const features = [];
    const bounds = new maplibregl.LngLatBounds();

    points.forEach((pt) => {
      const lat = parseFloat(pt.lat ?? pt.latitude);
      // Support lng, longitude, or lon
      const lng = parseFloat(pt.lng ?? pt.longitude ?? pt.lon);

      if (
        isNaN(lat) ||
        isNaN(lng) ||
        (lat === 0 && lng === 0) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return;
      }

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          id: pt.eventid || pt.id || "N/A",
          country: pt.country_txt || pt.country || "Unknown",
          city: pt.city || "Unknown",
          date: pt.iyear
            ? `${pt.iyear}${pt.imonth ? `-${String(pt.imonth).padStart(2, "0")}` : ""}${
                pt.iday ? `-${String(pt.iday).padStart(2, "0")}` : ""
              }`
            : "Unknown",
          group: pt.gname || pt.group || "Unknown",
          attackType: pt.attacktype1_txt || pt.attackType || "Incident",
          targetType: pt.targtype1_txt || pt.targetType || "Unknown",
          weaponType: pt.weaptype1_txt || pt.weaponType || "Unknown",
          nkill: parseInt(pt.nkill ?? 0, 10) || 0,
          nwound: parseInt(pt.nwound ?? 0, 10) || 0,
        },
      });

      bounds.extend([lng, lat]);
    });

    const featureCollection = {
      type: "FeatureCollection",
      features,
    };

    clusterSource.setData(featureCollection);
    rawSource.setData(featureCollection);

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 45, maxZoom: 10, duration: 1200 });
    }
  }, [mapReady]);

  // Sync with activeData changes
  useEffect(() => {
    if (!mapReady || !activeData) return;
    const points = activeData.geo_points || activeData.geo_samples || [];
    if (points.length > 0) {
      updateMapData(activeData);
    }
  }, [activeData, mapReady, updateMapData]);

  // Listen for broadcasted GTD events from chat
  useEffect(() => {
    const handleActiveGtdData = (event) => {
      const payload = event?.detail;
      if (!payload) return;
      setActiveData(payload);
    };

    window.addEventListener("aegis:active-gtd-data", handleActiveGtdData);
    return () => window.removeEventListener("aegis:active-gtd-data", handleActiveGtdData);
  }, []);

  // Toggle Cluster vs Heatmap mode cleanly
  const toggleMapMode = (mode) => {
    setMapMode(mode);
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;

    const showClusters = mode === "clusters";
    const showHeatmap = mode === "heatmap";

    const setVisibility = (layerId, isVisible) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none");
      }
    };

    setVisibility("gtd-clusters", showClusters);
    setVisibility("gtd-cluster-count", showClusters);
    setVisibility("gtd-unclustered-points", showClusters);

    setVisibility("gtd-heatmap", showHeatmap);
    setVisibility("gtd-heatmap-points", showHeatmap);
  };

  // Toggle Basemap (Carto Dark vs Esri Canvas)
  const toggleBasemap = (nextBasemap) => {
    setBasemap(nextBasemap);
    if (!mapRef.current || !mapReady) return;
    const map = mapRef.current;

    const isCarto = nextBasemap === "carto";

    if (map.getLayer("carto-dark-layer")) {
      map.setLayoutProperty("carto-dark-layer", "visibility", isCarto ? "visible" : "none");
    }
    if (map.getLayer("esri-dark-base-layer")) {
      map.setLayoutProperty("esri-dark-base-layer", "visibility", isCarto ? "none" : "visible");
    }
    if (map.getLayer("esri-dark-ref-layer")) {
      map.setLayoutProperty("esri-dark-ref-layer", "visibility", isCarto ? "none" : "visible");
    }
  };

  // Standby Action: Load Global Threat Radar (5,000 Incidents)
  const handleLoadGlobalRadar = async () => {
    setLoadingPoints(true);
    setLoadingStatus("Scanning 181,691 GTD Records...");
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE}/gtd/public/pipeline`, {
        method: "POST",
        headers: {
          ...baseHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          limit: 5000,
          includeGeoJSON: true,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data?.success && data?.geo_points?.length > 0) {
        const dataset = {
          ...data,
          title: "Global Threat Radar (5,000 Sample Incidents)",
          total_count: data.total_count || 181691,
        };
        setActiveData(dataset);
        updateMapData(dataset);
      } else {
        throw new Error("No incident telemetry returned from catalog");
      }
    } catch (err) {
      console.error("[Workstation Map] Failed to load global radar:", err);
      setErrorMsg(err.message || "Failed to load radar data");
    } finally {
      setLoadingPoints(false);
      setLoadingStatus("");
    }
  };

  // Historical Action: Refetch coordinates for historical query
  const handleRefetchCoordinates = async () => {
    if (!activeData) return;
    const filter = activeData.filter || activeData.originalFilter || activeData.simpleFilter || {};
    const slug = workspace?.slug || window.location.pathname.split("/workspace/")[1]?.split("/")[0];

    setLoadingPoints(true);
    setLoadingStatus("Plotting coordinates from database...");
    setErrorMsg(null);

    try {
      let res;
      if (slug) {
        res = await fetch(`${API_BASE}/workspace/${slug}/gtd-refetch`, {
          method: "POST",
          headers: {
            ...baseHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mongo_filter: filter,
            limit: Math.min(activeData.total_count || 5000, 20000),
          }),
        });
      }

      if (!res || !res.ok) {
        // Fallback to public pipeline with filter
        res = await fetch(`${API_BASE}/gtd/public/pipeline`, {
          method: "POST",
          headers: {
            ...baseHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filter,
            limit: Math.min(activeData.total_count || 5000, 20000),
            includeGeoJSON: true,
          }),
        });
      }

      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      const result = await res.json();

      if (result.success && result.geo_points?.length > 0) {
        const updated = {
          ...activeData,
          geo_points: result.geo_points,
          _storageOptimized: false,
          geo_points_count: result.geo_points.length,
          total_count: result.total_count || activeData.total_count,
        };
        setActiveData(updated);
        updateMapData(updated);
      } else {
        throw new Error("No coordinates returned for this query");
      }
    } catch (err) {
      console.error("[Workstation Map] Refetch failed:", err);
      setErrorMsg(err.message || "Failed to retrieve coordinates");
    } finally {
      setLoadingPoints(false);
      setLoadingStatus("");
    }
  };

  const resetView = () => {
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [20, 20], zoom: 1.8, duration: 1000 });
    }
  };

  const currentPoints = activeData?.geo_points || activeData?.geo_samples || [];
  const currentCount = currentPoints.length || activeData?.total_count || 0;
  const isHistoricalMissingPoints = activeData && currentPoints.length === 0 && (activeData.total_count > 0 || activeData.filter);
  const killedCount = activeData?.totalKilled ?? activeData?.statistics?.total_killed ?? 0;
  const woundedCount = activeData?.totalWounded ?? activeData?.statistics?.total_wounded ?? 0;
  const telemetry = activeData?.grounding_telemetry;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0F172A] border-l border-slate-800 text-slate-200 overflow-hidden select-none">
      {/* Top Workstation Header */}
      <div className="h-14 px-4 bg-[#0B0F19]/95 backdrop-blur border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-200">
            TerraForensics Geospatial Canvas
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800/90 text-cyan-400 border border-slate-700">
            GTD 1970–2017
          </span>
        </div>

        {/* Tactical Controls (Clusters / Heatmap / Basemap / Reset / Close) */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-md border border-slate-800">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-slate-950/60 p-0.5 rounded border border-slate-800/60">
            <button
              onClick={() => toggleMapMode("clusters")}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all ${
                mapMode === "clusters"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Cluster Density View"
            >
              <CirclesThreePlus size={14} weight="bold" />
              <span>Clusters</span>
            </button>
            <button
              onClick={() => toggleMapMode("heatmap")}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all ${
                mapMode === "heatmap"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Casualty Heatmap View"
            >
              <Fire size={14} weight="bold" />
              <span>Heatmap</span>
            </button>
          </div>

          {/* Basemap Switcher */}
          <button
            onClick={() => toggleBasemap(basemap === "carto" ? "esri" : "carto")}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-700"
            title={`Toggle Basemap (Current: ${basemap === "carto" ? "Tactical Dark" : "Esri Canvas"})`}
          >
            <Stack size={14} />
            <span className="font-mono text-[11px] uppercase">{basemap}</span>
          </button>

          {/* Reset View */}
          <button
            onClick={resetView}
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Reset Global View"
          >
            <ArrowsIn size={14} />
          </button>

          {/* Close Action */}
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-600/80 border border-rose-500/30 hover:border-rose-500 transition-all ml-1"
              title="Close Geospatial Canvas (Reclaim full screen for chat)"
            >
              <X size={14} weight="bold" />
              <span>Close</span>
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Telemetry Ribbon */}
      <div className="px-4 py-2 bg-slate-900/80 border-b border-slate-800/80 flex items-center justify-between text-xs font-mono z-10 backdrop-blur-sm">
        <div className="flex items-center gap-4 text-slate-300">
          <div>
            <span className="text-slate-500 text-[10px] block">PLOTTED INCIDENTS</span>
            <span className="font-semibold text-cyan-400">
              {currentPoints.length > 0
                ? `${currentPoints.length.toLocaleString()} pts`
                : currentCount > 0
                ? `${currentCount.toLocaleString()} total`
                : `${totalCatalogCount.toLocaleString()} catalog`}
            </span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">FATALITIES</span>
            <span className="font-semibold text-rose-400">
              {killedCount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">WOUNDED</span>
            <span className="font-semibold text-orange-400">
              {woundedCount.toLocaleString()}
            </span>
          </div>
          {activeData?.query && (
            <div className="hidden xl:block max-w-[180px] truncate text-slate-400 text-[11px]" title={activeData.query}>
              <span className="text-slate-500 text-[10px] block">QUERY</span>
              <span className="truncate block font-sans">{activeData.query}</span>
            </div>
          )}
        </div>

        {telemetry && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-950/80 border border-slate-800">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span className="text-emerald-400 text-[11px] font-medium">
              Grounding: {(telemetry.confidence * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Historical Query Notice Banner (When coordinates are stripped from SQLite history) */}
      {isHistoricalMissingPoints && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between text-xs font-mono z-10">
          <div className="flex items-center gap-2 text-amber-300">
            <WarningCircle size={15} className="text-amber-400 shrink-0" />
            <span>
              Historical query dataset: <strong>{(activeData.total_count || 0).toLocaleString()}</strong> matching incidents.
            </span>
          </div>
          <button
            onClick={handleRefetchCoordinates}
            disabled={loadingPoints}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition-all disabled:opacity-50"
          >
            {loadingPoints ? (
              <CircleNotch size={14} className="animate-spin" />
            ) : (
              <Globe size={14} />
            )}
            <span>Plot Incidents on Map</span>
          </button>
        </div>
      )}

      {/* MapLibre Canvas Container */}
      <div className="flex-1 relative w-full h-full">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Empty State Overlay when no active query */}
        {!activeData && !loadingPoints && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center bg-slate-950/40 backdrop-blur-[2px]">
            <div className="p-6 rounded-xl bg-[#0B0F19]/95 border border-slate-800 text-center max-w-md shadow-2xl pointer-events-auto">
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto mb-3">
                <Crosshair size={28} className="text-cyan-400 animate-pulse" />
              </div>
              <h4 className="text-sm font-semibold text-slate-100 tracking-wide">
                TerraForensics Sovereign Radar Standby
              </h4>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Connected to 181,691 verified GTD incident records. Query attacks, countries, or terror groups in the intelligence console, or initialize global threat radar.
              </p>
              <div className="mt-4 flex justify-center">
                <button
                  onClick={handleLoadGlobalRadar}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold shadow-lg transition-all group"
                >
                  <Globe size={16} className="text-cyan-400 group-hover:rotate-45 transition-transform" />
                  <span>Load Global Threat Radar (5,000 Incidents)</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {loadingPoints && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-sm z-30">
            <div className="p-5 rounded-xl bg-slate-900/95 border border-slate-800 text-center shadow-2xl flex flex-col items-center gap-3">
              <CircleNotch size={32} className="text-cyan-400 animate-spin" />
              <span className="text-xs font-mono text-slate-200">{loadingStatus || "Processing geospatial intelligence..."}</span>
            </div>
          </div>
        )}

        {/* Error notification */}
        {errorMsg && (
          <div className="absolute top-4 left-4 right-4 bg-rose-950/90 border border-rose-500/50 text-rose-200 text-xs px-3 py-2 rounded-md shadow-xl flex items-center justify-between z-20">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Tactical Coordinates HUD at bottom-left */}
        {mouseCoords && (
          <div className="absolute bottom-3 left-3 bg-[#0B0F19]/85 border border-slate-800/80 px-2.5 py-1 rounded text-[10px] font-mono text-slate-400 pointer-events-none z-10 backdrop-blur-sm">
            <span>LAT: {mouseCoords.lat}°</span>
            <span className="mx-1.5 text-slate-600">|</span>
            <span>LNG: {mouseCoords.lng}°</span>
            <span className="mx-1.5 text-slate-600">|</span>
            <span>ZOOM: {mouseCoords.zoom}</span>
          </div>
        )}

        {/* Incident Detail Drawer Popup */}
        {selectedIncident && (
          <div className="absolute bottom-4 left-4 right-4 bg-[#0B0F19]/95 border border-slate-700/80 rounded-lg p-4 shadow-2xl backdrop-blur-md z-20 transition-all">
            <div className="flex items-start justify-between border-b border-slate-800 pb-2 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <MapPin size={14} className="text-amber-400" />
                  <span className="text-xs font-semibold text-slate-100">
                    {selectedIncident.city}, {selectedIncident.country}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                    ID #{selectedIncident.id}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {selectedIncident.attackType} against {selectedIncident.targetType}
                </div>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-slate-100 text-xs px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 text-xs font-mono">
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                <span className="text-slate-500 text-[10px] block">DATE</span>
                <span className="text-slate-200">{selectedIncident.date}</span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                <span className="text-slate-500 text-[10px] block">PERPETRATOR</span>
                <span className="text-amber-400 truncate block">{selectedIncident.group}</span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                <span className="text-slate-500 text-[10px] block">KILLED</span>
                <span className="text-rose-400 font-semibold">{selectedIncident.nkill}</span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                <span className="text-slate-500 text-[10px] block">WOUNDED</span>
                <span className="text-orange-400 font-semibold">{selectedIncident.nwound}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}