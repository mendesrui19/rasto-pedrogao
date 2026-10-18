// World model independent of rendering: terrain, fuels, roads, fire-spread simulation.
import { makeNoise, mulberry32, clamp, lerp, smoothstep, T } from './util.js';

export let SIZE = 20000;            // metres, world spans [-HALF, HALF] on x (east) and z (south)
export let HALF = SIZE / 2;
export let GN = 401;                // terrain grid vertices per side
export let CELL = SIZE / (GN - 1);  // 50 m
export let BASE = 800;              // elevation mapped to y = 0
export let WATER = 852;             // reservoir surface elevation (m)

export let T_IGNITION = T(14, 14, 26);
export let T_SPOT = T(15, 3, 12);
export let T_RIDGE = T(15, 17, 48);
export let T_RAPID = T(14, 16, 50);
export let T_CONTAIN = T(18, 11, 20);
export let T_START = T(14, 14);
export let T_END = T(18, 12);
export let T_AXIS0 = T(14, 6);

// Scenario configuration. 'synthetic' is the procedural Ridgeview demo; 'real' is loaded from data/ (see real.js).
export let MODE = 'synthetic';
export let AREA_UNIT = 'acres';
export let AREA_DIV = 4046.86;
export let REAL = null;
export function configure(c) {
  MODE = 'real'; REAL = c;
  SIZE = c.size; HALF = SIZE / 2; GN = c.gn; CELL = SIZE / (GN - 1); BASE = c.base; WATER = -1e9;
  FN = c.fn; FCELL = SIZE / FN;
  T_IGNITION = c.tIgnition; T_SPOT = c.tSpot ?? c.tIgnition; T_RIDGE = c.tRidge ?? c.tIgnition; T_RAPID = c.tRapid ?? c.tIgnition;
  T_CONTAIN = c.tContain; T_START = c.tStart; T_END = c.tEnd; T_AXIS0 = c.tAxis0;
  AREA_UNIT = 'ha'; AREA_DIV = 10000;
  for (const k of Object.keys(PLACES)) delete PLACES[k];
  Object.assign(PLACES, c.places);
  ROADS.length = 0; c.roads.forEach((r) => ROADS.push(r));
  TRAILS.length = 0; (c.trails || []).forEach((r) => TRAILS.push(r));
  ADMIN.length = 0; (c.admin || []).forEach((r) => ADMIN.push(r));
}

export const PLACES = {
  ignition: { x: -1700, z: 3500 },
  pineRidge: { x: -6900, z: -5600, name: 'Pine Ridge', elev: 2430, kind: 'peak' },
  mesaPeak: { x: 5200, z: -2400, name: 'Mesa Peak', elev: 1892, kind: 'peak' },
  oakFlats: { x: 5600, z: 4300, name: 'Oak Flats', elev: 1120, kind: 'peak' },
  reservoir: { x: -1600, z: -7500, name: 'Silverwood\nReservoir', kind: 'water' },
  canyonCreek: { x: -5300, z: -600, name: 'Canyon Creek', kind: 'place' },
  staging: { x: -4950, z: 6200, name: 'Staging · Canyon Creek Rd', kind: 'base', letter: 'S' },
  helibase: { x: -5900, z: 2400, name: 'Helibase · Canyon Creek', kind: 'base', letter: 'H' },
};

const noise = makeNoise(7);
const noise2 = makeNoise(31);

// ---------- roads ----------
function catmull(pts, step = 20) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

export const ROADS = [
  { id: 'canyon', name: 'Canyon Creek Rd', width: 9, pts: catmull([
    [-3600, 10400], [-4300, 8600], [-4900, 7200], [-4300, 6300], [-5200, 5300], [-6200, 4300], [-5500, 3300],
    [-5700, 2400], [-6500, 1300], [-5900, 200], [-5000, -800], [-5700, -1900], [-6200, -3000], [-5300, -4100],
    [-4300, -5000], [-4600, -5900], [-3700, -6500], [-2800, -6650]]) },
  { id: 'oak', name: 'Oak Flats Rd', width: 7, pts: catmull([
    [10400, 7600], [8600, 6600], [7400, 5200], [6200, 4700], [5000, 4100], [3900, 4900], [2800, 5600], [1700, 6900], [600, 8200], [-900, 9200], [-2400, 9500], [-3600, 9300], [-4300, 8600]]) },
];
export const TRAILS = [
  catmull([[-5500, 3300], [-4200, 2600], [-3300, 1700], [-2200, 400], [-1200, -800], [300, -1900], [1400, -3300]], 30),
  catmull([[5000, 4100], [4300, 2600], [4700, 900], [5200, -900], [5200, -2400]], 30),
  catmull([[-5000, -800], [-6000, -3400], [-6900, -5600]], 30),
];
export const ADMIN = [
  catmull([[-10000, -2600], [-6000, -3600], [-2000, -2000], [2000, -4200], [6000, -5200], [10000, -4000]], 60),
  catmull([[3200, 10000], [3600, 6000], [7600, 2000], [8200, -2000], [8400, -10000]], 60),
];

function distToPolyline(x, z, pts, stride = 4) {
  let best = 1e9, bi = 0;
  for (let i = 0; i < pts.length - stride; i += stride) {
    const a = pts[i], b = pts[i + stride];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = clamp(t, 0, 1);
    const px = a[0] + dx * t - x, pz = a[1] + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) { best = d; bi = i + t * stride; }
  }
  return { d: Math.sqrt(best), i: bi };
}

// ---------- terrain ----------
function ridged(x, z) {
  let r = 0, amp = 1, f = 1, wsum = 0;
  for (let i = 0; i < 6; i++) {
    let n = 1 - Math.abs(noise(x * f, z * f));
    n = n * n;
    r += n * amp * (i === 0 ? 1 : 0.6 + 0.4 * r / Math.max(wsum, 1e-3));
    wsum += amp; amp *= 0.5; f *= 2.05;
  }
  return r / wsum;
}
const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

const canyonPts = ROADS[0].pts;
export function rawElev(x, z) {
  const u = x / 1000, v = z / 1000;
  const wx = u + 0.9 * noise2(u * 0.11 + 3.1, v * 0.11 + 7.2);
  const wz = v + 0.9 * noise2(u * 0.11 - 5.3, v * 0.11 + 1.7);
  const r = ridged(wx * 0.24, wz * 0.24);
  const broad = 0.5 + 0.5 * noise(u * 0.06 + 11.3, v * 0.06 + 3.9);
  let e = 880 + 1250 * (0.62 * r + 0.38 * broad) - 14 * v;
  // named relief
  e += 700 * gauss(x, z, PLACES.pineRidge.x, PLACES.pineRidge.z, 2600);
  e += 380 * gauss(x, z, PLACES.mesaPeak.x, PLACES.mesaPeak.z, 1700);
  e = lerp(e, 1080 + 60 * r, 0.75 * gauss(x, z, PLACES.oakFlats.x + 600, PLACES.oakFlats.z + 400, 2200));
  // main ridge the fire climbs (ignition -> NE)
  e += 260 * gauss(x, z, 1200, -1800, 3800);
  // canyon creek valley
  const cd = distToPolyline(x, z, canyonPts, 6).d;
  e -= 330 * Math.exp(-((cd / 900) ** 2));
  // reservoir basin
  const t = clamp((x + 4400) / 6400, 0, 1);
  const rz = -7350 - 500 * Math.sin(t * 3.0) + 120 * noise(u * 0.8, 9.1);
  const rw = 650 + 350 * Math.sin(t * Math.PI) + 200 * noise(u * 0.5, 4.2);
  const dz = Math.abs(z - rz);
  const inX = smoothstep(-4600, -4000, x) * (1 - smoothstep(1700, 2400, x));
  const basin = (1 - smoothstep(rw * 0.55, rw * 1.25, dz)) * inX;
  e = lerp(e, Math.min(e, 790), basin);
  return e;
}

export class Terrain {
  constructor(heights) {
    if (heights) { this.h = heights; this.fuelGrid = REAL.fuel; this.vegGrid = REAL.veg; this._benchRoads(); return; }
    this.h = new Float32Array(GN * GN);
    for (let j = 0; j < GN; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < GN; i++) this.h[j * GN + i] = rawElev(-HALF + i * CELL, z);
    }
    this._benchRoads();
  }
  _benchRoads() {
    // smooth road profiles and flatten a bench into the grid
    this.roadProfiles = ROADS.map((road) => {
      const raw = road.pts.map(([x, z]) => this.elevRaw(x, z));
      const sm = raw.slice();
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 1; i < sm.length - 1; i++) sm[i] = (sm[i - 1] + sm[i] * 2 + sm[i + 1]) / 4;
      }
      return sm;
    });
    const h2 = this.h.slice();
    ROADS.forEach((road, ri) => {
      const prof = this.roadProfiles[ri];
      for (let k = 0; k < road.pts.length; k += 2) {
        const [x, z] = road.pts[k];
        const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL);
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= GN || j >= GN) continue;
          const px = -HALF + i * CELL, pz = -HALF + j * CELL;
          const d = Math.hypot(px - x, pz - z);
          const w = 1 - smoothstep(25, 140, d);
          const idx = j * GN + i;
          const target = prof[k] - 0.5;
          const cur = h2[idx];
          h2[idx] = lerp(cur, target, Math.max(w, 0) * (Math.abs(cur - target) > 0 ? 1 : 0));
        }
      }
    });
    this.h = h2;
  }
  elevRaw(x, z) { return this.elev(x, z); }
  elev(x, z) {
    const fx = clamp((x + HALF) / CELL, 0, GN - 1.001), fz = clamp((z + HALF) / CELL, 0, GN - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const h = this.h, a = h[j * GN + i], b = h[j * GN + i + 1], c = h[(j + 1) * GN + i], d = h[(j + 1) * GN + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  // gradient (dh/dx, dh/dz)
  grad(x, z, e = 25) {
    return [(this.elev(x + e, z) - this.elev(x - e, z)) / (2 * e), (this.elev(x, z + e) - this.elev(x, z - e)) / (2 * e)];
  }
  slopeDeg(x, z) { const [gx, gz] = this.grad(x, z, 40); return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; }
  aspectDeg(x, z) { // direction the slope faces (downhill), compass degrees
    const [gx, gz] = this.grad(x, z, 40);
    // downhill = -grad ; compass: north = -z
    const ex = -gx, nz = gz; // east component, north component
    return ((Math.atan2(ex, nz) * 180 / Math.PI) + 360) % 360;
  }
  _grid(g, n, x, z) {
    const i = clamp(Math.floor((x + HALF) / SIZE * n), 0, n - 1), j = clamp(Math.floor((z + HALF) / SIZE * n), 0, n - 1);
    return g[j * n + i];
  }
  // 0 grass, 1 chaparral, 2 conifer, 3 water
  fuel(x, z) {
    if (this.fuelGrid) return this._grid(this.fuelGrid, REAL.fn, x, z);
    const e = this.elev(x, z);
    if (e < WATER) return 3;
    const asp = this.aspectDeg(x, z);
    const north = Math.cos(asp * Math.PI / 180); // 1 north-facing
    const n = noise(x / 900 + 40, z / 900 - 12) * 0.55 + noise(x / 260, z / 260) * 0.25;
    const v = n + north * 0.45 + (e - 1350) / 900 - (this.slopeDeg(x, z) > 38 ? 0.4 : 0);
    if (v > 0.32) return 2;
    if (v > -0.05) return 1;
    return 0;
  }
  // continuous tree density 0..1 used for placement / texture
  treeDensity(x, z) {
    if (this.vegGrid) { const v = this._grid(this.vegGrid, REAL.vegN, x, z); return v; }
    const e = this.elev(x, z);
    if (e < WATER + 4) return 0;
    const asp = this.aspectDeg(x, z);
    const north = Math.cos(asp * Math.PI / 180);
    const n = noise(x / 900 + 40, z / 900 - 12) * 0.55 + noise(x / 260, z / 260) * 0.25 + noise(x / 70, z / 70) * 0.12;
    const v = n + north * 0.45 + (e - 1350) / 900 - (this.slopeDeg(x, z) > 40 ? 0.5 : 0);
    return clamp((v + 0.25) / 0.85, 0, 1);
  }
}

// ---------- weather ----------
export function diurnal(t) {
  const hr = ((t % 24) + 24) % 24;
  let d = Math.abs(hr - 15.5); if (d > 12) d = 24 - d;
  return Math.exp(-((d / 3.8) ** 2));
}
function dayFactor(t) {
  const keys = [[14, 1.5], [24, 1.6], [30, 1.9], [42, 1.7], [50, 0.45], [64, 0.22], [76, 0.08], [88, 0.03], [100, 0.01], [200, 0.0]];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1][0]) { const k = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]); return lerp(keys[i][1], keys[i + 1][1], clamp(k, 0, 1)); }
  }
  return 0;
}
export function weatherAt(t, elev = 1300, x, z) {
  if (REAL) return REAL.weatherAt(t, elev, x, z);
  const d = diurnal(t);
  const day = Math.floor(t / 24);
  const dayHot = [0, 2.5, 1.0, -2.0, -4.0][clamp(day, 0, 4)];
  const temp = 20 + 15 * d + dayHot - (elev - 1300) * 0.0065;
  const rh = clamp(52 - 40 * d - dayHot * 1.5 + (elev - 1300) * 0.004, 6, 80);
  const windSpd = 5 + 11 * d + 3 * Math.sin(t * 0.7) * d + (day === 1 ? 3 : 0);
  const windDir = 238 + 35 * d + 6 * Math.sin(t * 1.3);
  const fm = clamp(2 + rh * 0.12, 2, 14);
  const erc = Math.round(clamp(40 + temp * 1.4 - rh * 0.3, 20, 99));
  return { temp, rh, windSpd, windDir, fm, erc };
}

// ---------- fire simulation ----------
export let FN = 200;            // fire grid cells per side
export let FCELL = SIZE / FN;   // 100 m
export const UNBURNED = 999;

class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const topV = v[0], topK = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.topK = topK; return topV;
  }
  get size() { return this.k.length; }
}

export function simulateFire(terrain, opts = {}) {
  const rosScale = opts.rosScale ?? 0.46;
  const windScale = opts.windScale ?? 1;
  const elev = new Float32Array(FN * FN), fuel = new Uint8Array(FN * FN);
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
    const x = -HALF + (i + 0.5) * FCELL, z = -HALF + (j + 0.5) * FCELL;
    elev[j * FN + i] = terrain.elev(x, z);
    fuel[j * FN + i] = terrain.fuel(x, z);
  }
  // breaks: roads are partial barriers
  const barrier = new Float32Array(FN * FN).fill(1);
  ROADS.forEach((r) => r.pts.forEach(([x, z]) => {
    const i = Math.floor((x + HALF) / FCELL), j = Math.floor((z + HALF) / FCELL);
    if (i >= 0 && j >= 0 && i < FN && j < FN) barrier[j * FN + i] = 0.25;
  }));
  const FUEL_ROS = [1150, 820, 470, 0];
  const arr = new Float32Array(FN * FN).fill(UNBURNED);
  const done = new Uint8Array(FN * FN);
  const heap = new Heap();
  const cellOf = (x, z) => Math.floor((z + HALF) / FCELL) * FN + Math.floor((x + HALF) / FCELL);
  const ig = cellOf(PLACES.ignition.x, PLACES.ignition.z);
  arr[ig] = T_IGNITION; heap.push(T_IGNITION, ig);
  const spot = opts.spot ?? { x: 1250, z: -2350 };
  const sp = cellOf(spot.x, spot.z);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const r = Math.hypot(di, dj); if (r > 2.3) continue;
    const c = sp + dj * FN + di; const tt = T_SPOT + r * 0.4;
    arr[c] = tt; heap.push(tt, c);
  }

  const NB = [];
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    if (!di && !dj) continue;
    if (Math.abs(di) === 2 && Math.abs(dj) === 2) continue;
    if ((Math.abs(di) === 2 || Math.abs(dj) === 2) && (Math.abs(di) === 0 || Math.abs(dj) === 0)) continue;
    NB.push([di, dj, Math.hypot(di, dj) * FCELL]);
  }
  const E = opts.ecc ?? 0.93;
  const rateFn = (t, dirx, dirz, slope, f) => {
    const w = weatherAt(t);
    const wr = (w.windDir - 40 + 180) * Math.PI / 180; // direction the (terrain-channelled) wind blows TOWARD
    const wx = Math.sin(wr), wz = -Math.cos(wr);
    const ws = clamp(w.windSpd / 16, 0.2, 1.4) * windScale;
    const e = clamp(E * Math.min(ws, 1.05), 0, 0.95);
    const cos = dirx * wx + dirz * wz;
    const ell = (1 - e) / (1 - e * cos);
    const sl = clamp(Math.exp(2.6 * slope), 0.35, 3.2);
    return FUEL_ROS[f] * rosScale * (0.1 + 0.9 * diurnal(t)) * dayFactor(t) * ell * sl * (0.6 + 0.4 * ws);
  };
  while (heap.size) {
    const c = heap.pop(); const t0 = heap.topK;
    if (done[c]) continue; done[c] = 1;
    if (t0 > T_CONTAIN) break;
    const ci = c % FN, cj = (c / FN) | 0;
    for (const [di, dj, dist] of NB) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= FN || j >= FN) continue;
      const n = j * FN + i;
      if (done[n] || fuel[n] === 3) continue;
      const slope = (elev[n] - elev[c]) / dist;
      const dx = di * FCELL / dist, dz = dj * FCELL / dist;
      // integrate travel through time-varying rate
      let rem = dist, t = t0, ok = true;
      const f = fuel[n];
      while (rem > 0) {
        const r = rateFn(t + 0.125, dx, dz, slope, f) * barrier[n];
        rem -= r * 0.25; t += 0.25;
        if (t - t0 > 30 || t > T_CONTAIN) { ok = false; break; }
      }
      if (!ok) continue;
      if (t < arr[n]) { arr[n] = t; heap.push(t, n); }
    }
  }
  // light smoothing of burned arrival field to remove grid artefacts
  const sm = arr.slice();
  for (let j = 1; j < FN - 1; j++) for (let i = 1; i < FN - 1; i++) {
    const c = j * FN + i; if (arr[c] >= UNBURNED) continue;
    let s = 0, w = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const v = arr[c + dj * FN + di]; if (v >= UNBURNED) continue;
      const ww = di || dj ? 1 : 2; s += v * ww; w += ww;
    }
    sm[c] = s / w;
  }
  sm[ig] = T_IGNITION;
  return new FireResult(sm, terrain);
}

export class FireResult {
  constructor(arr, terrain) {
    this.arr = arr;
    this.terrain = terrain;
    this._stats();
  }
  arrivalAt(x, z) {
    const fx = clamp((x + HALF) / FCELL - 0.5, 0, FN - 1.001), fz = clamp((z + HALF) / FCELL - 0.5, 0, FN - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = this.arr;
    const v = [a[j * FN + i], a[j * FN + i + 1], a[(j + 1) * FN + i], a[(j + 1) * FN + i + 1]];
    if (v.some((q) => q >= UNBURNED)) {
      // nearest
      return a[Math.round(fz) * FN + Math.round(fx)];
    }
    return lerp(lerp(v[0], v[1], tx), lerp(v[2], v[3], tx), tz);
  }
  _stats() {
    const a = this.arr; const AX = 0.6, AZ = -0.8; // NE axis
    const ig = PLACES.ignition;
    const radial = MODE === 'real';
    this.cells = [];
    for (let c = 0; c < a.length; c++) if (a[c] < UNBURNED) this.cells.push(c);
    this.cells.sort((p, q) => a[p] - a[q]);
    const cellXZ = (c) => [-HALF + (c % FN + 0.5) * FCELL, -HALF + (((c / FN) | 0) + 0.5) * FCELL];
    this.cellXZ = cellXZ;
    // hourly samples
    this.times = []; this.area = []; this.head = []; this.ros = [];
    let k = 0, count = 0; let best = -1e9, bestPos = [ig.x, ig.z];
    for (let t = T_AXIS0; t <= T_END + 0.001; t += 0.5) {
      while (k < this.cells.length && a[this.cells[k]] <= t) {
        const [x, z] = cellXZ(this.cells[k]);
        const p = radial ? Math.hypot(x - ig.x, z - ig.z) * ((REAL.headFilter ? REAL.headFilter(x, z) : 1)) : (x - ig.x) * AX + (z - ig.z) * AZ;
        if (p > best) { best = p; bestPos = [x, z]; }
        k++; count++;
      }
      this.times.push(t);
      this.area.push(count * FCELL * FCELL / AREA_DIV);
      this.head.push({ x: bestPos[0], z: bestPos[1], p: Math.max(best, 0) });
    }
    // ROS in chains/hr (from head advance + perimeter growth), smoothed
    const raw = this.times.map((t, i) => {
      if (i < 2) return 0;
      if (radial) return Math.max(0, this.area[i] - this.area[i - 2]); // growth, ha per hour
      const da = (this.area[i] - this.area[i - 2]) * 4046.86; // m2 per hour
      const r = Math.sqrt(Math.max(da, 0)) * 0.9 / 20.117;
      return r;
    });
    this.ros = raw.map((v, i) => {
      let s = 0, w = 0; for (let d = -2; d <= 2; d++) { const q = raw[i + d]; if (q === undefined) continue; s += q; w++; }
      return s / w;
    });
    this.finalAcres = this.area[this.area.length - 1];
  }
  sampleSeries(series, t) {
    const i = clamp((t - T_AXIS0) / 0.5, 0, this.times.length - 1.001);
    const i0 = Math.floor(i); const f = i - i0;
    const s = this[series];
    if (series === 'head') { const a = s[i0], b = s[i0 + 1] || a; return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) }; }
    return lerp(s[i0], s[i0 + 1] ?? s[i0], f);
  }
  // active fire cells near time t (hours window)
  activeCells(t, win = 1.2) {
    const out = [];
    for (const c of this.cells) {
      const d = t - this.arr[c];
      if (d >= 0 && d < win) out.push(c);
    }
    return out;
  }
}

export function buildTrees(terrain, fire, count = 52000, seed = 5, densFn = null) {
  const rnd = mulberry32(seed);
  const trees = [];
  let attempts = 0;
  while (trees.length < count && attempts < count * 12) {
    attempts++;
    const x = (rnd() * 2 - 1) * (HALF - 200), z = (rnd() * 2 - 1) * (HALF - 200);
    const d = densFn ? densFn(x, z) : terrain.treeDensity(x, z);
    // denser near the centre so close-ups look rich
    const centre = MODE === 'real' ? 1 : 1 - smoothstep(6000, 10000, Math.hypot(x - 300, z + 400));
    if (rnd() > Math.pow(d, 2.6) * (0.3 + 0.7 * centre)) continue;
    let near = false;
    for (const r of ROADS) { if (r.bbox && (x < r.bbox[0] - 30 || x > r.bbox[2] + 30 || z < r.bbox[1] - 30 || z > r.bbox[3] + 30)) continue; if (distToPolyline(x, z, r.pts, 8).d < 22) { near = true; break; } }
    if (near) continue;
    const conifer = rnd() < 0.35 + d * 0.5;
    const s = conifer ? 14 + rnd() * 16 : 10 + rnd() * 9;
    trees.push({ x, z, y: terrain.elev(x, z), s, conifer, rot: rnd() * 6.28, arr: fire ? fire.arrivalAt(x, z) : UNBURNED, tint: rnd() });
  }
  return trees;
}

export function roadAt(roadIdx, s) {
  // s in metres along road -> {x,z,heading,elev}
  const road = ROADS[roadIdx];
  if (!road._cum) {
    road._cum = [0];
    for (let i = 1; i < road.pts.length; i++) road._cum.push(road._cum[i - 1] + Math.hypot(road.pts[i][0] - road.pts[i - 1][0], road.pts[i][1] - road.pts[i - 1][1]));
    road.length = road._cum[road._cum.length - 1];
  }
  const L = road.length; s = ((s % L) + L) % L;
  let lo = 0, hi = road._cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (road._cum[m] <= s) lo = m; else hi = m; }
  const f = (s - road._cum[lo]) / Math.max(1e-6, road._cum[hi] - road._cum[lo]);
  const a = road.pts[lo], b = road.pts[hi];
  return { x: lerp(a[0], b[0], f), z: lerp(a[1], b[1], f), heading: Math.atan2(b[0] - a[0], -(b[1] - a[1])), idx: lo + f };
}
export function roadLength(roadIdx) { roadAt(roadIdx, 0); return ROADS[roadIdx].length; }
export { distToPolyline };
