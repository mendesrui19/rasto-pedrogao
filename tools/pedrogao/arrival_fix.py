"""Make the reconstructed arrival-time field causal and continuous, without changing the burned area.

The digitized ADAI isochrones + satellite fusion (digitize.py) leave three artefacts that show up as "pixel" pops:
  * the ignition cells sit alone for hours, then a whole ring appears at the next band time;
  * flat plateaus (≈20% of cells share a band-boundary value) that ignite in the same instant;
  * isolated islands (satellite upper bounds) that burn before the front can reach them.
Fix:
  1. ignition corridors: from each main ignition to the nearest early isochrone cell, timed to arrive on time;
  2. causality: T'(c) = max(T(c), min_n T'(n) + d(n, c) / VMAX), Dijkstra from the ignitions through burned cells only;
  3. light smoothing inside the scar, then causality again so the result stays monotone.
Times can only move later, except inside the ignition cones; unreachable cells keep their original value.
"""
import heapq, math
import numpy as np
from scipy.ndimage import gaussian_filter

VMAX = 8.0    # km/h, fastest allowed front (observed median peak ≈ 4.9 km/h)

def _dijkstra(lower, burned, seeds, fc):
    n = lower.shape[0]
    T = np.full(lower.shape, np.inf)
    step = fc / 1000 / VMAX  # hours per cell
    pq = []
    for (j, i, t) in seeds:
        if 0 <= j < n and 0 <= i < n and t < T[j, i]:
            T[j, i] = t; heapq.heappush(pq, (t, j, i))
    nbrs = [(dj, di, math.hypot(dj, di) * step) for dj in (-1, 0, 1) for di in (-1, 0, 1) if dj or di]
    while pq:
        t, j, i = heapq.heappop(pq)
        if t > T[j, i]: continue
        for dj, di, c in nbrs:
            jj, ii = j + dj, i + di
            if jj < 0 or ii < 0 or jj >= n or ii >= n or not burned[jj, ii]: continue
            nt = max(lower[jj, ii], t + c)
            if nt < T[jj, ii] - 1e-9:
                T[jj, ii] = nt; heapq.heappush(pq, (nt, jj, ii))
    return T

def fix_arrival(arr, meta):
    n = meta['fn']; half = meta['half']; fc = 2 * half / n
    burned = arr < 900
    T = np.where(burned, arr, np.inf).astype('float64')
    jj, ii = np.mgrid[0:n, 0:n]
    cx = -half + (ii + 0.5) * fc; cz = -half + (jj + 0.5) * fc
    seeds = []
    # main ignitions: a narrow corridor from the ignition to the nearest early isochrone cell, timed to reach it on time
    for g in meta['ignitions']:
        x, z, t = g['x'], g['z'], g['t']
        d = np.hypot(cx - x, cz - z)
        early = burned & (T <= t + 4) & (d > 1.5 * fc)
        if early.any():
            k = np.argmin(np.where(early, d, np.inf)); bj, bi = np.unravel_index(k, d.shape)
            bx, bz, tb, db = cx[bj, bi], cz[bj, bi], T[bj, bi], d[bj, bi]
            v0 = max(db / max(tb - t, 0.25), 150.0)                       # m/h
            ux, uz = (bx - x) / db, (bz - z) / db
            along = (cx - x) * ux + (cz - z) * uz; across = np.abs(-(cx - x) * uz + (cz - z) * ux)
            corridor = burned & (along >= -2 * fc) & (along <= db + fc) & (across <= 1.5 * fc + 0.3 * np.clip(along, 0, None))
            T = np.where(corridor, np.minimum(T, t + np.clip(along, 0, None) / v0 + across / v0), T)
        seeds.append((g['z'], g['x'], t))
    # secondary ignitions (spot / new fires) are seeds only: they start the local growth on time, never earlier
    for g in meta.get('extraIgnitions', []): seeds.append((g['z'], g['x'], g['t']))
    sd = []
    for z, x, t in seeds:
        j0, i0 = int((z + half) / fc), int((x + half) / fc)
        if 0 <= j0 < n and 0 <= i0 < n and burned[j0, i0]:
            T[j0, i0] = min(T[j0, i0], t); sd.append((j0, i0, T[j0, i0]))
    lower = np.where(burned, T, np.inf)
    T1 = _dijkstra(lower, burned, sd, fc)
    T1 = np.where(np.isfinite(T1), T1, np.where(burned, arr, np.inf))   # unreachable components keep their value
    # light smoothing inside the scar, bounded to ±0.2 h so the chronology does not drift
    w = burned.astype('float64'); v = np.where(burned, T1, 0)
    sm = gaussian_filter(v, 0.9) / np.maximum(gaussian_filter(w, 0.9), 1e-6)
    sm = np.where(burned, np.clip(sm, T1 - 0.2, T1 + 0.2), np.inf)
    T2 = _dijkstra(sm, burned, sd, fc)
    T2 = np.where(np.isfinite(T2), T2, np.where(burned, sm, np.inf))
    return np.where(burned, T2, 999.0).astype('float32')

if __name__ == '__main__':
    import json, os, sys
    from scipy import ndimage
    D = sys.argv[1]; meta = json.load(open(os.path.join(D, 'meta.json')))
    n = meta['fn']
    a = np.fromfile(os.path.join(D, 'src', 'arrival.f32'), '<f4').reshape(n, n)
    f = fix_arrival(a, meta); b = a < 900
    def stats(x):
        pad = np.pad(np.where(b, x, 1e9), 1, constant_values=1e9)
        nb = np.min([pad[1 + dj:n + 1 + dj, 1 + di:n + 1 + di] for dj in (-1, 0, 1) for di in (-1, 0, 1) if dj or di], axis=0)
        eq = np.zeros_like(b)
        for dj, di in ((0, 1), (1, 0)): eq |= b & (np.abs(x - np.roll(x, (-dj, -di), (0, 1))) < 1e-4)
        return int((b & (x < nb)).sum()), int(eq.sum())
    print('before: local minima %d, plateau cells %d' % stats(a)); print('after:  local minima %d, plateau cells %d' % stats(f))
    d = (f - a)[b]; print('shift h: median %.2f, p95 %.2f, earlier cells %d' % (np.median(d), np.percentile(d, 95), int((d < -0.01).sum())))
    for T in [16, 17, 18, 20, 24, 48]:
        lab, k = ndimage.label(f <= T); print(T, 'components', k, 'ha', int((f <= T).sum() * (2 * meta['half'] / n) ** 2 / 1e4), 'was', int((a <= T).sum() * (2 * meta['half'] / n) ** 2 / 1e4))
