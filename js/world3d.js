// Scene construction: terrain (with fire / map / thermal shading), trees, water, roads, structures.
import * as THREE from 'three';
import { makeNoise, mulberry32, clamp, lerp, smoothstep } from './util.js';
import * as CORE from './core.js';
import { loadBitmap } from './real.js';
import { SIZE, HALF, GN, CELL, BASE, WATER, FN, FCELL, UNBURNED, ROADS, PLACES, rawElev, distToPolyline } from './core.js';

export const U = {
  uTime: { value: 40 },
  uClock: { value: 0 },
  uMap: { value: 0 },
  uThermal: { value: 0 },
  uImagery: { value: 1 },
  uShadeAmt: { value: 1 },
  uScar: { value: 0.9 },
  uSpread: { value: 1 },
  uIgn: { value: 0.8 },
  uIgnPos: { value: new THREE.Vector2(PLACES.ignition.x, PLACES.ignition.z) },
  uFogColor: { value: new THREE.Color('#d3d3cb') },
  uFogDensity: { value: 0.000026 },
  uSunDir: { value: new THREE.Vector3(-0.62, 0.62, -0.28).normalize() },
  uOverlayTex: { value: null },
  uArrTex: { value: null },
  uColorTex: { value: null },
  uInfoTex: { value: null },
  uHalf: { value: HALF },
  uTreesBurn: { value: 1 },
  uFireOn: { value: 1 },
  uReal: { value: 0 },
  uIgnPos2: { value: new THREE.Vector2(1e7, 1e7) },
  uGridStep: { value: new THREE.Vector2(1533.333, 1849.167) },
  uGridOff: { value: new THREE.Vector2(0, 0) },
};

const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm3(vec2 p){ return vnoise(p)*.55 + vnoise(p*2.07+3.1)*.3 + vnoise(p*4.3-1.7)*.15; }
`;

const terrainVS = /* glsl */`
attribute float elev;
#ifdef OUTER
attribute vec3 color;
varying vec3 vCol;
#endif
varying vec3 vW;      // world-space xz + raw elevation
varying vec3 vView;
varying vec3 vN;
void main(){
  #ifdef OUTER
  vCol = color;
  #endif
  vW = vec3(position.x, elev, position.z);
  vN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vView = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const terrainFS = /* glsl */`
uniform float uTime, uClock, uMap, uThermal, uImagery, uShadeAmt, uScar, uSpread, uIgn, uFogDensity, uHalf, uFireOn;
uniform vec2 uIgnPos, uIgnPos2, uGridStep, uGridOff;
uniform float uReal;
uniform vec3 uFogColor;
uniform sampler2D uOverlayTex, uArrTex, uColorTex, uInfoTex;
varying vec3 vW; varying vec3 vView; varying vec3 vN;
#ifdef OUTER
varying vec3 vCol;
#endif
${GLSL_NOISE}
void main(){
  vec2 xz = vW.xz;
  vec2 uv = (xz + uHalf) / (2.0 * uHalf);
  float dist = length(vView);
#ifdef OUTER
  vec3 col = vCol;
  float shade = 0.7;
  vec4 info = vec4(0.3, 0.0, 0.0, 0.0);
  float water = 0.0;
#else
  vec4 ct = texture2D(uColorTex, uv);
  vec4 info = texture2D(uInfoTex, uv);
  float shade = mix(ct.a, info.a, uReal);
  float water = info.g;
  vec3 relief = vec3(0.86, 0.82, 0.75) * (0.42 + 0.7 * shade);
  vec3 col = mix(relief, ct.rgb, uImagery);
  // close range micro detail
  float near = 1.0 - smoothstep(600.0, 3000.0, dist);
  col *= mix(1.0, 0.86 + 0.28 * fbm3(xz / 7.0), near * (1.0 - water));
#endif
  col = mix(vec3(0.80, 0.77, 0.72) * (0.5 + 0.55 * shade), col, uShadeAmt);

  float heat = 0.11 + 0.06 * shade;
  float burnedAmt = 0.0;
  float frontAmt = 0.0;

#ifndef OUTER
  // ---------------- fire -----------------
  vec4 at = texture2D(uArrTex, uv);
  float young = clamp((uTime - at.r) / 4.0, 0.25, 1.0);
  float arr = at.r + ((fbm3(xz / 160.0) - 0.5) * 1.4 + (vnoise(xz / 28.0) - 0.5) * 0.4) * young;
  float dt = uTime - arr;
  float burned = step(0.0, dt) * step(at.r, 900.0) * uFireOn;
  burnedAmt = burned;
  float sev = mix(fbm3(xz / 260.0 + 7.0), smoothstep(0.1, 0.75, info.b) * 0.85 + fbm3(xz / 90.0) * 0.15, uReal);
  vec3 scar = mix(vec3(0.27, 0.25, 0.24), vec3(0.45, 0.27, 0.21), smoothstep(0.35, 0.75, sev));
  scar = mix(scar, vec3(0.20, 0.19, 0.19), smoothstep(0.6, 0.9, fbm3(xz / 55.0)));
  scar = mix(scar, mix(vec3(0.50, 0.40, 0.31), vec3(0.15, 0.14, 0.14), smoothstep(0.15, 0.9, sev)), uReal);
  scar *= 0.55 + 0.75 * shade;
  // recently burned areas keep a reddish cast
  scar = mix(scar, scar * vec3(1.35, 0.8, 0.65), (1.0 - smoothstep(0.0, 10.0, dt)) * 0.7);
  col = mix(col, scar, burned * uScar * 0.92 * (1.0 - water));

  // active front glow + embers
  float front = burned * (1.0 - smoothstep(0.0, 1.1, dt));
  float fl = 0.65 + 0.35 * sin(uClock * 9.0 + hash12(floor(xz / 18.0)) * 40.0);
  float edge = burned * (1.0 - smoothstep(0.0, 0.35, dt));
  vec3 glow = mix(vec3(1.0, 0.28, 0.05), vec3(1.0, 0.78, 0.32), edge);
  col = mix(col, glow, clamp(front * 0.85 * fl * uSpread, 0.0, 1.0));
  float emb = burned * (1.0 - smoothstep(0.5, 7.0, dt)) * step(0.82, vnoise(xz / 9.0 + floor(uClock * 2.0) * 0.0));
  col = mix(col, vec3(0.95, 0.28, 0.08), emb * 0.55 * uSpread * fl);
  frontAmt = front;

  // isochrones (modeled spread) every 6 h
  float iso = abs(fract((at.r + 0.0) / 6.0 + 0.5) - 0.5) * 6.0;
  float isoW = fwidth(at.r) * 0.9 + 0.02;
  float isoLine = (1.0 - smoothstep(isoW * 0.5, isoW, iso)) * step(at.r, uTime) * step(at.r, 900.0);
  float dash = step(0.5, fract((xz.x + xz.y) / 90.0));
  col = mix(col, vec3(0.98, 0.55, 0.25), isoLine * dash * 0.6 * uSpread * (1.0 - uMap));

  // ignition probability
  float dI = min(length(xz - uIgnPos), length(xz - uIgnPos2));
  float ip = exp(-dI * dI / (380.0 * 380.0));
  float rings = smoothstep(0.75, 1.0, sin(dI / 22.0 - uClock * 3.0)) * (1.0 - smoothstep(80.0, 420.0, dI));
  col = mix(col, vec3(0.93, 0.18, 0.08), clamp(ip * 0.55 + rings * 0.35, 0.0, 0.85) * uIgn);

  heat += burned * (0.06 + 0.16 * exp(-max(dt, 0.0) / 10.0)) + front * 0.9 * fl + emb * 0.3;
  heat = mix(heat, 0.03, water);
#endif

  // ---------------- map (2D) ----------------
  if (uMap > 0.001) {
    vec3 paper = vec3(0.955, 0.948, 0.925);
    vec3 green = vec3(0.80, 0.885, 0.735);
    vec3 m = mix(paper, green, smoothstep(0.25, 0.75, info.r));
    m *= 0.9 + 0.12 * shade;
    m = mix(m, vec3(0.66, 0.80, 0.90), water);
    float e = vW.y;
    float c20 = abs(fract(e / 20.0 + 0.5) - 0.5) * 20.0;
    float c100 = abs(fract(e / 100.0 + 0.5) - 0.5) * 100.0;
    float fw = fwidth(e);
    float l20 = 1.0 - smoothstep(0.0, fw * 1.1, c20);
    float l100 = 1.0 - smoothstep(0.0, fw * 1.6, c100);
    m = mix(m, vec3(0.62, 0.55, 0.45), (l20 * 0.22 + l100 * 0.38) * (1.0 - water));
    vec2 gq = abs(fract((xz - uGridOff) / uGridStep + 0.5) - 0.5) * uGridStep;
    vec2 gw = fwidth(xz) * 1.2;
    float grid = max(1.0 - smoothstep(0.0, gw.x, gq.x), 1.0 - smoothstep(0.0, gw.y, gq.y));
    m = mix(m, vec3(0.55, 0.53, 0.5), grid * 0.25);
#ifndef OUTER
    float inten = at.g;
    vec3 fireC = mix(vec3(0.96, 0.62, 0.55), vec3(0.88, 0.30, 0.25), smoothstep(0.25, 0.9, inten));
    m = mix(m, fireC, burnedAmt * 0.72 * max(uScar, uSpread * 0.6));
    float fr = burnedAmt * (1.0 - smoothstep(0.0, 1.0, dt));
    m = mix(m, vec3(0.95, 0.35, 0.15), fr * 0.6 * uSpread);
    m = mix(m, vec3(0.86, 0.2, 0.1), (ip * 0.4) * uIgn);
#endif
    col = mix(col, m, uMap);
  }

#ifndef OUTER
  vec4 ov = texture2D(uOverlayTex, uv);
  col = mix(col, ov.rgb, ov.a);
#endif

  // fog / aerial perspective
  float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
  col = mix(col, uFogColor, fogF * (1.0 - uMap) * 0.92);

  if (uThermal > 0.5) {
    float h = heat * (1.0 - fogF * 0.6);
    gl_FragColor = vec4(vec3(h), 1.0);
    return;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const treeVS = /* glsl */`
attribute float aArr;
varying vec3 vCol; varying vec3 vNrm; varying float vArr; varying vec3 vView; varying vec2 vXZ; varying float vY;
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vCol = instanceColor;
  vNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vArr = aArr;
  vY = position.y;
  vXZ = wp.xz;
  vView = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const treeFS = /* glsl */`
uniform float uTime, uClock, uThermal, uFogDensity, uFireOn, uScar, uSpread;
uniform vec3 uFogColor, uSunDir;
varying vec3 vCol; varying vec3 vNrm; varying float vArr; varying vec3 vView; varying vec2 vXZ; varying float vY;
${GLSL_NOISE}
void main(){
  vec3 n = normalize(vNrm);
  float d = max(dot(n, uSunDir), 0.0);
  float ao = 0.55 + 0.45 * clamp(vY + 0.2, 0.0, 1.0);
  vec3 col = vCol * (0.42 + 0.85 * d) * ao;
  float dt = uTime - vArr - (hash12(vXZ) - 0.3) * 1.2;
  float burned = step(0.0, dt) * step(vArr, 900.0) * uFireOn;
  vec3 charred = vec3(0.13, 0.12, 0.115) * (0.6 + 0.6 * d);
  col = mix(col, charred, burned * min(1.0, uScar + 0.25));
  float fl = 0.6 + 0.4 * sin(uClock * 12.0 + hash12(vXZ) * 30.0);
  float burning = burned * (1.0 - smoothstep(0.0, 0.9, dt));
  col = mix(col, mix(vec3(1.0, 0.3, 0.04), vec3(1.0, 0.75, 0.3), vY) * fl, burning * 0.85 * uSpread);
  float dist = length(vView);
  float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
  col = mix(col, uFogColor, fogF * 0.92);
  if (uThermal > 0.5) { gl_FragColor = vec4(vec3(0.07 + burned * 0.18 + burning * 0.8 * fl), 1.0); return; }
  gl_FragColor = vec4(col, 1.0);
}`;

const waterFS = /* glsl */`
uniform float uMap, uThermal, uFogDensity, uClock;
uniform vec3 uFogColor;
varying vec3 vView; varying vec2 vXZ;
${GLSL_NOISE}
void main(){
  vec3 v = normalize(vView);
  float fres = pow(1.0 - max(v.y, 0.0), 3.0);
  float rip = vnoise(vXZ / 30.0 + uClock * 0.15) * 0.5 + vnoise(vXZ / 11.0 - uClock * 0.2) * 0.5;
  vec3 col = mix(vec3(0.27, 0.42, 0.50), vec3(0.62, 0.72, 0.76), fres * 0.8 + rip * 0.08);
  float dist = length(vView);
  float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
  col = mix(col, uFogColor, fogF * 0.9 * (1.0 - uMap));
  col = mix(col, vec3(0.66, 0.80, 0.90), uMap);
  if (uThermal > 0.5) { gl_FragColor = vec4(vec3(0.02), 1.0); return; }
  gl_FragColor = vec4(col, 1.0);
}`;
const waterVS = /* glsl */`
varying vec3 vView; varying vec2 vXZ;
void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vView = cameraPosition - wp.xyz; vXZ = wp.xz; gl_Position = projectionMatrix * viewMatrix * wp; }`;

const roadVS = /* glsl */`
attribute vec2 ruv;
varying vec2 vUv; varying vec3 vView;
void main(){ vUv = ruv; vec4 wp = modelMatrix * vec4(position, 1.0); vView = cameraPosition - wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const roadFS = /* glsl */`
uniform float uMap, uThermal, uFogDensity, uImagery;
uniform vec3 uFogColor;
varying vec2 vUv; varying vec3 vView;
void main(){
  float across = abs(vUv.x - 0.5) * 2.0;
  vec3 col = vec3(0.38, 0.38, 0.39);
  float edgeLine = smoothstep(0.80, 0.84, across) * (1.0 - smoothstep(0.9, 0.94, across));
  col = mix(col, vec3(0.86, 0.85, 0.8), edgeLine * 0.8);
  float centre = (1.0 - smoothstep(0.03, 0.06, across)) * step(0.45, fract(vUv.y / 14.0));
  col = mix(col, vec3(0.93, 0.92, 0.88), centre);
  col = mix(col, vec3(0.62, 0.59, 0.55), smoothstep(0.94, 1.0, across));
  col = mix(vec3(0.72, 0.69, 0.64), col, uImagery);
  vec3 m = mix(vec3(1.0), vec3(0.62, 0.6, 0.58), smoothstep(0.55, 0.75, across));
  m = mix(m, vec3(0.97, 0.75, 0.45), (1.0 - smoothstep(0.0, 0.5, across)) * 0.0);
  col = mix(col, m, uMap);
  float dist = length(vView);
  float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
  col = mix(col, uFogColor, fogF * 0.92 * (1.0 - uMap));
  if (uThermal > 0.5) { gl_FragColor = vec4(vec3(0.2), 1.0); return; }
  gl_FragColor = vec4(col, 1.0);
}`;

const basicVS = /* glsl */`
varying vec3 vNrm; varying vec3 vView;
#ifdef USE_INSTANCING_COLOR
varying vec3 vIC;
#endif
void main(){
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
#ifdef USE_INSTANCING_COLOR
  vIC = instanceColor;
#endif
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vNrm = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vView = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const basicFS = /* glsl */`
uniform vec3 uColor, uFogColor, uSunDir, uEmissive;
uniform float uFogDensity, uThermal, uHeat, uOpacity;
varying vec3 vNrm; varying vec3 vView;
#ifdef USE_INSTANCING_COLOR
varying vec3 vIC;
#endif
void main(){
  vec3 base = uColor;
#ifdef USE_INSTANCING_COLOR
  base *= vIC;
#endif
  float d = max(dot(normalize(vNrm), uSunDir), 0.0);
  float sky = 0.5 + 0.5 * normalize(vNrm).y;
  vec3 col = base * (0.30 + 0.25 * sky + 0.75 * d) + uEmissive;
  float dist = length(vView);
  float fogF = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
  col = mix(col, uFogColor, fogF * 0.9);
  if (uThermal > 0.5) { gl_FragColor = vec4(vec3(uHeat), 1.0); return; }
  gl_FragColor = vec4(col, uOpacity);
}`;

// Shared lit material for vehicles/drones/structures
export function litMaterial(color, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uEmissive: { value: new THREE.Color(opts.emissive || 0x000000) },
      uHeat: { value: opts.heat ?? 0.35 },
      uOpacity: { value: opts.opacity ?? 1 },
      uFogColor: U.uFogColor, uSunDir: U.uSunDir, uFogDensity: U.uFogDensity, uThermal: U.uThermal,
    },
    vertexShader: basicVS, fragmentShader: basicFS,
    transparent: (opts.opacity ?? 1) < 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

const _mc = new MessageChannel(); const _q = [];
_mc.port1.onmessage = () => { const r = _q.shift(); r && r(); };
const sleep = () => new Promise((r) => { _q.push(r); _mc.port2.postMessage(0); });

export class World {
  constructor(terrain, fire, renderer) {
    this.terrain = terrain;
    this.fire = fire;
    this.renderer = renderer;
    this.group = new THREE.Group();          // terrain-attached content, scaled vertically
    this.vex = 1.5;
    this.flatten = 1;
    this.group.scale.y = this.vex;
    this.real = CORE.MODE === 'real';
    U.uHalf.value = HALF;
    U.uIgnPos.value.set(PLACES.ignition.x, PLACES.ignition.z);
    if (PLACES.ignition2) U.uIgnPos2.value.set(PLACES.ignition2.x, PLACES.ignition2.z);
    U.uReal.value = this.real ? 1 : 0;
  }
  get scaleY() { return this.group.scale.y; }
  groundY(x, z) { return (this.terrain.elev(x, z) - BASE) * this.group.scale.y; }
  yFor(elev) { return (elev - BASE) * this.group.scale.y; }

  async build(progress) {
    const t = this.terrain;
    progress('Computing terrain normals', 0.12);
    this._gridNormals();
    progress('Baking imagery & hillshade', 0.2);
    await this._bakeTextures(progress);
    progress('Building terrain mesh', 0.55);
    this._buildTerrainMesh();
    this._buildOuter();
    this._buildWater();
    progress('Planting trees', 0.65); await sleep();
    this._buildRoads();
    this._buildStructures();
    this.setFire(this.fire);
  }

  _gridNormals() {
    const t = this.terrain, h = t.h;
    this.gnx = new Float32Array(GN * GN); this.gny = new Float32Array(GN * GN); this.gnz = new Float32Array(GN * GN);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const l = h[j * GN + Math.max(i - 1, 0)], r = h[j * GN + Math.min(i + 1, GN - 1)];
      const u = h[Math.max(j - 1, 0) * GN + i], d = h[Math.min(j + 1, GN - 1) * GN + i];
      const dx = (r - l) / (2 * CELL) * this.vex, dz = (d - u) / (2 * CELL) * this.vex;
      const len = Math.hypot(dx, 1, dz);
      this.gnx[j * GN + i] = -dx / len; this.gny[j * GN + i] = 1 / len; this.gnz[j * GN + i] = -dz / len;
    }
    if (this.real) return; // hillshade + shadows are baked offline into info.webp / tex_*.webp
    // shadow mask (sun from WNW) by marching the height grid
    const sun = U.uSunDir.value;
    const sx = sun.x, sz = sun.z, sy = sun.y / Math.hypot(sun.x, sun.z);
    this.shadow = new Float32Array(GN * GN);
    const step = CELL * 0.75;
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL;
      const h0 = h[j * GN + i] * this.vex;
      let lit = 1;
      const hn = Math.hypot(sx, sz);
      for (let k = 1; k < 60; k++) {
        const d = k * step;
        const x = x0 + sx / hn * d, z = z0 + sz / hn * d;
        if (x < -HALF || x > HALF || z < -HALF || z > HALF) break;
        const hh = t.elev(x, z) * this.vex;
        const need = h0 + d * sy;
        if (hh > need) { lit = Math.min(lit, clamp(1 - (hh - need) / 40, 0, 1)); if (lit <= 0) break; }
      }
      this.shadow[j * GN + i] = lit;
    }
    // vegetation density grid
    this.veg = new Float32Array(GN * GN);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) this.veg[j * GN + i] = t.treeDensity(-HALF + i * CELL, -HALF + j * CELL);
  }
  _bil(arr, x, z) {
    const fx = clamp((x + HALF) / CELL, 0, GN - 1.001), fz = clamp((z + HALF) / CELL, 0, GN - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return lerp(lerp(arr[j * GN + i], arr[j * GN + i + 1], tx), lerp(arr[(j + 1) * GN + i], arr[(j + 1) * GN + i + 1], tx), tz);
  }

  async _bakeTextures(progress) {
    if (this.real) return this._bakeReal(progress);
    const R = 2048;
    const data = new Uint8Array(R * R * 4);
    const IR = 1024;
    const info = new Uint8Array(IR * IR * 4);
    const n1 = makeNoise(91), n2 = makeNoise(17), n3 = makeNoise(5);
    const sun = U.uSunDir.value;
    const t = this.terrain;
    const grass = [0.87, 0.73, 0.51], dry = [0.93, 0.82, 0.63], shrub = [0.68, 0.61, 0.41], forest = [0.38, 0.43, 0.26];
    const rock = [0.74, 0.69, 0.62], canopy = [0.19, 0.29, 0.14], waterC = [0.32, 0.46, 0.54], sand = [0.78, 0.72, 0.60];
    for (let py = 0; py < R; py++) {
      const z = -HALF + (py + 0.5) / R * SIZE;
      for (let px = 0; px < R; px++) {
        const x = -HALF + (px + 0.5) / R * SIZE;
        const e = t.elev(x, z);
        const nx = this._bil(this.gnx, x, z), ny = this._bil(this.gny, x, z), nz = this._bil(this.gnz, x, z);
        const sh = this._bil(this.shadow, x, z);
        const lam = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
        const shade = clamp(0.18 + 0.95 * lam * (0.35 + 0.65 * sh), 0, 1);
        const v = this._bil(this.veg, x, z);
        const slope = Math.acos(clamp(ny, -1, 1)) * 57.3;
        const m1 = n1(x / 220, z / 220) * 0.5 + 0.5;
        const m2 = n2(x / 45, z / 45) * 0.5 + 0.5;
        let c = [0, 0, 0];
        // ground mixing
        const gmix = smoothstep(0.25, 0.6, m1);
        for (let k = 0; k < 3; k++) c[k] = lerp(grass[k], dry[k], gmix);
        const sv = smoothstep(0.15, 0.55, v);
        for (let k = 0; k < 3; k++) c[k] = lerp(c[k], shrub[k], sv * 0.4);
        const fv = smoothstep(0.72, 0.98, v);
        for (let k = 0; k < 3; k++) c[k] = lerp(c[k], forest[k], fv * 0.6);
        const rk = smoothstep(30, 42, slope / 1.0) * 0.6;
        for (let k = 0; k < 3; k++) c[k] = lerp(c[k], rock[k], rk);
        // canopy speckles
        const sp = n3(x / 11, z / 11) * 0.5 + 0.5;
        const canopyAmt = smoothstep(1 - v * 0.5, 1.06 - v * 0.5, sp) * smoothstep(0.25, 0.6, v);
        for (let k = 0; k < 3; k++) c[k] = lerp(c[k], canopy[k], canopyAmt * 0.9);
        // mottling
        const mot = 0.9 + 0.2 * m2;
        let w = 0;
        if (e < WATER + 1.5) {
          w = smoothstep(WATER + 1.5, WATER - 3, e);
          const depth = smoothstep(WATER, WATER - 40, e);
          for (let k = 0; k < 3; k++) c[k] = lerp(lerp(sand[k], waterC[k], w), waterC[k] * (0.9 - depth * 0.25), w);
        }
        const o = (py * R + px) * 4;
        const lit = w > 0.5 ? 0.9 : (0.40 + 0.78 * shade) * mot;
        data[o] = clamp(c[0] * lit * 255, 0, 255);
        data[o + 1] = clamp(c[1] * lit * 255, 0, 255);
        data[o + 2] = clamp(c[2] * lit * 255, 0, 255);
        data[o + 3] = shade * 255;
        if ((px & 1) === 0 && (py & 1) === 0) {
          const io = ((py >> 1) * IR + (px >> 1)) * 4;
          info[io] = v * 255; info[io + 1] = w * 255; info[io + 2] = 0; info[io + 3] = 255;
        }
      }
      if ((py & 255) === 0) { progress('Baking imagery & hillshade', 0.2 + 0.33 * py / R); await sleep(); }
    }
    const tex = new THREE.DataTexture(data, R, R, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.flipY = false; tex.needsUpdate = true;
    U.uColorTex.value = tex;
    const itex = new THREE.DataTexture(info, IR, IR, THREE.RGBAFormat);
    itex.magFilter = THREE.LinearFilter; itex.minFilter = THREE.LinearFilter; itex.needsUpdate = true;
    U.uInfoTex.value = itex;
    // thumbnail canvas for UI (aerial)
    this.thumbData = { data, R };
  }

  async _bakeReal(progress) {
    const REAL = CORE.REAL;
    const mk = (img, mips) => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.magFilter = THREE.LinearFilter;
      tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; tex.generateMipmaps = mips;
      if (mips) tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      tex.needsUpdate = true; return tex;
    };
    progress('Loading Sentinel-2 imagery', 0.2);
    this.preTex = mk(await REAL.preImg, true);
    U.uColorTex.value = this.preTex;
    this._postUrl = REAL.imagery.post;
    // info texture: r = forest density (NDVI), g = water (OSM), b = burn severity (dNBR), a = hillshade
    const itex = mk(REAL.infoImg, false);
    itex.premultiplyAlpha = false;
    U.uInfoTex.value = itex;
  }
  async setImagery(which) {
    if (!this.real) return;
    if (which === 'post' && !this.postTex) {
      const tex = new THREE.Texture(await loadBitmap(this._postUrl));
      tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = this.preTex.anisotropy; tex.needsUpdate = true;
      this.postTex = tex;
    }
    U.uColorTex.value = which === 'post' ? this.postTex : this.preTex;
    this.imagery = which;
  }

  _terrainMaterial(outer = false) {
    return new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: terrainVS,
      fragmentShader: terrainFS,
      defines: outer ? { OUTER: 1 } : {},
      extensions: { derivatives: true },
    });
  }

  _buildTerrainMesh() {
    const t = this.terrain;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(GN * GN * 3), el = new Float32Array(GN * GN), nrm = new Float32Array(GN * GN * 3);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const k = j * GN + i;
      pos[k * 3] = -HALF + i * CELL; pos[k * 3 + 1] = t.h[k] - BASE; pos[k * 3 + 2] = -HALF + j * CELL;
      el[k] = t.h[k];
      nrm[k * 3] = this.gnx[k]; nrm[k * 3 + 1] = this.gny[k]; nrm[k * 3 + 2] = this.gnz[k];
    }
    const idx = new Uint32Array((GN - 1) * (GN - 1) * 6);
    let o = 0;
    for (let j = 0; j < GN - 1; j++) for (let i = 0; i < GN - 1; i++) {
      const a = j * GN + i, b = a + 1, c = a + GN, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('elev', new THREE.BufferAttribute(el, 1));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    this.terrainMesh = new THREE.Mesh(geo, this._terrainMaterial());
    this.terrainMesh.name = 'terrain';
    this.group.add(this.terrainMesh);
  }

  _buildOuter() {
    const OS = this.real ? 150000 : 90000, ON = this.real ? 241 : 181, step = OS / (ON - 1);
    const pos = new Float32Array(ON * ON * 3), el = new Float32Array(ON * ON), col = new Float32Array(ON * ON * 3);
    const n1 = makeNoise(91);
    for (let j = 0; j < ON; j++) for (let i = 0; i < ON; i++) {
      const k = j * ON + i;
      const x = -OS / 2 + i * step, z = -OS / 2 + j * step;
      const inside = Math.abs(x) < HALF - 1 && Math.abs(z) < HALF - 1;
      const edge = Math.abs(x) <= HALF + 1 && Math.abs(z) <= HALF + 1;
      let e;
      if (this.real) {
        const cx = clamp(x, -HALF, HALF), cz = clamp(z, -HALF, HALF);
        const out = Math.hypot(x - cx, z - cz);
        e = this.terrain.elev(cx, cz) * (1 - smoothstep(0, 30000, out)) + 350 * smoothstep(0, 30000, out) + 120 * n1(x / 4000, z / 4000) * smoothstep(0, 4000, out);
      } else {
        e = edge ? this.terrain.elev(x, z) : rawElev(x, z);
        const far = smoothstep(14000, 42000, Math.max(Math.abs(x), Math.abs(z)));
        e = lerp(e, e * 0.85 + 250, far);
      }
      pos[k * 3] = x; pos[k * 3 + 1] = (inside ? e - 120 : e) - BASE; pos[k * 3 + 2] = z;
      el[k] = e;
      const v = this.terrain.treeDensity(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF)) * 0.4 + (n1(x / 3000, z / 3000) * 0.5 + 0.5) * 0.6;
      const c = this.real ? [lerp(0.55, 0.30, v), lerp(0.52, 0.36, v), lerp(0.40, 0.24, v)] : [lerp(0.86, 0.45, v * 0.8), lerp(0.73, 0.47, v * 0.8), lerp(0.52, 0.31, v * 0.8)];
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
    const idx = new Uint32Array((ON - 1) * (ON - 1) * 6); let o = 0;
    for (let j = 0; j < ON - 1; j++) for (let i = 0; i < ON - 1; i++) {
      const a = j * ON + i, b = a + 1, c = a + ON, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('elev', new THREE.BufferAttribute(el, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.scale(1, this.vex, 1); geo.computeVertexNormals(); geo.scale(1, 1 / this.vex, 1);
    // bake simple shading into colours
    const nrm = geo.getAttribute('normal'); const sun = U.uSunDir.value;
    for (let k = 0; k < ON * ON; k++) {
      const l = Math.max(0, nrm.getX(k) * sun.x + nrm.getY(k) * sun.y + nrm.getZ(k) * sun.z);
      const s = 0.4 + 0.75 * l;
      col[k * 3] *= s; col[k * 3 + 1] *= s; col[k * 3 + 2] *= s;
    }
    this.outerMesh = new THREE.Mesh(geo, this._terrainMaterial(true));
    this.group.add(this.outerMesh);
  }

  _buildWater() {
    if (this.real) return;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: waterVS, fragmentShader: waterFS });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER - BASE;
    this.group.add(this.water);
  }

  // trees are split into a grid of instanced chunks: frustum-culled by three.js, thinned with distance in cullTrees()
  buildTrees(trees) {
    const NCH = 8, CS = SIZE / NCH;
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: treeVS, fragmentShader: treeFS });
    const mk = (geo, list, color) => {
      geo = geo.index ? geo.toNonIndexed() : geo; geo.computeVertexNormals();
      const group = new THREE.Group();
      const cells = Array.from({ length: NCH * NCH }, () => []);
      list.forEach((tr) => cells[clamp(Math.floor((tr.z + HALF) / CS), 0, NCH - 1) * NCH + clamp(Math.floor((tr.x + HALF) / CS), 0, NCH - 1)].push(tr));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      const c = new THREE.Color();
      cells.forEach((cl, ci) => {
        if (!cl.length) return;
        const g = geo.clone();
        const mesh = new THREE.InstancedMesh(g, mat, cl.length);
        const arr = new Float32Array(cl.length);
        cl.forEach((tr, i) => {
          q.setFromAxisAngle(up, tr.rot);
          s.set(tr.s * (tr.conifer ? 0.62 : 1), tr.s / this.vex, tr.s * (tr.conifer ? 0.62 : 1));
          p.set(tr.x, tr.y - BASE - 1.5, tr.z);
          m.compose(p, q, s); mesh.setMatrixAt(i, m);
          arr[i] = tr.arr;
          c.setRGB(color[0] * (0.8 + tr.tint * 0.4), color[1] * (0.8 + tr.tint * 0.35), color[2] * (0.85 + tr.tint * 0.3));
          mesh.setColorAt(i, c);
        });
        g.setAttribute('aArr', new THREE.InstancedBufferAttribute(arr, 1));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.userData = { list: cl, n: cl.length, cx: -HALF + (ci % NCH + 0.5) * CS, cz: -HALF + (Math.floor(ci / NCH) + 0.5) * CS, r: CS * 0.71 };
        group.add(mesh);
      });
      return group;
    };
    // conifer: stacked cones
    const cone1 = new THREE.ConeGeometry(0.5, 0.75, 7); cone1.translate(0, 0.55, 0);
    const cone2 = new THREE.ConeGeometry(0.36, 0.55, 7); cone2.translate(0, 0.85, 0);
    const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.25, 5); trunk.translate(0, 0.12, 0);
    const conGeo = mergeGeos([cone1, cone2, trunk]);
    const leaf = new THREE.IcosahedronGeometry(0.5, 0); leaf.scale(1, 0.85, 1); leaf.translate(0, 0.62, 0);
    const trunk2 = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5); trunk2.translate(0, 0.15, 0);
    const leafGeo = mergeGeos([leaf, trunk2]);
    this.treesA = mk(conGeo, trees.filter((t) => t.conifer), [0.22, 0.33, 0.17]);
    this.treesB = mk(leafGeo, trees.filter((t) => !t.conifer), [0.40, 0.46, 0.24]);
    this.group.add(this.treesA, this.treesB);
    this.treeChunks = [...this.treesA.children, ...this.treesB.children];
  }
  // distance LOD: full density near the camera, thinned out with distance (instances are in random order)
  cullTrees(cam) {
    if (!this.treeChunks || !this.treesA.visible) return;
    const cp = cam.position;
    const h = Math.max(0, cp.y - this.groundY(cp.x, cp.z));
    const near = 4500 + h * 0.25, far = 20000 + h * 0.3;
    for (const mesh of this.treeChunks) {
      const u = mesh.userData;
      const d = Math.max(0, Math.hypot(cp.x - u.cx, cp.z - u.cz) - u.r);
      const dd = Math.hypot(d, h * 0.6);
      const f = dd <= near ? 1 : dd >= far ? 0 : Math.pow(1 - (dd - near) / (far - near), 1.6);
      const n = Math.round(u.n * Math.max(f, 0.04));
      mesh.count = n; mesh.visible = f > 0;
    }
  }

  _buildRoads() {
    this.roadMeshes = [];
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: roadVS, fragmentShader: roadFS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    ROADS.forEach((road, ri) => {
      const prof = this.terrain.roadProfiles[ri];
      const pts = road.pts; const n = pts.length;
      const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
      let along = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const px = -dz * road.width / 2, pz = dx * road.width / 2;
        if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const y = Math.max(prof[i], this.terrain.elev(pts[i][0], pts[i][1])) - BASE + 1.2;
        pos.set([pts[i][0] + px, y, pts[i][1] + pz, pts[i][0] - px, y, pts[i][1] - pz], i * 6);
        uv.set([0, along, 1, along], i * 4);
      }
      const idx = [];
      for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('ruv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh); this.roadMeshes.push(mesh);
    });
  }

  _buildStructures() {
    const rnd = mulberry32(44);
    const spots = [];
    const addCluster = (cx, cz, n, r) => { for (let i = 0; i < n; i++) spots.push([cx + (rnd() - 0.5) * r, cz + (rnd() - 0.5) * r]); };
    if (this.real) {
      CORE.REAL.osm.places.forEach((p) => {
        if (p.k === 'town') addCluster(p.x, p.z, 70, 900);
        else if (p.k === 'village') addCluster(p.x, p.z, 22, 380);
        else if (p.k === 'hamlet') addCluster(p.x, p.z, 7, 180);
      });
    } else {
    addCluster(PLACES.oakFlats.x + 300, PLACES.oakFlats.z + 500, 26, 1300);
    addCluster(-4700, 7400, 12, 900);
    addCluster(-5300, 5000, 8, 700);
    addCluster(-5900, 2000, 6, 500);
    }
    // structures along roads
    if (!this.real) ROADS.forEach((road) => {
      for (let k = 0; k < road.pts.length; k += 25) {
        if (rnd() < 0.55) continue;
        const [x, z] = road.pts[k]; const s = rnd() < 0.5 ? 1 : -1;
        spots.push([x + s * (28 + rnd() * 30), z + (rnd() - 0.5) * 30]);
      }
    });
    const keep = spots.filter(([x, z]) => {
      if (Math.abs(x) > HALF - 100 || Math.abs(z) > HALF - 100) return false;
      if (this.terrain.elev(x, z) < WATER + 3) return false;
      for (const r of ROADS) { if (r.bbox && (x < r.bbox[0] - 20 || x > r.bbox[2] + 20 || z < r.bbox[1] - 20 || z > r.bbox[3] + 20)) continue; if (distToPolyline(x, z, r.pts, 4).d < 14) return false; }
      return true;
    });
    this.structures = keep.map(([x, z]) => ({ x, z, y: this.terrain.elev(x, z), rot: rnd() * Math.PI, burned: this.fire.arrivalAt(x, z) < UNBURNED }));
    const body = new THREE.BoxGeometry(14, 6, 10); body.translate(0, 3, 0);
    const roof = new THREE.CylinderGeometry(0.01, 9, 4.5, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(1.1, 1, 0.8); roof.translate(0, 8.2, 0);
    const mkI = (geo, color) => {
      const mesh = new THREE.InstancedMesh(geo, litMaterial(color, { heat: 0.22 }), this.structures.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1 / this.vex, 1), p = new THREE.Vector3();
      this.structures.forEach((st, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.rot); p.set(st.x, st.y - BASE - 0.5, st.z); m.compose(p, q, s); mesh.setMatrixAt(i, m); });
      mesh.frustumCulled = false; return mesh;
    };
    this.structA = mkI(body, '#e9e4dc'); this.structB = mkI(roof, '#5a4d45');
    this.group.add(this.structA, this.structB);
  }

  setFire(fire) {
    this.fire = fire;
    const d = new Float32Array(FN * FN * 4);
    // intensity: inverse arrival gradient (fast runs = high)
    const a = fire.arr;
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
      const c = j * FN + i; const v = a[c];
      d[c * 4] = v >= UNBURNED ? 1000 : v;
      let inten = 0;
      if (v < UNBURNED) {
        const l = a[j * FN + Math.max(i - 1, 0)], r = a[j * FN + Math.min(i + 1, FN - 1)];
        const u = a[Math.max(j - 1, 0) * FN + i], dn = a[Math.min(j + 1, FN - 1) * FN + i];
        const gx = (Math.min(r, 200) - Math.min(l, 200)) / 2, gz = (Math.min(dn, 200) - Math.min(u, 200)) / 2;
        const g = Math.hypot(gx, gz); // hours per cell
        inten = clamp(1 - (g - 0.08) / 0.7, 0, 1);
      }
      d[c * 4 + 1] = inten; d[c * 4 + 2] = 0; d[c * 4 + 3] = 1;
    }
    // blur intensity
    const tmp = new Float32Array(FN * FN);
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 1; j < FN - 1; j++) for (let i = 1; i < FN - 1; i++) {
        let s = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += d[((j + dj) * FN + i + di) * 4 + 1];
        tmp[j * FN + i] = s / 9;
      }
      for (let c = 0; c < FN * FN; c++) d[c * 4 + 1] = tmp[c];
    }
    const lin = !!this.renderer.extensions.get('OES_texture_float_linear');
    const tex = new THREE.DataTexture(d, FN, FN, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter; tex.minFilter = tex.magFilter;
    tex.needsUpdate = true;
    if (U.uArrTex.value) U.uArrTex.value.dispose();
    U.uArrTex.value = tex;
    // update tree arrival attributes if trees exist
    if (this.treeList) {
      this.treeChunks.forEach((mesh) => {
        const attr = mesh.geometry.getAttribute('aArr');
        mesh.userData.list.forEach((tr, i) => { tr.arr = fire.arrivalAt(tr.x, tr.z); attr.array[i] = tr.arr; });
        attr.needsUpdate = true;
      });
    }
  }

  setExaggeration(vex) { this.vex = vex; this.group.scale.y = vex * this.flatten; }
  setFlatten(f) { this.flatten = f; this.group.scale.y = this.vex * f; }
}

export function mergeGeos(geos) {
  const nonIdx = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; nonIdx.forEach((g) => (n += g.getAttribute('position').count));
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  nonIdx.forEach((g) => {
    pos.set(g.getAttribute('position').array, o * 3);
    if (g.getAttribute('normal')) nrm.set(g.getAttribute('normal').array, o * 3);
    o += g.getAttribute('position').count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}
