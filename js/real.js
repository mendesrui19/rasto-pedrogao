// Loads a real incident from data/<id>/ (built by the Python pipeline) and configures the app for it.
import * as C from './core.js';
import { setCalendar, setGeo, clamp, lerp, mulberry32 } from './util.js';

const KEY_VILLAGES = ['Pobrais', 'Nodeirinho', 'Vila Facaia', 'Escalos Fundeiros', 'Escalos Cimeiros', 'Fonte Limpa', 'Graça', 'Derreada Cimeira',
  'Mosteiro', 'Coelhal', 'Regadas', 'Alge', 'Sarzedas de São Pedro', 'Pera', 'Aguda', 'Moita', 'Casal de São Simão'];

// info.webp (baked offline by tools/pedrogao/bake_web.py): r forest density, g water, b dNBR 0..1, a hillshade
async function infoImage(url, n) {
  const img = await loadBitmap(url);
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data; const veg = new Float32Array(n * n), dnbr = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) { veg[i] = d[i * 4] / 255; dnbr[i] = d[i * 4 + 2]; }
  return { img, veg, dnbr };
}
// dem.z: int16 residuals of the 2-D predictor v = r + left + up - upleft, stored as low/high byte planes
function decodeDem(b, n) {
  const N = n * n, v = new Int32Array(N), out = new Float32Array(N);
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
    const r = ((b[N + k] << 24) >> 16) | b[k];
    v[k] = r + (i ? v[k - 1] : 0) + (j ? v[k - n] : 0) - (i && j ? v[k - n - 1] : 0);
    out[k] = v[k] / 10;
  }
  return out;
}
export async function loadImage(url) { const img = new Image(); img.src = url; await img.decode(); return img; }
// fetch with a couple of retries (flaky mobile links, dropped connections)
async function get(url, tries = 3) {
  for (let k = 1; ; k++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r; } catch (e) { if (k >= tries) throw e; await new Promise((res) => setTimeout(res, 300 * k)); }
  }
}
// decoded off the main thread, unpremultiplied — ready for a GPU upload
export async function loadBitmap(url) {
  const blob = await get(url).then((r) => r.blob());
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

const DATA_V = 2;
export async function loadReal(id, progress = () => {}) {
  const base = `data/${id}/`;
  const u = (f) => `${base}${f}?v=${DATA_V}`; // bump DATA_V whenever the baked files change (they are cached for a day)
  progress('Loading incident data', 0.03);
  // everything in parallel; the pre-fire texture download starts now and is awaited by the 3D world
  const json = (f) => get(u(f)).then((r) => r.json());
  const inflate = (f) => get(u(f)).then((r) => new Response(r.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const VN = 1024;
  const preImg = loadBitmap(u('tex_pre.webp'));
  const [meta, osm, record, icnf, demB, arrB, fuelB, cosB, info, outerB] = await Promise.all([
    json('meta.json'), json('osm.json'), json('record.json'), json('icnf_perimeters.json').catch(() => null),
    inflate('dem.z'), inflate('arrival.z'), inflate('fuel.z'), inflate('cos.z').catch(() => null), infoImage(u('info.webp'), VN), inflate('outer.z').catch(() => null)]);
  progress('Loading terrain & fire record', 0.1);
  setCalendar('Jun', 17);
  setGeo(meta.lat0, meta.lon0);

  const size = meta.half * 2;
  // dem in decimetres, arrival in minutes since 17 Jun 00:00 (65535 = unburned → 999 h)
  const dem = decodeDem(new Uint8Array(demB), meta.gn);
  const arr16 = new Uint16Array(arrB), arr = new Float32Array(arr16.length);
  for (let i = 0; i < arr.length; i++) arr[i] = arr16[i] === 65535 ? 999 : arr16[i] / 60;
  const fuel = new Uint8Array(fuelB);
  const veg = info.veg; // forest density from pre-fire NDVI

  // ---- places ----
  const P = {};
  const pl = osm.places;
  const find = (n) => pl.find((p) => p.n === n);
  const [pg, go] = meta.ignitions;
  P.ignition = { x: pg.x, z: pg.z };
  P.ignition2 = { x: go.x, z: go.z };
  pl.filter((p) => p.k === 'town').forEach((p, i) => (P[`town${i}`] = { x: p.x, z: p.z, name: p.n, kind: 'place' }));
  KEY_VILLAGES.forEach((n, i) => { const p = find(n); if (p) P[`v${i}`] = { x: p.x, z: p.z, name: n, kind: 'village' }; });
  pl.filter((p) => p.k === 'peak' && p.ele).sort((a, b) => parseFloat(b.ele) - parseFloat(a.ele)).slice(0, 4)
    .forEach((p, i) => (P[`peak${i}`] = { x: p.x, z: p.z, name: p.n, elev: Math.round(parseFloat(p.ele)), kind: 'peak' }));
  const bigWater = osm.waters.filter((w) => w.n).map((w) => ({ w, a: polyArea(w.p) })).sort((a, b) => b.a - a.a)[0];
  if (bigWater) { const c = centroid(bigWater.w.p); P.water0 = { x: c[0], z: c[1], name: bigWater.w.n, kind: 'water' }; }
  const pgTown = find('Pedrógão Grande'), fvTown = find('Figueiró dos Vinhos');
  if (pgTown) P.staging = { x: pgTown.x + 350, z: pgTown.z + 250, name: 'BV Pedrógão Grande', kind: 'base', letter: 'B' };
  if (fvTown) P.helibase = { x: fvTown.x - 300, z: fvTown.z + 300, name: 'BV Figueiró dos Vinhos', kind: 'base', letter: 'B' };
  const en2361 = osm.main.filter((r) => r.ref === 'EN 236-1').sort((a, b) => b.len - a.len)[0];
  const nod = find('Nodeirinho');
  if (nod) P.en2361 = { x: nod.x + 150, z: nod.z - 250, name: 'EN236-1', kind: 'memorial' };

  // ---- roads (merged OSM routes) ----
  const roads = osm.main.map((r, i) => {
    const xs = r.p.map((p) => p[0]), zs = r.p.map((p) => p[1]);
    const pts = densify(r.p, 25);
    return { id: `r${i}`, name: r.ref, width: r.ref.startsWith('IC') ? 11 : r.ref.startsWith('EN') ? 8 : 7, pts, bbox: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], deadly: r.ref === 'EN 236-1' };
  });
  const minor = osm.roads.filter((r) => r.r >= 4 || !r.ref).map((r) => r.p);

  // ---- weather (ERA5 hourly) + downburst ----
  const W = meta.weather;
  const db = meta.downburst;
  const weatherAt = (t, elev = 400, x, z) => {
    const i = clamp(W.findIndex((w) => w.t > t) - 1, 0, W.length - 2); const a = W[i], b = W[i + 1]; const f = clamp(t - a.t, 0, 1);
    let dd = ((b.wd - a.wd + 540) % 360) - 180;
    let windSpd = lerp(a.ws, b.ws, f), windDir = (a.wd + dd * f + 360) % 360, gust = lerp(a.gust, b.gust, f);
    let downburst = 0;
    if (t > db.t0 && t < db.t1 && x !== undefined) {
      const k = Math.sin(Math.PI * (t - db.t0) / (db.t1 - db.t0)) * Math.exp(-((Math.hypot(x - db.x, z - db.z) / 7000) ** 2));
      if (k > 0.05) { downburst = k; windSpd = lerp(windSpd, 110, k); gust = lerp(gust, 130, k); windDir = (Math.atan2(x - db.x - 3000, -(z - db.z + 500)) * 180 / Math.PI + 360) % 360; }
    }
    const temp = lerp(a.temp, b.temp, f) - (elev - 400) * 0.0065;
    const rh = lerp(a.rh, b.rh, f);
    const fm = clamp(1.5 + rh * 0.1 + Math.max(0, 25 - temp) * 0.05, 2, 20);
    const fwi = t < 24 ? 34.8 : null;  // SGIF FWI for 17 Jun (daily)
    return { temp, rh, windSpd, windDir, gust, fm, erc: fwi, downburst, unit: 'km/h' };
  };

  // ---- resources & casualties step series ----
  const step = (arrS, key) => (t) => { let v = null; for (const r of arrS) { if (r.t <= t && r[key] !== null && r[key] !== undefined) v = r[key]; } return v; };
  // ANPC series digitized from the official ADAI report take precedence over press figures
  const A = record.anpc;
  const fromSeries = (s) => (t) => { let v = null; for (const [tt, vv] of s) { if (tt <= t) v = vv; else break; } return v; };
  const opsA = A ? fromSeries([...A.ops_onscene_early, ...A.ops_onscene.filter(([t]) => t > 19.1)]) : null;
  const vehA = A ? (t) => { const ks = ['VFCI', 'VCOT', 'VTTU', 'VUCI', 'ABSC']; let n = 0, any = false; ks.forEach((k) => { const v = fromSeries(A['veh_' + k])(t); if (v !== null) { n += v; any = true; } }); return any ? n : null; } : null;
  const res = {
    ops: opsA || step(record.resources, 'ops'), veh: vehA || step(record.resources, 'veh'), air: step(record.resources, 'air'),
    opsPress: step(record.resources, 'ops'),
    opsArr: A ? fromSeries([...A.ops_arrived_cum_early, ...A.ops_arrived_cum.filter(([t]) => t > 19.1)]) : null,
    dead: step(record.casualties, 'dead'), inj: step(record.casualties, 'inj'),
  };

  // progression path through documented places (Pedrógão fire) and Góis
  const extra = meta.extraIgnitions || [];
  const reg = extra.find((e) => e.name === 'Regadas');
  const path = (names) => names.map(([n, t]) => { const p = n === 'PG' ? pg : n === 'GO' ? go : n === 'RG' ? reg : find(n); return p ? { x: p.x, z: p.z, t, name: n } : null; }).filter(Boolean);
  // times of the later nodes are filled from the official isochrones once the arrival grid is loaded
  const paths = [
    path([['PG', pg.t], ['Nodeirinho', 0], ['Figueiró dos Vinhos', 0]]),
    path([['RG', 16.25], ['Castanheira de Pera', 0]]),
    path([['GO', go.t], ['Alvares', 0]]),
  ];

  const cfg = {
    id, meta, record, osm, size, gn: meta.gn, fn: meta.fn, base: 0,
    tIgnition: Math.min(pg.t, go.t), extraIgnitions: extra, tContain: Math.max(...meta.ignitions.map((g) => g.ext)),
    tStart: 12, tEnd: 6 * 24, tAxis0: 12,
    places: P, roads, trails: minor, admin: [],
    fuel, veg, vegN: VN, cos: cosB ? new Uint8Array(cosB) : null, dnbr: info.dnbr, dnbrN: VN, infoImg: info.img, preImg,
    weatherAt, res, paths, imagery: { pre: u('tex_pre.webp'), post: u('tex_post.webp') },
    hotspots: meta.hotspots, dem, arr, icnf,
    outer: outerB ? { h: new Uint16Array(outerB), n: 241, size: 150000 } : null,
    areaUnit: 'ha', liquid: 'L',
  };
  C.configure(cfg);
  return cfg;
}

function densify(pts, step) {
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(l / step));
    for (let k = 1; k <= n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]);
  }
  return out;
}
function polyArea(p) { let s = 0; for (let i = 0; i < p.length - 1; i++) s += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]; return Math.abs(s / 2); }
function centroid(p) { let x = 0, z = 0; p.forEach((q) => { x += q[0]; z += q[1]; }); return [x / p.length, z / p.length]; }

// Illustrative unit roster for the 3D view. Counts and arrival times follow the documented record; positions are illustrative.
export function realUnits(cfg) {
  const L = 3.785;
  const air = [
    // windows on scene from CTI Quadro 8.1 (ANPC daily mission control)
    ...(cfg.record.cti ? cfg.record.cti.airWindows : []).map((a) => ({ id: a.id, type: a.type, model: 'huey', cap: 900, agency: 'ANPC (CTI, Quadro 8.1)', role: 'heli', speed: 100, liquid: 'water', windows: a.win, from: a.win[0][0] })),
    { id: 'H-KAMOV', type: 'Heli pesado Kamov · ANPC (após 18 jun)', model: 'skycrane', cap: 4500, agency: 'ANPC', role: 'heli', speed: 110, liquid: 'water', from: 32 },
    { id: 'CL-ES', type: 'Canadair CL-415 · Espanha', model: 'rj85', cap: 6100, agency: 'UE — Espanha', role: 'tanker', speed: 180, liquid: 'water', from: 36 },
    { id: 'CL-FR', type: 'Canadair CL-415 · França', model: 'rj85', cap: 6100, agency: 'UE — França (rescEU)', role: 'tanker', speed: 180, liquid: 'water', from: 36 },
    { id: 'CL-IT', type: 'Canadair CL-415 · Itália', model: 'rj85', cap: 6100, agency: 'UE — Itália', role: 'tanker', speed: 180, liquid: 'water', from: 46 },
    { id: 'AV-COORD', type: 'Avião de coordenação · ANPC', model: 'kingair', cap: 0, crew: 2, agency: 'ANPC', role: 'attack', speed: 160, from: 34 },
  ];
  const roadNear = (x, z) => {
    let best = 0, bd = 1e12, bs = 0;
    C.ROADS.forEach((r, i) => { let acc = 0; for (let k = 0; k < r.pts.length; k += 4) { if (k) acc += Math.hypot(r.pts[k][0] - r.pts[k - 4][0], r.pts[k][1] - r.pts[k - 4][1]); const d = (r.pts[k][0] - x) ** 2 + (r.pts[k][1] - z) ** 2; if (d < bd) { bd = d; best = i; bs = acc; } } });
    return { road: best, s: bs };
  };
  const P = C.PLACES;
  const town = (n) => Object.values(P).find((p) => p.name === n) || P.ignition;
  const eng = [
    { id: 'BV-PG', type: 'VFCI · BV Pedrógão Grande', model: 'engine', crew: 5, agency: 'Bombeiros Voluntários', status: 'Combate', div: 'A', at: town('Pedrógão Grande'), range: 3500, spd: 25 },
    { id: 'BV-CP', type: 'VFCI · BV Castanheira de Pêra', model: 'engine', crew: 5, agency: 'Bombeiros Voluntários', status: 'Proteção de aldeias', div: 'B', at: town('Castanheira de Pera'), range: 3000, spd: 20 },
    { id: 'BV-FV', type: 'VFCI · BV Figueiró dos Vinhos', model: 'engine1', crew: 4, agency: 'Bombeiros Voluntários', status: 'Patrulha', div: 'C', at: town('Figueiró dos Vinhos'), range: 5000, spd: 30 },
    { id: 'VTTU-1', type: 'Veículo tanque (VTTU)', model: 'tender', crew: 2, cap: 16000, agency: 'Bombeiros Voluntários', status: 'Reabastecimento', div: 'A', at: town('Vila Facaia'), range: 6000, spd: 30 },
    { id: 'GIPS-1', type: 'GNR · GIPS', model: 'engine1', crew: 6, agency: 'GNR', status: 'Ataque inicial', div: 'D', at: town('Alvares'), range: 4000, spd: 35 },
    { id: 'EXE-1', type: 'Pelotão do Exército', model: 'tender', crew: 30, agency: 'Exército', status: 'Rescaldo', div: 'E', at: town('Pobrais'), range: 3000, spd: 15, from: 30 },
  ].map((e) => { const r = roadNear(e.at.x, e.at.z); return { ...e, road: r.road, s0: r.s, range: e.range }; });
  return { air, eng, L };
}

// Synthetic-scenario compatible "head" sample for the real record: farthest burned point from the PG ignition.
export function headFilterFactory(cfg) {
  const [pg, go] = cfg.meta.ignitions;
  return (x, z) => (Math.hypot(x - pg.x, z - pg.z) < Math.hypot(x - go.x, z - go.z) ? 1 : 0);
}
