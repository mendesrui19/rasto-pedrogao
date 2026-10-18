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

## Web bake (run last)
The rasters above (`dem.f32`, `arrival.f32`, `fuel.u8`, `cos.u8`, `ndvi.png`, `dnbr.png`, `imagery_*.jpg`) live in `data/pedrogao/src/` and are not deployed.
9. `python bake_web.py data/pedrogao`: writes the files the browser loads.
   - `tex_pre/post.webp`: imagery pre-lit with hillshade and cast shadows.
   - `info.webp`: forest density, water, dNBR and hillshade packed into RGBA.
   - `dem.z`, `arrival.z`, `fuel.z`, `cos.z`: compact zlib grids, decoded in `js/real.js`.
   - Pass the Copernicus mosaic as a second argument (`bake_web.py data/pedrogao raw/dem_mosaic.tif`) for the 24 m hillshade and `outer.z` (real relief out to 75 km).
   - After re-baking, bump `DATA_V` in `js/real.js` and the `?v=` on the preloads in `index.html`: `/data` is cached for a day.

## Analysis dashboard data
10. `python analysis.py data/pedrogao <raw>` → `analysis.json` (loaded by `js/dash.js`).
    - Needs in `<raw>`: `era5_long.json` (Open-Meteo ERA5 archive, hourly, 1 Apr → 30 Jun 2017 at 39.955 N 8.17 W) and `admin7.json` (Overpass, `admin_level=7` relations in the domain bbox; send a User-Agent header).
    - Canadian FWI system computed daily at 13:00 local from 1 April start-up values (FFMC 85, DMC 6, DC 15). 17 June gives FWI 31.2, FFMC 94.1; the SGIF figures are 34.8 and 94.5.
    - Hot-Dry-Windy index (VPD × wind), burn severity classes (dNBR), land cover (COS2018), terrain, spread speed (inverse arrival-time gradient), burned area by municipality and day, FIRMS overpasses.
    - Validation against the CTI fatality sites; a death record more than 6 h after fire arrival is treated as the time the victim was found.
11. `python fetch_extra.py <raw>` (run before `analysis.py`) downloads the extra datasets into `<raw>/extra/`:
    - Copernicus HRL Dominant Leaf Type 2015 (EEA ImageServer);
    - ICNF burned areas 1975–2025 (WFS);
    - OSM building centroids;
    - Meteostat Monte Real;
    - the IEM METAR archive.
    Download the GHSL population tile `GHS_POP_E2015_GLOBE_R2023A_54009_100_V1_0_R5_C18` (JRC) into `<raw>/extra/ghsl/`.
    They feed the forest-type × severity, fire-history, exposure and station sections, plus `history.png` / `reburn.png`.
