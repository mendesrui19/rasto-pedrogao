// Data-analysis layer: metric catalog shared by the bottom charts and the full dashboard, the side-panel analysis
// summary and the full-screen dashboard. Texts are bilingual at render time (L), so these nodes skip the i18n observer.
import { Chart } from './charts.js';
import { T, clamp } from './util.js';
import { getLang } from './i18n.js';

let app;
export function initDash(a) { app = a; }
const A = () => app.real && app.real.analysis;
export const L = (en, pt) => (getLang() === 'pt' ? pt : en);
const nf = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString(getLang() === 'pt' ? 'pt-PT' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const MON = () => L('Jun', 'jun');
const pad = (n) => String(n).padStart(2, '0');
export function fmtT(t) {
  const d = 17 + Math.floor(t / 24), h = ((t % 24) + 24) % 24, hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const [H2, M2] = mm === 60 ? [hh + 1, 0] : [hh, mm];
  return L(`Jun ${d}, ${pad(H2)}:${pad(M2)}`, `${d} jun, ${pad(H2)}:${pad(M2)}`);
}
const fmtHMm = (t) => { const h = ((t % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${pad(hh)}:${pad(mm % 60)}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const COL = { fire: '#d0613e', red: '#c62f26', dark: '#2a2520', blue: '#3f6fd6', green: '#5c7a4a', amber: '#e08a3c', violet: '#7a4bd6', grey: '#8f877d', teal: '#2b8a8a' };
const SEV_COL = ['#c9c2b6', '#f2c86b', '#eb9a45', '#d4552e', '#7d1f17'];
const SEV_PT = { 'Unburned/regrowth': 'Não ardido/rebrotação', Low: 'Baixa', 'Moderate-low': 'Moderada-baixa', 'Moderate-high': 'Moderada-alta', High: 'Alta' };
const LC_PT = { Artificial: 'Artificializado', Agriculture: 'Agricultura', Pasture: 'Pastagens', Agroforestry: 'Agroflorestal', Forest: 'Floresta', Shrubland: 'Matos', 'Bare / sparse': 'Descoberto / esparso', Wetlands: 'Zonas húmidas', Water: 'Água' };
const FWI_PT = { 'Very low': 'Muito baixo', Low: 'Baixo', Moderate: 'Moderado', High: 'Elevado', 'Very high': 'Muito elevado', Extreme: 'Extremo' };
const fwiClass = (v) => { for (const [a, b, k] of A().fwi.classes) if (v >= a && v < b) return L(k, FWI_PT[k]); return '—'; };

// ------------------------------------------------------------------ shared time axis
const X17 = () => [T(17, 12), T(23, 0)];
const dayTicks = () => [17, 18, 19, 20, 21, 22].map((d) => [T(d, 12), L(`Jun ${d}`, `${d} jun`)]);
const X17zoom = () => [T(17, 12), T(18, 12)];
const hourTicks = () => [12, 15, 18, 21, 24, 27, 30, 33, 36].map((h) => [T(17, h), `${pad(h % 24)}h`]);
function fireSpans(compact) {
  const db = app.real.meta.downburst;
  return [
    { x0: db.t0, x1: db.t1, color: 'rgba(63,111,214,0.07)', label: compact ? '' : L('downburst', 'downburst') , text: '#3f5fa6' },
    { x0: T(17, 19, 30), x1: T(17, 20, 30), color: 'rgba(201,55,44,0.12)', label: compact ? '' : L('fatalities', 'vítimas') },
  ];
}

// ------------------------------------------------------------------ metric catalog (time series)
// each build(opts) returns { title, meta, cfg, insight? }
export const METRICS = {
  area: {
    label: () => L('Burned area', 'Área ardida'),
    build(o) {
      const f = app.fire, t = app.state.time; const area = f.times.map((tt, i) => [tt, f.area[i]]);
      const zoom = o.zoom;
      return {
        title: L('Burned area (ha)', 'Área ardida (ha)'), meta: `${nf(f.sampleSeries('area', t))} ha`,
        cfg: { x: zoom ? X17zoom() : X17(), y: [0, 50000], yTicks: [0, 25000, 50000], padL: 44, xTicks: zoom ? hourTicks() : dayTicks(), xFmt: fmtT, legend: !o.compact, refsLabel: L('official', 'oficial'),
          spans: zoom ? fireSpans(o.compact) : [],
          series: [{ pts: area, color: COL.fire, fill: 'rgba(222,120,80,A)', splitAt: t, futureAlpha: 0.6, label: L('Reconstruction', 'Reconstrução'), fmt: (v) => `${nf(v)} ha` }],
          refs: [{ x: T(22, 9, 22), y: 48050 }, { x: T(22, 19, 30), y: 47879 }], cursor: t, cursorY: f.sampleSeries('area', t) },
        insight: () => { const a = A(); const s1 = a.dailyBurn[0].ha + a.dailyBurn[1].ha; return L(`${nf(100 * s1 / a.totals.burnedHa)}% of the final area burned on 17–18 June. Final reconstruction ${nf(a.totals.burnedHa)} ha vs ICNF 48,050 ha (◆).`, `${nf(100 * s1 / a.totals.burnedHa)}% da área final ardeu a 17–18 de junho. Reconstrução final ${nf(a.totals.burnedHa)} ha vs ICNF 48 050 ha (◆).`); },
      };
    },
  },
  growth: {
    label: () => L('Growth rate (ha/h)', 'Crescimento (ha/h)'),
    build(o) {
      const a = A(), t = app.state.time; const pts = a.growth.filter((g) => g[0] % 1 === 0.5).map(([x, y]) => [x, y]);
      const zoom = o.zoom; const cur = pts.reduce((b, p) => (Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b), pts[0]);
      return {
        title: L('Growth rate (ha/h)', 'Crescimento (ha/h)'), meta: t >= pts[0][0] && t <= pts[pts.length - 1][0] ? `${nf(cur[1])} ha/h` : '',
        cfg: { x: zoom ? X17zoom() : X17(), y: [0, 6000], yTicks: [0, 3000, 6000], padL: 40, xTicks: zoom ? hourTicks() : dayTicks(), xFmt: fmtT, spans: fireSpans(o.compact),
          series: [{ type: 'bar', pts, barW: 1, color: COL.red, splitAt: t, label: L('Growth', 'Crescimento'), fmt: (v) => `${nf(v)} ha/h` }], cursor: t },
        insight: () => L(`Peak ${nf(a.peakGrowth.ha)} ha/h at ${fmtT(a.peakGrowth.t)}, when the Pedrógão and Góis fronts ran at night. 19:30–20:30, the EN236-1 window, stands out first.`, `Pico de ${nf(a.peakGrowth.ha)} ha/h às ${fmtT(a.peakGrowth.t)}, com as frentes de Pedrógão e Góis a correr de noite. Entre as 19:30 e as 20:30, a janela da EN236-1, destaca-se primeiro.`),
      };
    },
  },
  ros: {
    label: () => L('Spread speed (m/min)', 'Velocidade de propagação (m/min)'),
    build(o) {
      const a = A(), t = app.state.time; const p50 = a.ros.filter((r) => r.p50 !== null).map((r) => [r.t, r.p50]), p75 = a.ros.filter((r) => r.p75 !== null).map((r) => [r.t, r.p75]);
      const zoom = o.zoom; const pk = a.ros.reduce((b, r) => ((r.p50 || 0) > (b.p50 || 0) ? r : b), a.ros[0]);
      return {
        title: L('Spread speed (m/min)', 'Velocidade de propagação (m/min)'), meta: L(`peak ${nf(pk.p50)} m/min`, `pico ${nf(pk.p50)} m/min`),
        cfg: { x: zoom ? X17zoom() : X17(), y: [0, 120], yTicks: [0, 60, 120], padL: 32, xTicks: zoom ? hourTicks() : dayTicks(), xFmt: fmtT, legend: !o.compact, spans: fireSpans(o.compact),
          series: [{ pts: p75, color: COL.amber, width: 1.2, label: L('75th pct', 'percentil 75'), fmt: (v) => `${nf(v)} m/min`, step: true, splitAt: t }, { pts: p50, color: COL.red, fill: 'rgba(214,80,70,A)', label: L('median', 'mediana'), fmt: (v) => `${nf(v)} m/min (${nf(v * 0.06, 1)} km/h)`, step: true, splitAt: t }], cursor: t },
        insight: () => L(`Median front speed peaked at ${nf(pk.p50)} m/min (${nf(pk.p50 * 0.06, 1)} km/h) around ${fmtT(pk.t)}: the downburst-driven run that trapped people on the roads. Derived from the gradient of the arrival-time field.`, `A velocidade mediana da frente atingiu ${nf(pk.p50)} m/min (${nf(pk.p50 * 0.06, 1)} km/h) cerca das ${fmtT(pk.t)}: a corrida empurrada pelo downburst que apanhou pessoas nas estradas. Calculada a partir do gradiente do campo de tempos de chegada.`),
      };
    },
  },
  weather: {
    label: () => L('Temperature & humidity', 'Temperatura e humidade'),
    build(o) {
      const a = A(), t = app.state.time; const H = a.hourly;
      const zoom = o.zoom; const cur = H.reduce((b, h) => (Math.abs(h.t - t) < Math.abs(b.t - t) ? h : b), H[0]);
      return {
        title: L('Temperature (°C) · RH (%)', 'Temperatura (°C) · HR (%)'), meta: `${nf(cur.temp)} °C · ${nf(cur.rh)}%`,
        cfg: { x: zoom ? X17zoom() : X17(), y: [0, 50], yTicks: [0, 25, 50], padL: 26, padR: 28, xTicks: zoom ? hourTicks() : dayTicks(), xFmt: fmtT, legend: !o.compact, spans: fireSpans(o.compact),
          y2: { range: [0, 100], ticks: [0, 50, 100], fmt: (v) => `${v}%`, color: COL.blue },
          series: [{ pts: H.map((h) => [h.t, h.temp]), color: COL.red, label: L('Temp', 'Temp'), fmt: (v) => `${nf(v, 1)} °C`, splitAt: t }, { pts: H.map((h) => [h.t, h.rh]), color: COL.blue, axis: 2, label: L('RH', 'HR'), fmt: (v) => `${nf(v)}%`, splitAt: t },
            ...(a.station ? [{ pts: a.station.obs.filter((o) => o.temp !== null).map((o) => [o.t, o.temp]), color: COL.red, width: 1, dashed: true, alpha: 0.75, label: L('Temp · Monte Real (obs.)', 'Temp · Monte Real (obs.)'), fmt: (v) => `${nf(v, 1)} °C` },
              { pts: a.station.obs.filter((o) => o.rh !== null).map((o) => [o.t, o.rh]), color: COL.blue, width: 1, dashed: true, alpha: 0.75, axis: 2, label: L('RH · Monte Real', 'HR · Monte Real'), fmt: (v) => `${nf(v)}%`, noLegend: true }] : [])], cursor: t },
        insight: () => { const d17 = H.filter((h) => h.t >= 0 && h.t < 24); const mx = d17.reduce((b, h) => (h.temp > b.temp ? h : b)); const mn = d17.reduce((b, h) => (h.rh < b.rh ? h : b));
          const st = a.station ? a.station.obs.filter((o) => o.t >= 12 && o.t <= 18 && o.temp !== null) : []; const smx = st.length ? st.reduce((b, o) => (o.temp > b.temp ? o : b)) : null;
          const sTxt = smx ? L(` The Monte Real station (60 km W, dashed) measured ${nf(smx.temp, 1)} °C and RH ${nf(smx.rh)}%: an independent confirmation of the hot, dry air mass.`, ` A estação de Monte Real (60 km a oeste, tracejado) mediu ${nf(smx.temp, 1)} °C e HR ${nf(smx.rh)}%: uma confirmação independente da massa de ar quente e seca.`) : '';
          return L(`17 June: ${nf(mx.temp, 1)} °C at ${fmtHMm(mx.t)} and relative humidity down to ${nf(mn.rh)}% at ${fmtHMm(mn.t)} (ERA5).`, `17 de junho: ${nf(mx.temp, 1)} °C às ${fmtHMm(mx.t)} e humidade relativa até ${nf(mn.rh)}% às ${fmtHMm(mn.t)} (ERA5).`) + sTxt; },
      };
    },
  },
  wind: {
    label: () => L('Wind & gusts', 'Vento e rajadas'),
    build(o) {
      const a = A(), t = app.state.time; const H = a.hourly; const zoom = o.zoom; const cur = H.reduce((b, h) => (Math.abs(h.t - t) < Math.abs(b.t - t) ? h : b), H[0]);
      return {
        title: L('Wind · gusts (km/h)', 'Vento · rajadas (km/h)'), meta: `${nf(cur.ws)} · ${nf(cur.gust)} km/h`,
        cfg: { x: zoom ? X17zoom() : X17(), y: [0, 60], yTicks: [0, 30, 60], padL: 26, xTicks: zoom ? hourTicks() : dayTicks(), xFmt: fmtT, legend: !o.compact, spans: fireSpans(o.compact),
          series: [{ pts: H.map((h) => [h.t, h.gust]), color: COL.amber, width: 1.2, label: L('Gust', 'Rajada'), fmt: (v) => `${nf(v)} km/h`, splitAt: t }, { pts: H.map((h) => [h.t, h.ws]), color: COL.dark, label: L('Wind', 'Vento'), fmt: (v) => `${nf(v)} km/h`, splitAt: t }], cursor: t },
        insight: () => L('ERA5 shows moderate winds (≤ 30 km/h gusts). The thunderstorm downburst (estimated 100–130 km/h at ~19:00) is a convective-scale event that a 31 km reanalysis cannot resolve, so the model winds understate the conditions that drove the fatal run.', 'O ERA5 mostra vento moderado (rajadas ≤ 30 km/h). O downburst da trovoada (estimado em 100–130 km/h cerca das 19:00) é um fenómeno convectivo que uma reanálise de 31 km não consegue resolver, por isso o vento do modelo subestima as condições da corrida fatal.'),
      };
    },
  },
  hdw: {
    label: () => L('Hot-Dry-Windy index', 'Índice Hot-Dry-Windy'),
    build(o) {
      const a = A(), t = app.state.time; const H = a.hourly; const zoom = o.zoom; const cur = H.reduce((b, h) => (Math.abs(h.t - t) < Math.abs(b.t - t) ? h : b), H[0]);
      const pk = H.reduce((b, h) => (h.hdw > b.hdw ? h : b));
      return {
        title: L('Hot-Dry-Windy index', 'Índice Hot-Dry-Windy'), meta: `HDW ${nf(cur.hdw)}`,
        cfg: { x: zoom ? X17zoom() : X17(), y: [0, 200], yTicks: [0, 100, 200], padL: 30, xTicks: zoom ? hourTicks() : dayTicks(), xFmt: fmtT, spans: fireSpans(o.compact),
          bands: [{ y0: 100, y1: 200, color: 'rgba(201,55,44,0.06)' }],
          series: [{ pts: H.map((h) => [h.t, h.hdw]), color: COL.violet, fill: 'rgba(122,75,214,A)', label: 'HDW', fmt: (v) => nf(v), splitAt: t }], cursor: t },
        insight: () => L(`HDW = vapour-pressure deficit × wind speed, a measure of the atmosphere's drying power. Peak ${nf(pk.hdw)} at ${fmtT(pk.t)}; values above 100 (shaded) are very high.`, `HDW = défice de pressão de vapor × velocidade do vento, uma medida do poder de secagem da atmosfera. Pico de ${nf(pk.hdw)} às ${fmtT(pk.t)}; valores acima de 100 (sombreado) são muito elevados.`),
      };
    },
  },
  fwi: {
    label: () => L('Fire Weather Index · June', 'Índice FWI · junho'),
    build(o) {
      const a = A(), t = app.state.time; const D = a.fwi.daily; const day = 17 + t / 24;
      const bandsC = ['rgba(90,160,90,0.10)', 'rgba(150,190,90,0.10)', 'rgba(240,200,80,0.12)', 'rgba(235,140,60,0.13)', 'rgba(215,70,50,0.14)', 'rgba(130,30,30,0.14)'];
      const d17 = D.find((d) => d.d === 17);
      return {
        title: L('Fire Weather Index (FWI) · June 2017', 'Índice meteorológico de incêndio (FWI) · junho 2017'), meta: `FWI ${nf(d17.fwi, 1)} · ${fwiClass(d17.fwi)}`,
        cfg: { x: [0.5, 30.5], y: [0, 60], yTicks: [0, 21.3, 38, 50], yFmt: (v) => nf(v, v % 1 ? 1 : 0), padL: 30, xTicks: [1, 5, 10, 15, 17, 20, 25, 30].map((d) => [d, String(d)]), xFmt: (d) => L(`Jun ${Math.round(d)}`, `${Math.round(d)} jun`),
          legend: !o.compact, refsLabel: 'SGIF 17 Jun',
          bands: a.fwi.classes.map(([y0, y1], i) => ({ y0, y1, color: bandsC[i] })),
          series: [{ type: 'bar', pts: D.map((d) => [d.d, d.fwi, d.d === 17 ? COL.red : d.d >= 17 && d.d <= 22 ? '#e08a5c' : '#b8afa3']), barW: 1, color: '#b8afa3', label: 'FWI (ERA5)', fmt: (v) => `${nf(v, 1)} · ${fwiClass(v)}` }],
          refs: [{ x: 17, y: a.fwi.ref.sgif17.fwi }], cursor: day >= 0.5 && day <= 30.5 ? day : null },
        insight: () => { const rank = D.filter((d) => d.fwi > d17.fwi).length + 1;
          return L(`Computed from ERA5 with the Canadian FWI system (spin-up from 1 April): FWI ${nf(d17.fwi, 1)} on 17 June (${fwiClass(d17.fwi)}, #${rank} in June). The SGIF value was 34.8 (◆). FFMC ${nf(d17.ffmc, 1)}: fine fuels primed to ignite.`, `Calculado a partir do ERA5 com o sistema FWI canadiano (arranque a 1 de abril): FWI ${nf(d17.fwi, 1)} a 17 de junho (${fwiClass(d17.fwi)}, ${rank}.º de junho). O valor do SGIF foi 34,8 (◆). FFMC ${nf(d17.ffmc, 1)}: combustíveis finos prontos a arder.`); },
      };
    },
  },
  firms: {
    label: () => L('Satellite fire radiative power', 'Potência radiativa (satélite)'),
    build(o) {
      const a = A(), t = app.state.time; const P = a.firms.passes.filter((p) => p.frp > 0);
      const mx = Math.max(...P.map((p) => p.frp)); const ymax = Math.ceil(mx / 5000) * 5000;
      return {
        title: L('Fire radiative power per pass (MW)', 'Potência radiativa por passagem (MW)'), meta: L(`${nf(a.firms.n)} detections`, `${nf(a.firms.n)} deteções`),
        cfg: { x: X17(), y: [0, ymax], yTicks: [0, ymax / 2, ymax], padL: 44, xTicks: dayTicks(), xFmt: fmtT, legend: !o.compact,
          series: [{ type: 'bar', pts: P.filter((p) => p.sat === 'VIIRS').map((p) => [p.t, p.frp]), barW: 1.6, color: COL.red, label: 'VIIRS', fmt: (v) => `${nf(v)} MW`, splitAt: t },
            { type: 'bar', pts: P.filter((p) => p.sat === 'MODIS').map((p) => [p.t, p.frp]), barW: 1.6, color: COL.amber, label: 'MODIS', fmt: (v) => `${nf(v)} MW`, splitAt: t }], cursor: t },
        insight: () => { const pk = P.reduce((b, p) => (p.frp > b.frp ? p : b)); return L(`${nf(a.firms.n)} NASA FIRMS detections in ${a.firms.passes.length} overpasses. Strongest pass ${fmtT(pk.t)} (${pk.sat}): ${nf(pk.frp)} MW in total. The first night pass after ignition caught the fire at its most intense.`, `${nf(a.firms.n)} deteções NASA FIRMS em ${a.firms.passes.length} passagens. Passagem mais forte ${fmtT(pk.t)} (${pk.sat}): ${nf(pk.frp)} MW no total. A primeira passagem noturna após a ignição apanhou o fogo no auge.`); },
      };
    },
  },
  deaths: {
    label: () => L('Fatalities vs fire arrival', 'Vítimas vs chegada do fogo'),
    build(o) {
      const a = A(), t = app.state.time; const cum = [[T(17, 12), 0]]; let last = 0; a.deathsCum.forEach(([x, y]) => { cum.push([x, last]); cum.push([x, y]); last = y; }); cum.push([T(23, 0), last]);
      const f = app.fire; const area = f.times.map((tt, i) => [tt, f.area[i] / 50000 * 70]);
      return {
        title: L('Fatalities (CTI sites, cumulative)', 'Vítimas (locais CTI, acumulado)'), meta: `${nf(cum.filter((p) => p[0] <= t).pop()[1])} / ${a.validation.nDead}`,
        cfg: { x: X17zoom(), y: [0, 70], yTicks: [0, 35, 70], padL: 28, xTicks: hourTicks(), xFmt: fmtT, legend: !o.compact, spans: fireSpans(o.compact),
          series: [{ pts: area, color: COL.fire, width: 1, alpha: 0.6, dashed: true, label: L('Burned area (scaled)', 'Área ardida (escala)'), fmt: (v) => `${nf(v / 70 * 50000)} ha` },
            { pts: cum, color: COL.dark, width: 2, label: L('Fatalities', 'Vítimas'), fmt: (v) => nf(v), step: true, splitAt: t }], cursor: t },
        insight: () => { const inWin = a.deathsCum.filter(([x]) => x >= T(17, 19, 30) && x <= T(17, 20, 45)).pop(); return L(`${inWin ? inWin[1] : '—'} of the ${a.validation.nDead} geolocated fatalities happened between 19:30 and 20:45 on 17 June, 30 of them in 400 m of the EN236-1.`, `${inWin ? inWin[1] : '—'} das ${a.validation.nDead} vítimas geolocalizadas morreram entre as 19:30 e as 20:45 de 17 de junho, 30 delas em 400 m da EN236-1.`); },
      };
    },
  },
  exposure: {
    label: () => L('People & buildings reached', 'Pessoas e edifícios atingidos'),
    build(o) {
      const a = A(), t = app.state.time, E = a.exposure; const zoom = o.zoom;
      const pmax = Math.ceil(E.popBurned / 1000) * 1000, bmax = Math.ceil(E.bldBurned / 500) * 500;
      const cur = E.series.reduce((b, p) => (p[0] <= t ? p : b), E.series[0]);
      return {
        title: L('People · buildings inside the burned area', 'Pessoas · edifícios dentro da área ardida'), meta: `${nf(t >= E.series[0][0] ? cur[1] : 0)} · ${nf(t >= E.series[0][0] ? cur[2] : 0)}`,
        cfg: { x: zoom ? X17zoom() : X17(), y: [0, pmax], yTicks: [0, pmax / 2, pmax], padL: 40, padR: 36, xTicks: zoom ? hourTicks() : dayTicks(), xFmt: fmtT, legend: !o.compact, spans: fireSpans(o.compact),
          y2: { range: [0, bmax], ticks: [0, bmax / 2, bmax], color: COL.dark, fmt: (v) => nf(v) },
          series: [{ pts: E.series.map((p) => [p[0], p[1]]), color: COL.violet, fill: 'rgba(122,75,214,A)', label: L('People (GHSL 2015)', 'Pessoas (GHSL 2015)'), fmt: (v) => nf(v), splitAt: t },
            { pts: E.series.map((p) => [p[0], p[2]]), color: COL.dark, width: 1.2, axis: 2, label: L('Buildings (OSM)', 'Edifícios (OSM)'), fmt: (v) => nf(v), splitAt: t }], cursor: t },
        insight: () => { const w = E.warning; const k = w.slice(0, 3).reduce((s2, x) => s2 + x.pop, 0);
          return L(`About ${nf(E.popBurned)} residents (GHSL 2015) and ${nf(E.bldBurned)} buildings (OSM) lay inside the final scar. ${nf(k)} people were reached less than 6 h after the first alert (${fmtHMm(E.alert)}); the deadliest villages were overtaken 5–6 h after it.`, `Cerca de ${nf(E.popBurned)} residentes (GHSL 2015) e ${nf(E.bldBurned)} edifícios (OSM) ficavam dentro da área ardida final. ${nf(k)} pessoas foram atingidas menos de 6 h depois do primeiro alerta (${fmtHMm(E.alert)}); as aldeias com mais vítimas foram apanhadas 5–6 h depois.`); },
      };
    },
  },
};
export const METRIC_IDS = ['area', 'growth', 'ros', 'exposure', 'weather', 'wind', 'hdw', 'fwi', 'firms', 'deaths'];
export function drawMetric(chart, id, opts = {}) {
  const m = METRICS[id]; if (!m || !A()) return null;
  const r = m.build(opts);
  if (opts.solid) r.cfg.series.forEach((s) => { delete s.splitAt; });
  chart.draw(r.cfg); return r;
}

// ------------------------------------------------------------------ HTML widgets
function kpis() {
  const a = A(), rc = app.real; const d17 = a.fwi.daily.find((d) => d.d === 17); const pk = a.ros.reduce((b, r) => ((r.p50 || 0) > (b.p50 || 0) ? r : b), a.ros[0]);
  const hi = a.severity.filter((s) => s.k === 'Moderate-high' || s.k === 'High').reduce((s, x) => s + x.ha, 0);
  return [
    { k: L('Burned area', 'Área ardida'), v: `${nf(a.totals.burnedHa)} ha`, s: L('ICNF 48,050 ha · IoU 0.91', 'ICNF 48 050 ha · IoU 0,91') },
    { k: L('Fatalities', 'Vítimas mortais'), v: '66', s: L(`${a.validation.nDead} geolocated · 30 on EN236-1`, `${a.validation.nDead} geolocalizadas · 30 na EN236-1`), red: true },
    { k: L('Peak growth', 'Crescimento máximo'), v: `${nf(a.peakGrowth.ha)} ha/h`, s: fmtT(a.peakGrowth.t) },
    { k: L('Peak spread', 'Propagação máxima'), v: `${nf(pk.p50 * 0.06, 1)} km/h`, s: L(`median front · ${fmtHMm(pk.t)}`, `frente mediana · ${fmtHMm(pk.t)}`) },
    { k: L('FWI 17 Jun', 'FWI 17 jun'), v: nf(d17.fwi, 1), s: `${fwiClass(d17.fwi)} · SGIF ${nf(34.8, 1)}` },
    { k: L('High severity', 'Severidade alta'), v: `${nf(100 * hi / a.totals.burnedHa)}%`, s: L('moderate-high + high dNBR', 'dNBR moderada-alta + alta') },
    ...(a.exposure ? [{ k: L('People in scar', 'Pessoas na área ardida'), v: nf(a.exposure.popBurned), s: L(`GHSL 2015 · ${nf(a.exposure.bldBurned)} buildings (OSM)`, `GHSL 2015 · ${nf(a.exposure.bldBurned)} edifícios (OSM)`) }] : []),
    ...(a.history ? [{ k: L('No fire since 1975', 'Sem fogo desde 1975'), v: `${nf(a.history.neverPct)}%`, s: L('of the 2017 scar (ICNF records)', 'da área de 2017 (registos ICNF)') }] : []),
  ];
}
const kpiHtml = (list) => `<div class="dk-grid">${list.map((k) => `<div class="dk${k.red ? ' red' : ''}"><small>${esc(k.k)}</small><b>${esc(k.v)}</b><span>${esc(k.s)}</span></div>`).join('')}</div>`;

function severityHtml() {
  const a = A(); const tot = a.severity.reduce((s, x) => s + x.ha, 0);
  return `<div class="sev-bar">${a.severity.map((s, i) => `<i style="flex:${s.ha};background:${SEV_COL[i]}" title="${esc(L(s.k, SEV_PT[s.k]))}: ${nf(s.ha)} ha"></i>`).join('')}</div>
    <div class="sev-leg">${a.severity.map((s, i) => `<span><i style="background:${SEV_COL[i]}"></i>${esc(L(s.k, SEV_PT[s.k]))} <b>${nf(100 * s.ha / tot)}%</b></span>`).join('')}</div>`;
}
function barsHtml(items, { value, label, sub, color = COL.fire, max, fmt = (v) => nf(v), onclick }) {
  const mx = max ?? Math.max(...items.map(value));
  return `<div class="hb">${items.map((it, i) => `<div class="hb-r${onclick ? ' click' : ''}" data-i="${i}"><span class="hb-l">${esc(label(it))}</span><span class="hb-t"><i style="width:${(100 * value(it) / mx).toFixed(1)}%;background:${typeof color === 'function' ? color(it) : color}"></i></span><b>${fmt(value(it))}</b>${sub ? `<em>${sub(it)}</em>` : ''}</div>`).join('')}</div>`;
}
function landcoverHtml(n = 6) {
  const a = A(); const items = a.landcover.filter((l) => l.ha > 0 && l.k !== 'Water' && l.k !== 'Wetlands').slice(0, n);
  return barsHtml(items, { value: (l) => l.ha, label: (l) => L(l.k, LC_PT[l.k]), fmt: (v) => `${nf(v)} ha`, sub: (l) => L(`${nf(l.pct)}% of class · ${nf(l.high)}% high sev.`, `${nf(l.pct)}% da classe · ${nf(l.high)}% sev. alta`), color: (l) => (l.k === 'Forest' ? COL.green : l.k === 'Shrubland' ? '#9a8a4a' : '#b9a68a') });
}
function muniHtml(n = 12) {
  const a = A(); const items = a.municipalities.filter((m) => m.ha >= 50).slice(0, n);
  return barsHtml(items, { value: (m) => m.ha, label: (m) => m.k, fmt: (v) => `${nf(v)} ha`, sub: (m) => `${L(`${nf(m.pctBurned)}% of area`, `${nf(m.pctBurned)}% do território`)}${m.dead ? ` · <b class="red">${m.dead} ${L('dead', 'mortos')}</b>` : ''}`, onclick: true });
}
function validationHtml(full) {
  const v = A().validation; const sites = v.sites.slice().sort((p, q) => q.n - p.n);
  const rows = (full ? sites : sites.filter((s) => !s.excluded).slice(0, 6));
  const mx = 45;
  return `<p class="dk-note">${L(`Fire reaches ${v.nSites} CTI fatality sites (${v.deadInSites} victims) on average <b>${nf(v.meanLeadMin)} min</b> before the recorded time of death (range ${nf(v.minLeadMin)} to ${nf(v.maxLeadMin)} min). A positive lead is the expected result: people were overtaken after the front arrived.`, `O fogo chega a ${v.nSites} locais de vítimas da CTI (${v.deadInSites} vítimas), em média <b>${nf(v.meanLeadMin)} min</b> antes da hora de morte registada (de ${nf(v.minLeadMin)} a ${nf(v.maxLeadMin)} min). Uma antecedência positiva é o resultado esperado: as pessoas foram apanhadas depois da chegada da frente.`)}</p>
    <table class="vt"><thead><tr><th>${L('Site', 'Local')}</th><th>${L('Victims', 'Vítimas')}</th><th>${L('Arrival', 'Chegada')}</th><th>${L('Death', 'Morte')}</th><th>${L('Lead', 'Antecedência')}</th></tr></thead><tbody>
    ${rows.map((s) => `<tr class="${s.excluded ? 'ex' : ''}"><td>${esc(s.k)}</td><td>${s.n}</td><td>${s.arrival !== null ? fmtHMm(s.arrival) : '—'}</td><td>${s.death >= 24 ? fmtT(s.death) : fmtHMm(s.death)}</td><td>${s.excluded ? `<span class="muted">${L('found later', 'encontrada depois')}</span>` : `<span class="lead"><i style="width:${clamp(Math.abs(s.leadMin) / mx * 100, 2, 100)}%;${s.leadMin < 0 ? 'background:#c9372c' : ''}"></i></span>${s.leadMin > 0 ? '+' : ''}${nf(s.leadMin)}′`}</td></tr>`).join('')}
    </tbody></table>`;
}
const FT_PT = { Broadleaved: 'Folhosas (sobretudo eucalipto)', Coniferous: 'Resinosas (sobretudo pinheiro-bravo)', 'No tree cover': 'Sem coberto arbóreo' };
const FT_EN = { Broadleaved: 'Broadleaved (mostly eucalyptus)', Coniferous: 'Coniferous (mostly maritime pine)', 'No tree cover': 'No tree cover' };
function forestTypeHtml() {
  const F = A().forestType; if (!F) return '';
  const bro = F.find((f) => f.k === 'Broadleaved'), con = F.find((f) => f.k === 'Coniferous');
  return `<table class="vt"><thead><tr><th>${L('Type (Copernicus 2015)', 'Tipo (Copernicus 2015)')}</th><th>${L('Burned', 'Ardido')}</th><th>${L('% of type', '% do tipo')}</th><th>${L('Severity', 'Severidade')}</th><th>${L('High', 'Alta')}</th></tr></thead><tbody>
    ${F.map((f) => { const tot = f.sev.reduce((s2, x) => s2 + x, 0) || 1; return `<tr><td>${esc(L(FT_EN[f.k], FT_PT[f.k]))}</td><td>${nf(f.ha)} ha</td><td>${nf(f.pct)}%</td><td><span class="sev-mini">${f.sev.map((v, i) => `<i style="flex:${v};background:${SEV_COL[i]}"></i>`).join('')}</span></td><td><b>${nf(f.high)}%</b></td></tr>`; }).join('')}
  </tbody></table>
  <p class="dk-note">${L(`Pine stands burned in a larger share (${nf(con.pct)}% of all coniferous cover in the area vs ${nf(bro.pct)}% of broadleaved), but once burning, both reached similar severity (${nf(con.high)}% vs ${nf(bro.high)}% high). In this fire, the weather mattered more than the tree species. Copernicus does not separate eucalyptus from other broadleaves; in this region most broadleaved cover is eucalyptus.`, `Os pinhais arderam numa proporção maior (${nf(con.pct)}% de todas as resinosas da área vs ${nf(bro.pct)}% das folhosas), mas, uma vez a arder, ambos atingiram severidade semelhante (${nf(con.high)}% vs ${nf(bro.high)}% alta). Neste incêndio, a meteorologia pesou mais do que a espécie. O Copernicus não separa o eucalipto das outras folhosas; nesta região a maior parte das folhosas é eucalipto.`)}</p>`;
}
const TSF_PT = { '< 5 years': '< 5 anos', '5–9 years': '5–9 anos', '10–19 years': '10–19 anos', '20–42 years': '20–42 anos', 'No fire since 1975': 'Sem fogo desde 1975' };
function historyHtml() {
  const Hh = A().history; if (!Hh) return '';
  const r = Hh.reburn; const k10 = Hh.tsf.find((x) => x.k === '10–19 years'), k5 = Hh.tsf.find((x) => x.k === '< 5 years');
  return `<small class="dk-cap" style="margin:2px 0 4px">${L('Time since the previous fire → share burned at high severity', 'Tempo desde o fogo anterior → fração com severidade alta')}</small>
    ${barsHtml(Hh.tsf, { value: (x) => x.high ?? 0, label: (x) => L(x.k, TSF_PT[x.k]), fmt: (v) => `${nf(v)}%`, max: 100, color: (x) => (x.k === '< 5 years' ? '#e3b06a' : COL.red), sub: (x) => `${nf(x.ha)} ha` })}
    <div class="dk-two2"><div><small class="dk-cap">${L('Fires on the same ground, 1975–2016', 'Fogos no mesmo local, 1975–2016')}</small>${barsHtml(Hh.recurrence, { value: (x) => x.ha, label: (x) => L(`${x.k} fire${x.k === '1' ? '' : 's'}`, `${x.k} fogo${x.k === '1' ? '' : 's'}`), fmt: (v) => `${nf(v)} ha`, color: '#b9a68a' })}</div></div>
    <p class="dk-note">${L(`Ground burned less than 5 years earlier had little fuel and burned less severely (${nf(k5.high)}% high) than ground left 10–19 years (${nf(k10.high)}%). ${nf(Hh.neverPct)}% of the scar had no recorded fire since 1975. Only ${nf(r.ha)} ha (${nf(r.pct, 1)}%) has burned again since 2017 (mostly in 2025).`, `Terreno ardido há menos de 5 anos tinha pouco combustível e ardeu com menos severidade (${nf(k5.high)}% alta) do que terreno com 10–19 anos sem arder (${nf(k10.high)}%). ${nf(Hh.neverPct)}% da área não tinha fogo registado desde 1975. Só ${nf(r.ha)} ha (${nf(r.pct, 1)}%) voltaram a arder desde 2017 (sobretudo em 2025).`)}</p>`;
}
function villageRows() {
  const E = A().exposure; const fat = app.real.record.cti?.fatalities || [];
  // each CTI fatality site counts once, for its nearest village (≤ 1.5 km)
  const dead = new Map();
  fat.forEach((f) => { let best = null, bd = 1500; E.villages.forEach((v) => { const d = Math.hypot(f.x - v.x, f.z - v.z); if (d < bd) { bd = d; best = v.k; } }); if (best) dead.set(best, (dead.get(best) || 0) + f.count); });
  const all = E.villages.filter((v) => v.warnH <= 12 && (v.pop1km >= 40 || dead.has(v.k))).map((v) => ({ ...v, dead: dead.get(v.k) || 0 }));
  // every village with victims, then the most populated ones, shown in order of fire arrival
  const pick = [...all.filter((v) => v.dead), ...all.filter((v) => !v.dead).sort((p, q) => q.pop1km - p.pop1km)].slice(0, 18);
  return pick.sort((p, q) => p.arr - q.arr);
}
function exposureHtml() {
  const E = A().exposure; if (!E) return '';
  const vill = villageRows();
  return `<div class="dk-two2"><div><small class="dk-cap">${L('Residents by time between the first alert and fire arrival', 'Residentes pelo tempo entre o primeiro alerta e a chegada do fogo')}</small>
    ${barsHtml(E.warning, { value: (x) => x.pop, label: (x) => x.k, fmt: (v) => nf(v), color: COL.violet, sub: (x) => L(`${nf(x.bld)} buildings`, `${nf(x.bld)} edifícios`) })}</div>
    <div><table class="vt"><thead><tr><th>${L('Village', 'Aldeia')}</th><th>${L('Fire arrives', 'Fogo chega')}</th><th>${L('After alert', 'Após alerta')}</th><th>${L('Pop. ≤ 1 km', 'Pop. ≤ 1 km')}</th><th>${L('Dead', 'Mortos')}</th></tr></thead><tbody>
    ${vill.map((v, i) => `<tr class="vrow click" data-i="${i}"><td>${esc(v.k)}</td><td>${fmtT(v.arr)}</td><td>${nf(v.warnH, 1)} h</td><td>${nf(v.pop1km)}</td><td>${v.dead ? `<b class="red">${v.dead}</b>` : '—'}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="dk-note">${L('Villages with victims plus the most populated ones (≥ 40 residents within 1 km) reached in the first 12 h. Population from the JRC GHSL 2015 grid (100 m); buildings from OpenStreetMap (mapped today, so they include post-2017 reconstruction). Times are counted from the first 112 alert (14:43); each CTI fatality site is counted for its nearest village. Click a village to fly to it.', 'Aldeias com vítimas e as mais populosas (≥ 40 residentes num raio de 1 km) atingidas nas primeiras 12 h. População da grelha GHSL 2015 do JRC (100 m); edifícios do OpenStreetMap (mapeados hoje, por isso incluem a reconstrução depois de 2017). Tempos contados a partir do primeiro alerta 112 (14:43); cada local de vítimas da CTI conta para a aldeia mais próxima. Clica numa aldeia para voar até lá.')}</p>`;
}
function wireVillages(root) {
  const E = A().exposure; if (!E) return;
  const vill = villageRows();
  root.querySelectorAll('tr.vrow').forEach((el) => el.addEventListener('click', () => { const v = vill[+el.dataset.i]; closeDashboard(); app.setTime(v.arr + 0.1); app.flyTo(v.x, v.z, 3800, app.state.dim === '2d' ? 0.0001 : 0.85, 0.3, 1.6); }));
}
function terrainHtml() {
  const a = A(); const e = a.terrain.elev.filter((b) => b.ha > 0);
  return `<div class="dk-two"><div><canvas class="rose" width="150" height="150"></canvas><small class="dk-cap">${L('Burned area by aspect', 'Área ardida por exposição')}</small></div>
    <div>${barsHtml(e, { value: (b) => b.pct, label: (b) => `${b.lo}–${b.hi} m`, fmt: (v) => `${nf(v)}%`, max: 100, color: COL.fire })}<small class="dk-cap">${L('Share of each elevation band that burned', 'Fração de cada classe de altitude que ardeu')}</small></div></div>
    <p class="dk-note">${L(`Mean slope inside the scar ${nf(a.terrain.meanSlopeBurned, 1)}°, mean elevation ${nf(a.terrain.meanElevBurned)} m. The fire burned across every aspect: wind and the downburst, not the terrain alone, set the direction.`, `Declive médio dentro da área ardida ${nf(a.terrain.meanSlopeBurned, 1)}°, altitude média ${nf(a.terrain.meanElevBurned)} m. O fogo ardeu em todas as exposições: foi o vento e o downburst, e não só o relevo, que definiram a direção.`)}</p>`;
}
function drawRose(cv) {
  const a = A(); const items = a.terrain.aspect; const mx = Math.max(...items.map((i) => i.ha));
  const dpr = Math.min(2, window.devicePixelRatio || 1); const S = 150; cv.width = S * dpr; cv.height = S * dpr; cv.style.width = cv.style.height = `${S}px`;
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); const cx = S / 2, cy = S / 2, R = 58;
  c.strokeStyle = '#e1dbd1'; [0.33, 0.66, 1].forEach((f) => { c.beginPath(); c.arc(cx, cy, R * f, 0, Math.PI * 2); c.stroke(); });
  items.forEach((it, i) => {
    const a0 = (i * 45 - 22.5 - 90) * Math.PI / 180, a1 = (i * 45 + 22.5 - 90) * Math.PI / 180, r = R * Math.sqrt(it.ha / mx);
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a0 + 0.03, a1 - 0.03); c.closePath(); c.fillStyle = 'rgba(208,97,62,0.78)'; c.fill();
    const am = (i * 45 - 90) * Math.PI / 180; c.fillStyle = '#6f675f'; c.font = '600 9.5px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lab = getLang() === 'pt' ? ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][i] : it.k; c.fillText(lab, cx + Math.cos(am) * (R + 10), cy + Math.sin(am) * (R + 10));
  });
}
function wireMuni(root) {
  const a = A();
  root.querySelectorAll('.hb-r.click, tr.mrow').forEach((el) => el.addEventListener('click', () => {
    const m = a.municipalities.filter((q) => q.ha >= 50)[+el.dataset.i]; const o = a.muniOutlines.find((q) => q.k === m.k); if (!o) return;
    let sx = 0, sz = 0, n = 0; o.rings.forEach((r) => r.forEach(([x, z]) => { sx += x; sz += z; n++; }));
    closeDashboard(); app.flyTo(sx / n, sz / n, 22000, app.state.dim === '2d' ? 0.0001 : 0.8, 0.2, 1.6);
    app.state.layers.munis && (app.state.layers.munis.on = true); app.applyLayers?.(); app.drawOverlay?.();
  }));
}

// ------------------------------------------------------------------ side-panel summary
export function sideAnalysisHtml() {
  if (!A()) return '';
  return `<div data-no-i18n class="dk-side">
    ${kpiHtml(kpis())}
    <button class="btn red dk-open" id="dkOpen">${L('Open analysis dashboard', 'Abrir painel de análise')}</button>
    <div class="an-sec"><h4>${L('Model validation', 'Validação do modelo')}</h4>${validationHtml(false)}</div>
    <div class="an-sec"><h4>${L('Burn severity (Sentinel-2 dNBR)', 'Severidade (dNBR Sentinel-2)')}</h4>${severityHtml()}</div>
    <div class="an-sec"><h4>${L('Burned area by municipality', 'Área ardida por concelho')}</h4>${muniHtml(8)}</div>
    <div class="an-sec"><h4>${L('Burned area by land cover (COS 2018)', 'Área ardida por uso do solo (COS 2018)')}</h4>${landcoverHtml(5)}</div>
    ${A().history ? `<div class="an-sec"><h4>${L('Fire history → severity', 'Histórico de fogo → severidade')}</h4>${barsHtml(A().history.tsf, { value: (x) => x.high ?? 0, label: (x) => L(x.k, TSF_PT[x.k]), fmt: (v) => `${nf(v)}%`, max: 100, color: COL.red, sub: (x) => L(`${nf(x.ha)} ha · share at high severity`, `${nf(x.ha)} ha · fração com severidade alta`) })}</div>` : ''}
  </div>`;
}
export function wireSideAnalysis(root) {
  const b = root.querySelector('#dkOpen'); if (b) b.onclick = openDashboard;
  wireMuni(root);
}

// ------------------------------------------------------------------ full-screen dashboard
let dashCharts = [];
const CARD_IDS = [['area', true], ['growth', true], ['ros', true], ['exposure', true], ['deaths', false], ['weather', true], ['wind', true], ['hdw', true], ['fwi', false]];
export function openDashboard() {
  if (!A()) return;
  let el = document.getElementById('dash');
  if (!el) { el = document.createElement('div'); el.id = 'dash'; el.setAttribute('data-no-i18n', ''); document.body.appendChild(el); }
  const zoomed = el.dataset.zoom === '1';
  el.innerHTML = `<div class="dash-in">
    <header class="dash-h"><div><h2>${L('Pedrógão Grande 2017 · data analysis', 'Pedrógão Grande 2017 · análise de dados')}</h2>
      <p>${L('Every figure below is derived from the datasets listed in Sources. Hover a chart to read values; click a time chart to move the map to that moment.', 'Todos os valores abaixo vêm dos conjuntos de dados listados nas Fontes. Passa o rato num gráfico para ler os valores; clica num gráfico temporal para levar o mapa a esse momento.')}</p></div>
      <div class="dash-act"><div class="seg dash-zoom"><button data-z="0" class="${zoomed ? '' : 'on'}">${L('17–22 Jun', '17–22 jun')}</button><button data-z="1" class="${zoomed ? 'on' : ''}">${L('First 24 h', 'Primeiras 24 h')}</button></div>
      <button class="btn" id="dashCsv">${L('Export data (JSON)', 'Exportar dados (JSON)')}</button><button class="dash-x" id="dashClose" title="${L('Close', 'Fechar')}">✕</button></div></header>
    ${kpiHtml(kpis())}
    <section class="dash-g">
      ${CARD_IDS.map(([id]) => `<article class="dc"><h3>${esc(METRICS[id].label())}</h3><canvas data-m="${id}"></canvas><p class="dc-i" data-i="${id}"></p></article>`).join('')}
      <article class="dc"><h3>${L('Burn severity', 'Severidade')}</h3>${severityHtml()}<p class="dk-note">${L(`Mean dNBR inside the scar ${nf(A().totals.meanDnbr, 2)}. Most of the area burned at moderate-high to high severity, consistent with crown fire in eucalyptus and pine.`, `dNBR médio dentro da área ardida ${nf(A().totals.meanDnbr, 2)}. A maior parte ardeu com severidade moderada-alta a alta, coerente com fogo de copas em eucalipto e pinheiro.`)}</p></article>
      <article class="dc"><h3>${L('Land cover burned (COS 2018)', 'Uso do solo ardido (COS 2018)')}</h3>${landcoverHtml(7)}<p class="dk-note">${(() => { const f = A().landcover.find((l) => l.k === 'Forest'); return L(`Forest made up ${nf(100 * f.ha / A().totals.burnedHa)}% of the burned area.`, `A floresta representou ${nf(100 * f.ha / A().totals.burnedHa)}% da área ardida.`); })()}</p></article>
      <article class="dc"><h3>${L('Terrain', 'Relevo')}</h3>${terrainHtml()}</article>
      <article class="dc wide2"><h3>${L('Exposure: people, buildings and warning time', 'Exposição: pessoas, edifícios e tempo de aviso')}</h3>${exposureHtml()}</article>
      <article class="dc"><h3>${L('Forest type and severity', 'Tipo de floresta e severidade')}</h3>${forestTypeHtml()}</article>
      <article class="dc"><h3>${L('Fire history (ICNF 1975–2025)', 'Histórico de fogo (ICNF 1975–2025)')}</h3>${historyHtml()}</article>
      <article class="dc"><h3>${METRICS.firms.label()}</h3><canvas data-m="firms"></canvas><p class="dc-i" data-i="firms"></p></article>
      <article class="dc wide2"><h3>${L('Municipalities', 'Concelhos')}</h3>${muniTable()}<p class="dk-note">${L('Click a municipality to fly to it. Fatalities are counted by CTI site location.', 'Clica num concelho para voar até lá. As vítimas são contadas pela localização dos locais da CTI.')}</p></article>
      <article class="dc wide2"><h3>${L('Validation against fatality sites (CTI)', 'Validação com os locais das vítimas (CTI)')}</h3>${validationHtml(true)}</article>
    </section>
    <footer class="dash-f">${L('Sources: ERA5 (Copernicus/ECMWF via Open-Meteo), Sentinel-2 L2A, Copernicus DEM GLO-30, DGT COS2018, OpenStreetMap, NASA FIRMS, ICNF, CTI 2017, ADAI/CEIF (Viegas et al. 2017; Ribeiro et al. 2020). Derived with tools/pedrogao/analysis.py.', 'Fontes: ERA5 (Copernicus/ECMWF via Open-Meteo), Sentinel-2 L2A, Copernicus DEM GLO-30, DGT COS2018, OpenStreetMap, NASA FIRMS, ICNF, CTI 2017, ADAI/CEIF (Viegas et al. 2017; Ribeiro et al. 2020). Calculado com tools/pedrogao/analysis.py.')}</footer>
  </div>`;
  el.classList.add('open'); document.body.classList.add('dash-open');
  dashCharts = [...el.querySelectorAll('canvas[data-m]')].map((cv) => {
    const ch = new Chart(cv); const id = cv.dataset.m;
    cv.addEventListener('click', () => { if (id === 'fwi') return; const v = ch.xToValue(ch.hoverPx ?? 0); app.setTime(clamp(v, 0, 144)); redrawDashboard(); });
    return { ch, id };
  });
  redrawDashboard();
  el.querySelectorAll('.dc-i').forEach((p) => { const m = METRICS[p.dataset.i].build({}); p.innerHTML = m.insight ? m.insight() : ''; });
  drawRose(el.querySelector('canvas.rose'));
  wireMuni(el); wireVillages(el);
  el.querySelector('#dashClose').onclick = closeDashboard;
  el.querySelectorAll('.dash-zoom button').forEach((b) => (b.onclick = () => { el.dataset.zoom = b.dataset.z; openDashboard(); }));
  el.querySelector('#dashCsv').onclick = () => {
    const blob = new Blob([JSON.stringify(A(), null, 1)], { type: 'application/json' });
    const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'rasto_pedrogao_analysis.json'; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 1000);
  };
}
function muniTable() {
  const a = A(); const items = a.municipalities.filter((m) => m.ha >= 50); const mx = Math.max(...items.map((m) => m.ha));
  const days = [17, 18, 19, 20, 21, 22];
  return `<table class="vt mt"><thead><tr><th>${L('Municipality', 'Concelho')}</th><th>${L('Burned', 'Ardido')}</th><th>${L('% of area', '% do território')}</th><th>${L('By day', 'Por dia')} <small>${days.join(' ')}</small></th><th>${L('Dead', 'Mortos')}</th></tr></thead><tbody>
    ${items.map((m, i) => { const dm = Math.max(...m.byDay, 1); return `<tr class="mrow click" data-i="${i}"><td>${esc(m.k)}</td><td><span class="lead"><i style="width:${(100 * m.ha / mx).toFixed(0)}%;background:${COL.fire}"></i></span>${nf(m.ha)} ha</td><td>${nf(m.pctBurned)}%</td><td><span class="spark">${m.byDay.map((v) => `<i style="height:${Math.max(1, 16 * v / dm).toFixed(1)}px" title="${nf(v)} ha"></i>`).join('')}</span></td><td>${m.dead ? `<b class="red">${m.dead}</b>` : '—'}</td></tr>`; }).join('')}
  </tbody></table>`;
}
export function redrawDashboard() {
  const el = document.getElementById('dash'); if (!el || !el.classList.contains('open')) return;
  const zoom = el.dataset.zoom === '1';
  dashCharts.forEach(({ ch, id }) => drawMetric(ch, id, { solid: true, zoom: zoom && (CARD_IDS.find((c) => c[0] === id) || [])[1] }));
}
export function closeDashboard() { const el = document.getElementById('dash'); if (el) el.classList.remove('open'); document.body.classList.remove('dash-open'); }
export const dashboardOpen = () => document.getElementById('dash')?.classList.contains('open');
