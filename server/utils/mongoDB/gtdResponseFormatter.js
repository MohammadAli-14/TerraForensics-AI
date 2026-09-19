/**
 * GTD Response Formatter
 * Converts raw MongoDB attack records into the standardized heatmap JSON schema
 * as specified in the system prompt.
 */

class GTDResponseFormatter {
  constructor() {
    this.maxReturned = 200000; // Default max points per response (increased for worldwide queries)
  }

  /**
   * Calculate weight for a geo_point based on casualties
   * Formula: weight = min(1.0, (nkill * 2 + nwound) / 10)
   * If nkill/nwound missing: 0.5 for confirmed attack, 0.1 for unknown
   */
  calculateWeight(attack) {
    const nkill = parseInt(attack.nkill) || 0;
    const nwound = parseInt(attack.nwound) || 0;

    if (nkill === 0 && nwound === 0) {
      // Check if it's a confirmed attack
      return attack.success === "1" || attack.success === 1 ? 0.5 : 0.1;
    }

    return Math.min(1.0, (nkill * 2 + nwound) / 10);
  }

  /**
   * Determine location precision based on available data
   */
  getLocationPrecision(attack) {
    const lat = parseFloat(attack.latitude);
    const lon = parseFloat(attack.longitude);

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      return "unknown";
    }

    // Check if coordinates are city-level precision (not rounded to whole numbers)
    if (lat % 1 !== 0 && lon % 1 !== 0) {
      return "exact";
    }

    return "approximate";
  }

  /**
   * Convert a single attack record to a geo_point object
   */
  attackToGeoPoint(attack) {
    const lat = parseFloat(attack.latitude);
    const lon = parseFloat(attack.longitude);

    // Skip if no valid coordinates
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      return null;
    }

    const geoPoint = {
      eventid: `GTD_doc_${attack.eventid}`,
      lat: lat,
      lon: lon,
      weight: this.calculateWeight(attack),
      iyear: parseInt(attack.iyear) || null,
      country_txt: attack.country_txt || "",
      region_txt: attack.region_txt || "",
      city: attack.city || "",
      attacktype1_txt: attack.attacktype1_txt || "",
      weaptype1_txt: attack.weaptype1_txt || "",
      location_precision: this.getLocationPrecision(attack),
    };

    // Add optional fields only if they have values
    if (attack.imonth && attack.imonth !== "0") {
      geoPoint.imonth = parseInt(attack.imonth);
    }
    if (attack.iday && attack.iday !== "0") {
      geoPoint.iday = parseInt(attack.iday);
    }

    const nkill = parseInt(attack.nkill);
    const nwound = parseInt(attack.nwound);
    if (!isNaN(nkill) && nkill > 0) {
      geoPoint.nkill = nkill;
    }
    if (!isNaN(nwound) && nwound > 0) {
      geoPoint.nwound = nwound;
    }

    return geoPoint;
  }

  /**
   * Calculate bounding box from geo_points
   */
  calculateBBox(geoPoints) {
    if (!geoPoints || geoPoints.length === 0) {
      return null;
    }

    let minLat = Infinity,
      maxLat = -Infinity;
    let minLon = Infinity,
      maxLon = -Infinity;

    for (const point of geoPoints) {
      if (point.lat < minLat) minLat = point.lat;
      if (point.lat > maxLat) maxLat = point.lat;
      if (point.lon < minLon) minLon = point.lon;
      if (point.lon > maxLon) maxLon = point.lon;
    }

    return {
      min_lat: minLat,
      min_lon: minLon,
      max_lat: maxLat,
      max_lon: maxLon,
    };
  }

  /**
   * Generate segments for the response
   */
  generateSegments(geoPoints, queryInfo) {
    const segments = [];
    let segmentId = 1;

    // Segment 1: Aggregated count
    segments.push({
      id: segmentId++,
      text: `Total attacks: ${queryInfo.totalCount}`,
      score: 1.0,
      meta: {
        aggregated_range: "1970-2017",
        country_txt: queryInfo.country || "Multiple",
        count: queryInfo.totalCount,
      },
    });

    // Group by city for hotspot segments
    const cityGroups = {};
    for (const point of geoPoints) {
      const city = point.city || "Unknown";
      if (!cityGroups[city]) {
        cityGroups[city] = {
          count: 0,
          points: [],
          totalWeight: 0,
        };
      }
      cityGroups[city].count++;
      cityGroups[city].points.push(point);
      cityGroups[city].totalWeight += point.weight;
    }

    // Sort cities by count and take top 3
    const topCities = Object.entries(cityGroups)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3);

    for (const [city, data] of topCities) {
      const cityPoints = data.points;
      const avgLat =
        cityPoints.reduce((sum, p) => sum + p.lat, 0) / cityPoints.length;
      const avgLon =
        cityPoints.reduce((sum, p) => sum + p.lon, 0) / cityPoints.length;

      segments.push({
        id: segmentId++,
        text: `${city}: ${data.count} attacks`,
        score: data.count / queryInfo.totalCount,
        meta: {
          city: city,
          count: data.count,
          centroid: { lat: avgLat, lon: avgLon },
          representative_eventid: cityPoints[0]?.eventid,
        },
      });
    }

    return segments;
  }

  /**
   * Generate clusters from geo_points
   */
  generateClusters(geoPoints, numClusters = 5) {
    if (!geoPoints || geoPoints.length === 0) {
      return [];
    }

    // Group by city for basic clustering
    const cityGroups = {};
    for (const point of geoPoints) {
      const city = point.city || "Unknown";
      if (!cityGroups[city]) {
        cityGroups[city] = [];
      }
      cityGroups[city].push(point);
    }

    // Convert to cluster objects
    const clusters = [];
    let clusterId = 1;

    const sortedCities = Object.entries(cityGroups)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, numClusters);

    for (const [city, points] of sortedCities) {
      const lats = points.map((p) => p.lat);
      const lons = points.map((p) => p.lon);
      const years = points.map((p) => p.iyear).filter((y) => y);

      const centroidLat = lats.reduce((a, b) => a + b, 0) / lats.length;
      const centroidLon = lons.reduce((a, b) => a + b, 0) / lons.length;

      clusters.push({
        cluster_id: clusterId++,
        centroid: { lat: centroidLat, lon: centroidLon },
        bbox: {
          min_lat: Math.min(...lats),
          min_lon: Math.min(...lons),
          max_lat: Math.max(...lats),
          max_lon: Math.max(...lons),
        },
        count: points.length,
        intensity: points.length / geoPoints.length,
        iyear_range:
          years.length > 0
            ? {
                from: Math.min(...years),
                to: Math.max(...years),
              }
            : undefined,
      });
    }

    return clusters;
  }

  /**
   * Generate GeoJSON FeatureCollection from geo_points
   */
  generateGeoJSON(geoPoints) {
    const features = geoPoints.map((point) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.lon, point.lat], // GeoJSON uses [lon, lat] order
      },
      properties: {
        eventid: point.eventid,
        weight: point.weight,
        iyear: point.iyear,
        city: point.city,
        country_txt: point.country_txt,
        attacktype1_txt: point.attacktype1_txt,
        nkill: point.nkill,
        nwound: point.nwound,
      },
    }));

    return {
      type: "FeatureCollection",
      features: features,
    };
  }

  /**
   * Main formatter function - converts query results to full heatmap JSON schema
   * @param {Object} queryResult - Result from attackService.executeFilter
   * @param {string} humanReadableAnswer - The text answer to include
   * @param {Object} options - Additional options (country, query, etc.)
   */
  formatResponse(queryResult, humanReadableAnswer, options = {}) {
    const {
      country = null,
      query = "",
      includeGeoJSON = true,
      includeClusters = true,
      maxReturned = this.maxReturned,
    } = options;

    // Convert attacks to geo_points (filter out those without valid coordinates)
    const geoPoints = [];
    for (const attack of queryResult.results || []) {
      const geoPoint = this.attackToGeoPoint(attack);
      if (geoPoint) {
        geoPoints.push(geoPoint);
      }
    }

    // Calculate totals
    const totalKilled = (queryResult.results || []).reduce(
      (sum, a) => sum + (parseInt(a.nkill) || 0),
      0
    );
    const totalWounded = (queryResult.results || []).reduce(
      (sum, a) => sum + (parseInt(a.nwound) || 0),
      0
    );

    // Build the response
    const response = {
      answer: humanReadableAnswer,
      confidence: 0.95, // High confidence for database queries
      heatmap_schema: "segment",
      total_count: queryResult.totalCount,
      returned_count: geoPoints.length,
      truncated: queryResult.totalCount > geoPoints.length,
      max_returned: maxReturned,
      weight_method:
        "weight = min(1.0, (nkill * 2 + nwound) / 10); if nkill/nwound missing then weight = 0.5 for confirmed attack, 0.1 for unknown",
      sampling_method:
        queryResult.totalCount > maxReturned
          ? "top-K by recency (year desc) and lethality"
          : "none",
      aggregation_method: "keep_duplicates", // Keep duplicates for kernel heatmap amplification
      statistics: {
        total_killed: totalKilled,
        total_wounded: totalWounded,
      },
      bbox: this.calculateBBox(geoPoints),
      segments: this.generateSegments(geoPoints, {
        totalCount: queryResult.totalCount,
        country: country,
      }),
      geo_points: geoPoints,
    };

    // Add optional clusters
    if (includeClusters && geoPoints.length > 1) {
      response.clusters = this.generateClusters(geoPoints);
    }

    // Add optional GeoJSON
    if (includeGeoJSON) {
      response.geojson = this.generateGeoJSON(geoPoints);
    }

    return response;
  }

  /**
   * Format a simple text answer with minimal JSON (for non-geo queries)
   */
  formatSimpleResponse(answer, totalCount, confidence = 0.95) {
    return {
      answer: answer,
      confidence: confidence,
      heatmap_schema: "segment",
      total_count: totalCount,
      returned_count: 0,
      truncated: false,
      max_returned: this.maxReturned,
      weight_method: "N/A",
      sampling_method: "none",
      bbox: null,
      segments: [
        {
          id: 1,
          text: answer,
          score: 1.0,
          meta: { count: totalCount },
        },
      ],
      geo_points: [],
      clusters: [],
      geojson: { type: "FeatureCollection", features: [] },
    };
  }
}

module.exports = new GTDResponseFormatter();
