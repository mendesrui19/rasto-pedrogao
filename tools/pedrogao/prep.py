"""Pedrógão Grande 2017 — reconstruct fire arrival times + vector layers for FireTrace.

Inputs (scratchpad/raw): dnbr.npy, ndvi.npy, scl.npy (1024²), dem.f32 (801²), weather.json (ERA5),
VIIRS/MODIS FIRMS CSVs, osm.json (Overpass). Output: data/pedrogao/*.
Time unit: hours since 2017-06-17 00:00 local (WEST, UTC+1)."""
import json, os, sys, heapq, math
import numpy as np
import pandas as pd
from PIL import Image
from pyproj import Transformer

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(S, 'raw')
OUT = sys.argv[1]
LAT0, LON0, HALF = 39.955, -8.17, 25000.0
SIZE = 2 * HALF
fwd = Transformer.from_crs('EPSG:4326', f'+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m', always_xy=True)
def to_xz(lon, lat):
    x, y = fwd.transform(lon, lat); return x, -y   # app: x east, z south

def resize(a, n, resample=Image.BILINEAR):
    return np.array(Image.fromarray(a.astype('float32'), mode='F').resize((n, n), resample))

FN = 400; FC = SIZE / FN
dnbr = np.load(os.path.join(RAW, 'dnbr.npy')); ndvi = np.load(os.path.join(RAW, 'ndvi.npy')); scl = np.load(os.path.join(RAW, 'scl.npy'))
GN = 801
dem = np.fromfile(os.path.join(OUT, 'dem.f32'), '<f4').reshape(GN, GN)
d4 = resize(dnbr, FN); n4 = resize(ndvi, FN); w4 = resize((scl == 6).astype('float32'), FN)
e4 = resize(dem, FN)

# ---------------- hotspots ----------------
hs = []
for f, sat in [('viirs-snpp_2017_Portugal.csv', 'VIIRS'), ('modis_2017_Portugal.csv', 'MODIS')]:
    d = pd.read_csv(os.path.join(RAW, f))
    d = d[(d.acq_date >= '2017-06-17') & (d.acq_date <= '2017-06-23')]
    for _, r in d.iterrows():
        x, z = to_xz(r.longitude, r.latitude)
        if abs(x) > HALF or abs(z) > HALF: continue
        day = int(r.acq_date[-2:]); hhmm = int(r.acq_time)
        t = (day - 17) * 24 + hhmm // 100 + (hhmm % 100) / 60 + 1.0   # UTC -> WEST
        hs.append({'t': round(t, 3), 'x': round(x), 'z': round(z), 'frp': float(r.frp), 'sat': sat, 'conf': str(r.confidence)})
print('hotspots', len(hs))

# ---------------- burn mask ----------------
from scipy import ndimage
burn = d4 > 0.22
burn = ndimage.binary_closing(burn, iterations=2)
lab, nl = ndimage.label(burn)
keep = set()
cell = lambda x, z: (int((z + HALF) / FC), int((x + HALF) / FC))
for h in hs:
    if h['t'] > 6 * 24: continue
    j, i = cell(h['x'], h['z'])
    if 0 <= i < FN and 0 <= j < FN:
        for dj in (-2, -1, 0, 1, 2):
            for di in (-2, -1, 0, 1, 2):
                jj, ii = j + dj, i + di
                if 0 <= jj < FN and 0 <= ii < FN and lab[jj, ii]: keep.add(lab[jj, ii])
IGN = [
    {'id': 'PG', 'name': 'Escalos Fundeiros', 'concelho': 'Pedrógão Grande', 'lat': 39.949167, 'lon': -8.159444, 't': 14.5, 'alert': 14 + 43 / 60, 'sgif': 'BL4171577', 'area': 30358.84, 'cause': 'Linhas eléctricas (descarga)', 'ext': 5 * 24 + 9 + 22 / 60},
    {'id': 'GO', 'name': 'Fonte Limpa', 'concelho': 'Góis', 'lat': 40.042001, 'lon': -8.063979, 't': 14.75, 'alert': 14 + 52 / 60, 'sgif': 'BL217377', 'area': 17520.65, 'cause': 'Natural — raio', 'ext': 5 * 24 + 19.5},
]
for g in IGN:
    g['x'], g['z'] = [round(v) for v in to_xz(g['lon'], g['lat'])]
    j, i = cell(g['x'], g['z'])
    # snap to nearest burned component
    best = None
    for r in range(0, 12):
        sl = lab[max(0, j - r):j + r + 1, max(0, i - r):i + r + 1]
        if sl.max(): best = np.bincount(sl[sl > 0]).argmax(); break
    if best: keep.add(best)
mask = np.isin(lab, list(keep))
# small components (<30 ha) are dropped
sizes = ndimage.sum(mask, lab, index=list(keep))
print('burned ha in mask', mask.sum() * FC * FC / 1e4)

# ---------------- fuels (pre-fire NDVI) ----------------
fuel = np.full((FN, FN), 1, 'uint8')                # 0 grass/agric, 1 shrub, 2 forest, 3 water/rock
fuel[n4 < 0.33] = 0
fuel[n4 > 0.52] = 2
fuel[(w4 > 0.5) | (n4 < 0.02)] = 3

# ---------------- weather ----------------
W = json.load(open(os.path.join(RAW, 'weather.json')))['hourly']
wt = [(int(t[8:10]) - 17) * 24 + int(t[11:13]) for t in W['time']]
wx = {k: W[k] for k in ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation']}
def wat(t):
    i = int(np.clip(np.searchsorted(wt, t) - 1, 0, len(wt) - 2)); f = np.clip(t - wt[i], 0, 1)
    out = {k: v[i] * (1 - f) + v[i + 1] * f for k, v in wx.items() if k != 'wind_direction_10m'}
    a, b = wx['wind_direction_10m'][i], wx['wind_direction_10m'][i + 1]
    dd = ((b - a + 540) % 360) - 180; out['wind_direction_10m'] = (a + dd * f) % 360
    return out

# places for the downburst (thunderstorm outflow) near EN236-1 / Nodeirinho
osm = json.load(open(os.path.join(RAW, 'osm.json')))
places = {}
for el in osm['elements']:
    if el['type'] == 'node' and 'name' in el.get('tags', {}):
        places.setdefault(el['tags']['name'], (el['lon'], el['lat'], el['tags'].get('place') or el['tags'].get('natural')))
db = places.get('Nodeirinho') or places.get('Pobrais')
DBX, DBZ = to_xz(db[0], db[1]) if db else (-4500, 1000)
print('downburst centre', DBX, DBZ)
DB_T0, DB_T1 = 18.6, 20.6

def wind(t, x, z):
    w = wat(t); spd = w['wind_speed_10m']; dirn = w['wind_direction_10m']
    if DB_T0 < t < DB_T1:
        r = math.hypot(x - DBX, z - DBZ)
        k = math.sin(math.pi * (t - DB_T0) / (DB_T1 - DB_T0)) * math.exp(-(r / 7000) ** 2)
        # outflow radiates from the collapsing column ~3 km east of EN236-1
        ox, oz = DBX + 3000, DBZ - 500
        ang = math.degrees(math.atan2(x - ox, -(z - oz)))  # direction it blows TOWARD
        spd = spd * (1 - k) + 110 * k
        dirn = (ang + 180) % 360 if k > 0.15 else dirn
    return spd, dirn

# ---------------- spread simulation (time-dependent Dijkstra) ----------------
ROS = [900, 1300, 2000, 0]   # m/h at head, extreme conditions (crowning eucalyptus/pine)
NB = []
for dj in range(-2, 3):
    for di in range(-2, 3):
        if (di, dj) == (0, 0) or (abs(di) == 2 and abs(dj) == 2) or ((abs(di) == 2 or abs(dj) == 2) and (di == 0 or dj == 0)): continue
        NB.append((di, dj, math.hypot(di, dj) * FC))
def diurnal(t):
    h = t % 24; d = min(abs(h - 16), 24 - abs(h - 16)); return math.exp(-(d / 4.5) ** 2)
def rate(t, x, z, dx, dz, slope, f):
    w = wat(t); spd, dirn = wind(t, x, z)
    to = math.radians(dirn + 180); wxv, wzv = math.sin(to), -math.cos(to)
    ws = min(spd / 25, 4.5)
    e = min(0.55 + 0.1 * ws, 0.93)
    cos = dx * wxv + dz * wzv
    ell = (1 - e) / (1 - e * cos)
    sl = min(max(math.exp(3.0 * slope), 0.3), 4.0)
    dry = max(0.15, (45 - w['relative_humidity_2m']) / 25)
    day = 0.12 + 0.88 * diurnal(t)
    return ROS[f] * ell * sl * dry * day * (0.5 + 0.5 * ws)
SIMC = os.path.join(RAW, 'sim.npy')
if os.path.exists(SIMC) and os.path.exists(os.path.join(RAW, 'mask.npy')) and (np.load(os.path.join(RAW, 'mask.npy')) == mask).all():
    heap_skip = True
else:
    heap_skip = False
arr = np.full((FN, FN), np.inf)
done = np.zeros((FN, FN), bool)
heap = []
for g in IGN:
    j, i = cell(g['x'], g['z'])
    # nearest mask cell
    jj, ii = np.unravel_index(np.argmin(np.where(mask, (np.arange(FN)[:, None] - j) ** 2 + (np.arange(FN)[None, :] - i) ** 2, 1e9)), mask.shape)
    arr[jj, ii] = g['t']; heapq.heappush(heap, (g['t'], jj, ii))
T_END = 6 * 24
while heap and not heap_skip:
    t0, j, i = heapq.heappop(heap)
    if done[j, i]: continue
    done[j, i] = True
    x0, z0 = -HALF + (i + 0.5) * FC, -HALF + (j + 0.5) * FC
    for di, dj, dist in NB:
        ii, jj = i + di, j + dj
        if ii < 0 or jj < 0 or ii >= FN or jj >= FN or done[jj, ii] or not mask[jj, ii] or fuel[jj, ii] == 3: continue
        slope = (e4[jj, ii] - e4[j, i]) / dist
        dx, dz = di * FC / dist, dj * FC / dist
        rem, t = dist, t0
        while rem > 0 and t - t0 < 40:
            r = rate(t + 0.05, x0, z0, dx, dz, slope, fuel[jj, ii]); rem -= r * 0.1; t += 0.1
        if rem > 0: continue
        if t < arr[jj, ii]: arr[jj, ii] = t; heapq.heappush(heap, (t, jj, ii))
sim = np.load(SIMC) if heap_skip else arr.copy()
np.save(SIMC, sim); np.save(os.path.join(RAW, 'mask.npy'), mask)
print('sim reached', np.isfinite(sim).sum(), 'of', mask.sum())

# ---------------- calibrate to satellite passes + documented anchors ----------------
# D = earliest time fire was observed at/near each cell (upper bound on arrival)
D = np.full((FN, FN), np.inf)
yy, xx = np.mgrid[0:FN, 0:FN]
for h in sorted(hs, key=lambda q: q['t']):
    R = 450 if h['sat'] == 'VIIRS' else 1000
    j, i = cell(h['x'], h['z']); r = int(math.ceil(R / FC))
    j0, j1, i0, i1 = max(0, j - r), min(FN, j + r + 1), max(0, i - r), min(FN, i + r + 1)
    sub = D[j0:j1, i0:i1]
    np.minimum(sub, h['t'], out=sub, where=((yy[j0:j1, i0:i1] - j) ** 2 + (xx[j0:j1, i0:i1] - i) ** 2) <= r * r)
D[~mask] = np.inf
ANCH = [('Pobrais', 19.0), ('Nodeirinho', 19.25), ('Vila Facaia', 17.0), ('Figueiró dos Vinhos', 24.0), ('Castanheira de Pera', 28.0),
        ('Castanheira de Pêra', 28.0), ('Sertã', 44.2), ('Cernache do Bonjardim', 45.6), ('Derreada Cimeira', 42.0), ('Alge', 42.0)]
anchors = []
for name, t in ANCH:
    if name not in places: continue
    x, z = to_xz(places[name][0], places[name][1]); j, i = cell(x, z)
    if not (0 <= j < FN and 0 <= i < FN): continue
    d2 = np.where(mask, (yy - j) ** 2 + (xx - i) ** 2, 1e9); jj, ii = np.unravel_index(np.argmin(d2), d2.shape)
    if d2[jj, ii] > (2500 / FC) ** 2: print('anchor too far', name); continue
    anchors.append((name, t, jj, ii)); print('anchor', name, t, 'sim', round(float(sim[jj, ii]), 1))
# ---- nested burned regions at each satellite pass, then isochrone interpolation between them ----
from scipy.ndimage import distance_transform_edt as edt, binary_closing, binary_dilation
disk = lambda r: (np.add.outer(np.arange(-r, r + 1) ** 2, np.arange(-r, r + 1) ** 2) <= r * r)
# effective first-observation time: detected cells keep D, undetected burned cells inherit the nearest detection
Dd = np.where(np.isfinite(D) & mask, D, np.inf)
det = np.isfinite(Dd)
_, (iy, ix) = edt(~det, return_indices=True)
Deff = Dd[iy, ix]
Deff[~mask] = np.inf
from collections import Counter
_pc = Counter(round(h['t'], 1) for h in hs)
pass_t = sorted(t for t, n in _pc.items() if n >= 25)
snaps = []
seen = np.zeros((FN, FN), bool)
for t in pass_t:
    reg = (Deff <= t + 0.05) & mask
    reg = (binary_closing(reg, disk(2)) & mask) | seen
    if reg.sum() - seen.sum() < 40: continue
    snaps.append((t, reg.copy())); seen = reg
print('snapshots', [(round(t, 1), int(r.sum() * FC * FC / 1e4)) for t, r in snaps])
# region 0: ignition seeds
seed = np.zeros((FN, FN), bool)
for g in IGN:
    j, i = cell(g['x'], g['z']); seed[max(0, j - 1):j + 2, max(0, i - 1):i + 2] = True
seed &= mask | seed
T_IG = min(g['t'] for g in IGN)
seq = [(T_IG, seed)] + snaps + [(snaps[-1][0] + 14, mask | seed)]
real = np.full((FN, FN), 999.0)
real[seed] = T_IG
# first interval: explosive evening run (slow afternoon, downburst surge 18:30-21:00, slower night)
def first_curve(f):
    return np.interp(f, [0, 0.06, 0.18, 0.62, 0.8, 1.0], [T_IG, 16.5, 18.6, 20.8, 23.0, seq[1][0]])
for k in range(1, len(seq)):
    t0, r0 = seq[k - 1]; t1, r1 = seq[k]
    new_ = r1 & ~r0
    if not new_.any(): continue
    d0 = edt(~r0, sampling=FC)            # distance to previous front
    d1 = edt(r1, sampling=FC)             # distance to outer edge of the new front
    f = d0 / np.maximum(d0 + d1, 1e-6)
    tt = first_curve(f) if k == 1 else t0 + (t1 - t0) * f
    real[new_] = tt[new_]
# local correction toward documented anchors (eye-witness / official timeline)
corr = np.zeros((FN, FN)); wsum = np.zeros((FN, FN))
for name, t, jj, ii in anchors:
    e = t - real[jj, ii]
    g = np.exp(-(((yy - jj) ** 2 + (xx - ii) ** 2) * FC * FC) / (2800 ** 2))
    corr += g * e; wsum += g
real = np.where(mask, real + corr / np.maximum(wsum, 1.0), real)
real[mask] = np.maximum(real[mask], T_IG)
for g in IGN:  # cells right around each ignition burned in the first hours
    j, i = cell(g['x'], g['z'])
    near = (((yy - j) ** 2 + (xx - i) ** 2) * FC * FC < 1500 ** 2) & mask
    real[near] = np.minimum(real[near], g['t'] + np.sqrt(((yy - j) ** 2 + (xx - i) ** 2) * FC * FC)[near] / 1500 * 1.5)
real[~mask] = 999.0
for name, t, jj, ii in anchors: print('check', name, t, '->', round(float(real[jj, ii]), 1))
# smooth slightly
sm = real.copy()
for _ in range(1):
    pad = np.pad(real, 1, mode='edge'); acc = np.zeros_like(real); wsum = np.zeros_like(real)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            v = pad[1 + dj:FN + 1 + dj, 1 + di:FN + 1 + di]; ok = v < 900
            acc += np.where(ok, v, 0); wsum += ok
    sm = np.where(real < 900, acc / np.maximum(wsum, 1), 999)
real = sm.astype('float32')
real.tofile(os.path.join(OUT, 'arrival.f32'))

# area series
times = np.arange(12, 6 * 24 + 0.01, 0.5)
area = [float(((real <= t)).sum() * FC * FC / 1e4) for t in times]
print('area by time', [(int(t), int(a)) for t, a in zip(times[::12], area[::12])])

# ---------------- outputs: fuel, severity ----------------
Image.fromarray(np.clip((dnbr + 0.1) / 1.1 * 255, 0, 255).astype('uint8')).save(os.path.join(OUT, 'dnbr.png'))
fuel.tofile(os.path.join(OUT, 'fuel.u8'))
Image.fromarray(np.clip((ndvi + 0.1) / 1.0 * 255, 0, 255).astype('uint8')).save(os.path.join(OUT, 'ndvi.png'))

# ---------------- vectors from OSM ----------------
def simplify(coords, tol=12):
    from shapely.geometry import LineString
    ls = LineString(coords).simplify(tol); return [[round(a), round(b)] for a, b in ls.coords]
roads, waters, rivers, plist = [], [], [], []
RANK = {'motorway': 0, 'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4, 'unclassified': 5}
for el in osm['elements']:
    tg = el.get('tags', {})
    if el['type'] == 'way' and 'geometry' in el:
        pts2 = [to_xz(p['lon'], p['lat']) for p in el['geometry']]
        if len(pts2) < 2: continue
        if 'highway' in tg:
            roads.append({'c': tg['highway'], 'r': RANK.get(tg['highway'], 6), 'n': tg.get('name', ''), 'ref': tg.get('ref', ''), 'p': simplify(pts2)})
        elif tg.get('waterway') == 'river':
            rivers.append({'n': tg.get('name', ''), 'p': simplify(pts2, 20)})
        elif tg.get('natural') == 'water':
            waters.append({'n': tg.get('name', ''), 'p': simplify(pts2, 10)})
    elif el['type'] == 'relation' and tg.get('natural') == 'water':
        for m in el.get('members', []):
            if m.get('role') == 'outer' and m.get('geometry'):
                waters.append({'n': tg.get('name', ''), 'p': simplify([to_xz(p['lon'], p['lat']) for p in m['geometry']], 10)})
    elif el['type'] == 'node' and 'name' in tg:
        x, z = to_xz(el['lon'], el['lat'])
        if abs(x) < HALF and abs(z) < HALF:
            plist.append({'n': tg['name'], 'k': tg.get('place') or 'peak', 'x': round(x), 'z': round(z), 'ele': tg.get('ele')})
json.dump({'roads': roads, 'rivers': rivers, 'waters': waters, 'places': plist}, open(os.path.join(OUT, 'osm.json'), 'w'), separators=(',', ':'))
print('roads', len(roads), 'waters', len(waters), 'places', len(plist))

# ---------------- weather + meta ----------------
wout = [{'t': t, 'temp': wx['temperature_2m'][k], 'rh': wx['relative_humidity_2m'][k], 'ws': wx['wind_speed_10m'][k], 'wd': wx['wind_direction_10m'][k], 'gust': wx['wind_gusts_10m'][k]} for k, t in enumerate(wt)]
meta = {
    'name': 'Pedrógão Grande', 'lat0': LAT0, 'lon0': LON0, 'half': HALF, 'gn': GN, 'fn': FN, 'imageryN': 2048,
    'dateBase': '2017-06-17', 'month': 'Jun', 'day0': 17,
    'ignitions': IGN, 'downburst': {'x': round(DBX), 'z': round(DBZ), 't0': DB_T0, 't1': DB_T1},
    'weather': wout, 'hotspots': hs,
    'area': {'t': times.tolist(), 'ha': area},
    'burnedHa': float(mask.sum() * FC * FC / 1e4), 'sgifHa': 30358.84 + 17520.65,
}
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), separators=(',', ':'))
print('done')
