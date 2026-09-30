/**
 * Sovereign IndexedDB Storage Bridge for GTD Geospatial Datasets
 * Enables zero-latency, quota-free cross-tab data transfer of large datasets (180K+ incident records)
 * between Chat and Fullscreen Map without hitting browser localStorage 5MB quotas.
 */

const DB_NAME = "terraforensics_gtd_db";
const DB_VERSION = 1;
const STORE_NAME = "gtd_map_cache";

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB is not supported in this environment"));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Stores GTD map payload with full array of geo_points in IndexedDB.
 * @param {string} key Unique key, e.g. "gtd-map:UUID" or "tf:latest-gtd-data:slug"
 * @param {object} data Object containing geo_points, total_count, statistics, etc.
 * @returns {Promise<boolean>}
 */
export async function setGTDMapData(key, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ ...data, _savedAt: Date.now() }, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[gtdStorage] setGTDMapData failed:", err);
    return false;
  }
}

/**
 * Retrieves GTD map payload from IndexedDB.
 * @param {string} key Unique key
 * @returns {Promise<object|null>}
 */
export async function getGTDMapData(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[gtdStorage] getGTDMapData failed:", err);
    return null;
  }
}

/**
 * Deletes a stored GTD dataset by key.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function deleteGTDMapData(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[gtdStorage] deleteGTDMapData failed:", err);
    return false;
  }
}
