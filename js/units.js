// Drones, aircraft, ground units: procedural models + live behaviour.
import * as THREE from 'three';
import { litMaterial } from './world3d.js';
import { clamp, lerp, mulberry32, DEG } from './util.js';
import { PLACES, HALF, WATER, BASE, T_SPOT, roadAt, ROADS } from './core.js';
import { divisionFor } from './scenario.js';

const KT = 0.514444, MPH = 0.44704, FT = 0.3048;
const rnd = mulberry32(2024);

// ---------- model helpers ----------
function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); return m; }
function boxM(w, h, l, mat, x = 0, y = 0, z = 0) { const m = mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); return m; }
function cylZ(r1, r2, len, mat, seg = 12) { const g = new THREE.CylinderGeometry(r1, r2, len, seg); g.rotateX(Math.PI / 2); return mesh(g, mat); }

function navLights(g, span, y = 0, z = 0) {
  const red = litMaterial('#000', { emissive: '#ff2a1a', heat: 0.4 });
  const green = litMaterial('#000', { emissive: '#3dff6a', heat: 0.4 });
  const s = new THREE.SphereGeometry(Math.max(span * 0.018, 0.06), 6, 4);
  const l = mesh(s, red); l.position.set(-span / 2, y, z);
  const r = mesh(s, green); r.position.set(span / 2, y, z);
  g.add(l, r);
  return [red, green];
}

function tankerModel(def) {
  const g = new THREE.Group();
  const white = litMaterial('#eeeeea', { heat: 0.32 }), red = litMaterial('#c62a20', { heat: 0.32 }), dark = litMaterial('#3a3a3c', { heat: 0.6 }), glass = litMaterial('#1c2a33', { heat: 0.3 });
  const P = { vlat: [55, 50, 3.0], c130: [30, 40, 2.3], rj85: [29, 26, 1.8], kingair: [13.4, 16.6, 0.85] }[def.model];
  const [L, S, R] = P;
  const fus = cylZ(R, R, L * 0.82, white); g.add(fus);
  const nose = mesh(new THREE.SphereGeometry(R, 12, 8), white); nose.scale.set(1, 1, 1.8); nose.position.z = -L * 0.41; g.add(nose);
  const tail = mesh(new THREE.ConeGeometry(R, L * 0.2, 12), white); tail.rotation.x = Math.PI / 2; tail.position.set(0, R * 0.25, L * 0.5); g.add(tail);
  const cockpit = boxM(R * 1.3, R * 0.35, R * 0.9, glass, 0, R * 0.55, -L * 0.42); g.add(cockpit);
  const wingGeo = new THREE.BoxGeometry(S, R * 0.16, L * 0.16);
  const wing = mesh(wingGeo, white); wing.position.set(0, def.model === 'c130' || def.model === 'rj85' ? R * 0.85 : -R * 0.45, -L * 0.04); g.add(wing);
  const stab = boxM(S * 0.36, R * 0.12, L * 0.09, white, 0, R * 0.4, L * 0.47); g.add(stab);
  const fin = boxM(R * 0.18, S * 0.17, L * 0.13, red, 0, R + S * 0.07, L * 0.45); g.add(fin);
  const stripe = cylZ(R * 1.01, R * 1.01, L * 0.12, red); stripe.position.z = L * 0.08; g.add(stripe);
  const nEng = def.model === 'c130' || def.model === 'rj85' ? 4 : 2;
  for (let i = 0; i < nEng; i++) {
    const side = i % 2 ? 1 : -1, k = nEng === 4 ? (i < 2 ? 0.2 : 0.38) : 0.28;
    const e = cylZ(R * 0.42, R * 0.38, L * 0.12, def.model === 'c130' ? white : dark); e.position.set(side * S * k, wing.position.y - R * 0.45, -L * 0.1); g.add(e);
  }
  if (def.model === 'vlat') { const te = cylZ(R * 0.5, R * 0.45, L * 0.12, dark); te.position.set(0, R + S * 0.08, L * 0.36); g.add(te); }
  const lights = navLights(g, S, wing.position.y, -L * 0.04);
  return { g, len: L, lights, rotors: [] };
}
function heliModel(def) {
  const g = new THREE.Group();
  const body = litMaterial(def.model === 'skycrane' ? '#d9d2c4' : '#c43a22', { heat: 0.45 }), dark = litMaterial('#2f2f31', { heat: 0.5 });
  const rotorM = litMaterial('#222', { heat: 0.3, opacity: 0.55 });
  const L = def.model === 'skycrane' ? 21 : 13, R = def.model === 'skycrane' ? 22 : 15;
  if (def.model === 'skycrane') {
    g.add(boxM(1.6, 1.8, L * 0.85, body, 0, 1.6, 0));
    g.add(boxM(2.2, 2.0, 3.2, body, 0, 1.2, -L * 0.38));
    g.add(boxM(1.2, 1.2, 4, dark, 0, -0.2, 0)); // tank
    g.add(boxM(0.4, 3.5, 1.4, body, 0, 3.2, L * 0.45));
  } else {
    const cab = mesh(new THREE.SphereGeometry(1.4, 12, 8), body); cab.scale.set(1, 1, 1.7); g.add(cab);
    const boom = cylZ(0.45, 0.2, L * 0.55, body); boom.position.set(0, 0.5, L * 0.38); g.add(boom);
    g.add(boxM(0.2, 2.2, 1.0, body, 0, 1.5, L * 0.64));
    g.add(boxM(2.6, 0.15, 0.15, dark, 0, -1.6, -0.8)); g.add(boxM(2.6, 0.15, 0.15, dark, 0, -1.6, 0.8));
    // bucket on a long line
    const line = mesh(new THREE.CylinderGeometry(0.05, 0.05, 30, 4), dark); line.position.y = -16; g.add(line);
    const bucket = mesh(new THREE.CylinderGeometry(1.0, 0.7, 1.4, 10), litMaterial('#c63c20', { heat: 0.3 })); bucket.position.y = -31.5; g.add(bucket);
  }
  const rg = new THREE.Group();
  for (let i = 0; i < (def.model === 'skycrane' ? 6 : 2); i++) { const b = boxM(R, 0.06, 0.55, rotorM); b.rotation.y = i * Math.PI / (def.model === 'skycrane' ? 3 : 1) / (def.model === 'skycrane' ? 1 : 2); rg.add(b); }
  rg.position.y = def.model === 'skycrane' ? 3.4 : 2.0; g.add(rg);
  const lights = navLights(g, 3, 0.5, 0);
  return { g, len: L, lights, rotors: [rg] };
}
function droneModel(def) {
  const g = new THREE.Group();
  const body = litMaterial('#e8e6e2', { heat: 0.55 }), dark = litMaterial('#2c2c2e', { heat: 0.5 }), rotorM = litMaterial('#111', { heat: 0.4, opacity: 0.45 });
  const rotors = [];
  if (def.kind === 'quad') {
    g.add(boxM(0.5, 0.18, 0.62, body));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const arm = boxM(0.06, 0.05, 0.62, dark); arm.position.set(Math.sin(a) * 0.32, 0.04, Math.cos(a) * 0.32); arm.rotation.y = a; g.add(arm);
      const r = mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.015, 16), rotorM); r.position.set(Math.sin(a) * 0.6, 0.1, Math.cos(a) * 0.6); g.add(r); rotors.push(r);
    }
    const gimbal = mesh(new THREE.SphereGeometry(0.1, 8, 6), dark); gimbal.position.set(0, -0.14, -0.2); g.add(gimbal);
  } else {
    g.add(boxM(0.28, 0.26, 1.7, body));
    g.add(boxM(3.4, 0.05, 0.38, body, 0, 0.1, -0.1));
    g.add(boxM(0.04, 0.04, 1.6, dark, -0.55, 0.05, 0.4)); g.add(boxM(0.04, 0.04, 1.6, dark, 0.55, 0.05, 0.4));
    const vt = boxM(1.3, 0.04, 0.25, body, 0, 0.32, 1.15); vt.rotation.z = 0; g.add(vt);
    g.add(boxM(0.04, 0.4, 0.25, body, -0.55, 0.22, 1.15)); g.add(boxM(0.04, 0.4, 0.25, body, 0.55, 0.22, 1.15));
    for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 1.15], [0.55, 1.15]]) {
      const r = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.012, 14), rotorM); r.position.set(x, 0.1, z); g.add(r); rotors.push(r);
    }
    const prop = boxM(0.5, 0.04, 0.04, dark, 0, 0, 0.87); g.add(prop); rotors.push(prop);
  }
  const lights = navLights(g, def.kind === 'quad' ? 1.3 : 3.4, 0.05, 0);
  return { g, len: def.kind === 'quad' ? 1.3 : 3.4, lights, rotors };
}
function truckModel(def) {
  const g = new THREE.Group();
  const isTender = def.model === 'tender';
  const red = litMaterial(isTender ? '#d2d0cc' : '#c3241c', { heat: 0.4 }), white = litMaterial('#ecebe6', { heat: 0.35 }), dark = litMaterial('#262628', { heat: 0.5 });
  const L = def.model === 'engine1' ? 9.5 : isTender ? 10 : 8;
  g.add(boxM(2.5, 2.4, L * 0.32, red, 0, 1.7, -L * 0.33));
  g.add(boxM(2.4, 0.9, L * 0.3, litMaterial('#25313a', { heat: 0.3 }), 0, 2.2, -L * 0.37)).scale.set(1.02, 0.5, 0.9);
  if (isTender) { const tank = cylZ(1.2, 1.2, L * 0.6, white); tank.position.set(0, 1.9, L * 0.17); g.add(tank); }
  else g.add(boxM(2.5, 2.3, L * 0.62, red, 0, 1.65, L * 0.17));
  g.add(boxM(2.55, 0.12, L * 0.6, white, 0, 2.0, L * 0.17));
  for (const z of [-L * 0.33, L * 0.1, L * 0.35]) for (const x of [-1.2, 1.2]) { const w = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 10), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.5, z); g.add(w); }
  const lb1 = litMaterial('#000', { emissive: '#ff1a10', heat: 0.5 }), lb2 = litMaterial('#000', { emissive: '#ff1a10', heat: 0.5 });
  g.add(boxM(0.9, 0.25, 0.4, lb1, -0.5, 3.05, -L * 0.38), boxM(0.9, 0.25, 0.4, lb2, 0.5, 3.05, -L * 0.38));
  return { g, len: L, lights: [lb1, lb2], rotors: [], strobe: true };
}
function dozerModel() {
  const g = new THREE.Group();
  const y = litMaterial('#e3b021', { heat: 0.55 }), dark = litMaterial('#2a2a2a', { heat: 0.5 });
  g.add(boxM(2.6, 1.6, 4, y, 0, 1.4, 0));
  g.add(boxM(1.8, 1.4, 1.6, dark, 0, 2.8, 0.6));
  g.add(boxM(3.4, 1.3, 0.3, y, 0, 0.8, -2.6));
  g.add(boxM(0.7, 0.9, 4.6, dark, -1.3, 0.45, 0), boxM(0.7, 0.9, 4.6, dark, 1.3, 0.45, 0));
  return { g, len: 6, lights: [], rotors: [] };
}
function crewModel(n) {
  const g = new THREE.Group();
  const shirt = litMaterial('#e9c42a', { heat: 0.62 }), pants = litMaterial('#4c5236', { heat: 0.5 }), hat = litMaterial('#f2f2ee', { heat: 0.5 });
  const people = [];
  for (let i = 0; i < n; i++) {
    const p = new THREE.Group();
    p.add(boxM(0.45, 0.8, 0.3, pants, 0, 0.4, 0));
    p.add(boxM(0.55, 0.7, 0.35, shirt, 0, 1.15, 0));
    const h = mesh(new THREE.SphereGeometry(0.17, 8, 6), hat); h.position.y = 1.65; p.add(h);
    g.add(p); people.push(p);
  }
  return { g, len: 3, lights: [], rotors: [], people };
}

// ---------- base unit ----------
class Unit {
  constructor(def, kind, model) {
    this.def = def; this.id = def.id; this.kind = kind;
    this.model = model; this.group = new THREE.Group(); this.group.add(model.g);
    this.group.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.heading = 0; this.pitch = 0; this.bank = 0; this.speed = 0; this.agl = 0;
    this.status = def.status || ''; this.statusColor = 'g';
    this.visScale = 1; this.minPx = 0.02;
    this.group.traverse((o) => { o.userData.unit = this; });
    this.blink = rnd() * 10;
  }
  applyTransform(clk) {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, -this.heading, this.bank);
    this.group.scale.setScalar(this.visScale);
    for (const r of this.model.rotors) r.rotation.y += 0.9;
    if (this.model.lights.length) {
      const on = this.model.strobe ? (Math.floor((clk + this.blink) * 4) % 2) : (Math.floor((clk + this.blink) * 1.2) % 2);
      this.model.lights.forEach((m, i) => {
        const c = m.uniforms.uEmissive.value;
        if (this.model.strobe) c.setRGB(i % 2 === on ? 1 : 0.15, 0.08, 0.05);
        else c.setRGB(i === 0 ? (on ? 1 : 0.3) : 0.2, i === 1 ? (on ? 1 : 0.3) : 0.1, 0.1);
      });
    }
  }
  get headingDeg() { return ((this.heading / DEG) % 360 + 360) % 360; }
  get latlonXZ() { return [this.pos.x, this.pos.z]; }
}

// ---------- drones ----------
function circlePath(cx, cz, r, n = 72, ang0 = 0) { const p = []; for (let i = 0; i <= n; i++) { const a = ang0 + i / n * Math.PI * 2; p.push([cx + Math.sin(a) * r, cz - Math.cos(a) * r]); } return p; }
function ellipsePath(e, scale = 1.08, n = 96) {
  const p = []; const ca = Math.cos(e.ang), sa = Math.sin(e.ang);
  for (let i = 0; i <= n; i++) {
    const t = i / n * Math.PI * 2; const u = Math.cos(t) * e.a * scale, v = Math.sin(t) * e.b * scale;
    p.push([e.cx + u * ca - v * sa, e.cz + u * sa + v * ca]);
  }
  return p;
}
function pathLen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
function pathAt(p, s, wrap = true) {
  const L = p._len || (p._len = pathLen(p)); s = wrap ? ((s % L) + L) % L : clamp(s, 0, L - 1e-3);
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc + l >= s) { const f = (s - acc) / (l || 1); return [lerp(p[i - 1][0], p[i][0], f), lerp(p[i - 1][1], p[i][1], f)]; }
    acc += l;
  }
  return p[p.length - 1];
}

export class Drone extends Unit {
  constructor(def) {
    super(def, 'drone', droneModel(def));
    this.realSize = def.kind === 'quad' ? 1.3 : 3.4;
    this.s = rnd() * 5000;
    this.battery = def.battery; this.flight = def.flight; this.link = -68;
    this.camTarget = new THREE.Vector3();
    this.camera = new THREE.PerspectiveCamera(42, 16 / 10, 2, 60000);
    this.zoom = 1;
    this.hist = { alt: [], temp: [], batt: [] };
    this.maxTemp = 40;
    this.lastDetect = -100;
    this.path = null; this.statusColor = 'g';
  }
  buildPath(fg, world) {
    const d = this.def;
    switch (d.pattern) {
      case 'perimeter': this.path = ellipsePath(fg.ellipse, 1.06); this.look = 'inward'; break;
      case 'orbitHead': this.path = circlePath(fg.head.x, fg.head.z, 380); this.lookAt = [fg.head.x, fg.head.z]; break;
      case 'orbitSpot': { const c = fg.spotActive ? fg.spot : fg.flank; this.path = circlePath(c.x, c.z, 320); this.lookAt = [c.x, c.z]; break; }
      case 'patrol': { const c = PLACES.oakFlats ? { x: PLACES.oakFlats.x + 300, z: PLACES.oakFlats.z + 400 } : (PLACES.town2 || PLACES.ignition); this.path = ellipsePath({ cx: c.x, cz: c.z, a: 900, b: 380, ang: 0.5 }, 1, 64); this.lookAt = [c.x, c.z]; break; }
      case 'survey': {
        const e = fg.ellipse; const rows = 6; const p = [];
        const ca = Math.cos(e.ang), sa = Math.sin(e.ang);
        for (let r = 0; r < rows; r++) {
          const v = (r / (rows - 1) - 0.5) * 2 * e.b * 0.85;
          const ends = [-e.a * 0.9, e.a * 0.9]; if (r % 2) ends.reverse();
          for (const u of ends) p.push([e.cx + u * ca - v * sa, e.cz + u * sa + v * ca]);
        }
        p.push(p[0]); this.path = p; this.look = 'down'; break;
      }
      case 'relay': { const c = PLACES.canyonCreek ? { x: PLACES.canyonCreek.x - 300, z: PLACES.canyonCreek.z + 900 } : (PLACES.v1 || PLACES.ignition); this.path = circlePath(c.x, c.z, 450); this.lookAt = PLACES.canyonCreek ? [-5600, 300] : [c.x, c.z]; break; }
    }
    this.path._len = pathLen(this.path);
  }
  update(dt, ctx) {
    if (!this.path) return;
    const d = this.def;
    const v = d.speed * KT * (d.kind === 'quad' ? 1 : 1);
    this.s += v * dt;
    const [tx, tz] = pathAt(this.path, this.s);
    const [ax, az] = pathAt(this.path, this.s + 40);
    const k = Math.min(1, dt * 1.5);
    this.pos.x = lerp(this.pos.x || tx, tx, k); this.pos.z = lerp(this.pos.z || tz, tz, k);
    const gy = ctx.world.groundY(this.pos.x, this.pos.z);
    const wob = Math.sin(ctx.clk * 0.3 + this.blink) * 40;
    const targetAgl = (d.agl + wob) * FT;
    this.aglCur = this.aglCur === undefined ? targetAgl : lerp(this.aglCur, targetAgl, Math.min(1, dt * 0.8));
    // follow a smoothed terrain reference (raw ground under a fast drone is bumpy)
    this.gSm = this.gSm === undefined || Math.abs(this.gSm - gy) > 400 ? gy : lerp(this.gSm, gy, Math.min(1, dt * 0.7));
    this.pos.y = Math.max(this.gSm + this.aglCur, gy + 20);
    this.agl = this.pos.y - gy;
    const h = Math.atan2(ax - tx, -(az - tz));
    let dh = h - this.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    this.heading += dh * Math.min(1, dt * 3);
    this.bank = d.kind === 'fixed' ? clamp(-dh * 2.5, -0.5, 0.5) : clamp(-dh * 0.6, -0.15, 0.15);
    this.pitch = d.kind === 'quad' ? -0.12 : 0;
    this.speed = v;
    // gimbal target
    if (this.look === 'inward') {
      const e = ctx.fireGeom.ellipse;
      this.camTarget.set(lerp(this.pos.x, e.cx, 0.22), 0, lerp(this.pos.z, e.cz, 0.22));
    } else if (this.look === 'down') {
      this.camTarget.set(this.pos.x + Math.sin(this.heading) * 180, 0, this.pos.z - Math.cos(this.heading) * 180);
    } else {
      this.camTarget.set(this.lookAt[0], 0, this.lookAt[1]);
    }
    this.camTarget.y = ctx.world.groundY(this.camTarget.x, this.camTarget.z);
    // telemetry
    this.battery = Math.max(18, this.battery - dt * 0.012);
    if (this.flight >= 0) this.flight += dt;
    this.link = -62 - Math.round(Math.hypot(this.pos.x + 4900, this.pos.z - 6200) / 1200) + Math.round(Math.sin(ctx.clk * 1.7 + this.blink) * 1.5);
    // camera
    const cam = this.camera;
    cam.position.set(this.pos.x, this.pos.y - 1.5, this.pos.z);
    cam.lookAt(this.camTarget);
    cam.fov = 42 / this.zoom; cam.updateProjectionMatrix();
    const dir = new THREE.Vector3().subVectors(this.camTarget, cam.position);
    this.gimbalPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) / DEG;
    this.gimbalHdg = ((Math.atan2(dir.x, -dir.z) / DEG) + 360) % 360;
    this.range = dir.length();
  }
}

// ---------- aircraft ----------
export class Aircraft extends Unit {
  constructor(def, ctxInit) {
    const model = def.role === 'heli' ? heliModel(def) : tankerModel(def);
    super(def, 'air', model);
    this.realSize = model.len;
    this.load = def.cap; this.drops = 0;
    const a = rnd() * Math.PI * 2;
    this.pos.set(Math.sin(a) * 7000, 0, Math.cos(a) * 7000);
    this.heading = rnd() * Math.PI * 2; this.speed = def.speed * KT;
    this.state = 'init'; this.timer = 0; this.legs = [];
    this.firstCycle = true;
  }
  planCycle(ctx) {
    const d = this.def;
    if (d.role === 'attack') { this.state = 'orbit'; this.status = 'Air Attack · supervising'; this.statusColor = 'g'; return; }
    const tgt = ctx.pickDropTarget(d.role === 'heli');
    this.target = tgt;
    const { x0, z0, x1, z1 } = tgt;
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    if (d.role === 'heli') {
      const w0 = PLACES.water0;
      const dip = w0 ? { x: w0.x + (rnd() - 0.5) * 300, z: w0.z + (rnd() - 0.5) * 300 } : { x: -1600 + (rnd() - 0.5) * 2400, z: -7350 + (rnd() - 0.5) * 300 };
      this.legs = [
        { x: dip.x, z: dip.z, agl: 120, spd: d.speed, status: 'Return to fill', col: 'y' },
        { x: dip.x, z: dip.z, agl: 18, spd: 0, hold: 7, status: 'Filling', col: 'y', fill: true },
        { x: x0, z: z0, agl: 160, spd: d.speed, status: 'To drop', col: 'y' },
        { x: x1, z: z1, agl: 70, spd: 30, status: 'Dropping', col: 'r', drop: true },
      ];
      if (this.firstCycle) { this.legs = this.legs.slice(2); this.firstCycle = false; }
    } else {
      const far = 16000;
      const ang = Math.atan2(-ux, uz) + (rnd() - 0.5);
      this.legs = [
        { x: x0 - ux * 4200, z: z0 - uz * 4200, agl: 450, spd: d.speed * 1.1, status: 'Inbound', col: 'y' },
        { x: x0, z: z0, agl: 110, spd: d.speed, status: 'On final', col: 'r' },
        { x: x1, z: z1, agl: 70, spd: d.speed * 0.85, status: 'Dropping', col: 'r', drop: true },
        { x: x1 + ux * 3000, z: z1 + uz * 3000, agl: 600, spd: d.speed * 1.1, status: 'Return to reload', col: 'y' },
        { x: Math.sin(ang) * far, z: Math.cos(ang) * far, agl: 1500, spd: d.speed * 1.2, status: 'Return to reload', col: 'y' },
        { x: Math.sin(ang) * far, z: Math.cos(ang) * far, agl: 1500, spd: d.speed * 1.2, hold: 45, status: 'Reloading', col: 'y', fill: true, hidden: true },
      ];
      if (this.firstCycle) {
        // start somewhere along the inbound leg so the sky is busy right away
        const k = rnd();
        this.pos.set(x0 - ux * (4200 + 8000 * k), 0, z0 - uz * (4200 + 8000 * k));
        this.heading = Math.atan2(ux, -uz);
        this.firstCycle = false;
      }
    }
    this.leg = 0; this.state = 'fly';
  }
  update(dt, ctx) {
    const d = this.def;
    if (this.state === 'init') this.planCycle(ctx);
    let targetAgl = 400, targetSpd = d.speed * KT;
    if (this.state === 'orbit') {
      const c = ctx.fireGeom.ellipse; const r = 3200;
      this.orbitA = (this.orbitA ?? rnd() * 6) + dt * (d.speed * KT) / r;
      const tx = c.cx + Math.sin(this.orbitA) * r, tz = c.cz - Math.cos(this.orbitA) * r;
      this.steer(tx, tz, dt, 8);
      targetAgl = 1100;
    } else {
      const leg = this.legs[this.leg];
      const dx = leg.x - this.pos.x, dz = leg.z - this.pos.z, dist = Math.hypot(dx, dz);
      this.status = leg.status; this.statusColor = leg.col;
      this.group.visible = !leg.hidden;
      targetAgl = leg.agl;
      if (leg.hold) {
        targetSpd = leg.spd * KT;
        this.timer += dt;
        if (d.role === 'heli') { this.steer(leg.x, leg.z, dt, 25, true); }
        else { this.pos.x = leg.x; this.pos.z = leg.z; }
        if (leg.fill) this.load = Math.min(d.cap, this.load + d.cap * dt / leg.hold);
        if (this.timer > leg.hold) { this.timer = 0; this.leg++; }
      } else {
        targetSpd = Math.max(leg.spd, 20) * KT;
        const turn = d.role === 'heli' ? 30 : (leg.drop ? 3 : 7);
        this.steer(leg.x, leg.z, dt, turn, d.role === 'heli' && dist < 120);
        if (leg.drop) {
          this.dropping = true;
          const rate = d.cap / (d.role === 'heli' ? 5 : 9);
          const before = this.load;
          this.load = Math.max(0, this.load - rate * dt);
          ctx.emitDrop(this, before - this.load);
        } else this.dropping = false;
        const reach = d.role === 'heli' ? (leg.drop ? 25 : 60) : (leg.drop ? 140 : 260);
        if (dist < reach || (leg.drop && this.load <= 0 && d.role !== 'heli')) {
          if (leg.drop) { this.dropping = false; this.drops++; ctx.completeDrop(this); this.load = 0; }
          this.leg++;
        }
      }
      if (this.leg >= this.legs.length) { this.planCycle(ctx); }
    }
    // speed + altitude
    this.speed = lerp(this.speed, targetSpd, Math.min(1, dt * 0.6));
    const look = Math.min(1200, this.speed * 8);
    const gAhead = ctx.world.groundY(this.pos.x + Math.sin(this.heading) * look, this.pos.z - Math.cos(this.heading) * look);
    const gHere = ctx.world.groundY(this.pos.x, this.pos.z);
    const prevY = this.pos.y || gHere + targetAgl;
    this.aglCur = this.aglCur === undefined ? targetAgl : lerp(this.aglCur, targetAgl, Math.min(1, dt * (d.role === 'heli' ? 0.8 : 0.35)));
    // smoothed terrain reference with look-ahead: no frame-to-frame bumps from the raw ground
    const gRef = Math.max(gHere, gAhead);
    this.gSm = this.gSm === undefined || Math.abs(this.gSm - gRef) > 600 ? gRef : lerp(this.gSm, gRef, Math.min(1, dt * (d.role === 'heli' ? 0.9 : 0.5)));
    this.pos.y = Math.max(this.gSm + this.aglCur, gHere + 15);
    this.agl = this.pos.y - gHere;
    const climb = (this.pos.y - prevY) / Math.max(dt, 1e-3);
    this.climbSm = this.climbSm === undefined ? climb : lerp(this.climbSm, climb, Math.min(1, dt * 1.5));
    const pitchT = d.role === 'heli' ? -clamp(this.speed / 140, 0, 0.18) : clamp(this.climbSm / Math.max(this.speed, 1), -0.2, 0.2);
    this.pitch = lerp(this.pitch, pitchT, Math.min(1, dt * 2));
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z -= Math.cos(this.heading) * this.speed * dt;
  }
  steer(tx, tz, dt, maxTurnDeg, hover = false) {
    const h = Math.atan2(tx - this.pos.x, -(tz - this.pos.z));
    let dh = h - this.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    const mt = maxTurnDeg * DEG * dt;
    const turn = clamp(dh, -mt, mt);
    this.heading += turn;
    this.bank = lerp(this.bank, clamp(-turn / Math.max(dt, 1e-3) * (this.def.role === 'heli' ? 0.4 : 1.8), -0.6, 0.6), Math.min(1, dt * 2));
    if (hover) { const dist = Math.hypot(tx - this.pos.x, tz - this.pos.z); this.speed = Math.min(this.speed, dist * 0.5); }
  }
}

// ---------- ground ----------
export class GroundUnit extends Unit {
  constructor(def) {
    const model = def.model === 'dozer' ? dozerModel() : def.model === 'crew' ? crewModel(6) : truckModel(def);
    super(def, def.model === 'crew' || def.model === 'dozer' ? 'crew' : 'ground', model);
    this.realSize = model.len;
    this.dir = 1; this.s = def.s0 ?? 0; this.statusColor = def.status === 'Patrol' ? 'g' : 'y';
    this.status = def.status + (def.where ? ` · ${def.where}` : '');
    this.speedTarget = def.spd ?? (def.id === 'E-45' ? 8 : def.id === 'WT-12' ? 22 : def.model === 'crew' ? 0 : def.model === 'dozer' ? 2 : 0);
  }
  update(dt, ctx) {
    const d = this.def;
    if (d.road !== undefined) {
      const L = ctx.roadLen(d.road);
      const v = this.speedTarget * MPH;
      // engines at structures drift slowly within their range
      if (!this.speedTarget) { this.moveT = (this.moveT ?? rnd() * 60) + dt; this.speedTarget = 0; }
      this.s += this.dir * v * dt;
      // patrol window kept inside the road (no wrap-around at the road ends)
      const half = Math.min(d.range / 2, L / 2 - 5);
      const mid = clamp(d.s0, half + 5, L - half - 5);
      const lo = mid - half, hi = mid + half;
      if (!this._init) { this.s = clamp(this.s, lo, hi); this._init = true; }
      if (this.s > hi) { this.s = hi; this.dir = -1; } if (this.s < lo) { this.s = lo; this.dir = 1; }
      const r = roadAt(d.road, this.s);
      const prof = ctx.world.terrain.roadProfiles[d.road];
      const pi = clamp(r.idx, 0, prof.length - 1.001); const pe = lerp(prof[Math.floor(pi)], prof[Math.floor(pi) + 1], pi % 1);
      const elev = Math.max(pe, ctx.world.terrain.elev(r.x, r.z)) + 1.2;
      this.pos.set(r.x, ctx.world.yFor(elev), r.z);
      const off = 2.2 * this.dir; // keep to the right lane
      this.pos.x += Math.cos(r.heading) * off; this.pos.z += Math.sin(r.heading) * off;
      this.heading = this.dir > 0 ? r.heading : r.heading + Math.PI;
      this.speed = v;
      this.pitch = 0; this.bank = 0;
    } else if (this.line) {
      // crews / dozer walk their built line doing mop-up
      const pts = this.line.pts; const L = this.line.length;
      const v = d.model === 'dozer' ? 1.2 : 0.7;
      this.s += this.dir * v * dt * 6;
      const built = L * this.line.progress(ctx.time);
      const hi = Math.max(60, built), lo = Math.max(0, hi - 900);
      if (this.s > hi) { this.s = hi; this.dir = -1; } if (this.s < lo) { this.s = lo; this.dir = 1; }
      const [x, z] = pathAt(pts, this.s, false); const [x2, z2] = pathAt(pts, this.s + this.dir * 5, false);
      this.pos.set(x, ctx.world.groundY(x, z) + 0.2, z);
      this.heading = Math.atan2(x2 - x, -(z2 - z));
      this.speed = v;
      if (this.model.people) {
        this.model.people.forEach((p, i) => {
          const [px, pz] = pathAt(pts, this.s - this.dir * (i * 4 + 1), false);
          p.position.set((px - x) / this.visScale, (ctx.world.groundY(px, pz) - this.pos.y) / this.visScale, (pz - z) / this.visScale);
          // rotate into group frame
          const c = Math.cos(this.heading), s = Math.sin(this.heading);
          const lx = p.position.x * c + p.position.z * s, lz = -p.position.x * s + p.position.z * c;
          p.position.x = lx; p.position.z = lz;
          p.position.y = Math.sin(ctx.clk * 6 + i) * 0.05;
        });
      }
    }
    if (d.model === 'crew' || d.model === 'dozer') {
      const p = this.line ? this.line.progress(ctx.time) : 1;
      this.status = p < 1 ? (d.model === 'dozer' ? 'Constructing line' : 'Cutting line') : 'Holding & mop-up';
      this.statusColor = 'y';
    }
  }
}

export function makeRetardantSystem() {
  const MAX = 6000;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), life = new Float32Array(MAX), size = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
  const vel = new Float32Array(MAX * 3);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 800 } },
    vertexShader: `attribute vec3 color; attribute float life; attribute float psize; varying vec3 vC; varying float vL;
      uniform float uScale;
      void main(){ vC = color; vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = life > 0.0 ? psize * uScale / -mv.z : 0.0; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vL; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = (1.0 - r * 2.0) * clamp(vL, 0.0, 1.0) * 0.55; gl_FragColor = vec4(vC, a); }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  let head = 0;
  return {
    object: pts,
    emit(p, v, color, n, spread = 6) {
      for (let i = 0; i < n; i++) {
        const k = head; head = (head + 1) % MAX;
        pos[k * 3] = p.x + (Math.random() - 0.5) * spread; pos[k * 3 + 1] = p.y - 2; pos[k * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
        vel[k * 3] = v.x * 0.55 + (Math.random() - 0.5) * 6; vel[k * 3 + 1] = -4 - Math.random() * 6; vel[k * 3 + 2] = v.z * 0.55 + (Math.random() - 0.5) * 6;
        col[k * 3] = color[0]; col[k * 3 + 1] = color[1]; col[k * 3 + 2] = color[2];
        life[k] = 1.0 + Math.random() * 0.4; size[k] = 18 + Math.random() * 22;
      }
    },
    update(dt) {
      for (let k = 0; k < MAX; k++) {
        if (life[k] <= 0) continue;
        life[k] -= dt * 0.28;
        vel[k * 3] *= 1 - dt * 0.6; vel[k * 3 + 2] *= 1 - dt * 0.6; vel[k * 3 + 1] -= 9.8 * dt * 0.6;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        size[k] += dt * 14;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.life.needsUpdate = true; geo.attributes.psize.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}
export { pathAt, pathLen, KT, MPH, FT };
