# Pedrógão Grande 2017 — data pipeline

Builds `data/pedrogao/` for `index.html?incident=pedrogao`.

1. Download into a `raw/` folder next to `scripts/`:
   - Copernicus DEM GLO-30 tiles N39/N40 × W008/W009 (`copernicus-dem-30m.s3.amazonaws.com`)
   - ERA5 hourly weather via Open-Meteo archive API (39.95, −8.16, 2017-06-16 → 06-23) → `weather.json`
   - NASA FIRMS yearly country files: `viirs-snpp_2017_Portugal.csv`, `modis_2017_Portugal.csv`
   - OpenStreetMap Overpass query (roads, water, places, peaks) for bbox 39.73–40.18 N, 8.46–7.88 W → `osm.json`
   - Sentinel-2 STAC items (earth-search, collection `sentinel-2-l2a`, tile 29TNE) → `s2items.json`
2. `python rasters.py <out>`: DEM → `dem.f32`; S2 14 Jun / 8 Aug → `imagery_pre/post.jpg`, NBR, NDVI, dNBR.
3. `python prep.py <out>`: burn mask (dNBR > 0.22, components touching hotspots/ignitions), fuels from NDVI, arrival times (isochrone interpolation between satellite passes + documented anchors), OSM vectors, `meta.json`.
4. `python merge_roads.py <out>/osm.json`: merges road segments into routes.

`record.json` (resources, casualties, timeline) is hand-entered from the cited sources.
Python deps: numpy, pandas, rasterio, pyproj, shapely, scipy, pillow, requests.

## Official progression (replaces the satellite-only reconstruction)
5. `python digitize.py <out>`: digitizes Fig. 1 of Ribeiro et al. 2020 (ADAI/CEIF, *Fire* 3:57), the official estimated fire progression with 15 isochrone classes (17 Jun 16:00 → 21 Jun 23:59).
   - Colours are classified against the legend, keeping only flat fills; holes are closed.
   - The map is georeferenced from the Escalos Fundeiros marker and the scale bar, then fine-aligned to the Sentinel-2 scar (IoU 0.86).
   - Arrival times are interpolated by distance inside each band.
   - Needs `docs/p1_0_Image27.jpg`, extracted from the paper PDF with pypdf.
6. `python cos.py <out>`: downloads DGT COS2018 level-1 polygons (ArcGIS FeatureServer) and rasterizes them into `fuel.u8` / `cos.u8`.

## Official report data
7. `python digitize_resources.py <img_dir> data/pedrogao/record.json`: digitizes ANPC resource curves from the ADAI/CEIF official report.
   - Sources: Fig. 77a (operatives 14:30–19:00) and Fig. 92a/b (operatives and vehicles by type, 17–24 Jun).
   - Images extracted from the PDF with pypdf.
8. ICNF official perimeters: WFS `http://si.icnf.pt/geoserverplinia/BDG/ardida_2017/ows` (`typeName=BDG:ardida_2017`), filtered to the June fires → `icnf_perimeters.json`.
