"""Bake web-ready assets for data/pedrogao from the pipeline outputs in data/pedrogao/src/.

Moves expensive per-pixel work out of the browser:
  tex_pre.webp / tex_post.webp  — Sentinel-2 imagery pre-lit with hillshade + cast shadows (2048²)
  info.webp                     — RGBA 1024²: R forest density (NDVI), G water (OSM), B dNBR (0..1), A hillshade
  dem.z                         — elevation in decimetres (801²): 2-D predictor residuals (int16), byte planes, zlib
  arrival.z                     — fire arrival in minutes since 17 Jun 00:00, 65535 = unburned (400², uint16, zlib)
  fuel.z / cos.z                — fuel and COS2018 class grids (400², uint8, zlib)
Usage: python bake_web.py data/pedrogao
"""
import json, os, sys, zlib
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates

D = sys.argv[1]
SRC = os.path.join(D, 'src')
meta = json.load(open(os.path.join(D, 'meta.json')))
GN, HALF = meta['gn'], meta['half']
SIZE = 2 * HALF; CELL = SIZE / (GN - 1); VEX = 1.5

dem = np.fromfile(os.path.join(SRC, 'dem.f32'), '<f4').reshape(GN, GN)
dm = np.round(np.clip(dem, 0, 6500) * 10).astype(np.int32)
res = np.zeros_like(dm)               # decoder: v[j,i] = r + v[j,i-1] + v[j-1,i] - v[j-1,i-1]
res[0, 0] = dm[0, 0]; res[0, 1:] = np.diff(dm[0]); res[1:, 0] = np.diff(dm[:, 0])
res[1:, 1:] = dm[1:, 1:] - dm[1:, :-1] - dm[:-1, 1:] + dm[:-1, :-1]
b = res.astype('<i2').view(np.uint8).reshape(-1, 2)
open(os.path.join(D, 'dem.z'), 'wb').write(zlib.compress(b[:, 0].tobytes() + b[:, 1].tobytes(), 9))

arr = np.fromfile(os.path.join(SRC, 'arrival.f32'), '<f4')
a16 = np.where(arr >= 900, 65535, np.clip(np.round(arr * 60), 0, 65534)).astype('<u2')
open(os.path.join(D, 'arrival.z'), 'wb').write(zlib.compress(a16.tobytes(), 9))
for g in ['fuel', 'cos']:
    open(os.path.join(D, f'{g}.z'), 'wb').write(zlib.compress(open(os.path.join(SRC, f'{g}.u8'), 'rb').read(), 9))

# ---- hillshade + cast shadows (same model as the browser bake) ----
sun = np.array([-0.62, 0.62, -0.28]); sun /= np.linalg.norm(sun)
h = dem * VEX
gx = np.gradient(h, CELL, axis=1); gz = np.gradient(h, CELL, axis=0)
ln = np.sqrt(gx ** 2 + 1 + gz ** 2)
nx, ny, nz = -gx / ln, 1 / ln, -gz / ln
lam = np.clip(nx * sun[0] + ny * sun[1] + nz * sun[2], 0, None)
hn = np.hypot(sun[0], sun[2]); sx, sz, sy = sun[0] / hn, sun[2] / hn, sun[1] / hn
jj, ii = np.mgrid[0:GN, 0:GN].astype('float32')
lit = np.ones((GN, GN), 'float32')
step = CELL * 0.75
for k in range(1, 60):
    d = k * step
    ci = ii + sx * d / CELL; cj = jj + sz * d / CELL
    inside = (ci >= 0) & (ci <= GN - 1) & (cj >= 0) & (cj <= GN - 1)
    hh = map_coordinates(h, [cj, ci], order=1, mode='nearest')
    need = h + d * sy
    occ = inside & (hh > need)
    lit = np.where(occ, np.minimum(lit, np.clip(1 - (hh - need) / 40, 0, 1)), lit)
shade = np.clip(0.18 + 0.95 * lam * (0.35 + 0.65 * lit), 0, 1).astype('float32')

def resize(a, n):
    return np.array(Image.fromarray(a.astype('float32'), mode='F').resize((n, n), Image.BILINEAR))

shade2k = resize(shade, 2048)
k = 1.55 * (0.62 + 0.55 * shade2k)
for name in ['pre', 'post']:
    src = np.asarray(Image.open(os.path.join(SRC, f'imagery_{name}.jpg')).convert('RGB').resize((2048, 2048), Image.BILINEAR)).astype('float32') / 255
    out = np.power(src, 0.85) * 255 * k[..., None]
    out[..., 2] *= 0.95
    Image.fromarray(np.clip(out, 0, 255).astype('uint8')).save(os.path.join(D, f'tex_{name}.webp'), 'WEBP', quality=82, method=6)

# ---- info texture ----
IR = 1024
ndvi = np.asarray(Image.open(os.path.join(SRC, 'ndvi.png')).convert('L').resize((IR, IR), Image.BILINEAR)).astype('float32') / 255 - 0.1
veg = np.clip((ndvi - 0.32) / 0.42, 0, 1)
dnbr = np.asarray(Image.open(os.path.join(SRC, 'dnbr.png')).convert('L').resize((IR, IR), Image.BILINEAR)).astype('float32') / 255 * 1.1 - 0.1
osm = json.load(open(os.path.join(D, 'osm.json')))
wimg = Image.new('L', (IR, IR), 0); dr = ImageDraw.Draw(wimg)
px = lambda v: (v + HALF) / SIZE * IR
for w in osm['waters']:
    if len(w['p']) >= 3: dr.polygon([(px(x), px(z)) for x, z in w['p']], fill=255)
for r in osm['rivers']:
    dr.line([(px(x), px(z)) for x, z in r['p']], fill=255, width=1)
water = np.asarray(wimg).astype('float32') / 255
shade1k = resize(shade, IR)
rgba = np.stack([veg, water, np.clip(dnbr, 0, 1), shade1k], -1)
Image.fromarray(np.clip(rgba * 255, 0, 255).astype('uint8'), 'RGBA').save(os.path.join(D, 'info.webp'), 'WEBP', quality=80, alpha_quality=80, method=6)
for f in ['dem.z', 'arrival.z', 'fuel.z', 'cos.z', 'tex_pre.webp', 'tex_post.webp', 'info.webp']:
    print(f, os.path.getsize(os.path.join(D, f)))
