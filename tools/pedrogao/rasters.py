"""Pedrógão Grande 2017 — raster pipeline.
Reprojects Copernicus DEM, Sentinel-2 (pre/post) to a local metric grid and computes dNBR + NDVI."""
import json, os, sys
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from rasterio.crs import CRS
from PIL import Image

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(S, 'raw')
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

LAT0, LON0 = 39.955, -8.17
HALF = 25000.0  # metres -> 50 km domain
LCRS = CRS.from_proj4(f'+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs')

def grid(n):
    res = 2 * HALF / n
    return from_origin(-HALF, HALF, res, res), (n, n)

def warp(src_path, n, band=1, resampling=Resampling.bilinear, dtype='float32'):
    tr, shape = grid(n)
    dst = np.zeros(shape, dtype=dtype)
    with rasterio.open(src_path) as src:
        reproject(rasterio.band(src, band), dst, dst_transform=tr, dst_crs=LCRS, resampling=resampling, dst_nodata=0)
    return dst

# ---------------- DEM ----------------
GN = 801  # vertices -> 62.5 m spacing
tiles = [os.path.join(RAW, f) for f in os.listdir(RAW) if f.startswith('dem_')]
from rasterio.merge import merge
srcs = [rasterio.open(t) for t in tiles]
mos, mtr = merge(srcs)
prof = srcs[0].profile; prof.update(height=mos.shape[1], width=mos.shape[2], transform=mtr, count=1)
mpath = os.path.join(RAW, 'dem_mosaic.tif')
with rasterio.open(mpath, 'w', **prof) as d: d.write(mos[0], 1)
# vertex-centred grid: sample at cell centres of an (GN x GN) grid spanning [-HALF, HALF] inclusive
res = 2 * HALF / (GN - 1)
tr = from_origin(-HALF - res / 2, HALF + res / 2, res, res)
dem = np.zeros((GN, GN), 'float32')
with rasterio.open(mpath) as src:
    reproject(rasterio.band(src, 1), dem, dst_transform=tr, dst_crs=LCRS, resampling=Resampling.bilinear)
print('DEM', dem.min(), dem.max())
dem.astype('<f4').tofile(os.path.join(OUT, 'dem.f32'))

# ---------------- Sentinel-2 ----------------
items = {f['id']: f for f in json.load(open(os.path.join(RAW, 's2items.json')))['features']}
PRE, POST = 'S2A_29TNE_20170614_0_L2A', 'S2B_29TNE_20170808_0_L2A'
def href(item, key):
    return '/vsicurl/' + items[item]['assets'][key]['href']

os.environ['GDAL_DISABLE_READDIR_ON_OPEN'] = 'EMPTY_DIR'
os.environ['CPL_VSIL_CURL_ALLOWED_EXTENSIONS'] = '.tif'
NI = 2048
for name, it in [('imagery_pre', PRE), ('imagery_post', POST)]:
    rgb = np.stack([warp(href(it, 'visual'), NI, b, Resampling.bilinear, 'uint8') for b in (1, 2, 3)], -1)
    Image.fromarray(rgb).save(os.path.join(OUT, f'{name}.jpg'), quality=90)
    print(name, rgb.mean())

NR = 1024
def refl(it, key):
    a = warp(href(it, key), NR, 1, Resampling.average, 'float32')
    return a / 10000.0
nir_pre, sw_pre, red_pre = refl(PRE, 'nir'), refl(PRE, 'swir22'), refl(PRE, 'red')
nir_post, sw_post = refl(POST, 'nir'), refl(POST, 'swir22')
scl_pre = warp(href(PRE, 'scl'), NR, 1, Resampling.nearest, 'uint8')
nbr_pre = (nir_pre - sw_pre) / np.maximum(nir_pre + sw_pre, 1e-4)
nbr_post = (nir_post - sw_post) / np.maximum(nir_post + sw_post, 1e-4)
dnbr = nbr_pre - nbr_post
ndvi = (nir_pre - red_pre) / np.maximum(nir_pre + red_pre, 1e-4)
np.save(os.path.join(RAW, 'dnbr.npy'), dnbr); np.save(os.path.join(RAW, 'ndvi.npy'), ndvi); np.save(os.path.join(RAW, 'scl.npy'), scl_pre)
print('dNBR stats', np.percentile(dnbr, [5, 50, 95, 99]), 'burned(>0.27) ha', (dnbr > 0.27).sum() * (2 * HALF / NR) ** 2 / 1e4)
