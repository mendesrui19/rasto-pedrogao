import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

import { clamp, lerp, smoothstep, fmtTime, fmtHM, fmtDay, fmtInt, fmtLatLon, fmtLatLonHud, compassName, DEG, T, timeParts, mulberry32 } from './util.js';
import * as C from './core.js';
import { World, U } from './world3d.js';
import { Overlay, contourLoops, polyLength, slicePoly } from './overlay.js';
import { buildEvents, buildDrops, buildFireLines, DRONES, AIRCRAFT, ENGINES, CREWS, SPOT, EVIDENCE, divisionFor } from './scenario.js';
import { Drone, Aircraft, GroundUnit, makeRetardantSystem, pathAt, KT, MPH, FT } from './units.js';
import { Chart } from './charts.js';
import { hydrateIcons } from './icons.js';
import * as UI from './ui.js';
import { loadReal, realUnits, headFilterFactory } from './real.js';
import { initI18n } from './i18n.js';

const INCIDENT = new URLSearchParams(location.search).get('incident') || 'pedrogao';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const REF_DIST = 40000;

// ------------------------------------------------------------------ state
export const state = {
  mode: 'incident',
  time: T(15, 16),
  playing: false,
  speed: 1,
  dim: '3d',
  labels: true,
  unitTags: true,
  haze: true,
  showFps: false,
  quality: 'high',
  metric: true,
  layers: {
    terrain: { on: true, op: 1, name: 'Terrain (3D)' },
    imagery: { on: true, op: 1, name: 'Aerial Imagery' },
    scar: { on: true, op: 0.9, name: 'Burn Scar (dNBR)' },
    spread: { on: true, op: 1, name: 'Fire Spread (Modeled)' },
    ign: { on: true, op: 0.8, name: 'Ignition Probability' },
    wind: { on: false, op: 0.7, name: 'Weather (Wind Vectors)' },
    supp: { on: true, op: 1, name: 'Suppression (Drops & Line)' },
    structures: { on: false, op: 1, name: 'Structures' },
    roads: { on: false, op: 1, name: 'Roads & Trails' },
    admin: { on: false, op: 1, name: 'Administrative Boundaries' },
  },
  selDrone: 'FT-01',
  selUnit: null,
  camMode: 'orbit', // orbit | follow | chase | cockpit
  pip: { open: true, full: false },
  wxAt: 'cursor',
  hover: null,
  customEvents: [],
  evidence: EVIDENCE.slice(),
  notes: [],
  detections: [],
  airLog: [],
  retardantLive: 0,
  dropsVersion: 0,
  profilePath: null,
};
try { state.notes = JSON.parse(localStorage.getItem('firetrace.notes') || '[]'); } catch (e) { /* storage unavailable */ }

export const app = { state };
window.__ft = app;

// ------------------------------------------------------------------ renderer
const canvas = $('#gl');
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 5, 200000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.48; controls.minDistance = 25; controls.maxDistance = 70000;
controls.zoomSpeed = 1.2; controls.rotateSpeed = 0.6;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
camera.position.set(0, 14000, 16000); controls.target.set(0, 0, 0);
app.renderer = renderer; app.camera = camera; app.controls = controls; app.scene = scene;

// sky
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uThermal: U.uThermal, uMap: U.uMap },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
  fragmentShader: `uniform float uThermal, uMap; varying vec3 vD; void main(){ float h = clamp(vD.y, 0.0, 1.0);
    vec3 c = mix(vec3(0.80,0.82,0.80), vec3(0.56,0.67,0.77), pow(h, 0.55));
    c = mix(c, vec3(0.955,0.948,0.925), uMap);
    if (uThermal > 0.5) c = vec3(0.0);
    gl_FragColor = vec4(c,1.0); }`,
  side: THREE.BackSide, depthWrite: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(150000, 32, 16), skyMat);
sky.frustumCulled = false; sky.renderOrder = -10;
scene.add(sky);

// ------------------------------------------------------------------ loading
const initialHash = location.hash;
const T0 = performance.now(); let lastMsg = '';
const ld = (msg, p) => { if (msg !== lastMsg) { lastMsg = msg; } $('#ldStep').textContent = msg; $('#ldBar').style.width = `${Math.round(p * 100)}%`; };
const tick = () => new Promise((r) => setTimeout(r, 16));

let terrain, fire, world, overlay, perimeter, mainLoop, events, drops, lines;
const lineMats = [];
function lineMat(opts) {
  const m = new LineMaterial({ linewidth: 2, transparent: true, ...opts });
  m.resolution.set(viewport.clientWidth, viewport.clientHeight);
  lineMats.push(m); return m;
}

function applyRealState(rc) {
  state.time = T(17, 20);
  state.layers.ign.name = 'Ignition Points (SGIF)';
  state.layers.scar.name = 'Burn Severity (S2 dNBR)';
  state.layers.spread.name = 'Fire Progression (Reconstructed)';
  state.layers.wind.name = 'Weather (ERA5 Wind)';
  state.layers.structures.name = 'Villages (OSM)';
  state.layers.roads.name = 'Roads (OSM)';
  const L = state.layers; const keep = { ...L };
  for (const k of Object.keys(L)) delete L[k];
  Object.assign(L, { terrain: keep.terrain, imagery: keep.imagery, scar: keep.scar, spread: keep.spread, cti: { on: true, op: 1, name: 'CTI: Fatalities · PCO · Road Closures' }, hotspots: { on: true, op: 1, name: 'Satellite Hotspots (VIIRS/MODIS)' }, ign: keep.ign, wind: keep.wind, supp: keep.supp, structures: keep.structures, roads: keep.roads });
  L.supp.name = 'Air Drops (illustrative)';
  const TH = { Report: 'linear-gradient(135deg,#dfe4e8,#a9b2ba)', Paper: 'linear-gradient(135deg,#efe7da,#d8ccb9)', Data: 'linear-gradient(180deg,#e6eef3,#9fb7c8)', Sat: 'linear-gradient(135deg,#1b0638,#6a1b8a 45%,#f08c2b 75%,#fff2b0)' };
  state.evidence = [
    { id: 'DOC-01', title: 'Relatório da Comissão Técnica Independente (2017)', meta: 'Official report', tag: 'Report', thumb: TH.Report },
    { id: 'DOC-02', title: 'O complexo de incêndios de Pedrógão Grande… (CEIF/ADAI, 2017)', meta: 'Official report', tag: 'Report', thumb: TH.Report },
    { id: 'DOC-03', title: 'Ribeiro et al. (2020), Fire 3(4):57', meta: 'Scientific paper', tag: 'Report', thumb: TH.Paper },
    { id: 'DOC-04', title: 'Viegas et al. (2023), IJWF 32(6)', meta: 'Scientific paper', tag: 'Report', thumb: TH.Paper },
    { id: 'DAT-01', title: 'ICNF · SGIF 2011–2020 + Territórios ardidos 2017', meta: 'Official data', tag: 'Data', thumb: TH.Data },
    { id: 'DAT-02', title: 'Sentinel-2 · NASA FIRMS · Copernicus DEM', meta: 'Satellite data', tag: 'Data', thumb: TH.Sat },
    { id: 'DAT-03', title: 'Observador — As primeiras 56 horas, minuto a minuto', meta: 'News timeline', tag: 'Report', thumb: TH.Paper },
  ];
  document.title = 'FireTrace — Pedrógão Grande 2017';
  $('.incident-select b').textContent = 'Pedrógão Grande 2017';
  $('.tb-text').textContent = 'Leiria · Coimbra, Portugal';
  $('[data-menu=dateMenu] span').textContent = 'Jun 17, 2017 – Jun 22, 2017';
  $('#attrib').classList.remove('hidden');
  $('#ldStep').textContent = 'Loading Pedrógão Grande';
}
const KIND_ICON = { ignition: 'dot', spread: 'fire', fatal: 'fatal', contain: 'square', weather: 'weather', resources: 'res', intl: 'intl', road: 'road', evac: 'evac', admin: 'admin', alert: 'alert' };
function realEvents(rc) {
  const pl = rc.osm.places;
  return rc.record.events.map((e, i) => {
    const p = e.place ? pl.find((q) => q.n === e.place) : null;
    return { id: `e${i}`, name: e.name, t: e.t, icon: KIND_ICON[e.kind] || 'tri', kind: e.kind, pos: p ? { x: p.x, z: p.z } : null, zoom: 7, marker: ['ignition', 'fatal', 'contain'].includes(e.kind), src: e.src };
  });
}

async function init() {
  hydrateIcons();
  initI18n(() => { if (!$('#modal').classList.contains('hidden') && $('.intro')) UI.showIntro(true); if (app.events) { app.scheduleCharts(); UI.renderFeed(app); } });
  if (INCIDENT !== 'ridgeview') {
    const rc = await loadReal(INCIDENT, ld);
    app.real = rc; rc.headFilter = headFilterFactory(rc);
    applyRealState(rc);
    ld('Building terrain', 0.08); await tick();
    terrain = new C.Terrain(rc.dem);
    fire = new C.FireResult(rc.arr, terrain);
    // path node times from the official isochrones (earliest arrival within ~500 m)
    rc.paths.forEach((pth) => pth.forEach((q, i) => {
      if (i === 0) return; let best = 999;
      for (let dz = -500; dz <= 500; dz += 125) for (let dx = -500; dx <= 500; dx += 125) best = Math.min(best, fire.arrivalAt(q.x + dx, q.z + dz));
      q.t = best;
    }));
  } else {
    ld('Generating terrain', 0.04); await tick();
    terrain = new C.Terrain();
    ld('Simulating fire spread', 0.08); await tick();
    fire = C.simulateFire(terrain);
  }
  world = new World(terrain, fire, renderer);
  app.world = world; app.terrain = terrain;
  await world.build(ld);
  ld('Planting trees', 0.68); await tick();
  const nTrees = app.real ? (state.quality === 'low' ? 40000 : 90000) : (state.quality === 'low' ? 26000 : 52000);
  const trees = C.buildTrees(terrain, fire, nTrees, 5, (x, z) => world._bil(world.veg, x, z));
  world.buildTrees(trees); world.treeList = trees;
  scene.add(world.group);
  ld('Tracing perimeters', 0.76); await tick();
  overlay = new Overlay(2048);
  U.uOverlayTex.value = overlay.tex;
  deriveFromFire();
  ld('Deploying resources', 0.86); await tick();
  buildFireGraphics();
  buildUnits();
  buildWind();
  ld('Preparing workspace', 0.94); await tick();
  setupUI();
  { const G = UI.gridSpec(); U.uGridStep.value.set(G.lonStep, G.latStep); U.uGridOff.value.set(G.offX, G.offZ); }
  applyHash();
  resize();
  setMode(state.mode, true);
  setTime(state.time, true);
  if (!initialHash.includes('cam=') && state.mode !== 'drones') resetCamera(true);
  $('#loading').classList.add('done');
  requestAnimationFrame(frame);
  UI.showIntro();
  $('.brand').style.cursor = 'pointer'; $('.brand').title = 'Fontes, limitações e créditos'; $('.brand').addEventListener('click', () => UI.showIntro(true));
}

function deriveFromFire() {
  const loops = contourLoops(fire.arr, C.FN, C.FCELL, 900);
  perimeter = loops.filter((l) => l.length > 30);
  mainLoop = perimeter[0];
  if (app.real && app.real.icnf) { perimeter = app.real.icnf.filter((q) => q.ha > 50 && q.p.length > 8).map((q) => q.p); }
  if (app.real) {
    events = realEvents(app.real); drops = []; lines = [];
  } else {
    events = buildEvents(fire);
    drops = buildDrops(fire);
    lines = buildFireLines(mainLoop);
  }
  app.fire = fire; app.events = events; app.drops = drops; app.lines = lines; app.perimeter = perimeter;
  // structures threatened = inside or near final burn
  world.structures.forEach((s) => { s.threat = fire.arrivalAt(s.x, s.z) < C.UNBURNED; });
  // default elevation-profile path follows the progression
  const deadly = C.ROADS.find((r) => r.deadly);
  state.profilePath = app.real && deadly ? deadly.pts.filter((_, i) => i % 4 === 0) : progressionPts(true);
  computeProfile();
  // personnel step series
  app.personnel = [[C.T_AXIS0, 0], [T(14, 15, 10), 0], [T(14, 15, 20), 8], [T(14, 16, 40), 26], [T(14, 18), 41], [T(14, 21), 58], [T(15, 7), 63], [T(15, 9), 67], [C.T_END, 67]];
  // retardant cumulative from drops
  rebuildRetardantSeries();
}
function rebuildRetardantSeries() {
  let acc = 0; const s = [[C.T_AXIS0, 0]];
  const all = drops.filter((d) => d.kind === 'retardant' || d.kind === 'water');
  all.forEach((d) => { s.push([d.t, acc]); acc += d.gal * (d.kind === 'retardant' ? 1 : 0.6); s.push([d.t, acc]); });
  // scale so the final total matches the incident record (~312k gal by Aug 18 11:20)
  const k = 312000 / Math.max(acc, 1);
  app.retSeries = s.map(([t, v]) => [t, v * k]); app.retScale = k;
  app.retSeries.push([C.T_END, acc * k]);
}
function retardantAt(t) {
  const s = app.retSeries; let v = 0;
  for (const [tt, vv] of s) { if (tt <= t) v = vv; else break; }
  return v + (t >= C.T_CONTAIN - 0.01 ? state.retardantLive : 0);
}

function progressionPts(full) {
  const ts = [C.T_IGNITION, T(14, 18), T(15, 0), T(15, 6), T(15, 12)];
  if (full) ts.push(T(15, 20), T(16, 6), T(16, 18), T(17, 12));
  const raw = ts.map((t, i) => (i === 0 ? [C.PLACES.ignition.x, C.PLACES.ignition.z] : (() => { const h = fire.sampleSeries('head', t); return [h.x, h.z]; })()));
  // de-duplicate & smooth (catmull)
  const pts = [];
  raw.forEach((p) => { if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 150) pts.push(p); });
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 16; k++) {
      const t = k / 16, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function computeProfile() {
  const p = state.profilePath; const L = polyLength(p);
  const n = 160; const prof = [];
  for (let i = 0; i <= n; i++) { const [x, z] = slicePoly(p, 0, L * i / n).slice(-1)[0] || p[0]; prof.push([L * i / n / 1000, terrain.elev(x, z)]); }
  app.profile = prof; app.profileLen = L;
}

// ------------------------------------------------------------------ fire graphics: path, arrows, embers, ignition glow
let pathSolid, pathFuture, arrowLines = [], embers, ignGlow, ignGlow2, measureLine, realPathLines = [];
function drape(pts, lift = 18, step = 40) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(l / step));
    for (let k = 0; k < n; k++) { const x = lerp(a[0], b[0], k / n), z = lerp(a[1], b[1], k / n); out.push(x, terrain.elev(x, z) - C.BASE + lift, z); }
  }
  const e = pts[pts.length - 1]; out.push(e[0], terrain.elev(e[0], e[1]) - C.BASE + lift, e[1]);
  return out;
}
function setLine(line, pts, lift) {
  if (pts.length < 2) { line.visible = false; return; }
  line.visible = true;
  const g = new LineGeometry(); g.setPositions(drape(pts, lift));
  line.geometry.dispose(); line.geometry = g; line.computeLineDistances();
}
function buildFireGraphics() {
  pathSolid = new Line2(new LineGeometry(), lineMat({ color: 0xf6b52e, linewidth: 3 }));
  pathFuture = new Line2(new LineGeometry(), lineMat({ color: 0xf6b52e, linewidth: 2.6, dashed: true, dashSize: 110, gapSize: 90, opacity: 0.95 }));
  world.group.add(pathSolid, pathFuture);
  app.progPath = progressionPts(false);
  app.progPathFull = progressionPts(true);
  realPathLines.forEach(([a, b]) => world.group.remove(a, b)); realPathLines = [];
  if (app.real) {
    app.real.paths.forEach(() => {
      const a = new Line2(new LineGeometry(), lineMat({ color: 0xf6b52e, linewidth: 3 }));
      const b = new Line2(new LineGeometry(), lineMat({ color: 0xf6b52e, linewidth: 2.6, dashed: true, dashSize: 160, gapSize: 120, opacity: 0.95 }));
      world.group.add(a, b); realPathLines.push([a, b]);
    });
  }
  // spread arrows (modeled vectors)
  arrowLines.forEach((l) => world.group.remove(l)); arrowLines = [];
  const defs = app.real ? [] : [[T(14, 20), -1, 600], [T(15, 2), -1, 750], [T(15, 9), 1, 450]];
  defs.forEach(([t, side, off]) => {
    const a = fire.sampleSeries('head', t - 6), b = fire.sampleSeries('head', t);
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz * side * off, nz = dx * side * off;
    const p0 = [a.x + nx + dx * L * 0.1, a.z + nz + dz * L * 0.1], p2 = [b.x + nx - dx * L * 0.05, b.z + nz - dz * L * 0.05];
    const mid = [(p0[0] + p2[0]) / 2 + nx * 0.25, (p0[1] + p2[1]) / 2 + nz * 0.25];
    const pts = [p0, mid, p2];
    const chev = (tip, ux, uz, s) => [[tip[0] - ux * s - uz * s * 0.6, tip[1] - uz * s + ux * s * 0.6], tip, [tip[0] - ux * s + uz * s * 0.6, tip[1] - uz * s - ux * s * 0.6]];
    const line = new Line2(new LineGeometry(), lineMat({ color: 0xf05a22, linewidth: 3.2 }));
    setLine(line, pts, 26);
    const head = new Line2(new LineGeometry(), lineMat({ color: 0xf05a22, linewidth: 3.4 }));
    const mx = (mid[0] - p0[0]), mz = (mid[1] - p0[1]); const ml = Math.hypot(mx, mz) || 1;
    const ex = p2[0] - mid[0], ez = p2[1] - mid[1]; const el = Math.hypot(ex, ez) || 1;
    const hg = new LineGeometry(); const arr1 = drape(chev(mid, mx / ml, mz / ml, 140), 28, 400), arr2 = drape(chev(p2, ex / el, ez / el, 170), 28, 400);
    hg.setPositions(arr1); head.geometry = hg;
    const head2 = new Line2(new LineGeometry(), head.material); const hg2 = new LineGeometry(); hg2.setPositions(arr2); head2.geometry = hg2;
    line.userData.t = t; head.userData.t = t; head2.userData.t = t;
    arrowLines.push(line, head, head2); world.group.add(line, head, head2);
  });
  // embers
  if (!embers) {
    const MAX = 14000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(MAX), 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uClock: U.uClock, uScale: { value: 900 }, uOp: { value: 1 } },
      vertexShader: `attribute float seed; varying float vS; uniform float uClock, uScale;
        void main(){ vS = seed; vec4 mv = modelViewMatrix * vec4(position,1.0);
          float fl = 0.55 + 0.45 * sin(uClock * (6.0 + seed * 9.0) + seed * 50.0);
          gl_PointSize = clamp((14.0 + 16.0 * seed) * fl * uScale / -mv.z, 1.5, 48.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vS; uniform float uOp; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard;
        float core = exp(-r * r * 5.0); vec3 c = mix(vec3(1.0,0.35,0.06), vec3(1.0,0.9,0.55), core * (0.4 + vS * 0.6));
        gl_FragColor = vec4(c * (0.6 + core), core * uOp); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    embers = new THREE.Points(geo, mat); embers.frustumCulled = false;
    world.group.add(embers);
    // ignition glow sprite
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,250,220,1)'); rg.addColorStop(0.15, 'rgba(255,200,90,0.9)'); rg.addColorStop(0.45, 'rgba(255,110,30,0.35)'); rg.addColorStop(1, 'rgba(255,80,20,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,220,160,0.5)'; g.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke(); }
    const tex = new THREE.CanvasTexture(cv);
    ignGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    ignGlow2 = new THREE.Sprite(ignGlow.material);
    scene.add(ignGlow, ignGlow2);
  }
  lastEmberT = -999;
}
let lastEmberT = -999;
function updateEmbers(force) {
  const t = state.time;
  if (!force && Math.abs(t - lastEmberT) < 0.03) return;
  lastEmberT = t;
  const pos = embers.geometry.attributes.position.array, seed = embers.geometry.attributes.seed.array;
  const rnd = mulberry32(Math.floor(t * 40));
  let n = 0; const MAX = seed.length;
  const act = fire.activeCells(t, 1.0);
  const per = act.length ? Math.max(1, Math.min(8, Math.floor(MAX / act.length))) : 0;
  for (const c of act) {
    const [x0, z0] = fire.cellXZ(c);
    const age = t - fire.arr[c];
    const k = Math.max(1, Math.round(per * (1 - age)));
    for (let i = 0; i < k && n < MAX; i++) {
      const x = x0 + (rnd() - 0.5) * C.FCELL * 1.2, z = z0 + (rnd() - 0.5) * C.FCELL * 1.2;
      // only along the burning edge
      const a = fire.arrivalAt(x, z); if (!(a <= t && t - a < 0.9)) continue;
      pos[n * 3] = x; pos[n * 3 + 1] = terrain.elev(x, z) - C.BASE + 6; pos[n * 3 + 2] = z; seed[n] = rnd(); n++;
    }
  }
  embers.geometry.setDrawRange(0, n);
  embers.geometry.attributes.position.needsUpdate = true; embers.geometry.attributes.seed.needsUpdate = true;
}
let lastPathT = -999;
function updatePaths(force) {
  const t = state.time;
  if (!force && Math.abs(t - lastPathT) < 0.02) return;
  lastPathT = t;
  if (app.real) {
    const on = state.layers.spread.on;
    app.real.paths.forEach((pth, k) => {
      const [sol, fut] = realPathLines[k];
      const pts = pth.map((q) => [q.x, q.z]);
      // fraction travelled along the documented path at time t
      let acc = 0, s = 0; const segL = [];
      for (let i = 1; i < pth.length; i++) segL.push(Math.hypot(pth[i].x - pth[i - 1].x, pth[i].z - pth[i - 1].z));
      for (let i = 1; i < pth.length; i++) {
        const a = pth[i - 1], b = pth[i];
        if (t >= b.t) { acc += segL[i - 1]; continue; }
        if (t > a.t) acc += segL[i - 1] * (t - a.t) / (b.t - a.t);
        break;
      }
      s = acc; const L = segL.reduce((p, q) => p + q, 0);
      setLine(sol, slicePoly(pts, 0, s), 22); setLine(fut, slicePoly(pts, s, L), 22);
      sol.visible = sol.visible && on; fut.visible = fut.visible && on;
      sol.material.opacity = state.layers.spread.op; fut.material.opacity = state.layers.spread.op * 0.9;
    });
    pathSolid.visible = pathFuture.visible = false;
    return;
  }
  const full = app.progPath; const L = polyLength(full);
  // how far along the path is the head at time t
  const head = fire.sampleSeries('head', Math.max(t, C.T_IGNITION));
  let best = 0, bd = 1e12, acc = 0;
  for (let i = 0; i < full.length; i++) {
    if (i) acc += Math.hypot(full[i][0] - full[i - 1][0], full[i][1] - full[i - 1][1]);
    const d = (full[i][0] - head.x) ** 2 + (full[i][1] - head.z) ** 2; if (d < bd) { bd = d; best = acc; }
  }
  const s = t < C.T_IGNITION ? 0 : (t > T(15, 12) ? L : best);
  setLine(pathSolid, slicePoly(full, 0, s), 22);
  setLine(pathFuture, slicePoly(full, s, L), 22);
  const on = state.layers.spread.on;
  pathSolid.visible = pathSolid.visible && on; pathFuture.visible = pathFuture.visible && on;
  pathSolid.material.opacity = state.layers.spread.op; pathFuture.material.opacity = state.layers.spread.op * 0.9;
  arrowLines.forEach((l) => { l.visible = on; l.material.opacity = (t >= l.userData.t - 6 ? 1 : 0.45) * state.layers.spread.op; });
}

// ------------------------------------------------------------------ wind vectors
let wind;
function buildWind() {
  const N = 650, TL = 12;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * (TL - 1) * 2 * 3), alpha = new Float32Array(N * (TL - 1) * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOp: { value: 0.7 }, uMap: U.uMap },
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uOp, uMap; varying float vA; void main(){ gl_FragColor = vec4(mix(vec3(1.0), vec3(0.35,0.45,0.6), uMap), clamp(vA * uOp * 1.6, 0.0, 1.0)); }',
    transparent: true, depthWrite: false,
  });
  const obj = new THREE.LineSegments(geo, mat); obj.frustumCulled = false; obj.visible = false; app.windObj = obj;
  scene.add(obj);
  const rnd = mulberry32(3);
  const parts = [];
  const spawn = (p) => { p.x = (rnd() * 2 - 1) * C.HALF * 0.95; p.z = (rnd() * 2 - 1) * C.HALF * 0.95; p.trail = []; p.life = 5 + rnd() * 6; };
  for (let i = 0; i < N; i++) { const p = {}; spawn(p); p.life *= rnd(); parts.push(p); }
  const n2 = (x, z) => Math.sin(x / 2300 + z / 3100) * 0.5 + Math.sin(z / 1700 - x / 2600) * 0.35;
  app.wind = wind = {
    obj,
    update(dt) {
      if (!obj.visible) return;
      const w = C.weatherAt(state.time);
      const base = (w.windDir + 180) * DEG; const spd = 380 + w.windSpd * 30;
      let o = 0;
      for (const p of parts) {
        const a = base + n2(p.x, p.z) * 0.7 + (terrain.aspectDeg(p.x, p.z) - 180) * DEG * 0.04;
        p.x += Math.sin(a) * spd * dt; p.z -= Math.cos(a) * spd * dt; p.life -= dt;
        if (p.trail.length < 2) p.trail = [[p.x, p.z], [p.x, p.z]];
        p.trail[0][0] = p.x; p.trail[0][1] = p.z;
        if (Math.hypot(p.trail[1][0] - p.x, p.trail[1][1] - p.z) > 110) { p.trail.unshift([p.x, p.z]); if (p.trail.length > TL) p.trail.pop(); }
        if (p.life <= 0 || Math.abs(p.x) > C.HALF || Math.abs(p.z) > C.HALF) spawn(p);
        for (let k = 0; k < TL - 1; k++) {
          const a0 = p.trail[k], a1 = p.trail[k + 1];
          for (const [q, al] of [[a0, 1 - k / (TL - 1)], [a1, 1 - (k + 1) / (TL - 1)]]) {
            if (q) { pos[o * 3] = q[0]; pos[o * 3 + 1] = world.groundY(q[0], q[1]) + 90 * world.flatten + 2; pos[o * 3 + 2] = q[1]; alpha[o] = a1 ? al * Math.min(1, p.life) : 0; }
            else { alpha[o] = 0; }
            o++;
          }
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.alpha.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ units
const units = { drones: [], air: [], ground: [], all: [] };
let retardant;
function buildUnits() {
  units.drones = DRONES.map((d) => new Drone(d));
  units.drones.forEach((d) => { d.sensor = ['FT-03', 'FT-04'].includes(d.id) ? 'eo' : 'ir'; d.palette = 'Ironbow'; });
  if (app.real) {
    const ru = realUnits(app.real);
    units.air = ru.air.map((d) => new Aircraft(d));
    units.ground = ru.eng.map((d) => new GroundUnit(d));
  } else {
    units.air = AIRCRAFT.map((d) => new Aircraft(d));
    units.ground = ENGINES.map((d) => new GroundUnit(d)).concat(CREWS.map((d) => new GroundUnit(d)));
  }
  units.ground.forEach((u) => { const l = lines.find((q) => q.id === u.id); if (l) { u.line = l; u.s = l.length * 0.7; } });
  units.all = [...units.drones, ...units.air, ...units.ground];
  units.all.forEach((u) => scene.add(u.group));
  retardant = makeRetardantSystem(); scene.add(retardant.object);
  app.units = units;
}
let fireGeom = null, fireGeomT = -999;
function updateFireGeom(force) {
  const t = state.time;
  if (!force && fireGeom && Math.abs(t - fireGeomT) < 0.25) return;
  fireGeomT = t;
  let n = 0, sx = 0, sz = 0;
  const edge = [];
  for (const c of fire.cells) {
    const a = fire.arr[c];
    if (a <= t) { const [x, z] = fire.cellXZ(c); sx += x; sz += z; n++; }
    else if (a < t + 6) edge.push(c);
  }
  const ig = C.PLACES.ignition;
  let cx = n ? sx / n : ig.x, cz = n ? sz / n : ig.z;
  let sxx = 0, szz = 0, sxz = 0;
  if (n > 3) for (const c of fire.cells) { if (fire.arr[c] > t) continue; const [x, z] = fire.cellXZ(c); sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  sxx /= Math.max(n, 1); szz /= Math.max(n, 1); sxz /= Math.max(n, 1);
  const tr = sxx + szz, det = sxx * szz - sxz * sxz; const disc = Math.sqrt(Math.max(tr * tr / 4 - det, 0));
  const l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 0);
  const ang = Math.atan2(l1 - sxx, sxz || 1e-6);
  const head = fire.sampleSeries('head', Math.max(t, C.T_IGNITION + 0.3));
  fireGeom = {
    t, n, edge,
    ellipse: { cx, cz, a: Math.max(450, 2.1 * Math.sqrt(l1)), b: Math.max(350, 2.1 * Math.sqrt(l2)), ang: Math.abs(sxz) < 1e-3 && Math.abs(sxx - szz) < 1e-3 ? 0 : ang },
    head, spot: app.real ? (app.real.extraIgnitions.find((e) => e.name === 'Regadas') || SPOT) : SPOT, spotActive: app.real ? t >= 16.25 : t >= C.T_SPOT,
    flank: { x: lerp(cx, head.x, 0.5) - 700, z: lerp(cz, head.z, 0.5) },
  };
  app.fireGeom = fireGeom;
  units.drones.forEach((d) => d.buildPath(fireGeom, world));
}
const dropRnd = mulberry32(1234);
function pickDropTarget(heli) {
  const t = state.time;
  const fg = fireGeom;
  const a = fire.arr;
  if (fg.edge.length > 30 && dropRnd() < 0.8) {
    for (let k = 0; k < 40; k++) {
      const c = fg.edge[Math.floor(dropRnd() * fg.edge.length)];
      const [x, z] = fire.cellXZ(c);
      const i = c % C.FN, j = (c / C.FN) | 0;
      const g = (ii, jj) => Math.min(a[clamp(jj, 0, C.FN - 1) * C.FN + clamp(ii, 0, C.FN - 1)], t + 30);
      let gx = g(i + 1, j) - g(i - 1, j), gz = g(i, j + 1) - g(i, j - 1); const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
      const L = heli ? 200 : 700; const cx = x + gx * 150, cz = z + gz * 150;
      return { x0: cx + gz * L / 2, z0: cz - gx * L / 2, x1: cx - gz * L / 2, z1: cz + gx * L / 2, nx: gx, nz: gz };
    }
  }
  // along the final perimeter, slightly outside
  const loop = mainLoop; const i = Math.floor(dropRnd() * (loop.length - 4));
  const p = loop[i], q = loop[i + 3]; let tx = q[0] - p[0], tz = q[1] - p[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  let nx = tz, nz = -tx; // outward guess: away from centroid
  const ce = fg.ellipse; if ((p[0] - ce.cx) * nx + (p[1] - ce.cz) * nz < 0) { nx = -nx; nz = -nz; }
  const L = heli ? 220 : 650 + dropRnd() * 500, off = heli ? -120 : 110;
  const cx = p[0] + nx * off, cz = p[1] + nz * off;
  return { x0: cx - tx * L / 2, z0: cz - tz * L / 2, x1: cx + tx * L / 2, z1: cz + tz * L / 2, nx, nz };
}
const unitCtx = app.unitCtx = {
  get world() { return world; }, clk: 0, get time() { return state.time; }, get fireGeom() { return fireGeom; },
  pickDropTarget,
  roadLen: (r) => C.roadLength(r),
  emitDrop(ac, amount) {
    if (!ac.group.visible || state.mode !== 'resources') return;
    const water = ac.def.liquid === 'water';
    const back = new THREE.Vector3(-Math.sin(ac.heading) * ac.realSize * 0.2, -ac.realSize * 0.08, Math.cos(ac.heading) * ac.realSize * 0.2);
    const v = new THREE.Vector3(Math.sin(ac.heading) * ac.speed, 0, -Math.cos(ac.heading) * ac.speed);
    const n = Math.min(60, Math.ceil(amount / (water ? 4 : 18)) + 2);
    retardant.emit(ac.pos.clone().add(back), v, water ? [0.82, 0.9, 0.96] : [0.86, 0.22, 0.18], n, ac.def.role === 'heli' ? 4 : 10);
  },
  completeDrop(ac) {
    const tg = ac.target; if (!tg) return;
    const gal = ac.def.cap;
    const d = { t: state.time, id: ac.id, kind: ac.def.liquid, gal, x0: tg.x0, z0: tg.z0, x1: tg.x1, z1: tg.z1, nx: tg.nx, nz: tg.nz, w: ac.def.model === 'vlat' ? 70 : ac.def.role === 'heli' ? 55 : 50, cx: (tg.x0 + tg.x1) / 2, cz: (tg.z0 + tg.z1) / 2, live: true };
    d.div = divisionFor(d.cx, d.cz);
    drops.push(d); state.dropsVersion++;
    if (d.kind === 'retardant') state.retardantLive += gal;
    const clockH = C.T_CONTAIN + unitCtx.clk / 3600;
    state.airLog.unshift({ id: ac.id, gal, kind: d.kind, div: d.div, x: d.cx, z: d.cz, time: fmtHM(app.real ? state.time : clockH), live: true });
    UI.renderFeed(app);
    UI.renderResStats(app);
  },
};

// ------------------------------------------------------------------ labels
const labelsEl = $('#labels');
const labels = [];
function addLabel(html, cls, getPos, opts = {}) {
  const el = document.createElement('div'); el.className = `lbl ${cls}`; el.innerHTML = html; labelsEl.appendChild(el);
  const L = { el, getPos, opts, visible: true, ...opts }; labels.push(L);
  if (opts.onClick) { el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer'; el.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); }); }
  return L;
}
const tmpV = new THREE.Vector3();
function updateLabels() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  const hideAll = state.pip.full && state.mode === 'drones';
  let pr = null;
  if (state.mode === 'drones' && state.pip.open && !hideAll) { const a = $('#pip').getBoundingClientRect(), b = viewport.getBoundingClientRect(); pr = { l: a.left - b.left, t: a.top - b.top, r: a.right - b.left, b: a.bottom - b.top }; }
  for (const L of labels) {
    const show = !hideAll && (L.when ? L.when() : true);
    if (!show) { if (L.visible) { L.el.classList.add('hide'); L.visible = false; } continue; }
    const p = L.getPos(tmpV);
    if (!p) { if (L.visible) { L.el.classList.add('hide'); L.visible = false; } continue; }
    p.project(camera);
    if (p.z > 1 || p.x < -1.2 || p.x > 1.2 || p.y < -1.2 || p.y > 1.2) { if (L.visible) { L.el.classList.add('hide'); L.visible = false; } continue; }
    if (!L.visible) { L.el.classList.remove('hide'); L.visible = true; }
    const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h;
    if (pr && x > pr.l - 30 && x < pr.r + 10 && y > pr.t - 10 && y < pr.b + 20) { L.el.classList.add('hide'); L.visible = false; continue; }
    L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${L.anchor || ''}`;
    if (L.update) L.update(L);
  }
}
function buildLabels() {
  const gp = (x, z, lift = 0) => (v) => v.set(x, world.groundY(x, z) + lift, z);
  const showLabels = () => state.labels;
  Object.values(C.PLACES).forEach((p) => {
    if (p.kind === 'peak') addLabel(`<span class="tri">▲</span>${p.name}<br><span style="padding-left:13px">${fmtInt(p.elev)} m</span>`, 'lbl-place', gp(p.x, p.z, 40), { anchor: 'translate(-6px,-50%)', when: showLabels });
    if (p.kind === 'water') addLabel(p.name.replace('\n', '<br>'), 'lbl-place', gp(p.x, p.z, 30), { anchor: 'translate(-50%,-50%)', when: showLabels });
    if (p.kind === 'place') addLabel(p.name, 'lbl-place', gp(p.x, p.z, 40), { anchor: 'translate(-50%,-50%)', when: showLabels });
    if (p.kind === 'village') addLabel(p.name, 'lbl-place lbl-village', gp(p.x, p.z, 25), { anchor: 'translate(-50%,-50%)', when: showLabels });
    if (p.kind === 'memorial') addLabel(`<b>${p.name}</b> · estrada da morte<br><span>30 vítimas em 400 m · 19:30–20:30 (ADAI)</span>`, 'lbl-memorial', gp(p.x, p.z, 20), { anchor: 'translate(-50%,-120%)', when: showLabels });
    if (p.kind === 'base') addLabel(`<i>${p.letter}</i>${p.name}`, 'lbl-base', gp(p.x, p.z, 10), { anchor: 'translate(-9px,-50%)', when: () => state.labels && state.mode === 'resources' });
  });
  // ignition
  const igWhen = () => state.labels && state.mode !== 'drones' && (state.layers.ign.on || state.layers.spread.on);
  if (app.real) {
    const C2 = app.real.record.cti;
    if (C2) {
      const ctiOn = () => state.labels && state.layers.cti && state.layers.cti.on && state.mode !== 'drones';
      C2.fatalities.forEach((f) => addLabel(`<i>${f.count}</i><span>${f.name}</span>`, 'lbl-fatal', gp(f.x, f.z, 15), { anchor: 'translate(-11px,-50%)', when: () => ctiOn() && state.time >= f.t }));
      C2.pco.forEach((p) => addLabel(`<i>P</i>${p.name}`, 'lbl-base lbl-pco', gp(p.x, p.z, 10), { anchor: 'translate(-9px,-50%)', when: () => ctiOn() && state.time >= p.t0 && state.time < p.t1 }));
      C2.closures.forEach((c) => addLabel(`<b>⛔ ${fmtHM(c.t)}</b> ${c.name}`, 'lbl-closure', gp(c.x, c.z, 8), { anchor: 'translate(-6px,-50%)', when: () => ctiOn() && state.time >= c.t && state.time < 4 * 24 }));
    }
    app.real.extraIgnitions.forEach((g) => addLabel(`<span class="dot" style="width:10px;height:10px"></span><span class="lbl-chip">Ignição · ${g.name} · ${fmtHM(g.t)}</span>`, 'lbl-ign', gp(g.x, g.z, 20), { anchor: 'translate(-6px,-50%)', when: () => igWhen() && state.time >= g.t - 0.01 }));
    app.real.meta.ignitions.forEach((g) => addLabel(`<span class="dot"></span><span class="lbl-chip">Ignição · ${g.name}<br>${fmtTime(g.t).replace(',', '')} · alerta ${fmtHM(g.alert)}</span>`, 'lbl-ign', gp(g.x, g.z, 25), { anchor: 'translate(-8px,-50%)', when: igWhen }));
    app.real.paths.forEach((pth) => pth.slice(1).forEach((q) => {
      const L = addLabel(`<span class="dot"></span><span class="lbl-chip">${fmtTime(q.t)}</span>`, 'lbl-time', gp(q.x, q.z, 30), { anchor: 'translate(-7px,-50%)', when: () => state.labels && state.mode !== 'drones' && state.layers.spread.on });
      L.update = (l) => l.el.classList.toggle('future', state.time < q.t);
    }));
  } else
  addLabel(`<span class="dot"></span><span class="lbl-chip">Ignition<br>${fmtTime(C.T_IGNITION).replace(',', '')}</span>`, 'lbl-ign', gp(C.PLACES.ignition.x, C.PLACES.ignition.z, 25), { anchor: 'translate(-8px,-50%)', when: igWhen });
  // progression time markers
  (app.real ? [] : [T(14, 18), T(15, 0), T(15, 6), T(15, 12)]).forEach((t) => {
    const h = fire.sampleSeries('head', t);
    const L = addLabel(`<span class="dot"></span><span class="lbl-chip">${fmtTime(t)}</span>`, 'lbl-time', (v) => { const q = fire.sampleSeries('head', t); return v.set(q.x, world.groundY(q.x, q.z) + 30, q.z); }, { anchor: 'translate(-7px,-50%)', when: () => state.labels && state.mode !== 'drones' && state.layers.spread.on });
    L.update = (l) => l.el.classList.toggle('future', state.time < t);
  });
  // units
  units.all.forEach((u) => {
    const isDrone = u.kind === 'drone';
    const L = addLabel('', 'lbl-unit', (v) => (u.group.visible ? v.set(u.pos.x, u.pos.y + (isDrone ? 1 : 1) * Math.max(8, u.realSize * u.visScale * 0.6), u.pos.z) : null), {
      anchor: isDrone ? 'translate(-50%,-140%)' : 'translate(-50%,-150%)',
      when: () => state.unitTags && ((isDrone && state.mode === 'drones') || (!isDrone && state.mode === 'resources')) && !((state.camMode === 'cockpit' || state.camMode === 'chase') && state.selUnit === u.id),
      onClick: () => (isDrone ? selectDrone(u.id) : selectUnit(u.id)),
    });
    L.update = (l) => {
      const sel = isDrone ? state.selDrone === u.id : state.selUnit === u.id;
      const html = isDrone
        ? `<span class="d g"></span><b>${u.id}</b><span class="s">${fmtInt(u.agl / FT)} ft</span>`
        : `<span class="d ${u.statusColor === 'r' ? '' : u.statusColor === 'g' ? 'g' : 'y'}"></span><b>${u.id}</b>${u.def.crew && u.kind === 'crew' ? `<span class="s">${u.def.crew}</span>` : ''}<span class="s">${u.status}</span>`;
      if (l.html !== html) { l.el.innerHTML = html; l.html = html; }
      l.el.classList.toggle('sel', sel);
    };
  });
  app.addLabel = addLabel;
}

// ------------------------------------------------------------------ time
export function setTime(t, force) {
  t = clamp(t, C.T_START, C.T_END);
  const changed = force || Math.abs(t - state.time) > 1e-6;
  state.time = t; U.uTime.value = t;
  if (!changed) return;
  UI.updateTimeline(app);
  updatePaths(force);
  updateEmbers(force);
  updateFireGeom(force);
  drawOverlay();
  scheduleCharts();
  UI.renderFeedHighlight(app);
  UI.updateWeather(app);
  if (state.mode === 'resources') UI.renderResStats(app);
}
app.setTime = setTime;
function drawOverlay() {
  overlay.draw({ time: state.time, map: U.uMap.value, layers: state.layers, perimeter, drops, lines, structures: world.structures, hotspots: app.real ? app.real.hotspots : null, lineVersion: 0, dropsVersion: state.dropsVersion });
}
app.drawOverlay = drawOverlay;

// ------------------------------------------------------------------ layers -> uniforms
export function applyLayers() {
  const L = state.layers;
  U.uImagery.value = L.imagery.on ? L.imagery.op : 0;
  U.uShadeAmt.value = L.terrain.on ? 1 : 0.6;
  U.uScar.value = L.scar.on ? L.scar.op : 0;
  U.uSpread.value = L.spread.on ? L.spread.op : 0;
  U.uIgn.value = L.ign.on ? L.ign.op : 0;
  const flat = state.dim === '2d' ? 0.02 : 1;
  world.setFlatten(L.terrain.on ? flat : Math.min(flat, 0.03));
  wind.obj.visible = L.wind.on; wind.obj.material.uniforms.uOp.value = L.wind.op;
  if (world.real && world.imagery !== (state.postImagery ? 'post' : 'pre')) world.setImagery(state.postImagery ? 'post' : 'pre');
  world.roadMeshes.forEach((m) => (m.visible = true));
  world.structA.visible = world.structB.visible = state.dim === '3d';
  embers.visible = L.spread.on && state.dim === '3d';
  embers.material.uniforms.uOp.value = L.spread.op;
  updatePaths(true);
  drawOverlay();
}
app.applyLayers = applyLayers;

// ------------------------------------------------------------------ camera helpers
const tweens = [];
function tween(dur, fn, done, kind = 'cam') { const tw = { t: 0, dur, fn, done, kind }; tweens.push(tw); return tw; }
function clearCamTweens() { for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].kind !== 'dim') tweens.splice(i, 1); }
function finishTweens() { while (tweens.length) { const tw = tweens.shift(); tw.fn(1); tw.done && tw.done(); } }
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function camSph() {
  const off = new THREE.Vector3().subVectors(camera.position, controls.target);
  const s = new THREE.Spherical().setFromVector3(off); return s;
}
export function flyTo(x, z, dist, polar, azim, dur = 1.6, yOff = 0) {
  const fromT = controls.target.clone(); const s0 = camSph();
  const toT = new THREE.Vector3(x, world.groundY(x, z) + yOff, z);
  let a0 = s0.theta, a1 = azim ?? s0.theta; while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  const p0 = s0.phi, p1 = polar ?? s0.phi, r0 = Math.max(s0.radius, 1), r1 = Math.max(dist ?? s0.radius, 1);
  clearCamTweens();
  if (tweens.length) { tweens[tweens.length - 1].after = () => flyTo(x, z, dist, polar, azim, dur, yOff); return; }
  tween(dur, (k) => {
    const e = ease(k);
    controls.target.lerpVectors(fromT, toT, e);
    // arc out a little when travelling far
    const rr = Math.exp(lerp(Math.log(r0), Math.log(r1), e));
    const s = new THREE.Spherical(rr, lerp(p0, p1, e), lerp(a0, a1, e));
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    camera.lookAt(controls.target);
  });
}
app.flyTo = flyTo;
function resetCamera(instant) {
  exitChase();
  const c = app.real ? { x: -1500, z: -1500 } : { x: 500, z: -500 };
  const r2 = app.real ? 46000 : 17000, r3 = app.real ? 40000 : 16000;
  if (state.dim === '2d') flyTo(c.x, c.z + 600, r2, 0.0001, 0, instant ? 0.01 : 1.4);
  else flyTo(c.x - 400, c.z + (app.real ? 4000 : 600), r3, app.real ? 0.88 : 0.93, app.real ? 0.15 : -0.12, instant ? 0.01 : 1.4);
}
app.resetCamera = resetCamera;
function setZoom(z) { const s = camSph(); flyTo(controls.target.x, controls.target.z, REF_DIST / z, s.phi, s.theta, 0.8); }
app.setZoom = setZoom;

export function setDim(dim, onDone) {
  if (state.dim === dim) { onDone && onDone(); return; }
  state.dim = dim;
  $$('#dimSeg button').forEach((b) => b.classList.toggle('on', b.dataset.dim === dim));
  viewport.classList.toggle('map2d', dim === '2d');
  exitChase();
  const s = camSph();
  const fromMap = U.uMap.value, toMap = dim === '2d' ? 1 : 0;
  const fromF = world.flatten, toF = dim === '2d' ? 0.02 : 1;
  if (dim === '3d') { world.treesA.visible = world.treesB.visible = true; world.structA.visible = world.structB.visible = true; }
  const target = controls.target.clone();
  const p0 = s.phi, p1 = dim === '2d' ? 0.0001 : 0.95, a0 = s.theta; let a1 = dim === '2d' ? 0 : -0.15;
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  const r0 = s.radius, r1 = dim === '2d' ? Math.max(r0, 6000) : r0;
  controls.maxPolarAngle = 1.48; controls.minPolarAngle = 0;
  finishTweens();
  tween(1.1, (k) => {
    const e = ease(k);
    U.uMap.value = lerp(fromMap, toMap, smoothstep(0.2, 0.9, e));
    world.setFlatten(lerp(fromF, toF, e));
    controls.target.set(target.x, world.groundY(target.x, target.z), target.z);
    const sp = new THREE.Spherical(lerp(r0, r1, e), lerp(p0, p1, e), lerp(a0, a1, e));
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sp));
    camera.lookAt(controls.target);
  }, () => {
    if (dim === '2d') { world.treesA.visible = world.treesB.visible = false; controls.maxPolarAngle = 0.0001; controls.enableRotate = true; }
    lineMats.forEach((m) => (m.depthTest = dim !== '2d'));
    applyLayers();
    onDone && onDone();
  }, 'dim');
  lineMats.forEach((m) => (m.depthTest = false));
  embers.visible = dim === '3d' && state.layers.spread.on;
}
app.setDim = setDim;

// ------------------------------------------------------------------ selection / camera modes
export function selectDrone(id) {
  state.selDrone = id;
  const d = units.drones.find((q) => q.id === id);
  state.pip.open = true; $('#pip').classList.remove('hidden');
  UI.renderDrones(app);
  UI.updatePip(app);
  if (state.mode === 'drones') followUnit(d, 1340);
  scheduleCharts();
}
app.selectDrone = selectDrone;
let follow = null;
function followUnit(u, dist) {
  exitChase(true);
  follow = u;
  state.camMode = 'follow';
  const s = camSph();
  flyTo(u.pos.x, u.pos.z, dist, Math.min(s.phi, 1.0), s.theta, 1.4, u.pos.y - world.groundY(u.pos.x, u.pos.z));
}
export function selectUnit(id, mode) {
  state.selUnit = id;
  const u = units.all.find((q) => q.id === id);
  if (!u) return;
  UI.renderResources(app);
  setCamMode(mode || (u.kind === 'crew' ? 'overview' : 'chase'));
}
app.selectUnit = selectUnit;
const chase = { yaw: 0, pitch: 0.18, dist: 1, cur: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
export function setCamMode(m) {
  const u = units.all.find((q) => q.id === state.selUnit);
  if (!u) return;
  if (m === 'overview') {
    exitChase(true);
    followUnit(u, u.kind === 'air' ? 3600 : 900);
  } else {
    if (state.dim === '2d') { setDim('3d', () => setCamMode(m)); return; }
    finishTweens();
    state.camMode = m; follow = null; controls.enabled = false;
    chase.yaw = 0; chase.pitch = m === 'cockpit' ? -0.05 : (u.kind === 'air' ? 0.16 : 0.42);
    chase.dist = u.kind === 'air' ? Math.max(70, u.realSize * 4.2) : u.kind === 'crew' ? 45 : 32;
    chase.init = false;
  }
  UI.renderUnitHud(app); UI.renderResources(app);
}
app.setCamMode = setCamMode;
function exitChase(keepSel) {
  if (state.camMode === 'chase' || state.camMode === 'cockpit') {
    const u = units.all.find((q) => q.id === state.selUnit);
    if (u) { controls.target.copy(u.pos); }
    camera.up.set(0, 1, 0);
  }
  state.camMode = 'orbit'; follow = null; controls.enabled = true;
  if (!keepSel) { /* selection is kept for the panel */ }
  units.all.forEach((u) => (u.model.g.visible = true));
  UI.renderUnitHud(app);
}
app.exitChase = exitChase;
export function deselectUnit() { exitChase(); state.selUnit = null; UI.renderResources(app); UI.renderUnitHud(app); }
app.deselectUnit = deselectUnit;
function cycleCam() {
  const u = units.all.find((q) => q.id === state.selUnit); if (!u) return;
  const order = u.kind === 'air' ? ['chase', 'cockpit', 'overview'] : ['chase', 'overview'];
  const cur = state.camMode === 'follow' ? 'overview' : state.camMode;
  setCamMode(order[(order.indexOf(cur) + 1) % order.length]);
}

function updateCamera(dt) {
  if (tweens.length) {
    const tw = tweens[0]; tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(k);
    if (k >= 1) { tweens.shift(); tw.done && tw.done(); tw.after && tw.after(); }
    if (follow) follow._lastPos = follow.pos.clone();
    return;
  }
  if (state.camMode === 'follow' && follow) {
    const lp = follow._lastPos || follow.pos.clone();
    const d = new THREE.Vector3().subVectors(follow.pos, lp);
    camera.position.add(d); controls.target.add(d);
    follow._lastPos = follow.pos.clone();
  }
  if (state.camMode === 'chase' || state.camMode === 'cockpit') {
    const u = units.all.find((q) => q.id === state.selUnit); if (!u) return;
    const fwd = new THREE.Vector3(Math.sin(u.heading), 0, -Math.cos(u.heading));
    if (state.camMode === 'chase') {
      u.model.g.visible = true;
      const yaw = u.heading + Math.PI + chase.yaw;
      const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(chase.pitch), Math.sin(chase.pitch), -Math.cos(yaw) * Math.cos(chase.pitch)).multiplyScalar(chase.dist);
      const want = u.pos.clone().add(off);
      const g = world.groundY(want.x, want.z) + 4; if (want.y < g) want.y = g;
      if (!chase.init) { chase.cur.copy(want); chase.look.copy(u.pos); chase.init = true; }
      chase.cur.lerp(want, Math.min(1, dt * 4)); chase.look.lerp(u.pos.clone().add(new THREE.Vector3(0, u.realSize * 0.15, 0)), Math.min(1, dt * 8));
      camera.position.copy(chase.cur); camera.up.set(0, 1, 0); camera.lookAt(chase.look);
    } else {
      u.model.g.visible = false;
      const up = new THREE.Vector3(0, 1, 0);
      const eye = u.pos.clone().add(fwd.clone().multiplyScalar(u.realSize * 0.42)).add(new THREE.Vector3(0, u.kind === 'air' ? u.realSize * 0.05 : 2.2, 0));
      const yaw = u.heading + chase.yaw; const pitch = u.pitch + chase.pitch;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      camera.position.copy(eye);
      up.applyAxisAngle(dir, -u.bank * 0.8);
      camera.up.copy(up);
      camera.lookAt(eye.clone().add(dir));
    }
    controls.target.copy(u.pos);
  }
}

// pointer for chase look-around
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false, btn: e.button }; });
window.addEventListener('pointermove', (e) => {
  if (drag && (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4)) drag.moved = true;
  if (drag && (state.camMode === 'chase' || state.camMode === 'cockpit')) {
    chase.yaw -= (e.movementX || 0) * 0.005; chase.pitch = clamp(chase.pitch + (e.movementY || 0) * 0.004 * (state.camMode === 'chase' ? 1 : -1), state.camMode === 'chase' ? -0.1 : -1.2, 1.3);
  }
});
window.addEventListener('pointerup', (e) => {
  if (drag && !drag.moved && e.target === canvas && drag.btn === 0) onClick(e);
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  if (state.camMode === 'chase') { chase.dist = clamp(chase.dist * (1 + Math.sign(e.deltaY) * 0.12), 10, 3000); e.preventDefault(); }
  if (state.camMode === 'follow') { /* orbit controls handles zoom around the followed unit */ }
}, { passive: false });
controls.addEventListener('start', () => { finishTweens(); });

// ------------------------------------------------------------------ picking / hover
const ray = new THREE.Raycaster();
function terrainHit(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let t = 0, prev = null; let step = 10;
  for (let i = 0; i < 1400; i++) {
    const p = o.clone().addScaledVector(d, t);
    if (Math.abs(p.x) > C.HALF * 1.6 || Math.abs(p.z) > C.HALF * 1.6) { if (t > 50000) break; }
    const g = world.groundY(clamp(p.x, -C.HALF, C.HALF), clamp(p.z, -C.HALF, C.HALF));
    if (p.y < g) {
      // bisection
      let a = prev ?? 0, b = t;
      for (let k = 0; k < 18; k++) { const m = (a + b) / 2; const q = o.clone().addScaledVector(d, m); if (q.y < world.groundY(q.x, q.z)) b = m; else a = m; }
      const q = o.clone().addScaledVector(d, b);
      if (Math.abs(q.x) > C.HALF || Math.abs(q.z) > C.HALF) return null;
      return q;
    }
    prev = t; step = Math.max(8, (p.y - g) * 0.4); t += step;
    if (t > 120000) break;
  }
  return null;
}
app.terrainHit = terrainHit;
function pickUnit(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  let best = null, bd = 28;
  const list = state.mode === 'drones' ? units.drones : state.mode === 'resources' ? [...units.air, ...units.ground] : [];
  for (const u of list) {
    if (!u.group.visible) continue;
    const p = u.pos.clone().project(camera); if (p.z > 1) continue;
    const x = (p.x * 0.5 + 0.5) * r.width + r.left, y = (-p.y * 0.5 + 0.5) * r.height + r.top;
    const d = Math.hypot(x - clientX, y - clientY); if (d < bd) { bd = d; best = u; }
  }
  return best;
}
function onClick(e) {
  if (measure.active) { const p = terrainHit(e.clientX, e.clientY); if (p) addMeasurePoint(p); return; }
  const u = pickUnit(e.clientX, e.clientY);
  if (u) { if (u.kind === 'drone') selectDrone(u.id); else selectUnit(u.id); }
}
let hoverPending = null;
canvas.addEventListener('pointermove', (e) => { hoverPending = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerleave', () => { hoverPending = null; state.hover = null; $('#tooltip').classList.add('hidden'); UI.updateWeather(app); });
function processHover() {
  if (!hoverPending) return;
  const { x, y } = hoverPending; hoverPending = null;
  if (drag && drag.moved) { $('#tooltip').classList.add('hidden'); return; }
  if (state.camMode === 'chase' || state.camMode === 'cockpit' || (state.pip.full && state.mode === 'drones')) { $('#tooltip').classList.add('hidden'); return; }
  const p = terrainHit(x, y);
  const tt = $('#tooltip');
  if (!p) { tt.classList.add('hidden'); state.hover = null; UI.updateWeather(app); return; }
  state.hover = { x: p.x, z: p.z };
  UI.showTooltip(app, x, y, p.x, p.z);
  UI.updateWeather(app);
  if (measure.active && measure.pts.length) updateMeasurePreview(p);
}

// ------------------------------------------------------------------ measure / profile tool
const measure = { active: false, pts: [], labels: [], purpose: 'measure' };
app.measure = measure;
function startMeasure(purpose = 'measure') {
  exitChase();
  measure.active = true; measure.purpose = purpose; measure.pts = [];
  measure.labels.forEach((l) => { l.el.remove(); labels.splice(labels.indexOf(l), 1); }); measure.labels = [];
  if (!measureLine) { measureLine = new Line2(new LineGeometry(), lineMat({ color: 0xffd34d, linewidth: 3, dashed: false })); world.group.add(measureLine); }
  measureLine.visible = false;
  $('#measureBar').classList.remove('hidden');
  $('#measureText').textContent = purpose === 'profile' ? 'Click to draw the elevation-profile path' : 'Click on the terrain to add points';
  canvas.style.cursor = 'crosshair';
}
app.startMeasure = startMeasure;
function addMeasurePoint(p) {
  measure.pts.push([p.x, p.z]);
  const k = measure.pts.length;
  const L = polyLength(measure.pts);
  const pt = measure.pts[k - 1];
  const lbl = addLabel(k === 1 ? 'Start' : fmtDist(L), 'lbl-measure', (v) => v.set(pt[0], world.groundY(pt[0], pt[1]) + 10, pt[1]), { anchor: 'translate(-50%,-150%)' });
  measure.labels.push(lbl);
  if (k >= 2) { setLine(measureLine, measure.pts, 12); measureLine.visible = true; }
  $('#measureText').textContent = `${k} pts · ${fmtDist(L)} · ${measure.purpose === 'profile' ? 'Done to set profile' : 'Done to finish'}`;
}
function updateMeasurePreview(p) {
  const pts = measure.pts.concat([[p.x, p.z]]);
  setLine(measureLine, pts, 12); measureLine.visible = true;
}
function finishMeasure(cancel) {
  measure.active = false; canvas.style.cursor = '';
  $('#measureBar').classList.add('hidden');
  if (!cancel && measure.pts.length >= 2) {
    setLine(measureLine, measure.pts, 12);
    if (measure.purpose === 'profile') {
      state.profilePath = measure.pts.slice(); computeProfile(); scheduleCharts();
      UI.toast(`Elevation profile set · ${fmtDist(polyLength(measure.pts))}`);
    } else UI.toast(`Distance ${fmtDist(polyLength(measure.pts))} · elevation Δ ${Math.round(terrain.elev(...measure.pts[measure.pts.length - 1]) - terrain.elev(...measure.pts[0]))} m`);
  } else {
    if (measureLine) measureLine.visible = false;
    measure.labels.forEach((l) => { l.el.remove(); labels.splice(labels.indexOf(l), 1); }); measure.labels = [];
  }
}
app.finishMeasure = finishMeasure;
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

// ------------------------------------------------------------------ drone feed (PiP)
const feed = {
  rt: null, quadScene: new THREE.Scene(), quadCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  heatRT: new THREE.WebGLRenderTarget(96, 60), heatBuf: new Uint8Array(96 * 60 * 4),
  hot: null, lastRead: 0, rec: 0,
};
const feedMat = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uMode: { value: 1 }, uPal: { value: 0 }, uClock: U.uClock, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tSrc; uniform float uMode, uPal, uClock; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    vec3 ironbow(float t){
      t = clamp(t, 0.0, 1.0);
      vec3 c0 = vec3(0.02,0.0,0.08), c1 = vec3(0.20,0.02,0.45), c2 = vec3(0.55,0.05,0.62), c3 = vec3(0.88,0.22,0.30), c4 = vec3(0.99,0.55,0.08), c5 = vec3(1.0,0.86,0.30), c6 = vec3(1.0,1.0,0.92);
      if (t < 0.18) return mix(c0, c1, t / 0.18);
      if (t < 0.32) return mix(c1, c2, (t - 0.18) / 0.14);
      if (t < 0.48) return mix(c2, c3, (t - 0.32) / 0.16);
      if (t < 0.64) return mix(c3, c4, (t - 0.48) / 0.16);
      if (t < 0.82) return mix(c4, c5, (t - 0.64) / 0.18);
      return mix(c5, c6, (t - 0.82) / 0.18);
    }
    void main(){
      vec3 s = texture2D(tSrc, vUv).rgb;
      float n = h(vUv * uRes + fract(uClock * 13.1)) - 0.5;
      vec2 q = vUv - 0.5; float vig = 1.0 - dot(q, q) * 0.9;
      vec3 c;
      if (uMode > 0.5) {
        float t = s.r;
        // AGC: stretch so background sits in the purple band and fire saturates
        float v = clamp((t - 0.07) / 0.8, 0.0, 1.0);
        v = pow(v, 0.85) + n * 0.03;
        c = uPal < 0.5 ? ironbow(v) : vec3(clamp(v * 1.1, 0.0, 1.0));
      } else {
        c = s; c = (c - 0.5) * 1.08 + 0.5 + n * 0.035;
        c *= vec3(1.02, 1.0, 0.97);
      }
      gl_FragColor = vec4(c * vig, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const feedQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), feedMat); feedQuad.frustumCulled = false;
feed.quadScene.add(feedQuad); app.feed = feed;
function pipRect() {
  const v = $('#pipView').getBoundingClientRect(), c = canvas.getBoundingClientRect();
  return { x: v.left - c.left, y: v.top - c.top, w: v.width, h: v.height, ch: c.height };
}
function renderScene(cam, thermal) {
  U.uThermal.value = thermal ? 1 : 0;
  const prevFog = U.uFogDensity.value;
  if (thermal) U.uFogDensity.value = prevFog * 0.4;
  renderer.render(scene, cam);
  U.uFogDensity.value = prevFog;
  U.uThermal.value = 0;
}
function renderPip(clk) {
  const d = units.drones.find((q) => q.id === state.selDrone); if (!d) return;
  const r = pipRect(); if (r.w < 10 || r.h < 10) return;
  const dpr = renderer.getPixelRatio();
  const W = Math.round(r.w * dpr), H = Math.round(r.h * dpr);
  if (!feed.rt || feed.rt.width !== W || feed.rt.height !== H) { feed.rt?.dispose(); feed.rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 }); }
  d.camera.aspect = r.w / r.h; d.camera.updateProjectionMatrix();
  const ir = d.sensor === 'ir';
  // hide all drone models in their own feed; other units keep their scale
  const vis = units.drones.map((q) => q.group.visible); units.drones.forEach((q) => (q.group.visible = q !== d && q.group.visible));
  const wasEmb = embers.visible; if (ir) embers.visible = false;
  const lv = labelsVisibleObjects(false);
  const ov = [pathSolid, pathFuture, ignGlow, wind.obj, ...arrowLines]; const ovVis = ov.map((o) => o.visible); ov.forEach((o) => (o.visible = false));
  renderer.setRenderTarget(feed.rt); renderer.clear(); renderScene(d.camera, ir);
  // thermal read-back (small) for max temperature & hot-spot box
  if (clk - feed.lastRead > 0.2) {
    feed.lastRead = clk;
    renderer.setRenderTarget(feed.heatRT); renderer.clear(); renderScene(d.camera, true);
    renderer.readRenderTargetPixels(feed.heatRT, 0, 0, 96, 60, feed.heatBuf);
    let mx = 0, mi = 0; const b = feed.heatBuf;
    for (let i = 0; i < 96 * 60; i++) { const v = b[i * 4]; if (v > mx) { mx = v; mi = i; } }
    const hv = mx / 255;
    d.maxTemp = Math.round(clamp(12 + Math.pow(Math.max(hv - 0.05, 0) / 0.95, 1.6) * 1080, 15, 1000));
    feed.hot = d.maxTemp > 300 ? { u: (mi % 96 + 0.5) / 96, v: 1 - (Math.floor(mi / 96) + 0.5) / 60, t: d.maxTemp } : null;
    // centre-pixel temperature
    const ci = 30 * 96 + 48; d.centreTemp = Math.round(clamp(12 + Math.pow(Math.max(b[ci * 4] / 255 - 0.05, 0) / 0.95, 1.6) * 1080, 10, 1000));
  }
  units.drones.forEach((q, i) => (q.group.visible = vis[i]));
  embers.visible = wasEmb; labelsVisibleObjects(true, lv); ov.forEach((o, i) => (o.visible = ovVis[i]));
  renderer.setRenderTarget(null);
  feedMat.uniforms.tSrc.value = feed.rt.texture; feedMat.uniforms.uMode.value = ir ? 1 : 0; feedMat.uniforms.uPal.value = d.palette === 'White hot' ? 1 : 0;
  feedMat.uniforms.uRes.value.set(W, H);
  const y = r.ch - r.y - r.h;
  renderer.setViewport(r.x, y, r.w, r.h); renderer.setScissor(r.x, y, r.w, r.h); renderer.setScissorTest(true);
  renderer.render(feed.quadScene, feed.quadCam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight);
  if (feed.snapshot) { const cb = feed.snapshot; feed.snapshot = null; cb(r); }
}
function labelsVisibleObjects(restore, saved) {
  // wind particles & retardant are fine in the feed; the measurement line is not
  if (!restore) { const s = [measureLine?.visible]; if (measureLine) measureLine.visible = false; return s; }
  if (measureLine && saved) measureLine.visible = saved[0];
}
app.snapshot = () => {
  feed.snapshot = (r) => {
    const dpr = renderer.getPixelRatio();
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = Math.round(320 * r.h / r.w);
    cv.getContext('2d').drawImage(canvas, r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr, 0, 0, cv.width, cv.height);
    const d = units.drones.find((q) => q.id === state.selDrone);
    const url = cv.toDataURL('image/jpeg', 0.85);
    state.evidence.unshift({ id: `EV-${String(100 + state.evidence.length).padStart(3, '0')}`, title: `${d.id} ${d.def.name} still · ${d.sensor.toUpperCase()}`, meta: `${fmtTime(state.time)} · ${fmtLatLon(d.camTarget.x, d.camTarget.z)}`, tag: 'Drone', thumb: `url(${url})`, img: url });
    UI.renderEvidence(app);
    UI.toast(`Still captured to Evidence · ${d.id}`);
  };
  const f = $('.pip-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
};

// HUD overlay drawn on the PiP
const hud = $('#hud'), hctx = hud.getContext('2d');
function drawHud(clk) {
  const d = units.drones.find((q) => q.id === state.selDrone); if (!d) return;
  const r = hud.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (hud.width !== Math.round(r.width * dpr)) { hud.width = Math.round(r.width * dpr); hud.height = Math.round(r.height * dpr); }
  const c = hctx; const W = r.width, H = r.height;
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const big = W > 800; const fs = big ? 12 : W > 600 ? 10 : 8.5;
  c.font = `500 ${fs}px "JetBrains Mono", monospace`; c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 1.6;
  c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 3;
  const m = 12, L = 16;
  // corner brackets
  [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => { c.beginPath(); c.moveTo(x, y + sy * L); c.lineTo(x, y); c.lineTo(x + sx * L, y); c.stroke(); });
  const ln = fs * 1.35;
  const tl = [`REC ${fmtRec(feed.rec)}`, `${d.id} ${d.def.name.toUpperCase()}`, d.sensor === 'ir' ? `IR · ${d.palette.toUpperCase()}` : 'EO · DAY'];
  c.textAlign = 'left';
  tl.forEach((s, i) => c.fillText(s, m + 6 + (i === 0 ? 8 : 0), m + 14 + i * ln));
  c.fillStyle = Math.floor(clk * 2) % 2 ? '#ff3b30' : 'rgba(255,59,48,0.25)'; c.beginPath(); c.arc(m + 9, m + 10.5, 3, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff';
  c.textAlign = 'right';
  const tp = timeParts(state.time);
  [`${app.real ? 'JUN' : 'AUG'} ${tp.day}, ${String(tp.hh).padStart(2, '0')}:${String(tp.mm).padStart(2, '0')} ${app.real ? 'WEST' : 'PDT'}`, d.def.status.toUpperCase()].forEach((s, i) => c.fillText(s, W - m - 6, m + 14 + i * ln));
  // bottom-left / bottom-right telemetry
  c.textAlign = 'left';
  [`ALT ${fmtInt(d.agl / FT)} FT AGL`, `GS  ${Math.round(d.speed / KT)} KT`, `HDG ${String(Math.round(d.headingDeg)).padStart(3, '0')}°`].forEach((s, i) => c.fillText(s, m + 6, H - m - 8 - (2 - i) * ln));
  c.textAlign = 'right';
  [`BAT ${Math.round(d.battery)}%`, `LNK ${d.link} DBM`, `ZOOM ${d.zoom.toFixed(1)}× · ${Math.round(d.camera.fov)}° FOV`].forEach((s, i) => c.fillText(s, W - m - 6, H - m - 8 - (2 - i) * ln));
  c.textAlign = 'center';
  const ct = d.camTarget;
  c.fillText(`SPI ${fmtLatLonHud(ct.x, ct.z)}`, W / 2 + W * 0.04, H - m - 8 - ln);
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.fillText(`RNG ${fmtInt(d.range)} M · ELEV ${fmtInt(terrain.elev(ct.x, ct.z))} M · ${d.centreTemp ?? 27} °C`, W / 2 + W * 0.04, H - m - 8);
  c.fillStyle = '#fff';
  // crosshair
  const cx = W / 2, cy = H / 2;
  c.beginPath(); c.moveTo(cx - 16, cy); c.lineTo(cx - 5, cy); c.moveTo(cx + 5, cy); c.lineTo(cx + 16, cy); c.moveTo(cx, cy - 16); c.lineTo(cx, cy - 5); c.moveTo(cx, cy + 5); c.lineTo(cx, cy + 16); c.stroke();
  // heading tape (top)
  const tw = Math.min(260, W * 0.4); const hdg = d.gimbalHdg ?? d.headingDeg;
  c.save(); c.beginPath(); c.rect(cx - tw / 2, 0, tw, 50); c.clip();
  c.lineWidth = 1; c.font = `${fs - 1}px "JetBrains Mono", monospace`;
  for (let a = Math.floor((hdg - 40) / 5) * 5; a <= hdg + 40; a += 5) {
    const x = cx + (a - hdg) * (tw / 80); const major = a % 30 === 0;
    c.beginPath(); c.moveTo(x, 20); c.lineTo(x, major ? 28 : 24); c.stroke();
    if (major) c.fillText(String(((a % 360) + 360) % 360), x, 16);
  }
  c.restore();
  c.beginPath(); c.moveTo(cx, 30); c.lineTo(cx - 4, 36); c.lineTo(cx + 4, 36); c.closePath(); c.fill();
  c.fillText(`${Math.round(hdg)}°`, cx, 48);
  // gimbal pitch scale (right)
  const gx = W - m - 26, gy0 = H * 0.24, gy1 = H * 0.66;
  c.textAlign = 'right'; c.fillText('GMB', gx + 8, gy0 - 8);
  c.beginPath(); c.moveTo(gx, gy0); c.lineTo(gx, gy1); c.stroke();
  for (let k = 0; k <= 9; k++) { const y = gy0 + (gy1 - gy0) * k / 9; c.beginPath(); c.moveTo(gx, y); c.lineTo(gx - (k % 3 === 0 ? 8 : 4), y); c.stroke(); }
  const gp = clamp(-(d.gimbalPitch ?? -45), 0, 90); const py = gy0 + (gy1 - gy0) * gp / 90;
  c.beginPath(); c.moveTo(gx + 2, py); c.lineTo(gx + 8, py - 4); c.lineTo(gx + 8, py + 4); c.closePath(); c.fill();
  c.fillText(`${Math.round(d.gimbalPitch ?? -45)}°`, gx - 12, py + 4);
  // hot-spot bracket
  if (d.sensor === 'ir' || feed.hot) {
    const h = feed.hot;
    if (h && state.mode === 'drones') {
      const x = h.u * W, y = h.v * H, s = 14;
      c.strokeStyle = d.sensor === 'ir' ? '#fff' : '#ff9a62'; c.lineWidth = 1.4;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => { c.beginPath(); c.moveTo(x + sx * s, y + sy * (s - 6)); c.lineTo(x + sx * s, y + sy * s); c.lineTo(x + sx * (s - 6), y + sy * s); c.stroke(); });
      c.textAlign = 'center'; c.fillStyle = d.sensor === 'ir' ? '#fff' : '#ff9a62';
      c.fillText(`HOT ${h.t}°C`, x, y - s - 4);
    }
  }
}
const fmtRec = (s) => `0:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

// ------------------------------------------------------------------ charts
const charts = $$('#charts .chart').map((el) => ({ el, chart: new Chart($('canvas', el)), title: $('.ch-title', el), meta: $('.ch-meta', el) }));
app.charts = charts;
let chartsDirty = true;
function scheduleCharts() { chartsDirty = true; }
app.scheduleCharts = scheduleCharts;
function drawCharts() {
  chartsDirty = false;
  UI.drawCharts(app, charts);
}

// ------------------------------------------------------------------ modes
export function setMode(mode, init) {
  const prev = state.mode;
  state.mode = mode;
  $$('.mode-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#sideIncident').classList.toggle('hidden', mode !== 'incident');
  $('#sideDrones').classList.toggle('hidden', mode !== 'drones');
  $('#sideResources').classList.toggle('hidden', mode !== 'resources');
  units.drones.forEach((u) => (u.group.visible = mode === 'drones'));
  units.air.forEach((u) => (u.group.visible = mode === 'resources'));
  units.ground.forEach((u) => (u.group.visible = mode === 'resources'));
  retardant.object.visible = mode === 'resources';
  $('#pip').classList.toggle('hidden', mode !== 'drones' || !state.pip.open);
  viewport.classList.toggle('pip-full', mode === 'drones' && state.pip.open && state.pip.full);
  $('#tlStep').disabled = mode === 'resources';
  if (mode !== 'resources') { exitChase(); state.selUnit = null; UI.renderUnitHud(app); }
  if (mode === 'drones') {
    if (!init) setTime(app.real ? T(18, 3, 5) : T(15, 4));
    UI.renderDrones(app); UI.updatePip(app);
    const d = units.drones.find((q) => q.id === state.selDrone);
    updateFireGeom(true);
    units.drones.forEach((u) => u.update(0.016, unitCtx));
    setDim('3d', () => followUnit(d, 1340));
  } else if (mode === 'resources') {
    if (!init) setTime(app.real ? T(18, 16) : C.T_CONTAIN);
    UI.renderResources(app);
    if (prev === 'drones') resetCamera();
  } else {
    if (prev !== 'incident' && !init) { setTime(app.real ? T(17, 20) : T(15, 16)); resetCamera(); }
  }
  UI.renderFeed(app);
  scheduleCharts();
  if (!init) writeHash();
}
app.setMode = setMode;

// ------------------------------------------------------------------ UI wiring
function setupUI() {
  buildLabels();
  UI.init(app);
  // mode tabs
  $$('.mode-tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('#dimSeg button').forEach((b) => b.addEventListener('click', () => setDim(b.dataset.dim)));
  $('#compass').addEventListener('click', () => { const s = camSph(); exitChase(); flyTo(controls.target.x, controls.target.z, s.radius, state.dim === '2d' ? 0.0001 : Math.min(s.phi, 0.95), 0, 1); });
  $('#fsBtn').addEventListener('click', toggleFullscreen);
  $('#zoomBtn').addEventListener('click', (e) => UI.showMenu(e.currentTarget, [1, 2.5, 5, 10, 20, 30, 50].map((z) => ({ label: `${z}×`, action: () => setZoom(z) })), 'up'));
  $('#measureDone').addEventListener('click', () => finishMeasure(false));
  $('#measureCancel').addEventListener('click', () => finishMeasure(true));
  // PiP
  $$('.pip-seg button').forEach((b) => b.addEventListener('click', () => { const d = curDrone(); d.sensor = b.dataset.sensor; UI.updatePip(app); UI.renderDrones(app); }));
  $('#pipPalette').addEventListener('click', () => { const d = curDrone(); d.palette = d.palette === 'Ironbow' ? 'White hot' : 'Ironbow'; if (d.sensor !== 'ir') d.sensor = 'ir'; UI.updatePip(app); });
  $('#pipZoomIn').addEventListener('click', () => { const d = curDrone(); d.zoom = Math.min(30, +(d.zoom * 1.5).toFixed(1)); UI.updatePip(app); });
  $('#pipZoomOut').addEventListener('click', () => { const d = curDrone(); d.zoom = Math.max(1, +(d.zoom / 1.5).toFixed(1)); UI.updatePip(app); });
  $('#pipExpand').addEventListener('click', () => togglePipFull());
  $('#pipClose').addEventListener('click', () => { state.pip.open = false; state.pip.full = false; viewport.classList.remove('pip-full'); $('#pip').classList.add('hidden'); $('#pip').classList.remove('full'); UI.renderDrones(app); });
  $('#pipSnap').addEventListener('click', () => app.snapshot());
  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable=true]')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') setTime(state.time + (e.shiftKey ? 6 : 1));
    else if (e.key === 'ArrowLeft') setTime(state.time - (e.shiftKey ? 6 : 1));
    else if (e.key === 'c' || e.key === 'C') cycleCam();
    else if (e.key === 'Escape') { if (measure.active) finishMeasure(true); else if (state.pip.full) togglePipFull(false); else if (state.camMode === 'chase' || state.camMode === 'cockpit') setCamMode('overview'); UI.closeMenus(); }
    else if (e.key === 'l' || e.key === 'L') { state.labels = !state.labels; UI.toast(`Labels ${state.labels ? 'on' : 'off'}`); }
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'r' || e.key === 'R') resetCamera();
    else if (e.key === 'm' || e.key === 'M') startMeasure('measure');
    else if (e.key === '2') setDim('2d');
    else if (e.key === '3') setDim('3d');
    else if (e.key === 'Enter' && measure.active) finishMeasure(false);
  });
  window.addEventListener('resize', resize);
  $('#sideToggle').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('#sideScrim').addEventListener('click', () => document.body.classList.remove('side-open'));
  new ResizeObserver(resize).observe(viewport);
}
const curDrone = () => units.drones.find((q) => q.id === state.selDrone);
app.curDrone = curDrone;
export function togglePipFull(force) {
  state.pip.full = force ?? !state.pip.full;
  $('#pip').classList.toggle('full', state.pip.full);
  viewport.classList.toggle('pip-full', state.pip.full);
  $('#pipExpand').innerHTML = `<i class="ic" data-ic="${state.pip.full ? 'shrink' : 'expand'}"></i>`; hydrateIcons($('#pip'));
  UI.renderDrones(app);
}
app.togglePipFull = togglePipFull;
export function togglePlay(force) {
  state.playing = force ?? !state.playing;
  if (state.playing && state.time >= C.T_END - 0.01) setTime(C.T_START);
  $('#tlPlay').classList.toggle('on', state.playing); $('#tlPause').classList.toggle('on', !state.playing);
}
app.togglePlay = togglePlay;
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.();
}
app.toggleFullscreen = toggleFullscreen;
app.resetProfile = () => { state.profilePath = progressionPts(true); computeProfile(); scheduleCharts(); };
app.rerunModel = (opts) => {
  fire = C.simulateFire(terrain, opts);
  world.setFire(fire);
  deriveFromFire();
  buildFireGraphics();
  labels.filter((l) => l.el.classList.contains('lbl-time')).forEach((l) => { /* follow live head positions automatically */ });
  units.ground.forEach((u) => { const l = lines.find((q) => q.id === u.id); if (l) { u.line = l; u.s = l.length * 0.7; } });
  UI.renderAll(app);
  setTime(state.time, true);
  UI.toast(`Spread model re-run · ${fmtInt(fire.finalAcres)} acres final`);
};

function placeFeed() {
  // narrow screens: key-events feed lives in the side panel instead of squeezing the charts
  const feedEl = $('#feed'); if (!feedEl) return;
  const narrow = window.innerWidth <= 1024;
  if (narrow && feedEl.parentElement.id !== 'side') $('#side').prepend(feedEl);
  if (!narrow && feedEl.parentElement.id === 'side') $('#bottom').appendChild(feedEl);
}
function resize() {
  placeFeed();
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  lineMats.forEach((m) => m.resolution.set(w, h));
  scheduleCharts();
  UI.layoutTimeline?.();
}

// ------------------------------------------------------------------ URL hash (share link)
function writeHash() {
  if (!controls) return;
  const s = camSph(); const t = controls.target;
  const h = `m=${state.mode}&t=${state.time.toFixed(2)}&d=${state.dim}&cam=${Math.round(t.x)},${Math.round(t.z)},${Math.round(s.radius)},${s.phi.toFixed(3)},${s.theta.toFixed(3)}`;
  history.replaceState(null, '', `#${h}`);
}
app.writeHash = writeHash;
function applyHash() {
  const p = new URLSearchParams(initialHash.slice(1));
  if (p.get('m')) { state.mode = p.get('m'); if (!p.get('t')) state.time = state.mode === 'drones' ? (app.real ? T(18, 3, 5) : T(15, 4)) : state.mode === 'resources' ? (app.real ? T(18, 16) : C.T_CONTAIN) : state.time; }
  if (p.get('t')) state.time = +p.get('t');
  if (p.get('d') === '2d') { state.dim = '2d'; U.uMap.value = 1; world.setFlatten(0.02); viewport.classList.add('map2d'); $$('#dimSeg button').forEach((b) => b.classList.toggle('on', b.dataset.dim === '2d')); world.treesA.visible = world.treesB.visible = false; controls.maxPolarAngle = 0.0001; }
  const cam = p.get('cam');
  if (cam) { const [x, z, r, ph, th] = cam.split(',').map(Number); flyTo(x, z, r, ph, th, 0.01); }
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), clk = 0, acc = { charts: 0, hist: 0, ui: 0, hash: 0, det: 0 }, fpsAcc = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  clk += dt; unitCtx.clk = clk; U.uClock.value = clk; feed.rec += dt;
  if (state.playing) {
    const rate = 0.75 * state.speed;
    const nt = state.time + dt * rate;
    if (nt >= C.T_END) { setTime(C.T_END); togglePlay(false); } else setTime(nt);
  }
  // units
  const camDist = (u) => camera.position.distanceTo(u.pos);
  if (state.mode === 'drones') units.drones.forEach((u) => u.update(dt, unitCtx));
  if (app.real && state.mode === 'resources') [...units.air, ...units.ground].forEach((u) => { const on = u.def.windows ? u.def.windows.some(([a, b]) => state.time >= a && state.time <= b) : state.time >= (u.def.from ?? 0); u.active = on; if (!on) u.group.visible = false; else if (u.hiddenByLeg !== true && !u.group.visible && u.kind !== 'air') u.group.visible = true; });
  if (state.mode === 'resources') { units.air.forEach((u) => (u.active === false ? null : u.update(dt, unitCtx))); units.ground.forEach((u) => u.update(dt, unitCtx)); retardant.update(dt); }
  updateCamera(dt);
  if (controls.enabled) controls.update();
  // visual scale for units
  units.all.forEach((u) => {
    if (!u.group.visible) return;
    const sel = (state.camMode === 'chase' || state.camMode === 'cockpit') && state.selUnit === u.id;
    const k = u.kind === 'drone' ? 0.016 : u.kind === 'air' ? 0.0045 : 0.012;
    u.visScale = sel ? 1 : clamp(camDist(u) * k / u.realSize, 1, 400);
    if (u.kind === 'crew' && u.visScale > 3) u.visScale = Math.min(u.visScale, 6 + camDist(u) * 0.004);
    u.applyTransform(clk);
  });
  // ignition glow
  const ig = C.PLACES.ignition; const igOn = state.layers.ign.on && state.mode !== 'drones';
  ignGlow.visible = igOn; ignGlow2.visible = igOn && !!C.PLACES.ignition2;
  if (ignGlow2.visible) {
    const g2 = C.PLACES.ignition2; ignGlow2.position.set(g2.x, world.groundY(g2.x, g2.z) + 25, g2.z);
    const s2 = camera.position.distanceTo(ignGlow2.position) * 0.05 * (0.9 + 0.12 * Math.sin(clk * 3 + 1)); ignGlow2.scale.set(s2, s2, 1);
  }
  if (igOn) {
    const gy = world.groundY(ig.x, ig.z);
    ignGlow.position.set(ig.x, gy + 25, ig.z);
    const dist = camera.position.distanceTo(ignGlow.position);
    const s = dist * 0.05 * (0.9 + 0.12 * Math.sin(clk * 3)) * (state.time < C.T_IGNITION + 3 ? 1.4 : 0.8);
    ignGlow.scale.set(s, s, 1); ignGlow.material.opacity = state.layers.ign.op;
  }
  if (embers) embers.material.uniforms.uScale.value = viewport.clientHeight * 1.1;
  wind.update(dt);
  // camera near plane relative to altitude
  const camG = world.groundY(clamp(camera.position.x, -C.HALF, C.HALF), clamp(camera.position.z, -C.HALF, C.HALF));
  const alt = Math.max(camera.position.y - camG, 1);
  camera.near = clamp(alt * 0.15, 0.5, 60); camera.updateProjectionMatrix();
  U.uFogDensity.value = state.haze ? (app.real ? 0.0000125 : 0.000026) : 0.000004;
  processHover();
  updateLabels();
  // render
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight);
  renderer.clear();
  const pipVisible = state.mode === 'drones' && state.pip.open;
  if (!(pipVisible && state.pip.full)) renderer.render(scene, camera);
  if (pipVisible) { renderPip(clk); drawHud(clk); }
  // periodic UI
  acc.ui += dt; acc.hist += dt; acc.charts += dt; acc.hash += dt; acc.det += dt;
  if (acc.ui > 0.1) { acc.ui = 0; UI.updateMapChrome(app, camSph()); }
  if (acc.hist > 0.5) {
    acc.hist = 0;
    units.drones.forEach((d) => {
      d.hist.alt.push(d.agl / FT); d.hist.batt.push(d.battery); d.hist.temp.push(d.id === state.selDrone ? d.maxTemp : (d.maxTemp ?? 40));
      ['alt', 'batt', 'temp'].forEach((k) => { if (d.hist[k].length > 120) d.hist[k].shift(); });
    });
    if (state.mode === 'drones') { UI.renderDroneLive(app); scheduleCharts(); }
    if (state.mode === 'resources') { UI.renderResLive(app); UI.renderUnitHud(app, true); }
  }
  if (acc.det > 3 && state.mode === 'drones') { acc.det = 0; UI.checkDetections(app, clk); }
  if (chartsDirty && acc.charts > 0.08) { acc.charts = 0; drawCharts(); }
  if (acc.hash > 1.5) { acc.hash = 0; writeHash(); }
  if (state.showFps) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { UI.setFps(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; } }
}

init().catch((e) => { console.error(e); $('#ldStep').textContent = `Error: ${e.message}`; });
