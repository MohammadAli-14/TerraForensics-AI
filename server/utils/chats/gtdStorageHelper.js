/**
 * GTD Storage Helper
 *
 * Provides utilities to strip large geo_points/clusters/geojson/segments data
 * from GTD responses before saving to SQLite, keeping only lightweight metadata.
 *
 * The full geo_points are still sent to the frontend via SSE streaming and API responses.
 * Only the SQLite persistence is trimmed to prevent:
 * 1. Prisma NAPI "Failed to convert rust String into napi string" errors
 * 2. SQLite bloat from 100MB+ response strings
 * 3. Slow chat history loading
 *
 * Historical chats can re-fetch geo_points on demand via the /workspace/:slug/gtd-refetch endpoint.
 */

/**
 * Creates a lightweight copy of gtdData suitable for SQLite storage.
 * Strips geo_points, clusters, geojson, and segments arrays — replaces them with counts.
 * Preserves all metadata needed to display stats and re-fetch data.
 *
 * @param {Object|null} gtdData - The full GTD formatted data object
 * @returns {Object|null} - Lightweight copy for storage, or null if input is null
 */
function stripGeoPointsForStorage(gtdData) {
  if (!gtdData) return null;

  // Create a shallow copy to avoid mutating the original
  const storageData = { ...gtdData };

  // Replace geo_points array with just the count
  if (Array.isArray(storageData.geo_points)) {
    storageData.geo_points_count = storageData.geo_points.length;
    // Keep first 5 as samples for the historical view
    storageData.geo_points_sample = storageData.geo_points.slice(0, 5);
    delete storageData.geo_points;
  } else {
    storageData.geo_points_count = storageData.geo_points_count || 0;
  }

  // Replace clusters array with count
  if (Array.isArray(storageData.clusters)) {
    storageData.clusters_count = storageData.clusters.length;
    delete storageData.clusters;
  }

  // Replace geojson features with count
  if (storageData.geojson && Array.isArray(storageData.geojson.features)) {
    storageData.geojson_features_count = storageData.geojson.features.length;
    delete storageData.geojson;
  }

  // Replace segments with count
  if (Array.isArray(storageData.segments)) {
    storageData.segments_count = storageData.segments.length;
    delete storageData.segments;
  }

  // Mark this as a storage-optimized record so the frontend knows
  // geo_points need to be re-fetched if visualization is needed
  storageData._storageOptimized = true;

  return storageData;
}

module.exports = { stripGeoPointsForStorage };
