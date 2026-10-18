"""Digitize ANPC resource curves from the ADAI/CEIF official report (Viegas et al. 2017, 'O complexo de incêndios de Pedrógão Grande…'):
Fig. 77a (operatives, 17 Jun 14:30–19:00), Fig. 92a (operatives 17–24 Jun) and Fig. 92b (vehicles by type + aerial means).
Output: series in hours since 2017-06-17 00:00 (appended to data/pedrogao/record.json as 'anpc')."""
import json, sys, os
import numpy as np
from PIL import Image

IMG, OUT = sys.argv[1], sys.argv[2]

def load(f): return np.array(Image.open(os.path.join(IMG, f)).convert('RGB')).astype(int)

def trace(a, mask, x0, x1, xs_to_t, py0, py1, v0, v1, exclude=None, pick='median'):
    out = []
    for x in range(x0, x1):
        if exclude and exclude[0] <= x <= exclude[2]:
            ys = [y for y in np.where(mask[:, x])[0] if not (exclude[1] <= y <= exclude[3]) and py1 <= y <= py0]
        else:
            ys = [y for y in np.where(mask[:, x])[0] if py1 <= y <= py0]
        if not ys: continue
        y = np.median(ys) if pick == 'median' else min(ys)
        out.append((xs_to_t(x), v0 + (py0 - y) / (py0 - py1) * (v1 - v0)))
    return out

def smooth_steps(pts, dt=0.25):
    if not pts: return []
    pts.sort(); res = []; t = pts[0][0]; i = 0
    while t <= pts[-1][0]:
        vals = [v for tt, v in pts if abs(tt - t) <= dt / 2]
        if vals: res.append([round(t, 2), int(round(float(np.median(vals))))])
        t += dt
    return res

series = {}
# Fig 92a — operatives, x: 17/06 00:00 at px 96, 78.14 px/day; y: 0 at 312, 1400 at 11
a = load('p116_0.png')
black = (a.sum(-1) < 150) & (np.abs(a[..., 0] - a[..., 2]) < 30)
orange = (a[..., 0] > 200) & (a[..., 1] > 90) & (a[..., 1] < 180) & (a[..., 2] < 90)
# Excel date axis starts at the first record (17 Jun 14:43); one tick per day
d2t = lambda x: 14.72 + (x - 96) / 78.14 * 24
leg = (120, 12, 320, 90)
series['ops_onscene'] = smooth_steps(trace(a, black, 98, 655, d2t, 311, 11, 0, 1400, leg), 1.0)
series['ops_arrived_cum'] = smooth_steps(trace(a, orange, 98, 655, d2t, 311, 11, 0, 1400, leg, 'min'), 1.0)
# Fig 77a — operatives 14:30–19:00, x: 14:30 at 85, 64.2 px per 30 min; y: 0 at 316, 400 at 15
a = load('p103_2.png')
black = (a.sum(-1) < 150) & (np.abs(a[..., 0] - a[..., 2]) < 30)
red = (a[..., 0] > 170) & (a[..., 1] < 80) & (a[..., 2] < 80)
blue = (a[..., 2] > 170) & (a[..., 0] < 140)
h2t = lambda x: 14.5 + (x - 85) / 64.2 * 0.5
leg = (110, 20, 330, 120)
series['ops_onscene_early'] = smooth_steps(trace(a, black, 96, 662, h2t, 315, 15, 0, 400, leg), 1 / 12)
series['ops_arrived_cum_early'] = smooth_steps(trace(a, red, 96, 662, h2t, 315, 15, 0, 400, leg, 'min'), 1 / 12)
series['ops_dispatched_cum_early'] = smooth_steps(trace(a, blue, 96, 662, h2t, 315, 15, 0, 400, leg, 'min'), 1 / 12)
# Fig 92b — vehicles by type; x: 17/06 at 84, 79.4 px/day; y: 0 at 323, 60 at 11
a = load('p116_1.png')
d2t = lambda x: 14.72 + (x - 84) / 79.4 * 24
leg = (505, 15, 665, 160)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
masks = {
    'VFCI': (a.sum(-1) < 150) & (np.abs(r - b) < 30),
    'VCOT': (r > 200) & (g < 60) & (b < 60),
    'VTTU': (g > 140) & (r < 140) & (b < 120),
    'VUCI': (r > 220) & (g > 110) & (g < 170) & (b < 90),
    'ABSC': (r > 90) & (r < 160) & (b > 140) & (g < 90),
    'air': (b > 150) & (g > 100) & (g < 200) & (r < 150) & (b - r > 60),
}
for k, m in masks.items():
    series['veh_' + k] = smooth_steps(trace(a, m, 87, 660, d2t, 321, 14, 0, 60 * (321 - 14) / (323 - 11), leg), 1.0 if k != 'air' else 0.5)

for k, v in series.items():
    print(k, len(v), v[:3], '…', [p for p in v if abs(p[0] % 12) < 0.01][:14])
rec = json.load(open(OUT))
rec['anpc'] = {'source': 'ANPC data, figures 77 and 92 of the ADAI/CEIF official report (digitized)', **series}
json.dump(rec, open(OUT, 'w'), ensure_ascii=False, indent=1)
