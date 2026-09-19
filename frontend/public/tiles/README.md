# PMTiles Basemap

Place a PMTiles basemap file in this folder named `world.pmtiles`.

Example path:
- frontend/public/tiles/world.pmtiles

This file is required for the GTD map page to render the basemap.

If you cannot download a large file, you can use a remote PMTiles URL instead.
Set this in frontend/.env:

VITE_PMTILES_URL='https://your-remote-host/path/to/world.pmtiles'

Recommended source: Protomaps basemap PMTiles built from OpenStreetMap.
The map style uses the Protomaps basemap layers and expects standard OSM layers.

Attribution requirement: "Protomaps © OpenStreetMap" must be visible on the map.
