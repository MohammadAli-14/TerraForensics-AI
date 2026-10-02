import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  CaretDown,
  CaretUp,
  CaretLeft,
  CaretRight,
  MapPin,
  Database,
  Globe,
  DownloadSimple,
  Copy,
  Check,
  MagnifyingGlass,
  ArrowClockwise,
  ListBullets,
} from "@phosphor-icons/react";
import { v4 as uuidv4 } from "uuid";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { syncActiveGTDData } from "@/utils/chat";
import { setGTDMapData } from "@/utils/gtdStorage";

const GEO_POINTS_PAGE_SIZE = 50;
const LOAD_ALL_SERVER_PAGE_SIZE = 25000; // records per server round-trip when loading all
const LOAD_ALL_HARD_CAP = 200000; // respect backend safety cap

/**
 * GTDDataDisplay - Displays Global Terrorism Database query results in the chat
 * Shows a collapsible summary with stats, sample records, LLM parameters,
 * and a paginated JSON viewer that handles 177k+ records without freezing.
 *
 * Supports two modes:
 * 1. Live mode: gtdData contains full geo_points array (from streaming response)
 * 2. Historical mode: gtdData._storageOptimized === true, geo_points stripped, metadata only
 */
export default function GTDDataDisplay({ gtdData: gtdDataProp, llmOutput }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [payloadSection, setPayloadSection] = useState("metadata"); // "metadata" | "geo_points" | "all_meta"
  const [geoPage, setGeoPage] = useState(0);
  const [copySuccess, setCopySuccess] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isRefetching, setIsRefetching] = useState(false);
  const [refetchedData, setRefetchedData] = useState(null);
  const [refetchError, setRefetchError] = useState(null);

  // "Load All" state
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [loadAllProgress, setLoadAllProgress] = useState(0);
  const [loadAllStatus, setLoadAllStatus] = useState("");
  const [allPointsLoaded, setAllPointsLoaded] = useState(false);
  const loadAllAbortRef = useRef(null);

  // Use refetched data if available, otherwise use the original prop
  const gtdData = refetchedData || gtdDataProp;

  // Broadcast and cache active GTD query data to the synchronized Workstation Map Panel
  useEffect(() => {
    if (
      gtdData &&
      (gtdData.geo_points?.length > 0 ||
        gtdData.total_count > 0 ||
        gtdData.filter)
    ) {
      syncActiveGTDData(gtdData);
    }
  }, [gtdData]);

  // Determine if this is a storage-optimized (historical) record
  const isHistorical = gtdData?._storageOptimized === true;

  // Extract stats from gtdData
  const stats = useMemo(() => {
    if (!gtdData) return null;

    const geoPoints = gtdData.geo_points || gtdData.geo_samples || [];
    const geoPointCount = geoPoints.length || gtdData.geo_points_count || 0;
    const totalRecords =
      gtdData.total || gtdData.count || gtdData.total_count || geoPointCount;
    const recordsWithCoordinates =
      gtdData.records_with_coordinates || geoPointCount;
    const hasGeoData = geoPointCount > 0;

    // Calculate basic stats from geo_points (live mode) or use stored values (historical)
    let countryCount = 0;
    let yearRange = null;
    let totalKilled = gtdData.totalKilled || 0;
    let totalWounded = gtdData.totalWounded || 0;

    if (geoPoints.length > 0) {
      const countries = new Set();
      const years = new Set();
      let killed = 0;
      let wounded = 0;

      geoPoints.forEach((point) => {
        if (point.country_txt) countries.add(point.country_txt);
        if (point.iyear) years.add(String(point.iyear));
        if (point.nkill) killed += parseInt(point.nkill, 10) || 0;
        if (point.nwound) wounded += parseInt(point.nwound, 10) || 0;
      });

      countryCount = countries.size;
      yearRange =
        years.size > 0
          ? {
              min: Math.min(...Array.from(years).map((y) => parseInt(y, 10))),
              max: Math.max(...Array.from(years).map((y) => parseInt(y, 10))),
            }
          : null;
      if (killed > 0) totalKilled = killed;
      if (wounded > 0) totalWounded = wounded;
    } else if (gtdData.year_range) {
      yearRange = {
        min: gtdData.year_range.start,
        max: gtdData.year_range.end,
      };
    }

    return {
      geoPointCount,
      totalRecords,
      recordsWithCoordinates,
      hasGeoData,
      countryCount,
      yearRange,
      totalKilled,
      totalWounded,
      samplePoints:
        geoPoints.length > 0
          ? geoPoints.slice(0, 10)
          : gtdData.geo_points_sample || [],
      allPoints: geoPoints,
    };
  }, [gtdData]);

  const canOpenMap = Boolean(
    stats?.hasGeoData ||
    gtdData?.filter ||
    gtdData?.originalFilter ||
    gtdData?.simpleFilter
  );

  // Filtered geo_points for search
  const filteredPoints = useMemo(() => {
    if (!stats?.allPoints?.length || !searchTerm) return stats?.allPoints || [];
    const lower = searchTerm.toLowerCase();
    return stats.allPoints.filter(
      (point) =>
        (point.country_txt &&
          point.country_txt.toLowerCase().includes(lower)) ||
        (point.city && point.city.toLowerCase().includes(lower)) ||
        (point.eventid && String(point.eventid).includes(lower)) ||
        (point.iyear && String(point.iyear).includes(lower)) ||
        (point.attacktype1_txt &&
          point.attacktype1_txt.toLowerCase().includes(lower)) ||
        (point.gname && point.gname.toLowerCase().includes(lower))
    );
  }, [stats?.allPoints, searchTerm]);

  // Pagination calculations
  const totalGeoPages = Math.ceil(
    (filteredPoints?.length || 0) / GEO_POINTS_PAGE_SIZE
  );
  const paginatedPoints = useMemo(() => {
    if (!filteredPoints?.length) return [];
    const start = geoPage * GEO_POINTS_PAGE_SIZE;
    return filteredPoints.slice(start, start + GEO_POINTS_PAGE_SIZE);
  }, [filteredPoints, geoPage]);

  // Build metadata object (everything except geo_points, clusters, segments, geojson)
  const metadataPayload = useMemo(() => {
    if (!gtdData) return {};
    const meta = {};
    for (const [key, value] of Object.entries(gtdData)) {
      if (
        [
          "geo_points",
          "clusters",
          "segments",
          "geojson",
          "geo_samples",
        ].includes(key)
      )
        continue;
      meta[key] = value;
    }
    if (llmOutput) meta.llmOutput = llmOutput;
    return meta;
  }, [gtdData, llmOutput]);

  // Download full JSON as file
  const handleDownload = useCallback(() => {
    try {
      const dataStr = JSON.stringify(gtdData, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gtd-data-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
    }
  }, [gtdData]);

  const handleOpenMap = useCallback(() => {
    try {
      const slug = window.location.pathname
        .split("/workspace/")[1]
        ?.split("/")[0];
      if (!slug) return;

      const MAX_LOCALSTORAGE_POINTS = 5000;
      const allPoints = gtdData?.geo_points || null;
      const shouldStorePoints =
        Array.isArray(allPoints) && allPoints.length <= MAX_LOCALSTORAGE_POINTS;

      const payload = {
        geo_points: shouldStorePoints ? allPoints : null,
        geo_points_count:
          gtdData?.geo_points_count || gtdData?.geo_points?.length || 0,
        total_count:
          gtdData?.total_count || gtdData?.total || gtdData?.count || 0,
        total_killed:
          gtdData?.totalKilled ||
          stats?.totalKilled ||
          gtdData?.statistics?.total_killed ||
          0,
        total_wounded:
          gtdData?.totalWounded ||
          stats?.totalWounded ||
          gtdData?.statistics?.total_wounded ||
          0,
        year_range: gtdData?.year_range || null,
        filter: gtdData?.filter || gtdData?.originalFilter || null,
        simpleFilter: gtdData?.simpleFilter || null,
        geo_points_sample: gtdData?.geo_points_sample || null,
        geo_points_limited: gtdData?.geo_points_limited || !shouldStorePoints,
        geo_points_max: gtdData?.geo_points_max || MAX_LOCALSTORAGE_POINTS,
        bbox: gtdData?.bbox || null,
        created_at: Date.now(),
        query: gtdData?.query || null,
        // If all points were loaded in the card, hint the map to load all too
        load_all_hint: allPointsLoaded,
      };

      const mapKey = uuidv4();

      // 1. Store full dataset in IndexedDB (immune to 5MB localStorage quotas, enables full 180k+ transfer)
      if (Array.isArray(allPoints) && allPoints.length > 0) {
        setGTDMapData(`gtd-map:${mapKey}`, {
          ...payload,
          geo_points: allPoints,
        });
        if (slug) {
          setGTDMapData(`tf:latest-gtd-data:${slug}`, {
            ...payload,
            geo_points: allPoints,
          });
        }
      }

      // 2. Also keep lightweight metadata in localStorage as backup pointer
      try {
        localStorage.setItem(`gtd-map:${mapKey}`, JSON.stringify(payload));
      } catch (storageErr) {
        console.warn("[GTDDataDisplay] localStorage quota exceeded for metadata:", storageErr);
      }

      window.open(
        `/workspace/${slug}/gtd-map?key=${mapKey}`,
        "_blank",
        "noopener"
      );
    } catch (e) {
      console.error("Open map failed:", e);
    }
  }, [gtdData, allPointsLoaded, stats]);

  // Open the synchronized right-pane TerraForensics Geospatial Canvas
  const handleOpenCanvas = useCallback(() => {
    if (!gtdData) return;
    syncActiveGTDData(gtdData);
    window.dispatchEvent(new CustomEvent("tf:open-map"));

    // Staggered retries to guarantee delivery during React component mount cycle
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("aegis:active-gtd-data", { detail: gtdData })
      );
    }, 100);
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("aegis:active-gtd-data", { detail: gtdData })
      );
    }, 300);
  }, [gtdData]);

  // Copy current view to clipboard
  const handleCopy = useCallback(async (data) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }, []);

  // Re-fetch geo_points for historical chats
  const handleRefetch = useCallback(async () => {
    const sourceData = gtdDataProp;
    if (
      !sourceData?.filter &&
      !sourceData?.originalFilter &&
      !sourceData?.simpleFilter
    ) {
      setRefetchError("No filter found in stored data to re-fetch");
      return;
    }
    setIsRefetching(true);
    setRefetchError(null);
    try {
      const filter =
        sourceData.filter ||
        sourceData.originalFilter ||
        sourceData.simpleFilter ||
        {};
      const slug = window.location.pathname
        .split("/workspace/")[1]
        ?.split("/")[0];
      if (!slug) {
        setRefetchError("Could not determine workspace slug from URL");
        return;
      }

      const res = await fetch(`${API_BASE}/workspace/${slug}/gtd-refetch`, {
        method: "POST",
        headers: {
          ...baseHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mongo_filter: filter,
          limit: sourceData.total_count || 20000,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setRefetchError(
            "Your login session has expired. Please log out and log back in to refresh your credentials."
          );
          return;
        }
        const errText = await res.text().catch(() => res.statusText);
        setRefetchError(`Server error ${res.status}: ${errText}`);
        return;
      }

      const result = await res.json();
      if (result.success && result.geo_points?.length > 0) {
        // Create a new merged object so React detects state change and re-renders
        const updated = {
          ...sourceData,
          geo_points: result.geo_points,
          _storageOptimized: false,
          geo_points_count: result.geo_points.length,
          total_count: result.total_count || sourceData.total_count,
        };
        setRefetchedData(updated);
        syncActiveGTDData(updated);
        setGeoPage(0);
        // If all points were fetched in this single request, mark as all loaded
        if (!result.has_more) setAllPointsLoaded(true);
      } else if (result.geo_points?.length === 0) {
        setRefetchError(
          "Re-fetch returned 0 geo points — filter may have matched no records with coordinates"
        );
      } else {
        setRefetchError(result.error || "Unknown error during re-fetch");
      }
    } catch (e) {
      console.error("Re-fetch failed:", e);
      setRefetchError(`Network error: ${e.message}`);
    } finally {
      setIsRefetching(false);
    }
  }, [gtdDataProp]);

  // Load ALL available geo points using deterministic paginated refetch from skip=0
  const handleLoadAll = useCallback(async () => {
    const sourceData = gtdDataProp || gtdData;
    const filter =
      sourceData?.filter ||
      sourceData?.originalFilter ||
      sourceData?.simpleFilter;
    if (!filter) {
      setRefetchError("No filter available — cannot load all geo points");
      return;
    }

    const slug = window.location.pathname
      .split("/workspace/")[1]
      ?.split("/")[0];
    if (!slug) {
      setRefetchError("Could not determine workspace slug from URL");
      return;
    }

    // Abort any prior load-all in flight
    if (loadAllAbortRef.current) loadAllAbortRef.current.abort();
    const abortController = new AbortController();
    loadAllAbortRef.current = abortController;

    setIsLoadingAll(true);
    setLoadAllProgress(0);
    setLoadAllStatus("Starting deterministic fetch...");
    setRefetchError(null);

    try {
      let allPoints = [];
      let currentSkip = 0;
      let hasMore = true;
      let totalCount =
        sourceData?.total_count || sourceData?.total || sourceData?.count || 0;

      while (hasMore && currentSkip < LOAD_ALL_HARD_CAP) {
        if (abortController.signal.aborted) return;

        const res = await fetch(`${API_BASE}/workspace/${slug}/gtd-refetch`, {
          method: "POST",
          headers: { ...baseHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            mongo_filter: filter,
            limit: LOAD_ALL_HARD_CAP,
            skip: currentSkip,
            page_size: LOAD_ALL_SERVER_PAGE_SIZE,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error(
              "Your login session has expired. Please log out and log back in to refresh your credentials."
            );
          }
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Server error ${res.status}: ${errText}`);
        }

        const result = await res.json();
        if (!result.success)
          throw new Error(result.error || "Failed to fetch records");

        const pagePoints = result.geo_points || [];
        for (let i = 0; i < pagePoints.length; i++)
          allPoints.push(pagePoints[i]);

        totalCount = result.total_count || totalCount;
        hasMore = result.has_more === true;
        currentSkip = result.next_skip || currentSkip + pagePoints.length;

        // Update progress
        const pct =
          totalCount > 0
            ? Math.min(95, Math.floor((allPoints.length / totalCount) * 100))
            : Math.min(
                95,
                Math.floor((allPoints.length / LOAD_ALL_HARD_CAP) * 100)
              );
        setLoadAllProgress(pct);
        setLoadAllStatus(
          `Fetched ${allPoints.length.toLocaleString()} of ${totalCount.toLocaleString()} records...`
        );

        // Safety: prevent infinite loop if server returns 0 results
        if (pagePoints.length === 0) break;
      }

      if (abortController.signal.aborted) return;

      // Update component data with all fetched points
      const allLoadedData = {
        ...sourceData,
        geo_points: allPoints,
        _storageOptimized: false,
        geo_points_count: allPoints.length,
        total_count: totalCount,
      };
      setRefetchedData(allLoadedData);
      syncActiveGTDData(allLoadedData);
      setGeoPage(0);
      setAllPointsLoaded(true);
      setLoadAllProgress(100);
      setLoadAllStatus(
        `All ${allPoints.length.toLocaleString()} geo points loaded`
      );
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Load All failed:", err);
      setRefetchError(`Load All failed: ${err.message}`);
    } finally {
      setIsLoadingAll(false);
    }
  }, [gtdDataProp, gtdData]);

  // Cancel load-all on unmount
  const handleCancelLoadAll = useCallback(() => {
    if (loadAllAbortRef.current) {
      loadAllAbortRef.current.abort();
      loadAllAbortRef.current = null;
    }
    setIsLoadingAll(false);
    setLoadAllProgress(0);
    setLoadAllStatus("");
  }, []);

  if (!gtdData || !stats) return null;

  return (
    <div className="mt-4 border border-theme-sidebar-border rounded-lg overflow-hidden">
      {/* Header - Always visible */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-theme-bg-secondary cursor-pointer hover:bg-theme-bg-container transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-theme-text-primary">
            GTD Query Results
          </span>
          <span className="text-sm text-theme-text-secondary">
            {(() => {
              const totalAvailable =
                gtdData?.total_count || gtdData?.total || gtdData?.count || 0;
              if (allPointsLoaded && stats.geoPointCount > 0) {
                return `${stats.geoPointCount.toLocaleString()} geo points (all loaded)`;
              } else if (
                stats.geoPointCount > 0 &&
                totalAvailable > stats.geoPointCount
              ) {
                return `${stats.geoPointCount.toLocaleString()} of ${totalAvailable.toLocaleString()} geo points`;
              } else if (stats.geoPointCount > 0) {
                return `${stats.geoPointCount.toLocaleString()} geo points`;
              } else {
                return `${stats.totalRecords.toLocaleString()} total records`;
              }
            })()}
            {isHistorical && !allPointsLoaded && (
              <span className="ml-1 text-yellow-500">(historical)</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {gtdData?.grounding_telemetry && (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {gtdData.grounding_telemetry.verificationPill} (
              {Math.round(gtdData.grounding_telemetry.confidence * 100)}%)
            </span>
          )}
          {allPointsLoaded && (
            <span className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded">
              <Check className="w-3 h-3" />
              All Geo Points Loaded
            </span>
          )}
          {stats.hasGeoData && !isHistorical && !allPointsLoaded && (
            <span className="flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded">
              <MapPin className="w-3 h-3" />
              Geo Data Available
            </span>
          )}
          {isHistorical && !allPointsLoaded && (
            <span className="flex items-center gap-1 text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">
              Metadata Only
            </span>
          )}
          {isExpanded ? (
            <CaretUp className="w-5 h-5 text-theme-text-secondary" />
          ) : (
            <CaretDown className="w-5 h-5 text-theme-text-secondary" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 py-3 bg-theme-bg-primary border-t border-theme-sidebar-border">
          {/* Historical mode banner */}
          {isHistorical && (
            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center justify-between">
              <div className="text-sm text-yellow-500">
                <span className="font-semibold">Historical record</span> —{" "}
                {(gtdData.geo_points_count || 0).toLocaleString()} geo points
                were generated for this query but not stored in chat history.
              </div>
              {(gtdData.filter ||
                gtdData.originalFilter ||
                gtdData.simpleFilter) && (
                <button
                  onClick={handleRefetch}
                  disabled={isRefetching}
                  className="flex items-center gap-1 text-xs text-yellow-500 hover:text-yellow-400 bg-yellow-500/20 px-3 py-1.5 rounded font-medium"
                >
                  <ArrowClockwise
                    className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`}
                  />
                  {isRefetching ? "Re-fetching..." : "Re-fetch Data"}
                </button>
              )}
            </div>
          )}
          {/* Re-fetch error message */}
          {refetchError && (
            <div className="mb-4 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
              <span className="font-semibold">Re-fetch error:</span>{" "}
              {refetchError}
            </div>
          )}

          {/* Load All Geo Points action bar */}
          {(() => {
            const totalAvailable =
              gtdData?.total_count || gtdData?.total || gtdData?.count || 0;
            const currentLoaded = stats.geoPointCount;
            const hasFilter = Boolean(
              gtdData?.filter ||
              gtdData?.originalFilter ||
              gtdData?.simpleFilter
            );
            const canLoadAll =
              hasFilter &&
              !allPointsLoaded &&
              !isLoadingAll &&
              totalAvailable > 0;
            const showLoadAllBar =
              canLoadAll || isLoadingAll || allPointsLoaded;

            return showLoadAllBar ? (
              <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <ListBullets className="w-4 h-4 text-blue-400" />
                    {allPointsLoaded ? (
                      <span className="text-green-400 font-medium">
                        All {currentLoaded.toLocaleString()} geo points loaded
                      </span>
                    ) : isLoadingAll ? (
                      <span className="text-blue-400">{loadAllStatus}</span>
                    ) : (
                      <span className="text-theme-text-secondary">
                        Showing {currentLoaded.toLocaleString()} of{" "}
                        {totalAvailable.toLocaleString()} available geo points
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isLoadingAll && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelLoadAll();
                        }}
                        className="text-xs text-red-400 hover:text-red-300 bg-red-500/20 px-2 py-1 rounded font-medium"
                      >
                        Cancel
                      </button>
                    )}
                    {canLoadAll && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadAll();
                        }}
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/20 px-3 py-1.5 rounded font-medium"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        Load All {totalAvailable.toLocaleString()} Geo Points
                      </button>
                    )}
                  </div>
                </div>
                {isLoadingAll && (
                  <div className="mt-2">
                    <div className="w-full h-2 bg-theme-bg-secondary rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${loadAllProgress}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-theme-text-secondary text-right">
                      {loadAllProgress}% complete
                    </div>
                  </div>
                )}
              </div>
            ) : null;
          })()}

          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <StatCard
              label="Countries"
              value={stats.countryCount || "—"}
              icon={<Globe className="w-4 h-4" />}
            />
            <StatCard
              label="Year Range"
              value={
                stats.yearRange
                  ? `${stats.yearRange.min}-${stats.yearRange.max}`
                  : "N/A"
              }
            />
            <StatCard
              label="Total Killed"
              value={stats.totalKilled.toLocaleString()}
              className="text-red-500"
            />
            <StatCard
              label="Total Wounded"
              value={stats.totalWounded.toLocaleString()}
              className="text-orange-500"
            />
          </div>

          {/* Sample Data Table */}
          {stats.samplePoints.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-theme-text-primary mb-2">
                Sample Records (first {stats.samplePoints.length} of{" "}
                {stats.geoPointCount.toLocaleString()})
              </h4>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-theme-bg-secondary sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left text-theme-text-secondary">
                        Event ID
                      </th>
                      <th className="px-2 py-1 text-left text-theme-text-secondary">
                        Year
                      </th>
                      <th className="px-2 py-1 text-left text-theme-text-secondary">
                        Country
                      </th>
                      <th className="px-2 py-1 text-left text-theme-text-secondary">
                        City
                      </th>
                      <th className="px-2 py-1 text-left text-theme-text-secondary">
                        Latitude
                      </th>
                      <th className="px-2 py-1 text-left text-theme-text-secondary">
                        Longitude
                      </th>
                      <th className="px-2 py-1 text-left text-theme-text-secondary">
                        Attack Type
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.samplePoints.map((point, idx) => (
                      <tr
                        key={point.eventid || idx}
                        className="border-b border-theme-sidebar-border"
                      >
                        <td className="px-2 py-1 text-theme-text-primary font-mono">
                          {point.eventid}
                        </td>
                        <td className="px-2 py-1 text-theme-text-primary">
                          {point.iyear}
                        </td>
                        <td className="px-2 py-1 text-theme-text-primary">
                          {point.country_txt}
                        </td>
                        <td className="px-2 py-1 text-theme-text-primary">
                          {point.city || "-"}
                        </td>
                        <td className="px-2 py-1 text-theme-text-primary font-mono">
                          {point.latitude?.toFixed(4) ||
                            point.lat?.toFixed(4) ||
                            "-"}
                        </td>
                        <td className="px-2 py-1 text-theme-text-primary font-mono">
                          {point.longitude?.toFixed(4) ||
                            point.lon?.toFixed(4) ||
                            "-"}
                        </td>
                        <td className="px-2 py-1 text-theme-text-primary">
                          {point.attacktype1_txt || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* LLM Output (mongo_filter and query_type) */}
          {llmOutput && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-theme-text-primary mb-2">
                LLM Query Parameters
              </h4>
              <div className="bg-theme-bg-secondary rounded p-3 text-xs font-mono overflow-x-auto">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <span className="text-theme-text-secondary">
                      Query Type:{" "}
                    </span>
                    <span className="text-blue-400">
                      {llmOutput.query_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-theme-text-secondary">
                      Confidence:{" "}
                    </span>
                    <span className="text-green-400">
                      {((llmOutput.confidence || 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-theme-text-secondary">
                      Needs Geo:{" "}
                    </span>
                    <span
                      className={
                        llmOutput.needs_geo_data
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    >
                      {llmOutput.needs_geo_data ? "Yes" : "No"}
                    </span>
                  </div>
                  <div>
                    <span className="text-theme-text-secondary">
                      Execute on Server:{" "}
                    </span>
                    <span
                      className={
                        llmOutput.execute_on_server
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    >
                      {llmOutput.execute_on_server ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
                {llmOutput.mongo_filter && (
                  <div className="mt-2 pt-2 border-t border-theme-sidebar-border">
                    <span className="text-theme-text-secondary block mb-1">
                      MongoDB Filter:
                    </span>
                    <pre className="text-yellow-400 whitespace-pre-wrap break-all">
                      {JSON.stringify(llmOutput.mongo_filter, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* JSON Payload Viewer */}
          <div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowPayload(!showPayload)}
                className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
              >
                {showPayload ? (
                  <CaretUp className="w-3 h-3" />
                ) : (
                  <CaretDown className="w-3 h-3" />
                )}
                {showPayload ? "Hide" : "Show"} JSON Payload
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    handleCopy(
                      payloadSection === "geo_points"
                        ? paginatedPoints
                        : metadataPayload
                    )
                  }
                  className="text-xs text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1"
                  title="Copy current view to clipboard"
                >
                  {copySuccess ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copySuccess ? "Copied!" : "Copy"}
                </button>
                {canOpenMap && (
                  <>
                    <button
                      onClick={handleOpenCanvas}
                      className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/60 px-2 py-0.5 rounded flex items-center gap-1 transition-all"
                      title="Open in synchronized Geospatial Canvas right pane"
                    >
                      <Globe className="w-3 h-3 text-cyan-400" />
                      Geospatial Canvas
                    </button>
                    <button
                      onClick={handleOpenMap}
                      className="text-xs text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1"
                      title="Open full-screen map in new browser tab"
                    >
                      <MapPin className="w-3 h-3" />
                      Full Map
                    </button>
                  </>
                )}
                {stats.allPoints.length > 0 && (
                  <button
                    onClick={handleDownload}
                    className="text-xs text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1"
                    title="Download full JSON as file"
                  >
                    <DownloadSimple className="w-3 h-3" />
                    Download Full JSON
                  </button>
                )}
              </div>
            </div>

            {showPayload && (
              <div className="mt-2">
                {/* Section Tabs */}
                <div className="flex gap-1 mb-2">
                  <TabButton
                    active={payloadSection === "metadata"}
                    onClick={() => setPayloadSection("metadata")}
                    label="Metadata"
                  />
                  {stats.allPoints.length > 0 && (
                    <TabButton
                      active={payloadSection === "geo_points"}
                      onClick={() => {
                        setPayloadSection("geo_points");
                        setGeoPage(0);
                      }}
                      label={`Geo Points (${stats.geoPointCount.toLocaleString()})`}
                    />
                  )}
                </div>

                {/* Metadata Section */}
                {payloadSection === "metadata" && (
                  <div className="bg-theme-bg-secondary rounded p-3 text-xs font-mono max-h-[500px] overflow-y-auto overflow-x-auto">
                    <pre className="text-theme-text-primary whitespace-pre-wrap break-all">
                      {JSON.stringify(metadataPayload, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Paginated Geo Points Section */}
                {payloadSection === "geo_points" &&
                  stats.allPoints.length > 0 && (
                    <div>
                      {/* Search + Pagination Controls */}
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <div className="flex items-center gap-1 bg-theme-bg-secondary rounded px-2 py-1 flex-1 max-w-xs">
                          <MagnifyingGlass className="w-3 h-3 text-theme-text-secondary" />
                          <input
                            type="text"
                            placeholder="Search country, city, year..."
                            value={searchTerm}
                            onChange={(e) => {
                              setSearchTerm(e.target.value);
                              setGeoPage(0);
                            }}
                            className="bg-transparent text-xs text-theme-text-primary outline-none w-full placeholder-theme-text-secondary"
                          />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-theme-text-secondary">
                          {/* Load All mini-button in pagination row */}
                          {(() => {
                            const totalAvailable =
                              gtdData?.total_count ||
                              gtdData?.total ||
                              gtdData?.count ||
                              0;
                            const hasFilterForAll = Boolean(
                              gtdData?.filter ||
                              gtdData?.originalFilter ||
                              gtdData?.simpleFilter
                            );
                            const canLoadMore =
                              hasFilterForAll &&
                              !allPointsLoaded &&
                              !isLoadingAll &&
                              totalAvailable > stats.geoPointCount;
                            return canLoadMore ? (
                              <button
                                onClick={handleLoadAll}
                                className="text-[11px] text-blue-400 hover:text-blue-300 bg-blue-500/15 px-2 py-0.5 rounded font-medium"
                                title={`Load all ${totalAvailable.toLocaleString()} geo points from server`}
                              >
                                Load All ({totalAvailable.toLocaleString()})
                              </button>
                            ) : allPointsLoaded ? (
                              <span className="text-[11px] text-green-400">
                                ✓ All loaded
                              </span>
                            ) : null;
                          })()}
                          {searchTerm && (
                            <span className="text-blue-400">
                              {filteredPoints.length.toLocaleString()} matches
                            </span>
                          )}
                          <button
                            onClick={() => setGeoPage(Math.max(0, geoPage - 1))}
                            disabled={geoPage === 0}
                            className="p-1 hover:text-theme-text-primary disabled:opacity-30"
                          >
                            <CaretLeft className="w-4 h-4" />
                          </button>
                          <span className="text-theme-text-primary font-medium min-w-[100px] text-center">
                            Page {geoPage + 1} of {totalGeoPages || 1}
                          </span>
                          <button
                            onClick={() =>
                              setGeoPage(
                                Math.min(totalGeoPages - 1, geoPage + 1)
                              )
                            }
                            disabled={geoPage >= totalGeoPages - 1}
                            className="p-1 hover:text-theme-text-primary disabled:opacity-30"
                          >
                            <CaretRight className="w-4 h-4" />
                          </button>
                          {/* Jump to page */}
                          <input
                            type="number"
                            min={1}
                            max={totalGeoPages}
                            placeholder="Go to"
                            className="bg-theme-bg-secondary text-xs text-theme-text-primary rounded px-2 py-1 w-16 outline-none border border-theme-sidebar-border"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const page = parseInt(e.target.value, 10);
                                if (page >= 1 && page <= totalGeoPages) {
                                  setGeoPage(page - 1);
                                  e.target.value = "";
                                }
                              }
                            }}
                          />
                        </div>
                      </div>

                      {/* JSON content for current page */}
                      <div className="bg-theme-bg-secondary rounded p-3 text-xs font-mono max-h-[500px] overflow-y-auto overflow-x-auto">
                        <div className="text-theme-text-secondary mb-1">
                          // Showing records{" "}
                          {geoPage * GEO_POINTS_PAGE_SIZE + 1}–
                          {Math.min(
                            (geoPage + 1) * GEO_POINTS_PAGE_SIZE,
                            filteredPoints.length
                          )}{" "}
                          of {filteredPoints.length.toLocaleString()}
                        </div>
                        <pre className="text-theme-text-primary whitespace-pre-wrap break-all">
                          {JSON.stringify(paginatedPoints, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tab button for switching payload sections
 */
function TabButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
        active
          ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
          : "bg-theme-bg-secondary text-theme-text-secondary hover:text-theme-text-primary border border-transparent"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Small stat card component for the stats grid
 */
function StatCard({ label, value, icon, className = "" }) {
  return (
    <div className="bg-theme-bg-secondary rounded px-3 py-2">
      <div className="flex items-center gap-1 text-theme-text-secondary text-xs mb-1">
        {icon}
        {label}
      </div>
      <div
        className={`text-lg font-semibold text-theme-text-primary ${className}`}
      >
        {value}
      </div>
    </div>
  );
}
