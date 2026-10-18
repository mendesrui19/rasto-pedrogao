// Incident scenario content derived from the fire simulation.
import { mulberry32, clamp, T } from './util.js';
import { PLACES, FN, FCELL, HALF, UNBURNED, T_IGNITION, T_RAPID, T_SPOT, T_RIDGE, T_CONTAIN } from './core.js';
import { polyLength, slicePoly } from './overlay.js';

export const SPOT = { x: 1250, z: -2350 };

export function buildEvents(fire) {
  const head = (t) => fire.sampleSeries('head', t);
  let cx = 0, cz = 0; fire.cells.forEach((c) => { const [x, z] = fire.cellXZ(c); cx += x; cz += z; });
  cx /= fire.cells.length; cz /= fire.cells.length;
  return [
    { id: 'ign', name: 'Ignition (est.)', t: T_IGNITION, icon: 'dot', pos: { ...PLACES.ignition }, zoom: 6 },
    { id: 'rapid', name: 'Rapid Growth', t: T_RAPID, icon: 'fire', pos: head(T_RAPID), zoom: 4.5 },
    { id: 'spot', name: 'Spot Fire (prob.)', t: T_SPOT, icon: 'tri', pos: { ...SPOT }, zoom: 5 },
    { id: 'ridge', name: 'Ridge Crossing', t: T_RIDGE, icon: 'hourglass', pos: head(T_RIDGE), zoom: 4 },
    { id: 'contain', name: 'Containment (est.)', t: T_CONTAIN, icon: 'square', pos: { x: cx, z: cz }, zoom: 2.2 },
  ];
}

export const DRONES = [
  { id: 'FT-01', name: 'Kestrel', kind: 'fixed', aircraft: 'Fixed-wing VTOL', mission: 'Perimeter mapping', status: 'Mapping', task: 'Flying the current fire edge, mapping it every lap', sensor: 'EO/IR · 30× zoom', agl: 1880, speed: 54, battery: 77, endurance: 88, flight: 3007, pattern: 'perimeter' },
  { id: 'FT-02', name: 'Harrier', kind: 'quad', aircraft: 'Quadcopter', mission: 'Head fire watch', status: 'Orbit · active fire', task: 'Holding over the head of the fire, tracking rate of spread', sensor: 'EO/IR', agl: 540, speed: 22, battery: 73, endurance: 36, flight: 1544, pattern: 'orbitHead' },
  { id: 'FT-03', name: 'Swift', kind: 'quad', aircraft: 'Quadcopter', mission: 'Flank & spot watch', status: 'Orbit · spot fire', task: 'Circling the next most active part of the fire (the spot fire once it starts)', sensor: 'EO/IR', agl: 650, speed: 18, battery: 77, endurance: 34, flight: 1172, pattern: 'orbitSpot' },
  { id: 'FT-04', name: 'Osprey', kind: 'quad', aircraft: 'Quadcopter', mission: 'Structure protection', status: 'Patrol', task: 'Patrolling Oak Flats and East Fork', sensor: 'EO/IR · spotlight', agl: 770, speed: 20, battery: 84, endurance: 40, flight: 2494, pattern: 'patrol' },
  { id: 'FT-05', name: 'Condor', kind: 'fixed', aircraft: 'Fixed-wing', mission: 'Hotspot survey', status: 'Survey', task: 'Survey lines over the burn scar for hold-over heat', sensor: 'IR · radiometric', agl: 1480, speed: 47, battery: 69, endurance: 76, flight: 1497, pattern: 'survey' },
  { id: 'FT-06', name: 'Wren', kind: 'quad', aircraft: 'Quadcopter', mission: 'Comms relay', status: 'Relay', task: 'Relay for crews in Canyon Creek', sensor: 'EO · mesh radio', agl: 930, speed: 65, battery: 77, endurance: 30, flight: -1, pattern: 'relay' },
];

export const AIRCRAFT = [
  { id: 'T-910', type: 'DC-10 VLAT', model: 'vlat', cap: 9400, agency: 'CAL FIRE (exclusive use)', role: 'tanker', speed: 300, liquid: 'retardant' },
  { id: 'T-131', type: 'C-130Q Air Tanker', model: 'c130', cap: 4000, agency: 'CAL FIRE', role: 'tanker', speed: 260, liquid: 'retardant' },
  { id: 'T-162', type: 'RJ85 Air Tanker', model: 'rj85', cap: 3000, agency: 'USFS (contract)', role: 'tanker', speed: 290, liquid: 'retardant' },
  { id: 'H-743', type: 'S-64 Air-Crane', model: 'skycrane', cap: 2650, agency: 'LA County Fire', role: 'heli', speed: 100, liquid: 'water' },
  { id: 'H-531', type: 'Bell 205 · bucket', model: 'huey', cap: 324, agency: 'LA County Fire', role: 'heli', speed: 95, liquid: 'water' },
  { id: 'AA-52', type: 'King Air 200 · Air Attack', model: 'kingair', cap: 0, crew: 2, agency: 'CAL FIRE', role: 'attack', speed: 180 },
];
export const ENGINES = [
  { id: 'E-31', type: 'Type 3 Engine', model: 'engine', crew: 4, agency: 'CAL FIRE', status: 'Structure protection', div: 'B', road: 1, s0: 5600, range: 500 },
  { id: 'E-32', type: 'Type 3 Engine', model: 'engine', crew: 5, agency: 'LA County Fire', status: 'Structure protection', div: 'B', road: 1, s0: 7400, range: 600 },
  { id: 'E-45', type: 'Type 1 Engine', model: 'engine1', crew: 4, agency: 'LA County Fire', status: 'Patrol', where: 'Canyon Creek Rd', div: 'A', road: 0, s0: 3600, range: 5200 },
  { id: 'WT-12', type: 'Water Tender', model: 'tender', crew: 1, cap: 2500, agency: 'CAL FIRE', status: 'To E-31', div: 'B', road: 1, s0: 9600, range: 3000 },
];
export const CREWS = [
  { id: 'C-7', type: 'Crew 7 · Hotshots', model: 'crew', crew: 20, agency: 'USFS IHC', status: 'Holding & mop-up', div: 'Z', chains: 352 },
  { id: 'C-14', type: 'Crew 14 · Hand crew', model: 'crew', crew: 17, agency: 'CAL FIRE', status: 'Holding & mop-up', div: 'Y', chains: 321 },
  { id: 'DZ-4', type: 'D6 Dozer', model: 'dozer', crew: 1, agency: 'CAL FIRE', status: 'Holding & mop-up', div: 'X', chains: 438 },
];

function divisionFor(x, z) {
  const ang = Math.atan2(x - PLACES.ignition.x, -(z - PLACES.ignition.z));
  const letters = 'ABCDEFGHJKLM';
  return letters[Math.floor(((ang + Math.PI) / (2 * Math.PI)) * letters.length) % letters.length];
}
export { divisionFor };

// Historic suppression drops (before "now"), placed on the flanks of the front at each time
export function buildDrops(fire) {
  const rnd = mulberry32(99);
  const drops = [];
  const types = AIRCRAFT.filter((a) => a.role !== 'attack');
  const a = fire.arr;
  const AX = 0.6, AZ = -0.8;
  for (let k = 0; k < 120; k++) {
    let t = T(14, 16, 30) + rnd() * (T(18, 9) - T(14, 16, 30));
    const hr = t % 24; if (hr < 7.5 || hr > 19.5) { t = Math.floor(t / 24) * 24 + 8 + rnd() * 11; }
    const ac = types[Math.floor(rnd() * types.length)];
    // candidate edge cells: will burn shortly after t
    let best = null;
    for (let tries = 0; tries < 60; tries++) {
      const c = fire.cells[Math.floor(rnd() * fire.cells.length)];
      const v = a[c];
      if (v < t + 0.3 || v > t + 8) continue;
      const [x, z] = fire.cellXZ(c);
      // prefer flanks (lateral to spread axis)
      const head = fire.sampleSeries('head', t);
      const lat = Math.abs((x - head.x) * -AZ + (z - head.z) * AX);
      if (lat < 300 && rnd() < 0.8) continue;
      best = { c, x, z }; break;
    }
    if (!best) continue;
    const i = best.c % FN, j = (best.c / FN) | 0;
    const g = (ii, jj) => Math.min(a[clamp(jj, 0, FN - 1) * FN + clamp(ii, 0, FN - 1)], t + 30);
    let gx = g(i + 1, j) - g(i - 1, j), gz = g(i, j + 1) - g(i, j - 1);
    const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
    const tx = -gz, tz = gx; // tangent to front
    const L = ac.model === 'vlat' ? 1150 : ac.role === 'heli' ? 180 + rnd() * 100 : 520 + rnd() * 300;
    const w = ac.model === 'vlat' ? 70 : ac.role === 'heli' ? 55 : 50;
    const off = 120 + rnd() * 120; // laid ahead of the front
    const cx = best.x + gx * off, cz = best.z + gz * off;
    drops.push({ t, id: ac.id, kind: ac.liquid, gal: ac.cap === 324 ? 324 : Math.round(ac.cap * (0.75 + rnd() * 0.25) / 50) * 50,
      x0: cx - tx * L / 2, z0: cz - tz * L / 2, x1: cx + tx * L / 2, z1: cz + tz * L / 2, nx: gx, nz: gz, w,
      div: divisionFor(cx, cz), cx, cz });
  }
  drops.sort((p, q) => p.t - q.t);
  return drops;
}

// Hand/dozer line built along the final perimeter
export function buildFireLines(perimeterLoop) {
  const L = polyLength(perimeterLoop);
  // start near the south-west of the burn
  let best = 0, bd = 1e12;
  perimeterLoop.forEach((p, i) => { const d = (p[0] - (PLACES.ignition.x - 2500)) ** 2 + (p[1] - (PLACES.ignition.z - 600)) ** 2; if (d < bd) { bd = d; best = i; } });
  const loop = perimeterLoop.slice(best).concat(perimeterLoop.slice(1, best + 1));
  const defs = [
    { id: 'DZ-4', chains: 438, t0: T(15, 20), t1: T(17, 10) },
    { id: 'C-7', chains: 352, t0: T(16, 2), t1: T(17, 16) },
    { id: 'C-14', chains: 321, t0: T(16, 8), t1: T(18, 2) },
  ];
  let s = 0;
  return defs.map((d) => {
    const len = Math.min(d.chains * 20.117, L * 0.3);
    const pts = slicePoly(loop, s, s + len); s += len + 150;
    return {
      ...d, pts, length: len,
      progress(t) { return clamp((t - d.t0) / (d.t1 - d.t0), 0, 1); },
      builtAt(t) { const p = clamp((t - d.t0) / (d.t1 - d.t0), 0, 1); return p <= 0 ? [] : slicePoly(pts, 0, len * p); },
      chainsAt(t) { return d.chains * clamp((t - d.t0) / (d.t1 - d.t0), 0, 1); },
    };
  });
}

export const EVIDENCE = [
  { id: 'EV-001', title: 'Origin area photo set', meta: '24 photos · Aug 18 · Inv. R. Alvarez', tag: 'Photo', thumb: 'linear-gradient(135deg,#8a6a4a,#3d2e24 60%,#c39a6a)' },
  { id: 'EV-002', title: 'Metallic fragment (tag 7)', meta: 'Recovered 3 m SE of origin marker', tag: 'Physical', thumb: 'radial-gradient(circle at 40% 40%,#c9c4bd,#6d6862 50%,#3a3632)' },
  { id: 'EV-003', title: 'RAWS KSGM weather log', meta: 'Aug 14 00:00 – Aug 18 12:00 · hourly', tag: 'Data', thumb: 'linear-gradient(180deg,#e6eef3,#9fb7c8)' },
  { id: 'EV-004', title: 'Witness statement — hiker', meta: 'Smoke observed ~14:30 from Pine Ridge trail', tag: 'Statement', thumb: 'linear-gradient(135deg,#efe7da,#d8ccb9)' },
  { id: 'EV-005', title: 'FT-05 IR mosaic', meta: 'Aug 15 04:00 · burn scar · radiometric', tag: 'Drone', thumb: 'linear-gradient(135deg,#1b0638,#6a1b8a 45%,#f08c2b 75%,#fff2b0)' },
  { id: 'EV-006', title: 'Distribution line inspection', meta: 'Span 114–118 · no fault recorded', tag: 'Report', thumb: 'linear-gradient(135deg,#dfe4e8,#a9b2ba)' },
];

export const CAUSES = [
  { name: 'Equipment use (mowing / grinding)', p: 0.46 },
  { name: 'Power line', p: 0.22 },
  { name: 'Vehicle (hot exhaust / brakes)', p: 0.14 },
  { name: 'Arson', p: 0.09 },
  { name: 'Debris burning', p: 0.06 },
  { name: 'Lightning', p: 0.03 },
];
