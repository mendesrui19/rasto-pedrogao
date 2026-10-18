// Shared helpers: noise, RNG, math, time + geo formatting.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D gradient (Perlin) noise, range roughly [-1, 1]
export function makeNoise(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = new Float32Array(16), gy = new Float32Array(16);
  for (let i = 0; i < 16; i++) { gx[i] = Math.cos(i / 16 * Math.PI * 2); gy[i] = Math.sin(i / 16 * Math.PI * 2); }
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = p[p[X] + Y] & 15, b = p[p[X + 1] + Y] & 15;
    const c = p[p[X] + Y + 1] & 15, d = p[p[X + 1] + Y + 1] & 15;
    const n00 = gx[a] * xf + gy[a] * yf;
    const n10 = gx[b] * (xf - 1) + gy[b] * yf;
    const n01 = gx[c] * xf + gy[c] * (yf - 1);
    const n11 = gx[d] * (xf - 1) + gy[d] * (yf - 1);
    const x1 = n00 + u * (n10 - n00), x2 = n01 + u * (n11 - n01);
    return (x1 + v * (x2 - x1)) * 1.4;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- Time: hours since Aug 14 2024 00:00 PDT ----
let MONTH = 'Aug', DAY0 = 14;
export function setCalendar(month, day0) { MONTH = month; DAY0 = day0; }
export const T = (day, hh, mm = 0) => (day - DAY0) * 24 + hh + mm / 60;
const pad = (n) => String(n).padStart(2, '0');
export function timeParts(h) {
  const totalMin = Math.round(h * 60);
  const day = DAY0 + Math.floor(totalMin / 1440);
  const rem = ((totalMin % 1440) + 1440) % 1440;
  return { day, hh: Math.floor(rem / 60), mm: rem % 60 };
}
export function fmtTime(h) { const t = timeParts(h); return `${MONTH} ${t.day}, ${pad(t.hh)}:${pad(t.mm)}`; }
export function fmtTimeShort(h) { const t = timeParts(h); return `${MONTH} ${t.day}, ${pad(t.hh)}:${pad(t.mm)}`; }
export function fmtHM(h) { const t = timeParts(h); return `${pad(t.hh)}:${pad(t.mm)}`; }
export function fmtDay(h) { const t = timeParts(h); return `${MONTH} ${t.day}`; }
export function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

// ---- Geo: local metres -> lat/lon (center 34°19'N, 117°56'W) ----
let LAT0 = 34 + 19 / 60, LON0 = -(117 + 56 / 60);
let M_PER_DEG_LAT = 110950, M_PER_DEG_LON = 92000;
export function setGeo(lat0, lon0) { LAT0 = lat0; LON0 = lon0; M_PER_DEG_LAT = 111132 - 559.8 * Math.cos(2 * lat0 * Math.PI / 180); M_PER_DEG_LON = 111320 * Math.cos(lat0 * Math.PI / 180); }
export const geoInfo = () => ({ LAT0, LON0, M_PER_DEG_LAT, M_PER_DEG_LON, MONTH });
export function toLatLon(x, z) { return { lat: LAT0 - z / M_PER_DEG_LAT, lon: LON0 + x / M_PER_DEG_LON }; }
export function fromLatLon(lat, lon) { return { x: (lon - LON0) * M_PER_DEG_LON, z: (LAT0 - lat) * M_PER_DEG_LAT }; }
function dm(v, digits) {
  const a = Math.abs(v); const d = Math.floor(a); const m = (a - d) * 60;
  return `${d}°${m.toFixed(digits).padStart(digits + 3, '0')}'`;
}
export function fmtLatLon(x, z, digits = 2) {
  const { lat, lon } = toLatLon(x, z);
  return `${dm(lat, digits)}${lat >= 0 ? 'N' : 'S'} ${dm(lon, digits)}${lon < 0 ? 'W' : 'E'}`;
}
export function fmtLatLonHud(x, z) {
  const { lat, lon } = toLatLon(x, z);
  return `${dm(lat, 2).replace("'", '')} ${lat >= 0 ? 'N' : 'S'} ${dm(lon, 2).replace("'", '')} ${lon < 0 ? 'W' : 'E'}`;
}
export function compassName(deg) {
  const n = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return n[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
export const DEG = Math.PI / 180;
