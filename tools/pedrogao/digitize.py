"""Digitize the ADAI/CEIF official fire-progression map (Ribeiro et al. 2020, Fire 3:57, Fig. 1)
into an arrival-time grid aligned with the FireTrace domain, then interpolate inside each isochrone band."""
import json, os, sys, math
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.ndimage import distance_transform_edt as edt

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1]
im = np.array(Image.open(os.path.join(S, 'docs', 'p1_0_Image27.jpg')).convert('RGB')).astype(float)
H, W, _ = im.shape
LEG = np.array([[191, 191, 191], [245, 115, 88], [254, 101, 33], [251, 178, 38], [249, 225, 38], [208, 254, 54], [13, 251, 47], [152, 253, 52],
                [38, 244, 249], [67, 196, 250], [96, 123, 250], [110, 24, 247], [224, 35, 251], [254, 31, 173], [252, 48, 32]], float)
TIMES = np.array([16, 18, 19, 19.5, 19.75, 20, 20.25, 20.5, 22, 23.98, 36, 47.98, 71.98, 95.98, 119.98])
# classify: nearest legend colour, only for saturated "flat" pixels
d = np.linalg.norm(im[:, :, None, :] - LEG[None, None], axis=-1)
cls = d.argmin(-1); dmin = d.min(-1)
sat = im.max(-1) - im.min(-1)
# fire polygons are flat fills: low local colour variance (terrain hillshade is textured)
var = sum(ndimage.uniform_filter(im[:, :, c] ** 2, 3) - ndimage.uniform_filter(im[:, :, c], 3) ** 2 for c in range(3))
ok = (dmin < 32) & ((sat > 120) | (cls == 0)) & (var < 1200)
ok[:, 980:] = False                      # legend panel
cls = np.where(ok, cls, -1)
# light smoothing: mode filter to remove speckle / labels
for _ in range(2):
    out = cls.copy()
    for k in range(len(LEG)):
        m = ndimage.uniform_filter((cls == k).astype(float), 5)
        out = np.where((m > 0.5), k, out)
    cls = out
# fill gaps left by roads/borders/labels: close the fire footprint, drop specks, then give gap pixels their nearest class
fire = cls >= 0
lab, n = ndimage.label(fire); sizes = ndimage.sum(fire, lab, range(1, n + 1))
fire = np.isin(lab, 1 + np.where(sizes >= 300)[0])
yy, xx = np.mgrid[-9:10, -9:10]; disk = (xx ** 2 + yy ** 2) <= 81
fire = ndimage.binary_closing(fire, disk, iterations=1)
fire = ndimage.binary_fill_holes(fire)
fire[:, 980:] = False
good = (cls >= 0) & fire
_, (iy, ix) = edt(~good, return_indices=True)
cls = np.where(fire, cls[iy, ix], -1)
print('classified px', (cls >= 0).sum())

meta = json.load(open(os.path.join(OUT, 'meta.json')))
pg = meta['ignitions'][0]
FN = meta['fn']; HALF = meta['half']; FC = 2 * HALF / FN
mask = np.load(os.path.join(S, 'raw', 'mask.npy'))
EX, EY = 502, 517          # Escalos Fundeiros marker (px)
SCALE = 10000 / 201.0      # m per px from the scale bar

def raster(dx, dy, sc):
    # sample the classified map at each domain cell centre
    jj, ii = np.mgrid[0:FN, 0:FN]
    x = -HALF + (ii + 0.5) * FC; z = -HALF + (jj + 0.5) * FC
    px = EX + (x - pg['x'] - dx) / sc; py = EY + (z - pg['z'] - dy) / sc
    inside = (px >= 0) & (px < W) & (py >= 0) & (py < H)
    v = np.full((FN, FN), -1)
    v[inside] = cls[py[inside].astype(int), px[inside].astype(int)]
    return v
best = None
for sc in [SCALE * f for f in (0.98, 0.99, 1.0, 1.01, 1.02)]:
    for dx in range(-3000, 3001, 200):
        for dy in range(-3000, 3001, 200):
            v = raster(dx, dy, sc) >= 0
            iou = (v & mask).sum() / max((v | mask).sum(), 1)
            if best is None or iou > best[0]: best = (iou, dx, dy, sc)
print('best IoU %.3f dx %d dz %d scale %.2f' % best)
_, dx, dy, sc = best
v = raster(dx, dy, sc)
mapped = v >= 0
print('map burned ha', mapped.sum() * FC * FC / 1e4, 'S2 ha', mask.sum() * FC * FC / 1e4)

# class time per cell; fill S2-burned cells the map misses with nearest class; drop map cells outside S2 scar
tcell = np.where(mapped, TIMES[np.clip(v, 0, None)], np.inf)
_, (iy, ix) = edt(~mapped, return_indices=True)
tfill = tcell[iy, ix]
tclass = np.where(mask, tfill, np.inf)

# interpolate arrival within each band: between region(t_{k-1}) and region(t_k)
IGN = [(pg['x'], pg['z'], 14 + 43 / 60)]
mi = meta['ignitions'][1]; IGN.append((mi['x'], mi['z'], 14 + 48 / 60))
def cellof(x, z): return int((z + HALF) / FC), int((x + HALF) / FC)
seed = np.zeros((FN, FN), bool)
for x, z, t in IGN:
    j, i = cellof(x, z); seed[max(0, j - 1):j + 2, max(0, i - 1):i + 2] = True
levels = [14.72] + list(TIMES)
real = np.full((FN, FN), 999.0)
prev = seed.copy(); real[seed] = 14.72; tprev = 14.72
lowb = np.full((FN, FN), 14.72)
for t in TIMES:
    reg = (tclass <= t + 1e-6) | prev
    new = reg & ~prev
    if new.any():
        d0 = edt(~prev, sampling=FC); d1 = edt(reg, sampling=FC)
        f = d0 / np.maximum(d0 + d1, 1e-6)
        real[new] = (tprev + (t - tprev) * f)[new]
        lowb[new] = tprev
    prev = reg; tprev = t
real[~mask] = 999.0
# --- data fusion: satellite detections are upper bounds on arrival (fire seen burning there at time t) ---
hs = meta['hotspots']
D = np.full((FN, FN), np.inf)
yy, xx = np.mgrid[0:FN, 0:FN]
for h in hs:
    r = 2 if h['sat'] == 'VIIRS' else 4
    j, i = cellof(h['x'], h['z'])
    j0, j1, i0, i1 = max(0, j - r), min(FN, j + r + 1), max(0, i - r), min(FN, i + r + 1)
    sub = D[j0:j1, i0:i1]
    np.minimum(sub, h['t'] - 0.5, out=sub, where=((yy[j0:j1, i0:i1] - j) ** 2 + (xx[j0:j1, i0:i1] - i) ** 2) <= r * r)
fix = mask & np.isfinite(D) & (D < real)
real[fix] = np.maximum(D[fix], lowb[fix])
print('cells advanced by satellite evidence', int(fix.sum()))
# keep the field smooth and causal: a cell cannot burn earlier than ~its fastest neighbour path allows (light min-smoothing)
for _ in range(2):
    pad = np.pad(real, 1, mode='edge')
    nb = np.min([pad[1 + dj:FN + 1 + dj, 1 + di:FN + 1 + di] for dj in (-1, 0, 1) for di in (-1, 0, 1)], axis=0)
    real = np.where(mask, np.maximum(np.minimum(real, nb + 1.0), lowb), real)
real[~mask] = 999.0
real = real.astype('float32')
real.tofile(os.path.join(OUT, 'arrival.f32'))
np.save(os.path.join(S, 'raw', 'arrival_adai.npy'), real)
for t in [18, 19.5, 20.5, 24, 36, 48, 72, 96, 120]:
    print(t, int((real <= t).sum() * FC * FC / 1e4), 'ha')
# record the alignment
meta['progressionSource'] = {'name': 'ADAI/CEIF — Ribeiro et al. 2020, Fire 3(4):57, Fig. 1 (estimated fire progression)', 'iou': round(best[0], 3), 'offset_m': [dx, dy], 'm_per_px': round(sc, 2)}
meta['area'] = {'t': list(np.arange(12, 144.01, 0.5)), 'ha': [float((real <= t).sum() * FC * FC / 1e4) for t in np.arange(12, 144.01, 0.5)]}
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), separators=(',', ':'))
Image.fromarray(((cls >= 0) * 255).astype('uint8')).save(os.path.join(S, 'docs', 'cls_mask.png'))
