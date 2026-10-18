// Draped 2D overlay painted on a canvas and sampled by the terrain shader.
import * as THREE from 'three';
import { SIZE, HALF, FN, FCELL, UNBURNED, TRAILS, ADMIN, ROADS, MODE } from './core.js';
import { clamp } from './util.js';

// Marching squares: loops where field < level. Returns arrays of [x,z] in world metres.
export function contourLoops(field, N, cell, level, origin = -HALF) {
  const inside = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? false : field[j * N + i] < level);
  const segs = new Map();
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const add = (a, b) => { const ka = key(a); (segs.get(ka) || segs.set(ka, []).get(ka)).push({ a, b }); };
  for (let j = -1; j < N; j++) for (let i = -1; i < N; i++) {
    const c0 = inside(i, j), c1 = inside(i + 1, j), c2 = inside(i + 1, j + 1), c3 = inside(i, j + 1);
    const code = (c0 ? 1 : 0) | (c1 ? 2 : 0) | (c2 ? 4 : 0) | (c3 ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const cx = (k) => origin + (k + 0.5) * cell;
    const T = [cx(i) + cell / 2, cx(j)], R = [cx(i + 1), cx(j) + cell / 2], B = [cx(i) + cell / 2, cx(j + 1)], L = [cx(i), cx(j) + cell / 2];
    const table = {
      1: [[L, T]], 2: [[T, R]], 3: [[L, R]], 4: [[R, B]], 5: [[L, T], [R, B]], 6: [[T, B]], 7: [[L, B]],
      8: [[B, L]], 9: [[B, T]], 10: [[T, R], [B, L]], 11: [[B, R]], 12: [[R, L]], 13: [[R, T]], 14: [[T, L]],
    };
    for (const [a, b] of table[code]) add(a, b);
  }
  const loops = [];
  const used = new Set();
  for (const [k, list] of segs) {
    for (const s of list) {
      if (used.has(s)) continue;
      const loop = [s.a]; used.add(s);
      let cur = s.b; let guard = 0;
      while (guard++ < 100000) {
        loop.push(cur);
        const nxt = (segs.get(key(cur)) || []).find((q) => !used.has(q));
        if (!nxt) break;
        used.add(nxt); cur = nxt.b;
      }
      if (loop.length > 6) loops.push(chaikin(chaikin(loop)));
    }
  }
  return loops.sort((a, b) => b.length - a.length);
}
export function chaikin(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  out.push(out[0]);
  return out;
}
export function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
export function slicePoly(pts, from, to) {
  // sub-polyline between arc lengths
  const out = []; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const s0 = acc, s1 = acc + l;
    if (s1 >= from && s0 <= to) {
      const t0 = clamp((from - s0) / l, 0, 1), t1 = clamp((to - s0) / l, 0, 1);
      if (!out.length) out.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
      out.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
    }
    acc = s1;
  }
  return out;
}

export class Overlay {
  constructor(R = 2048) {
    this.R = R;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = R;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.flipY = false;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.anisotropy = 8;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.lastKey = '';
  }
  px(x) { return (x + HALF) / SIZE * this.R; }
  m(px) { return px / SIZE * this.R; }
  path(pts) {
    const c = this.ctx; c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(this.px(p[0]), this.px(p[1])) : c.moveTo(this.px(p[0]), this.px(p[1]))));
  }
  // pre-rendered radial blobs (one per age colour), stamped with drawImage instead of a gradient per hotspot
  _blob(k) {
    this._blobs = this._blobs || [];
    if (!this._blobs[k]) {
      const col = [[255, 236, 120], [255, 150, 40], [220, 60, 30]][k], n = 64;
      const cv = document.createElement('canvas'); cv.width = cv.height = n; const g = cv.getContext('2d');
      const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.55, `rgba(${col},0.45)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, n, n); this._blobs[k] = cv;
    }
    return this._blobs[k];
  }
  draw(s) {
    // s: { time, map, layers, perimeter, drops, lines, structures }
    const key = JSON.stringify([Math.round(s.time * 4), s.map > 0.5, s.layers, s.lineVersion, s.dropsVersion]);
    if (key === this.lastKey) return false;
    this.lastKey = key;
    const c = this.ctx, R = this.R, map = s.map > 0.5, L = s.layers;
    c.clearRect(0, 0, R, R);
    c.lineJoin = 'round'; c.lineCap = 'round';

    if (L.admin && L.admin.on) {
      c.save(); c.globalAlpha = L.admin.op;
      ADMIN.forEach((p) => { this.path(p); c.setLineDash([this.m(160), this.m(60), this.m(20), this.m(60)]); c.strokeStyle = map ? 'rgba(120,80,150,0.8)' : 'rgba(200,170,230,0.85)'; c.lineWidth = this.m(map ? 22 : 28); c.stroke(); });
      c.restore();
    }
    // raster layers baked by analysis.py (400² RGBA): fire history before 2017 and re-burn after it
    for (const [key, img] of [['history', s.history], ['reburn', s.reburn]]) {
      if (!L[key] || !L[key].on || !img) continue;
      c.save(); c.globalAlpha = L[key].op; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(img, 0, 0, R, R); c.restore();
    }
    if (MODE === 'real' && (L.roads.on || map)) {
      c.save(); c.globalAlpha = L.roads.on ? L.roads.op : 0.8;
      c.setLineDash([]);
      TRAILS.forEach((p) => { this.path(p); c.strokeStyle = map ? 'rgba(255,255,255,0.95)' : 'rgba(255,248,230,0.7)'; c.lineWidth = this.m(map ? 22 : 14); c.stroke(); });
      if (map) ROADS.forEach((r) => { this.path(r.pts); c.strokeStyle = r.deadly ? 'rgba(200,30,30,0.95)' : 'rgba(250,210,120,1)'; c.lineWidth = this.m(r.deadly ? 60 : 40); c.stroke(); });
      c.restore();
    } else if (L.roads.on) {
      c.save(); c.globalAlpha = L.roads.op;
      TRAILS.forEach((p) => { this.path(p); c.setLineDash([this.m(60), this.m(45)]); c.strokeStyle = map ? 'rgba(140,110,80,0.9)' : 'rgba(250,245,230,0.85)'; c.lineWidth = this.m(16); c.stroke(); });
      c.restore();
    }
    if (MODE === 'real') {
      // EN236-1 highlight (3D and map)
      ROADS.filter((r) => r.deadly).forEach((r) => { this.path(r.pts); c.setLineDash([]); c.strokeStyle = 'rgba(210,25,25,0.55)'; c.lineWidth = this.m(70); c.stroke(); });
    }
    // final perimeter (dashed)
    if (s.perimeter && (L.scar.on || L.spread.on)) {
      c.save(); c.setLineDash([this.m(90), this.m(55)]);
      s.perimeter.forEach((loop) => {
        this.path(loop);
        if (!map) { c.strokeStyle = 'rgba(40,30,25,0.35)'; c.lineWidth = this.m(46); c.stroke(); }
        c.strokeStyle = map ? 'rgba(70,60,55,0.85)' : 'rgba(255,255,255,0.92)'; c.lineWidth = this.m(map ? 20 : 26); c.stroke();
      });
      c.restore();
    }
    // suppression: retardant drops & fire line
    if (L.supp.on) {
      c.save();
      s.drops.forEach((d) => {
        if (d.t > s.time) return;
        const age = s.time - d.t;
        const a = clamp(1 - age / 60, 0.12, 1) * L.supp.op;
        const water = d.kind === 'water';
        c.strokeStyle = water ? `rgba(90,150,215,${0.55 * a})` : (map ? `rgba(225,45,55,${0.85 * a})` : `rgba(214,52,40,${0.72 * a})`);
        c.lineWidth = this.m(d.w);
        c.lineCap = 'round';
        // slightly irregular strip: draw a few offset passes
        for (let k = 0; k < 3; k++) {
          c.globalAlpha = k === 0 ? 1 : 0.35;
          c.beginPath();
          const o = (k - 1) * d.w * 0.25;
          c.moveTo(this.px(d.x0 + d.nx * o), this.px(d.z0 + d.nz * o));
          c.lineTo(this.px(d.x1 + d.nx * o), this.px(d.z1 + d.nz * o));
          c.stroke();
        }
      });
      c.globalAlpha = 1;
      // built fire line
      s.lines.forEach((ln) => {
        const built = ln.builtAt(s.time);
        if (built.length < 2) return;
        this.path(built);
        c.setLineDash([]);
        c.strokeStyle = map ? 'rgba(150,80,30,0.9)' : 'rgba(110,70,40,0.55)';
        c.lineWidth = this.m(map ? 24 : 34); c.stroke();
        c.setLineDash([this.m(16), this.m(14)]);
        c.strokeStyle = map ? 'rgba(240,160,70,1)' : 'rgba(255,190,110,0.95)';
        c.lineWidth = this.m(map ? 12 : 18); c.stroke();
        c.setLineDash([]);
      });
      c.restore();
    }
    if (L.hotspots && L.hotspots.on && s.hotspots) {
      // soft heat blobs: satellite pixels are footprints, not crisp squares
      c.save(); c.setLineDash([]); c.globalCompositeOperation = 'source-over';
      for (const h of s.hotspots) {
        if (h.t > s.time + 0.01) continue;
        const age = s.time - h.t; if (age > 18) continue;
        const r = this.m((h.sat === 'VIIRS' ? 260 : 650) * (1 + Math.min(h.frp, 200) / 400));
        const a = Math.pow(1 - age / 18, 1.5) * L.hotspots.op * (map ? 0.75 : 0.6);
        const spr = this._blob(age < 2 ? 0 : age < 8 ? 1 : 2);
        c.globalAlpha = a; c.drawImage(spr, this.px(h.x) - r, this.px(h.z) - r, r * 2, r * 2);
      }
      c.restore();
    }
    if (L.munis && L.munis.on && s.munis) {
      // municipal boundaries: soft halo + dashed line, name at the centroid
      c.save(); c.globalAlpha = L.munis.op; c.lineJoin = 'round';
      for (const m of s.munis) {
        for (const r of m.rings) {
          c.beginPath(); r.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.px(z)) : c.moveTo(this.px(x), this.px(z)))); c.closePath();
          c.setLineDash([]); c.strokeStyle = map ? 'rgba(255,255,255,0.75)' : 'rgba(30,20,50,0.35)'; c.lineWidth = this.m(120); c.stroke();
          c.setLineDash([this.m(220), this.m(110)]); c.strokeStyle = map ? '#6a4c93' : '#f1e9ff'; c.lineWidth = this.m(map ? 40 : 55); c.stroke();
        }
        let sx = 0, sz = 0, n = 0; m.rings.forEach((r) => r.forEach(([x, z]) => { sx += x; sz += z; n++; }));
        c.setLineDash([]); c.font = `600 ${Math.round(this.m(520))}px Inter, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = this.m(120); c.strokeStyle = map ? 'rgba(255,255,255,0.85)' : 'rgba(30,25,20,0.55)'; c.strokeText(m.k.toUpperCase(), this.px(sx / n), this.px(sz / n));
        c.fillStyle = map ? '#5a3f80' : '#f4eeff'; c.fillText(m.k.toUpperCase(), this.px(sx / n), this.px(sz / n));
      }
      c.restore();
    }
    if (L.structures.on && s.structures) {
      c.save(); c.globalAlpha = L.structures.op;
      s.structures.forEach((st) => {
        c.strokeStyle = st.threat ? '#e0461f' : (map ? '#6a5f55' : '#ffffff');
        c.lineWidth = this.m(8);
        c.strokeRect(this.px(st.x) - this.m(22), this.px(st.z) - this.m(22), this.m(44), this.m(44));
      });
      c.restore();
    }
    this.tex.needsUpdate = true;
    return true;
  }
}
