"""Derived analyses for the Pedrógão Grande dashboard → data/pedrogao/analysis.json.

Inputs: data/pedrogao/{meta,record,osm}.json + src/ rasters, and in <raw>/:
  era5_long.json  Open-Meteo ERA5 archive, hourly, 2017-04-01 → 06-30 at 39.955 N 8.17 W (FWI spin-up)
  admin7.json     OSM Overpass, admin_level=7 relations (municipalities) intersecting the domain
  extra/          from fetch_extra.py: HRL leaf type 2015, ICNF burned areas 1975–2025, OSM buildings,
                  GHSL population 2015 (ghsl/*.tif), Meteostat Monte Real
Also writes history.png (fire history before 2017) and reburn.png (2017 scar burned again 2018–2025), 400² RGBA.
Usage: python analysis.py data/pedrogao <raw>
"""
import json, math, os, sys
from datetime import datetime
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union
import shapely

D, RAW = sys.argv[1], sys.argv[2]
SRC = os.path.join(D, 'src')
meta = json.load(open(os.path.join(D, 'meta.json')))
rec = json.load(open(os.path.join(D, 'record.json')))
HALF, FN, GN = meta['half'], meta['fn'], meta['gn']
FC = 2 * HALF / FN; HA = FC * FC / 1e4
r1 = lambda v, n=1: None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), n)

# ------------------------------------------------------------------ Canadian FWI system (Van Wagner 1987)
def ffmc(T, H, W, ro, Fo):
    mo = 147.2 * (101 - Fo) / (59.5 + Fo)
    if ro > 0.5:
        rf = ro - 0.5
        add = 42.5 * rf * math.exp(-100 / (251 - mo)) * (1 - math.exp(-6.93 / rf))
        mo = mo + add + (0.0015 * (mo - 150) ** 2 * math.sqrt(rf) if mo > 150 else 0)
        mo = min(mo, 250)
    ed = 0.942 * H ** 0.679 + 11 * math.exp((H - 100) / 10) + 0.18 * (21.1 - T) * (1 - math.exp(-0.115 * H))
    if mo > ed:
        ko = 0.424 * (1 - (H / 100) ** 1.7) + 0.0694 * math.sqrt(W) * (1 - (H / 100) ** 8)
        m = ed + (mo - ed) * 10 ** (-ko * 0.581 * math.exp(0.0365 * T))
    else:
        ew = 0.618 * H ** 0.753 + 10 * math.exp((H - 100) / 10) + 0.18 * (21.1 - T) * (1 - math.exp(-0.115 * H))
        if mo < ew:
            k1 = 0.424 * (1 - ((100 - H) / 100) ** 1.7) + 0.0694 * math.sqrt(W) * (1 - ((100 - H) / 100) ** 8)
            m = ew - (ew - mo) * 10 ** (-k1 * 0.581 * math.exp(0.0365 * T))
        else:
            m = mo
    return 59.5 * (250 - m) / (147.2 + m)

def dmc(T, H, ro, Po, month):
    Le = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0]
    T = max(T, -1.1); rk = 1.894 * (T + 1.1) * (100 - H) * Le[month - 1] * 1e-6
    pr = Po
    if ro > 1.5:
        re = 0.92 * ro - 1.27; mo = 20 + math.exp(5.6348 - Po / 43.43)
        b = 100 / (0.5 + 0.3 * Po) if Po <= 33 else (14 - 1.3 * math.log(Po) if Po <= 65 else 6.2 * math.log(Po) - 17.2)
        mr = mo + 1000 * re / (48.77 + b * re)
        pr = max(244.72 - 43.43 * math.log(mr - 20), 0)
    return pr + 100 * rk

def dc(T, ro, Do, month):
    Lf = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6]
    T = max(T, -2.8); pe = max((0.36 * (T + 2.8) + Lf[month - 1]) / 2, 0)
    dr = Do
    if ro > 2.8:
        rd = 0.83 * ro - 1.27; Qo = 800 * math.exp(-Do / 400); Qr = Qo + 3.937 * rd
        dr = max(400 * math.log(800 / Qr), 0)
    return dr + pe

def isi(W, F):
    mo = 147.2 * (101 - F) / (59.5 + F)
    return 0.208 * math.exp(0.05039 * W) * 91.9 * math.exp(-0.1386 * mo) * (1 + mo ** 5.31 / 4.93e7)

def bui(P, Dd):
    if P <= 0.4 * Dd: U = 0.8 * P * Dd / (P + 0.4 * Dd) if P + Dd > 0 else 0
    else: U = P - (1 - 0.8 * Dd / (P + 0.4 * Dd)) * (0.92 + (0.0114 * P) ** 1.7)
    return max(U, 0)

def fwi(I, U):
    fD = 0.626 * U ** 0.809 + 2 if U <= 80 else 1000 / (25 + 108.64 * math.exp(-0.023 * U))
    B = 0.1 * I * fD
    return math.exp(2.72 * (0.434 * math.log(B)) ** 0.647) if B > 1 else B

E = json.load(open(os.path.join(RAW, 'era5_long.json')))['hourly']
times = [datetime.fromisoformat(t) for t in E['time']]
F, P, Dd = 85.0, 6.0, 15.0                     # standard spring start-up values (1 April)
daily = []
rain24 = 0.0
for k, t in enumerate(times):
    rain24 += E['precipitation'][k] or 0
    if t.hour != 13: continue                  # solar noon ≈ 13:30 local (UTC+1, 8.17 W)
    T, H, W = E['temperature_2m'][k], E['relative_humidity_2m'][k], E['wind_speed_10m'][k]
    F = ffmc(T, H, W, rain24, F); P = dmc(T, H, rain24, P, t.month); Dd = dc(T, rain24, Dd, t.month)
    I = isi(W, F); U = bui(P, Dd); X = fwi(I, U)
    if t.month == 6:
        daily.append({'d': t.day, 'temp': r1(T), 'rh': r1(H, 0), 'ws': r1(W), 'rain': r1(rain24), 'ffmc': r1(F), 'dmc': r1(P), 'dc': r1(Dd), 'isi': r1(I), 'bui': r1(U), 'fwi': r1(X)})
    rain24 = 0.0
# FWI climatology rank of 17 June inside the spin-up window
fw = [d['fwi'] for d in daily]

# hourly fire weather 16–23 Jun (t = hours since 17 Jun 00:00); HDW = VPD (hPa) × wind (m/s)
hourly = []
for k, t in enumerate(times):
    if not (datetime(2017, 6, 16) <= t <= datetime(2017, 6, 23, 23)): continue
    th = (t - datetime(2017, 6, 17)).total_seconds() / 3600
    vpd = (E['vapour_pressure_deficit'][k] or 0) * 10   # kPa → hPa
    ws = E['wind_speed_10m'][k] or 0
    hourly.append({'t': th, 'temp': r1(E['temperature_2m'][k]), 'rh': r1(E['relative_humidity_2m'][k], 0), 'ws': r1(ws), 'gust': r1(E['wind_gusts_10m'][k]),
                   'wd': r1(E['wind_direction_10m'][k], 0), 'vpd': r1(vpd), 'hdw': r1(vpd * ws / 3.6, 0), 'blh': r1(E['boundary_layer_height'][k], 0),
                   'sm': r1(E['soil_moisture_0_to_7cm'][k], 3), 'rain': r1(E['precipitation'][k])})

# ------------------------------------------------------------------ rasters on the 400² fire grid
arr = np.fromfile(os.path.join(SRC, 'arrival.f32'), '<f4').reshape(FN, FN)
burned = arr < 900
cos = np.fromfile(os.path.join(SRC, 'cos.u8'), np.uint8).reshape(FN, FN)
dn_png = Image.open(os.path.join(SRC, 'dnbr.png')).convert('L').resize((FN, FN), Image.BOX)
dnbr = np.asarray(dn_png).astype('float32') / 255 * 1.1 - 0.1
dem = np.fromfile(os.path.join(SRC, 'dem.f32'), '<f4').reshape(GN, GN)
cc = (np.arange(FN) + 0.5) * FC / (2 * HALF / (GN - 1))          # fire-cell centres in DEM index space
jj, ii = np.meshgrid(cc, cc, indexing='ij')
elev = map_coordinates(dem, [jj, ii], order=1)
gz, gx = np.gradient(elev, FC)
slope = np.degrees(np.arctan(np.hypot(gx, gz)))
aspect = (np.degrees(np.arctan2(-gx, gz)) + 360) % 360           # downslope azimuth (0 = N; z points south)

SEVB = [0.1, 0.27, 0.44, 0.66]
SEVN = ['Unburned/regrowth', 'Low', 'Moderate-low', 'Moderate-high', 'High']
sevc = np.digitize(dnbr, SEVB)
severity = [{'k': SEVN[c], 'ha': r1((burned & (sevc == c)).sum() * HA, 0)} for c in range(5)]

COSN = {1: 'Artificial', 2: 'Agriculture', 3: 'Pasture', 4: 'Agroforestry', 5: 'Forest', 6: 'Shrubland', 7: 'Bare / sparse', 8: 'Wetlands', 9: 'Water'}
landcover = []
for c, n in COSN.items():
    m = cos == c
    if m.sum() == 0: continue
    b = m & burned
    landcover.append({'k': n, 'code': c, 'ha': r1(b.sum() * HA, 0), 'domainHa': r1(m.sum() * HA, 0), 'pct': r1(100 * b.sum() / m.sum()),
                      'dnbr': r1(dnbr[b].mean(), 2) if b.any() else None, 'high': r1(100 * (b & (sevc >= 3)).sum() / max(b.sum(), 1))})
landcover.sort(key=lambda d: -d['ha'])

def hist(v, edges):
    hb, _ = np.histogram(v[burned], edges); ha, _ = np.histogram(v, edges)
    return [{'lo': float(edges[i]), 'hi': float(edges[i + 1]), 'ha': r1(hb[i] * HA, 0), 'pct': r1(100 * hb[i] / max(ha[i], 1))} for i in range(len(edges) - 1)]
terrain = {'elev': hist(elev, np.arange(0, 1300, 100)), 'slope': hist(slope, np.array([0, 5, 10, 15, 20, 25, 30, 35, 45, 90])),
           'aspect': [{'k': k, 'ha': r1((burned & (((aspect - a + 22.5) % 360) < 45)).sum() * HA, 0)} for k, a in zip(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], range(0, 360, 45))],
           'meanElevBurned': r1(elev[burned].mean(), 0), 'meanSlopeBurned': r1(slope[burned].mean())}

# rate of spread from the arrival field: speed = 1 / |∇t|
ga_z, ga_x = np.gradient(np.where(burned, arr, np.nan), FC)
g = np.hypot(ga_x, ga_z)                                          # hours per metre
with np.errstate(divide='ignore'):
    speed = np.where(np.isfinite(g) & (g > 0), 1 / (g * 60), np.nan)   # m/min
speed = np.clip(speed, 0, 150)   # interpolation inside a single isochrone band produces near-flat gradients
ros = []
for h in range(14, 24 * 6):
    m = burned & (arr >= h) & (arr < h + 1) & np.isfinite(speed)
    n = int(m.sum())
    ros.append({'t': h + 0.5, 'ha': r1(n * HA, 0), 'p50': r1(np.nanpercentile(speed[m], 50)) if n > 20 else None, 'p75': r1(np.nanpercentile(speed[m], 75)) if n > 20 else None})
daily_burn = [{'d': d, 'ha': r1((burned & (arr >= (d - 17) * 24) & (arr < (d - 16) * 24)).sum() * HA, 0)} for d in range(17, 23)]

# ------------------------------------------------------------------ municipalities (OSM admin_level 7)
fwd = Transformer.from_crs('EPSG:4326', f"+proj=tmerc +lat_0={meta['lat0']} +lon_0={meta['lon0']} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs", always_xy=True)
def xz(lon, lat): x, y = fwd.transform(lon, lat); return x, -y
adm = json.load(open(os.path.join(RAW, 'admin7.json')))['elements']
cx = -HALF + (np.arange(FN) + 0.5) * FC
CX, CZ = np.meshgrid(cx, cx)
fat = rec['cti']['fatalities']
munis, outlines = [], []
for el in adm:
    ways = [LineString([xz(p['lon'], p['lat']) for p in m['geometry']]) for m in el.get('members', []) if m['type'] == 'way' and m.get('role') in ('outer', '') and 'geometry' in m]
    if not ways: continue
    poly = unary_union(list(polygonize(unary_union(ways))))
    if poly.is_empty: continue
    inside = shapely.contains_xy(poly, CX, CZ)
    b = inside & burned
    if inside.sum() == 0: continue
    name = el['tags'].get('name')
    dead = sum(f['count'] for f in fat if poly.contains(Point(f['x'], f['z'])))
    entry = {'k': name, 'ha': r1(b.sum() * HA, 0), 'domainHa': r1(inside.sum() * HA, 0), 'pctBurned': r1(100 * b.sum() / inside.sum()), 'dead': dead,
             'byDay': [r1((b & (arr >= (d - 17) * 24) & (arr < (d - 16) * 24)).sum() * HA, 0) for d in range(17, 23)]}
    munis.append(entry)
    if b.sum() * HA > 50:
        simp = poly.intersection(shapely.box(-HALF, -HALF, HALF, HALF)).simplify(120)
        geoms = getattr(simp, 'geoms', [simp])
        outlines.append({'k': name, 'rings': [[[round(x), round(z)] for x, z in g.exterior.coords] for g in geoms if g.geom_type == 'Polygon']})
munis = sorted([m for m in munis if m['ha'] > 0], key=lambda d: -d['ha'])

# ------------------------------------------------------------------ satellite passes (FIRMS)
hs = meta['hotspots']
passes = {}
for h in hs:
    k = (h['sat'], round(h['t'] * 4) / 4)
    p = passes.setdefault(k, {'t': k[1], 'sat': h['sat'], 'n': 0, 'frp': 0.0, 'max': 0.0})
    p['n'] += 1; p['frp'] += h['frp']; p['max'] = max(p['max'], h['frp'])
passes = sorted(({**p, 'frp': r1(p['frp'], 0), 'max': r1(p['max'], 0)} for p in passes.values()), key=lambda p: p['t'])
inside_burn = sum(1 for h in hs if burned[min(FN - 1, max(0, int((h['z'] + HALF) / FC))), min(FN - 1, max(0, int((h['x'] + HALF) / FC)))])

# ------------------------------------------------------------------ validation at the CTI fatality sites
def arr_near(x, z, r=250):
    j0, i0 = int((z + HALF) / FC), int((x + HALF) / FC); k = int(math.ceil(r / FC))
    sub = arr[max(0, j0 - k):j0 + k + 1, max(0, i0 - k):i0 + k + 1]
    return float(sub.min())
val = []
for f in fat:
    a = arr_near(f['x'], f['z'])
    lead = (f['t'] - a) * 60 if a < 900 else None
    # a record more than 6 h after arrival is the time the victim was found, not the time of death
    val.append({'k': f['name'], 'n': f['count'], 'death': r1(f['t'], 3), 'arrival': r1(a, 3) if a < 900 else None, 'leadMin': r1(lead, 0), 'excluded': lead is not None and lead > 360})
leads = [v['leadMin'] for v in val if v['leadMin'] is not None and not v['excluded']]
deaths = sorted(fat, key=lambda f: f['t'])
cum, c = [], 0
for f in deaths: c += f['count']; cum.append([r1(f['t'], 3), c])

area_t = meta['area']['t']; area_h = meta['area']['ha']
def area_at(t): return float(np.interp(t, area_t, area_h))
growth = [[t, r1(area_at(t + 0.5) - area_at(t - 0.5), 0)] for t in np.arange(14.5, 144, 0.5)]
peak = max(growth, key=lambda g: g[1])

out = {
    'about': 'Derived by tools/pedrogao/analysis.py from ERA5 (Open-Meteo), Sentinel-2 dNBR, COS2018, Copernicus DEM, OSM municipalities, NASA FIRMS and the CTI/ADAI record.',
    'fwi': {'daily': daily, 'ref': {'sgif17': {'fwi': 34.8, 'isi': 12.1, 'ffmc': 94.5}}, 'classes': [[0, 5.2, 'Very low'], [5.2, 11.2, 'Low'], [11.2, 21.3, 'Moderate'], [21.3, 38, 'High'], [38, 50, 'Very high'], [50, 999, 'Extreme']]},
    'hourly': hourly,
    'severity': severity, 'landcover': landcover, 'terrain': terrain,
    'ros': ros, 'growth': growth, 'peakGrowth': {'t': peak[0], 'ha': peak[1]}, 'dailyBurn': daily_burn,
    'municipalities': munis, 'muniOutlines': outlines,
    'firms': {'passes': passes, 'n': len(hs), 'insideBurn': inside_burn, 'frpTotal': r1(sum(h['frp'] for h in hs), 0)},
    'validation': {'sites': val, 'meanLeadMin': r1(np.mean(leads), 0), 'minLeadMin': r1(min(leads), 0), 'maxLeadMin': r1(max(leads), 0), 'nSites': len(leads), 'deadInSites': sum(v['n'] for v in val if not v['excluded']), 'nDead': sum(f['count'] for f in fat)},
    'deathsCum': cum,
    'totals': {'burnedHa': r1(burned.sum() * HA, 0), 'highSevPct': r1(100 * (burned & (sevc >= 3)).sum() / burned.sum()), 'meanDnbr': r1(dnbr[burned].mean(), 2)},
}
# ------------------------------------------------------------------ extra datasets (fetch_extra.py)
X = os.path.join(RAW, 'extra')
import glob, gzip, csv
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from rasterio.features import rasterize
from rasterio.crs import CRS
LCRS = CRS.from_proj4(f"+proj=tmerc +lat_0={meta['lat0']} +lon_0={meta['lon0']} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs")
GTR = from_origin(-HALF, HALF, FC, FC)         # row 0 = north edge = z -HALF (z = -northing)
def to_grid(path, resampling, dtype='float32'):
    out = np.zeros((FN, FN), dtype)
    with rasterio.open(path) as src:
        reproject(rasterio.band(src, 1), out, dst_transform=GTR, dst_crs=LCRS, resampling=resampling, src_nodata=src.nodata, dst_nodata=0)
    return out
sev_high = sevc >= 3

# forest type before the fire (Copernicus HRL Dominant Leaf Type 2015: 1 broadleaved ≈ eucalyptus here, 2 coniferous ≈ maritime pine)
with rasterio.open(os.path.join(X, 'dlt2015.tif')) as src:      # 0 is a real class (no trees): shift by 1 so 0 can be nodata
    a0 = src.read(1).astype('uint8') + 1; dlt = np.zeros((FN, FN), 'uint8')
    reproject(a0, dlt, src_transform=src.transform, src_crs=src.crs, dst_transform=GTR, dst_crs=LCRS, resampling=Resampling.mode, src_nodata=0, dst_nodata=0)
dlt = dlt.astype(np.int16) - 1
forest_type = []
for code, k in [(1, 'Broadleaved'), (2, 'Coniferous'), (0, 'No tree cover')]:
    m = dlt == code; b = m & burned
    if m.sum() == 0: continue
    forest_type.append({'k': k, 'ha': r1(b.sum() * HA, 0), 'domainHa': r1(m.sum() * HA, 0), 'pct': r1(100 * b.sum() / m.sum()), 'dnbr': r1(dnbr[b].mean(), 2) if b.any() else None,
                        'high': r1(100 * (b & sev_high).sum() / max(b.sum(), 1)), 'sev': [r1((b & (sevc == c)).sum() * HA, 0) for c in range(5)]})

# fire history: ICNF burned areas 1975–2016 (before) and 2018–2025 (after)
fwd_ll = Transformer.from_crs('EPSG:4326', LCRS, always_xy=True)
def proj_geom(g):
    def ring(r): xs, ys = fwd_ll.transform([q[0] for q in r], [q[1] for q in r]); return list(zip(xs, ys))
    if g['type'] == 'Polygon': return {'type': 'Polygon', 'coordinates': [ring(r) for r in g['coordinates']]}
    if g['type'] == 'MultiPolygon': return {'type': 'MultiPolygon', 'coordinates': [[ring(r) for r in p] for p in g['coordinates']]}
    return None
by_year = {}
for f in sorted(glob.glob(os.path.join(X, 'icnf_ardida_*.json'))):
    for ft in json.load(open(f))['features']:
        y = int(ft['properties'].get('Ano') or 0); g = ft.get('geometry')
        if not g or y < 1975: continue
        pg = proj_geom(g)
        if pg: by_year.setdefault(y, []).append(pg)
count_pre = np.zeros((FN, FN), np.int16); last_pre = np.zeros((FN, FN), np.int16); first_post = np.zeros((FN, FN), np.int16)
area_by_year = []
for y in sorted(by_year):
    m = rasterize(((g, 1) for g in by_year[y]), out_shape=(FN, FN), transform=GTR, fill=0, dtype='uint8').astype(bool)
    area_by_year.append({'y': y, 'ha': r1(m.sum() * HA, 0), 'inScar': r1((m & burned).sum() * HA, 0)})
    if y < 2017: count_pre += m; last_pre = np.where(m, y, last_pre)
    elif y > 2017: first_post = np.where(m & (first_post == 0), y, first_post)
tsf = np.where(last_pre > 0, 2017 - last_pre, 99)
TSF = [('< 5 years', 0, 5), ('5–9 years', 5, 10), ('10–19 years', 10, 20), ('20–42 years', 20, 43), ('No fire since 1975', 99, 100)]
history = {'tsf': [], 'recurrence': [], 'byYear': area_by_year}
for k, a, b in TSF:
    m = burned & (tsf >= a) & (tsf < b)
    history['tsf'].append({'k': k, 'ha': r1(m.sum() * HA, 0), 'dnbr': r1(dnbr[m].mean(), 2) if m.sum() > 20 else None, 'high': r1(100 * (m & sev_high).sum() / max(m.sum(), 1)) if m.sum() > 20 else None})
for n in range(0, 5):
    m = burned & ((count_pre == n) if n < 4 else (count_pre >= 4))
    history['recurrence'].append({'k': f'{n}' if n < 4 else '4+', 'ha': r1(m.sum() * HA, 0)})
reb = burned & (first_post > 0)
history['reburn'] = {'ha': r1(reb.sum() * HA, 0), 'pct': r1(100 * reb.sum() / burned.sum()), 'byYear': [{'y': y, 'ha': r1((burned & (first_post == y)).sum() * HA, 0)} for y in range(2018, 2026)]}
history['neverPct'] = r1(100 * (burned & (tsf == 99)).sum() / burned.sum())
# map rasters: fire history before 2017 (colour by time since last fire) and post-2017 re-burn
def rgba(mask, col, alpha):
    im = np.zeros((FN, FN, 4), np.uint8); im[mask] = (*col, alpha); return im
hist_img = np.zeros((FN, FN, 4), np.uint8)
for (a, b), col in zip([(0, 5), (5, 10), (10, 20), (20, 43)], [(11, 79, 108), (31, 122, 140), (79, 163, 165), (168, 213, 206)]):   # teal ramp, distinct from the fire palette
    m = (tsf >= a) & (tsf < b); hist_img[m] = (*col, 170)
Image.fromarray(hist_img, 'RGBA').save(os.path.join(D, 'history.png'), optimize=True)
reb_img = np.zeros((FN, FN, 4), np.uint8)
for y, col in zip(range(2018, 2026), [(63, 111, 214), (63, 111, 214), (90, 80, 200), (90, 80, 200), (122, 75, 214), (122, 75, 214), (160, 70, 190), (190, 60, 160)]):
    m = first_post == y; reb_img[m] = (*col, 190)
Image.fromarray(reb_img, 'RGBA').save(os.path.join(D, 'reburn.png'), optimize=True)

# exposure: GHSL population 2015 (100 m) and OSM buildings
ghsl = glob.glob(os.path.join(X, 'ghsl', '*.tif'))[0]
pop = to_grid(ghsl, Resampling.sum)
bl = json.load(open(os.path.join(X, 'buildings.json')))
bx, bz = zip(*[xz(b['lon'], b['lat']) for b in bl])
bx, bz = np.array(bx), np.array(bz)
inb = (np.abs(bx) < HALF) & (np.abs(bz) < HALF)
bi = ((bx[inb] + HALF) / FC).astype(int).clip(0, FN - 1); bj = ((bz[inb] + HALF) / FC).astype(int).clip(0, FN - 1)
bld = np.zeros((FN, FN), np.int32); np.add.at(bld, (bj, bi), 1)
alert = min(g['alert'] for g in meta['ignitions'])
arr_b = np.where(burned, arr, np.inf)
def exposed_by(ths):
    return [[float(t), r1(pop[arr_b <= t].sum(), 0), int(bld[arr_b <= t].sum())] for t in ths]
WARN = [('< 1 h', 0, 1), ('1–3 h', 1, 3), ('3–6 h', 3, 6), ('6–12 h', 6, 12), ('12–24 h', 12, 24), ('> 24 h', 24, 999)]
warn = []
for k, a, b in WARN:
    m = burned & (arr - alert >= a) & (arr - alert < b)
    warn.append({'k': k, 'pop': r1(pop[m].sum(), 0), 'bld': int(bld[m].sum())})
# villages: population within 1 km and fire arrival
osm = json.load(open(os.path.join(D, 'osm.json')))
vill = []
for p in osm['places']:
    if p.get('k') not in ('village', 'hamlet', 'town'): continue
    j0, i0 = int((p['z'] + HALF) / FC), int((p['x'] + HALF) / FC)
    if not (0 <= j0 < FN and 0 <= i0 < FN): continue
    k = 4; sub = arr[max(0, j0 - 2):j0 + 3, max(0, i0 - 2):i0 + 3]; a = float(sub.min())
    if a >= 900: continue
    pp = float(pop[max(0, j0 - k):j0 + k + 1, max(0, i0 - k):i0 + k + 1].sum())
    vill.append({'k': p['n'], 'arr': r1(a, 3), 'warnH': r1(a - alert, 1), 'pop1km': r1(pp, 0), 'x': p['x'], 'z': p['z']})
vill.sort(key=lambda v: v['arr'])
exposure = {'popDomain': r1(pop.sum(), 0), 'popBurned': r1(pop[burned].sum(), 0), 'bldDomain': int(bld.sum()), 'bldBurned': int(bld[burned].sum()),
            'series': exposed_by(np.arange(14.5, 144.01, 0.5)), 'warning': warn, 'alert': alert, 'villages': vill[:150],
            'popWithin3hOfAlert': r1(pop[burned & (arr - alert < 3)].sum(), 0)}

# station observations: Meteostat Monte Real (08540, ~60 km W), hourly UTC → local (UTC+1)
obs = []
fn = os.path.join(X, 'meteostat_08540.csv.gz')
if os.path.exists(fn):
    for r in csv.reader(gzip.open(fn, 'rt')):
        if not r[0].startswith('2017-06-1') and not r[0].startswith('2017-06-2'): continue
        d = datetime.fromisoformat(r[0]); th = (d - datetime(2017, 6, 17)).total_seconds() / 3600 + int(r[1]) + 1
        if -24 <= th <= 168:
            num = lambda v: float(v) if v not in ('', None) else None
            obs.append({'t': th, 'temp': num(r[2]), 'rh': num(r[4]), 'wd': num(r[7]), 'ws': num(r[8])})
out.update({'forestType': forest_type, 'history': history, 'exposure': exposure, 'station': {'name': 'Monte Real (IPMA 08540)', 'distKm': 60, 'obs': obs}})
json.dump(out, open(os.path.join(D, 'analysis.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
print('forest type', [(f['k'], f['ha'], f['pct'], f['dnbr'], f['high']) for f in forest_type])
print('tsf', history['tsf']); print('recurrence', history['recurrence']); print('reburn', history['reburn'], 'never', history['neverPct'])
print('exposure', {k: exposure[k] for k in ('popDomain', 'popBurned', 'bldDomain', 'bldBurned', 'popWithin3hOfAlert')}, exposure['warning'])
print('villages', [(v['k'], v['warnH'], v['pop1km']) for v in vill[:8]])
print('station obs', len(obs))
print('analysis.json', os.path.getsize(os.path.join(D, 'analysis.json')), 'bytes')
d17 = [d for d in daily if d['d'] == 17][0]
print('FWI 17 Jun', d17, '| SGIF 34.8')
print('severity', severity); print('landcover', [(l['k'], l['ha'], l['pct']) for l in landcover[:5]])
print('munis', [(m['k'], m['ha'], m['dead']) for m in munis])
print('validation lead (min)', out['validation']['meanLeadMin'], out['validation']['minLeadMin'], out['validation']['maxLeadMin'])
print('peak growth', peak, '| ros max p90', max(r['p75'] or 0 for r in ros))
print('firms', len(passes), 'passes', inside_burn, '/', len(hs), 'inside burn')
