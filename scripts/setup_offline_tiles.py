#!/usr/bin/env python3
"""
scripts/setup_offline_tiles.py — Air-Gapped PMTiles Basemap Provisioning & Validation

Verifies the presence and integrity of local vector tiles required for sovereign,
zero-egress air-gapped forensic map rendering in TerraForensics AI.

Usage:
  python scripts/setup_offline_tiles.py --check
  python scripts/setup_offline_tiles.py --help
  python scripts/setup_offline_tiles.py --download-sample
"""

import sys
import os
import argparse
from pathlib import Path
import urllib.request
import time

REPO_ROOT = Path(__file__).resolve().parent.parent
TILES_DIR = REPO_ROOT / "frontend" / "public" / "tiles"
PMTILES_FILE = TILES_DIR / "world.pmtiles"

# Sample lightweight open PMTiles extract (Protomaps / OSM sample)
SAMPLE_PMTILES_URL = (
    "https://build.protomaps.com/20240101.pmtiles"
)

PMTILES_MAGIC = b"PMTiles"

def verify_pmtiles(file_path: Path):
    if not file_path.exists():
        return False, "File does not exist"
    
    size_bytes = file_path.stat().st_size
    if size_bytes < 127:
        return False, f"File too small ({size_bytes} bytes). Corrupt or incomplete."
    
    with open(file_path, "rb") as f:
        magic = f.read(7)
        if magic != PMTILES_MAGIC:
            return False, f"Invalid PMTiles header magic: expected {PMTILES_MAGIC}, got {magic}"
        
        # Read version byte at offset 7
        version = f.read(1)
        version_num = version[0] if version else 0

    size_mb = size_bytes / (1024 * 1024)
    return True, f"Valid PMTiles v{version_num} archive ({size_mb:.2f} MB)"


def main():
    parser = argparse.ArgumentParser(
        description="TerraForensics AI — Offline Vector Tile Provisioning & Integrity Checker"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if local world.pmtiles exists and is structurally valid for air-gapped use."
    )
    parser.add_argument(
        "--download-sample",
        action="store_true",
        help="Download sample OpenStreetMap PMTiles archive into frontend/public/tiles/."
    )
    args = parser.parse_args()

    print("=" * 80)
    print(" 🗺️  TerraForensics AI — Air-Gapped PMTiles Basemap Provisioning")
    print("=" * 80)
    print(f"Target directory: {TILES_DIR}")
    print(f"Target file:      {PMTILES_FILE}")
    print("-" * 80)

    TILES_DIR.mkdir(parents=True, exist_ok=True)

    is_valid, msg = verify_pmtiles(PMTILES_FILE)

    if args.check or (not args.download_sample and not args.check):
        if is_valid:
            print(f"✔ Status: READY FOR AIR-GAPPED DEPLOYMENT")
            print(f"  Details: {msg}")
            print("\nThe MapLibre GL frontend will serve local vector basemaps without WAN requests.")
            sys.exit(0)
        else:
            print(f"⚠ Status: TILE ASSET MISSING OR INCOMPLETE")
            print(f"  Details: {msg}")
            print("\nIn an air-gapped environment without WAN egress, the map will fail to render raster fallbacks.")
            print("To resolve, supply a valid PMTiles archive:")
            print(f"  1. Place 'world.pmtiles' directly at: {PMTILES_FILE}")
            print(f"  2. Or run: python scripts/setup_offline_tiles.py --download-sample")
            print("  3. Recommended OpenStreetMap source: https://protomaps.com/extracts or https://maps.protomaps.com/builds/")
            if args.check:
                sys.exit(1)

    if args.download_sample:
        if is_valid:
            print(f"Tile archive already exists and is valid: {msg}")
            print("Overwrite? Remove the existing file first if you want to replace it.")
            sys.exit(0)

        print(f"Fetching sample PMTiles archive from: {SAMPLE_PMTILES_URL}")
        print("Note: This download requires external network connectivity during workstation preparation.")
        try:
            start_time = time.time()
            urllib.request.urlretrieve(SAMPLE_PMTILES_URL, PMTILES_FILE)
            elapsed = time.time() - start_time
            valid, check_msg = verify_pmtiles(PMTILES_FILE)
            if valid:
                print(f"✔ Successfully downloaded and verified sample tiles ({elapsed:.1f}s): {check_msg}")
            else:
                print(f"❌ Download completed but verification failed: {check_msg}")
        except Exception as e:
            print(f"❌ Download failed: {e}")
            print("Please manually copy a valid 'world.pmtiles' file into frontend/public/tiles/.")
            sys.exit(1)

if __name__ == "__main__":
    main()
