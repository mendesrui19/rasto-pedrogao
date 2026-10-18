// DOM side of the app: panels, timeline, feeds, menus, tooltips and chart configs.
import * as C from './core.js';
import { clamp, fmtTime, fmtHM, fmtDay, fmtInt, fmtLatLon, compassName, T, timeParts, lerp, geoInfo } from './util.js';
import { ic, hydrateIcons } from './icons.js';
import { getLang } from './i18n.js';
import { CAUSES } from './scenario.js';
import { KT, MPH, FT } from './units.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let D0 = C.T_AXIS0, D1 = C.T_END;
const R = () => app.real;
const MON = () => geoInfo().MONTH;
const pct = (t) => ((t - D0) / (D1 - D0)) * 100;

const LAYER_THUMBS = {
  terrain: 'linear-gradient(135deg,#5d6b3c,#8d8f5a 40%,#3f4a2a 60%,#a49a6a)',
  imagery: 'linear-gradient(135deg,#9d9a92,#c9c4b8 35%,#7e7a72 60%,#b4ae9f)',
  scar: 'radial-gradient(circle at 30% 40%,#8a2a14,#4a1a0e 45%,#7a3418 70%,#2e1209)',
  spread: 'radial-gradient(circle at 40% 60%,#ffd27a,#f59a2c 35%,#e3561c 70%,#c63b13)',
  ign: 'radial-gradient(circle at 50% 50%,#ffefe0 0 8%,#ff6d4a 20%,#e52f18 45%,#b51d0e)',
  wind: 'repeating-linear-gradient(160deg,#dfe8ee 0 3px,#bccfdb 3px 6px)',
  supp: 'linear-gradient(120deg,#c9b494,#c9b494 40%,#d8402e 40% 52%,#c9b494 52%)',
  structures: 'linear-gradient(135deg,#b9b4ac,#8c8780)',
  roads: 'linear-gradient(135deg,#ebe7e0,#d0cbc2)',
  admin: 'linear-gradient(135deg,#e6e2da,#cfcac0)',
};
const NO_SLIDER = ['supp', 'structures', 'roads', 'admin'];

let app, S;
export function init(a) {
  app = a; S = a.state; D0 = C.T_AXIS0; D1 = C.T_END;
  LAYER_THUMBS.cti = 'linear-gradient(135deg,#2a2520 0 45%,#d21e1e 45% 60%,#f1ede6 60%)';
  LAYER_THUMBS.hotspots = 'radial-gradient(circle at 35% 40%,#fff3a0 0 12%,#ffb238 28%,#e2401c 55%,#6b1a10)';
  if (R()) $('#tlRange').textContent = `${fmtTime(C.T_START)} – ${fmtTime(C.T_END)}`;
  buildTimeline();
  renderLayers();
  renderOverview();
  renderAnalysis();
  renderEvidence();
  renderNotes();
  renderDrones(app);
  renderResources(app);
  // tabs
  $$('#sideTabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#sideTabs button').forEach((q) => q.classList.toggle('on', q === b));
    $$('#sideIncident .tab-body').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${b.dataset.tab}`));
  }));
  $('#ovEdit').addEventListener('click', toggleOverviewEdit);
  $('#wxMenu').addEventListener('click', (e) => showMenu(e.currentTarget, [
    { header: 'Show conditions' },
    { label: 'At cursor', check: S.wxAt === 'cursor', action: () => { S.wxAt = 'cursor'; updateWeather(app); } },
    { label: 'At fire front', check: S.wxAt === 'front', action: () => { S.wxAt = 'front'; updateWeather(app); } },
    { label: 'At ignition point', check: S.wxAt === 'ign', action: () => { S.wxAt = 'ign'; updateWeather(app); } },
  ]));
  // top bar menus
  $$('[data-menu]').forEach((b) => b.addEventListener('click', (e) => openTopMenu(b.dataset.menu, e.currentTarget)));
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnCollapse').addEventListener('click', () => { document.body.classList.toggle('side-collapsed'); });
  // timeline controls
  $('#tlPlay').addEventListener('click', () => app.togglePlay(true));
  $('#tlPause').addEventListener('click', () => app.togglePlay(false));
  $('#tlStep').addEventListener('click', stepEvent);
  $('#tlSpeed').addEventListener('click', (e) => showMenu(e.currentTarget, [0.25, 0.5, 1, 2, 4, 8].map((s) => ({ label: `${s}×`, check: S.speed === s, action: () => { S.speed = s; $('#tlSpeed span').textContent = `${s}×`; } })), 'up'));
  // charts: click to scrub, menus
  app.charts.forEach((c, i) => {
    c.chart.canvas.addEventListener('pointerdown', (e) => {
      if (S.mode === 'drones') return;
      const r = c.chart.canvas.getBoundingClientRect();
      const scrub = (ev) => { const v = c.chart.xToValue(ev.clientX - r.left); if (S.mode === 'incident' && i === 2) return; app.setTime(v); };
      scrub(e);
      const mv = (ev) => scrub(ev); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    $('.ch-menu', c.el).addEventListener('click', (e) => showMenu(e.currentTarget, [
      { label: 'Export CSV', action: () => exportCsv(i) },
      { label: 'Copy current value', action: () => { navigator.clipboard?.writeText(c.meta.textContent || c.title.textContent); toast('Copied'); } },
      ...(S.mode === 'incident' && i === 2 ? [{ sep: true }, { label: 'Draw new profile path…', action: () => app.startMeasure('profile') }, { label: 'Reset to progression path', action: resetProfile }] : []),
    ]));
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu') && !e.target.closest('[data-menu]') && !e.target.closest('.ch-menu') && !e.target.closest('#zoomBtn') && !e.target.closest('#tlSpeed') && !e.target.closest('#wxMenu') && !e.target.closest('.feed-add')) closeMenus(); });
  hydrateIcons();
}
function resetProfile() { app.resetProfile(); }

// ------------------------------------------------------------------ timeline
let tlStep = 0;
export function layoutTimeline() {
  const w = $('#tlTrack').clientWidth;
  const span = D1 - D0; const step = w / span * 6 > 46 ? 6 : w / span * 12 > 46 ? 12 : w / span * 24 > 48 ? 24 : 48;
  if (step === tlStep) return; tlStep = step;
  const axis = $('#tlAxis'); axis.innerHTML = '';
  for (let t = D0; t <= D1 + 0.01; t += 6) {
    if ((t - D0) % step && timeParts(t).hh !== 0) continue;
    if (step >= 24 && timeParts(t).hh !== 0) continue;
    if (step === 48 && (t - D0) % 48 >= 24) continue;
    const p = timeParts(t);
    const day = p.hh === 0 || t === D0 ? `${MON()} ${p.day}` : '';
    const el = document.createElement('div'); el.className = 'tl-tick'; el.style.left = `${pct(t)}%`;
    el.innerHTML = step >= 24 ? `<b>${MON()} ${p.day}</b>` : `<b>${day}</b>${String(p.hh).padStart(2, '0')}:00`;
    axis.appendChild(el);
  }
}
function buildTimeline() {
  layoutTimeline();
  renderTimelineMarkers();
  const track = $('#tlTrack');
  const setFromX = (x) => { const r = track.getBoundingClientRect(); app.setTime(D0 + clamp((x - r.left) / r.width, 0, 1) * (D1 - D0)); };
  track.addEventListener('pointerdown', (e) => {
    setFromX(e.clientX); track.setPointerCapture(e.pointerId);
    const mv = (ev) => setFromX(ev.clientX);
    const up = () => { track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up);
  });
}
function renderTimelineMarkers() {
  const mk = $('#tlMarkers'); mk.innerHTML = '';
  const evs = app.events.concat(S.customEvents).filter((e) => e.marker !== false);
  evs.forEach((ev) => {
    const el = document.createElement('div');
    const cls = ev.icon === 'dot' ? 'dot' : ev.icon === 'fire' ? 'fire' : ev.icon === 'fatal' ? 'dot fatal' : 'tri';
    el.className = `tl-mk ${cls}`; el.style.left = `${pct(ev.t)}%`; el.title = `${ev.name} · ${fmtTime(ev.t)}`;
    if (ev.icon === 'fire') el.innerHTML = ic('flame');
    if (ev.custom) el.style.borderBottomColor = '#3a7bd5';
    mk.appendChild(el);
  });
  // activity band from rate of spread
  const f = app.fire; const mx = Math.max(...f.ros);
  const stops = [];
  for (let i = 0; i < f.times.length; i += 4) {
    const t = f.times[i]; const a = t < C.T_IGNITION ? 0 : 0.15 + 0.75 * (f.ros[i] / mx);
    stops.push(`rgba(222,96,70,${a.toFixed(2)}) ${pct(t).toFixed(1)}%`);
  }
  $('#tlBand').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
}
export function updateTimeline() {
  const p = pct(S.time);
  $('#tlThumb').style.left = `${p}%`; $('#tlFill').style.width = `${p}%`;
  $('#tlTip').textContent = fmtTime(S.time);
}
function stepEvent() {
  const evs = app.events.concat(S.customEvents).map((e) => e.t).sort((a, b) => a - b);
  const nxt = evs.find((t) => t > S.time + 0.01);
  const t = nxt ?? evs[0];
  app.setTime(t);
  const ev = app.events.concat(S.customEvents).find((e) => e.t === t);
  if (ev && ev.pos) focusEvent(ev);
}
function focusEvent(ev) {
  if (S.mode !== 'incident') return;
  const s = app.state.dim === '2d';
  app.flyTo(ev.pos.x, ev.pos.z, 40000 / (ev.zoom || 4), s ? 0.0001 : 0.95, s ? 0 : -0.15, 1.6);
}

// ------------------------------------------------------------------ feed (key events / detections / air ops)
export function renderFeed(a) {
  const title = $('#feedTitle'), act = $('#feedAction'), list = $('#feedList');
  if (S.mode === 'incident') {
    title.textContent = 'Key Events';
    act.innerHTML = '<button class="feed-add">+ Add</button>';
    $('.feed-add', act).onclick = (e) => addEventDialog();
    const evs = app.events.concat(S.customEvents).sort((p, q) => p.t - q.t);
    list.innerHTML = evs.map((ev, i) => `<div class="ev" data-i="${i}">
      <span class="ev-ic">${evIcon(ev)}</span><span>${esc(ev.name)}</span><span class="ev-t">${fmtTime(ev.t).replace(',', '')}</span></div>`).join('');
    $$('.ev', list).forEach((el) => el.addEventListener('click', () => { const ev = evs[+el.dataset.i]; app.setTime(ev.t); focusEvent(ev); }));
    renderFeedHighlight();
  } else if (S.mode === 'drones' && R()) {
    title.textContent = 'Satellite Detections';
    const hs = R().hotspots.filter((h) => h.t <= S.time + 0.01).sort((p, q) => q.t - p.t);
    act.innerHTML = `<span class="feed-count">${hs.length}</span>`;
    list.innerHTML = hs.slice(0, 80).map((h, i) => `<div class="det" data-i="${i}"><span class="dd" style="background:${S.time - h.t < 3 ? '#f5c518' : S.time - h.t < 12 ? '#f08a3c' : '#c9372c'}"></span><div class="db">${h.sat} · FRP ${h.frp.toFixed(1)} MW<small>${fmtLatLon(h.x, h.z, 1)}</small></div><span class="dt">${fmtDay(h.t).slice(4)} ${fmtHM(h.t)}</span></div>`).join('') || '<div class="muted" style="padding:6px 10px;font-size:11px">No satellite pass has detected fire yet (first VIIRS night pass: Jun 18, 03:05).</div>';
    $$('.det', list).forEach((el) => el.addEventListener('click', () => { const h = hs[+el.dataset.i]; app.flyTo(h.x, h.z, 6000, app.state.dim === '2d' ? 0.0001 : 0.9, undefined, 1.4); }));
  } else if (S.mode === 'resources' && R()) {
    title.textContent = 'Operations Log';
    const evs = R().record.events.filter((e) => ['resources', 'intl', 'road', 'evac', 'admin', 'alert'].includes(e.kind) && e.t <= S.time + 0.01).sort((p, q) => q.t - p.t);
    const live = S.airLog.map((d) => ({ name: `${d.id} · ${fmtInt(d.gal)} L de água (ilustrativo)`, t: null, time: d.time }));
    act.innerHTML = `<span class="feed-count">${evs.length}</span>`;
    list.innerHTML = live.concat(evs).slice(0, 80).map((e) => `<div class="det"><span class="sq" style="background:${e.kind === 'intl' ? '#3f6fd6' : e.kind === 'resources' ? '#c92a22' : e.kind === 'evac' ? '#e08a1c' : '#7a726a'}"></span><div class="db">${esc(e.name)}<small>${e.t !== null && e.t !== undefined ? fmtTime(e.t) : 'live'}</small></div><span class="dt">${e.t !== null && e.t !== undefined ? fmtHM(e.t) : e.time}</span></div>`).join('');
  } else if (S.mode === 'drones') {
    title.textContent = 'Detections';
    act.innerHTML = `<span class="feed-count">${S.detections.length}</span>`;
    list.innerHTML = S.detections.map((d, i) => `<div class="det" data-i="${i}"><span class="dd"></span><div class="db">Hot spot · ${d.temp} °C<small>${d.id} · ${fmtLatLon(d.x, d.z, 1)}</small></div><span class="dt">${d.time}</span></div>`).join('') || '<div class="muted" style="padding:6px 10px;font-size:11px">Scanning… detections from drone sensors appear here.</div>';
    $$('.det', list).forEach((el) => el.addEventListener('click', () => { const d = S.detections[+el.dataset.i]; app.selectDrone(d.id); }));
  } else {
    title.textContent = 'Air Ops Log';
    const rows = airLogRows();
    act.innerHTML = `<span class="feed-count">${rows.length}</span>`;
    list.innerHTML = rows.slice(0, 80).map((d, i) => `<div class="det" data-i="${i}"><span class="sq" style="background:${d.kind === 'water' ? '#3f86d6' : '#c92a22'}"></span><div class="db">${d.id} · ${fmtInt(d.gal)} gal ${d.kind}<small>Div. ${d.div} · ${fmtLatLon(d.x, d.z, 1)}</small></div><span class="dt">${d.time}</span></div>`).join('');
    $$('.det', list).forEach((el) => el.addEventListener('click', () => { const d = rows[+el.dataset.i]; app.flyTo(d.x, d.z, 3500, app.state.dim === '2d' ? 0.0001 : 0.9, undefined, 1.4); }));
  }
}
function airLogRows() {
  const hist = app.drops.filter((d) => !d.live && d.t <= S.time).map((d) => ({ id: d.id, gal: d.gal, kind: d.kind, div: d.div, x: d.cx, z: d.cz, time: fmtHM(d.t), t: d.t })).reverse();
  return (S.time >= C.T_CONTAIN - 0.01 ? S.airLog : []).concat(hist);
}
function evIcon(ev) {
  if (ev.icon === 'dot') return '<svg viewBox="0 0 12 12" width="12"><circle cx="6" cy="6" r="5" fill="#d63a2a"/></svg>';
  if (ev.icon === 'fire') return ic('flame');
  if (ev.icon === 'tri') return '<svg viewBox="0 0 12 12" width="12"><path d="M6 1.5 11 10.5H1z" fill="#c98a3a" stroke="#9a6524" stroke-width=".8"/></svg>';
  if (ev.icon === 'hourglass') return '<svg viewBox="0 0 12 12" width="12"><path d="M2.5 1.5h7M2.5 10.5h7M3.5 1.5c0 3 5 3 5 4.5s-5 1.5-5 4.5M8.5 1.5c0 3-5 3-5 4.5s5 1.5 5 4.5" fill="none" stroke="#8c857b" stroke-width="1.2"/></svg>';
  if (ev.icon === 'fatal') return '<svg viewBox="0 0 12 12" width="12"><path d="M6 1v10M2.5 4h7" stroke="#2a2520" stroke-width="2"/></svg>';
  if (ev.icon === 'weather') return '<svg viewBox="0 0 12 12" width="12"><path d="M3 8a2.5 2.5 0 0 1 .5-5 3 3 0 0 1 5.5 1 2 2 0 0 1 0 4z" fill="#8aa0b4"/><path d="M6 8 5 11l2-2" stroke="#e8b923" stroke-width="1.2" fill="none"/></svg>';
  if (ev.icon === 'res') return '<svg viewBox="0 0 12 12" width="12"><rect x="1" y="4" width="7" height="5" fill="#c92a22"/><rect x="8" y="5.5" width="3" height="3.5" fill="#c92a22"/></svg>';
  if (ev.icon === 'intl') return '<svg viewBox="0 0 12 12" width="12"><circle cx="6" cy="6" r="5" fill="#2b4fa8"/><circle cx="6" cy="6" r="3" fill="none" stroke="#f5d33a" stroke-dasharray="1 1.4"/></svg>';
  if (ev.icon === 'road') return '<svg viewBox="0 0 12 12" width="12"><path d="M4 1 2 11M8 1l2 10M6 2v2M6 6v2" stroke="#6a625a" stroke-width="1.3"/></svg>';
  if (ev.icon === 'evac') return '<svg viewBox="0 0 12 12" width="12"><path d="M6 1 11 10H1z" fill="#e08a1c"/></svg>';
  if (ev.icon === 'square') return '<svg viewBox="0 0 12 12" width="12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="#7ea2d6" stroke="#4d73a8"/></svg>';
  return '<svg viewBox="0 0 12 12" width="12"><circle cx="6" cy="6" r="4.5" fill="#3a7bd5"/></svg>';
}
export function renderFeedHighlight() {
  if (S.mode === 'incident') {
    const evs = app.events.concat(S.customEvents).sort((p, q) => p.t - q.t);
    let cur = -1; evs.forEach((e, i) => { if (e.t <= S.time + 1e-6) cur = i; });
    $$('#feedList .ev').forEach((el, i) => { el.classList.toggle('cur', i === cur); el.classList.toggle('future', evs[i].t > S.time + 1e-6); });
  } else if (S.mode === 'resources' && R()) {
    renderFeed(app);
  } else if (S.mode === 'drones' && R()) {
    const n = R().hotspots.filter((h) => h.t <= S.time + 0.01).length; const badge = $('#feedAction .feed-count');
    if (!badge || +badge.textContent !== n) renderFeed(app);
  } else if (S.mode === 'resources') {
    // log changes with time (historic rows)
    const n = airLogRows().length; const badge = $('#feedAction .feed-count');
    if (badge && +badge.textContent !== n) renderFeed(app);
  }
}
function addEventDialog() {
  modal(`<h3>Add key event</h3>
    <div class="row"><span>Time</span><b>${fmtTime(S.time)}</b></div>
    <div class="row"><span>Name</span><input id="evName" style="flex:1;margin-left:16px;padding:6px 8px;border:1px solid #d8d1c4;border-radius:5px;font:inherit" placeholder="e.g. Wind shift"/></div>
    <div class="row"><span>Location</span><span class="muted">${S.hover ? fmtLatLon(S.hover.x, S.hover.z) : 'Current view centre'}</span></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn red" id="evOk">Add event</button></div>`);
  const inp = $('#evName'); inp.focus();
  const ok = () => {
    const name = inp.value.trim() || 'Observation';
    const t = app.controls.target;
    S.customEvents.push({ id: `c${Date.now()}`, name, t: S.time, icon: 'custom', custom: true, pos: S.hover ? { ...S.hover } : { x: t.x, z: t.z }, zoom: 5 });
    closeModal(); renderTimelineMarkers(); renderFeed(app); toast(`Event added · ${fmtTime(S.time)}`);
  };
  $('#evOk').onclick = ok; inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
}

// ------------------------------------------------------------------ layers
function renderLayers() {
  const host = $('#tab-layers');
  host.innerHTML = Object.entries(S.layers).map(([k, L]) => `
    <div class="layer ${L.on ? '' : 'off'}" data-k="${k}">
      <span class="chk ${L.on ? 'on' : ''}"></span>
      <span class="lthumb" style="background:${LAYER_THUMBS[k]}"></span>
      <span class="lname">${L.name}</span>
      ${NO_SLIDER.includes(k) ? '' : `<span class="lslider"><i style="width:${L.op * 100}%"></i><b style="left:${L.op * 100}%"></b></span><span class="lpct">${Math.round(L.op * 100)}%</span>`}
    </div>`).join('');
  $$('.layer', host).forEach((row) => {
    const k = row.dataset.k;
    const toggle = () => { S.layers[k].on = !S.layers[k].on; renderLayers(); app.applyLayers(); };
    $('.chk', row).addEventListener('click', toggle);
    $('.lname', row).addEventListener('click', toggle);
    $('.lthumb', row).addEventListener('click', toggle);
    const sl = $('.lslider', row);
    if (sl) sl.addEventListener('pointerdown', (e) => {
      const set = (ev) => {
        const r = sl.getBoundingClientRect(); const v = clamp((ev.clientX - r.left) / r.width, 0, 1);
        S.layers[k].op = Math.round(v * 20) / 20; S.layers[k].on = true;
        $('i', sl).style.width = `${S.layers[k].op * 100}%`; $('b', sl).style.left = `${S.layers[k].op * 100}%`;
        $('.lpct', row).textContent = `${Math.round(S.layers[k].op * 100)}%`;
        row.classList.remove('off'); $('.chk', row).classList.add('on');
        app.applyLayers();
      };
      set(e); sl.setPointerCapture(e.pointerId);
      const up = () => { sl.removeEventListener('pointermove', set); sl.removeEventListener('pointerup', up); };
      sl.addEventListener('pointermove', set); sl.addEventListener('pointerup', up);
    });
  });
}

// ------------------------------------------------------------------ overview
const overviewData = () => R() ? [
  ['Incident', 'Pedrógão Grande + Góis'],
  ['SGIF IDs', 'BL4171577 · BL217377'],
  ['Location', 'Leiria / Coimbra, Portugal'],
  ['Ignition', 'Jun 17, 2017 14:43 · 14:48 (+ Regadas 16:15)'],
  ['Extinction', 'Jun 22, 2017 09:22 · 19:30'],
  ['Burned Area', `${fmtInt(30618 + 17432)} ha (ICNF) · ${fmtInt(R().meta.burnedHa)} ha (S2)`],
  ['Cause', 'Power line (PG) · lightning (Góis)'],
  ['Fatalities', '66 (62 while fleeing, 30 on EN236-1)'],
  ['Buildings', `${fmtInt(R().meta.structures.surveyed)} damaged · ${R().meta.structures.heavyOrDestroyed} heavy/destroyed`],
] : [
  ['Incident Name', 'Ridgeview Incident'],
  ['Incident ID', 'CA-LAC-2024-0176'],
  ['Location', 'San Gabriel Mountains, CA'],
  ['Start (Est.)', 'Aug 14, 2024 14:26'],
  ['End', 'Aug 18, 2024 11:20'],
  ['Total Acres', `${fmtInt(Math.round(app.fire.finalAcres / 10) * 10)} acres`],
  ['Cause (Prelim.)', 'Under Investigation'],
  ['Analysis Status', '<span class="status-dot"></span>In Progress'],
];
let ovEditing = false, ovValues = null;
function renderOverview() {
  const vals = ovValues || overviewData();
  $('#overview').innerHTML = vals.map(([k, v], i) => `<span>${k}</span><span data-i="${i}" ${ovEditing && i !== 7 ? 'contenteditable="true"' : ''}>${v}</span>`).join('');
}
function toggleOverviewEdit() {
  if (ovEditing) {
    const vals = ovValues || overviewData();
    $$('#overview [data-i]').forEach((el) => { const i = +el.dataset.i; if (i !== 7) vals[i][1] = esc(el.textContent.trim()); });
    ovValues = vals; toast('Incident overview saved');
  }
  ovEditing = !ovEditing; $('#ovEdit').textContent = ovEditing ? 'Save' : 'Edit';
  renderOverview();
  if (ovEditing) $('#overview [contenteditable]')?.focus();
}

// ------------------------------------------------------------------ weather
export function updateWeather() {
  let x, z, where;
  if (S.wxAt === 'cursor' && S.hover) { x = S.hover.x; z = S.hover.z; where = '(at cursor)'; }
  else if (S.wxAt === 'ign') { x = C.PLACES.ignition.x; z = C.PLACES.ignition.z; where = '(at ignition)'; }
  else { const h = app.fire.sampleSeries('head', Math.max(S.time, C.T_IGNITION)); x = h.x; z = h.z; where = '(at fire front)'; }
  const elev = app.terrain.elev(x, z);
  const w = C.weatherAt(S.time, elev, x, z);
  const arr = app.fire.arrivalAt(x, z);
  const fuel = app.terrain.fuel(x, z);
  let flame;
  const dt = S.time - arr;
  const real = !!R();
  if (arr < C.UNBURNED && dt > 1.2) flame = 'Burned out';
  else {
    const base = [[4, 8], [12, 19], [18, 34], [0, 0]][fuel];
    const k = 0.45 + 0.75 * C.diurnal(S.time) * (S.time < 80 ? 1 : 0.5);
    flame = fuel === 3 ? '—' : real ? `${Math.round(base[0] * k * 0.3048 * (1 + (w.windSpd || 0) / 40))}–${Math.round(base[1] * k * 0.3048 * (1 + (w.windSpd || 0) / 40))} m` : `${Math.round(base[0] * k)}–${Math.round(base[1] * k)} ft`;
  }
  $('#wxWhere').textContent = where;
  const dir = Math.round(((w.windDir % 360) + 360) % 360);
  $('#wx').innerHTML = `
    <div class="wx-i">${ic('wind')}<div><small>Wind</small><b>${Math.round(w.windSpd)} ${real ? 'km/h' : 'mph'}</b><span>${compassName(dir)} (${dir}°)${w.downburst > 0.2 ? ' · <b style="color:#c9372c;display:inline">downburst</b>' : real && w.gust ? ` · gust ${Math.round(w.gust)}` : ''}</span></div></div>
    <div class="wx-i">${ic('thermo')}<div><small>Temp</small><b>${Math.round(w.temp)} °C</b></div></div>
    <div class="wx-i">${ic('drop')}<div><small>RH</small><b>${Math.round(w.rh)}%</b></div></div>
    <div class="wx-i">${ic('leaf')}<div><small>Fuel Moisture</small><b>${Math.round(w.fm)}%</b></div></div>
    <div class="wx-i">${ic('flame')}<div><small>${real ? 'FWI (SGIF)' : 'ERC'}</small><b>${w.erc ?? '—'}</b></div></div>
    <div class="wx-i">${ic('flen')}<div><small>Flame Length</small><b>${flame}</b></div></div>`;
}

// ------------------------------------------------------------------ hover tooltip
const FUEL_NAMES = ['Annual grass, light', 'Chaparral, moderate', 'Mixed conifer, heavy', 'Open water'];
const FUEL_NAMES_PT = ['Agriculture / pasture', 'Shrubland (matos)', 'Forest (eucalyptus / maritime pine)', 'Water / bare / built-up'];
const COS_NAMES = { 1: 'Territórios artificializados', 2: 'Agricultura', 3: 'Pastagens', 4: 'Superfícies agroflorestais', 5: 'Florestas', 6: 'Matos', 7: 'Espaços descobertos', 8: 'Zonas húmidas', 9: 'Massas de água' };
const SEV = (d) => (d < 0.1 ? 'Unburned' : d < 0.27 ? 'Low severity' : d < 0.44 ? 'Moderate-low' : d < 0.66 ? 'Moderate-high' : 'High severity');
export function showTooltip(a, cx, cy, x, z) {
  const t = app.terrain; const tt = $('#tooltip');
  const elev = t.elev(x, z), slope = t.slopeDeg(x, z), asp = t.aspectDeg(x, z);
  const arr = app.fire.arrivalAt(x, z); const inside = arr < C.UNBURNED;
  const fuel = t.fuel(x, z);
  const el = S.metric ? `${fmtInt(elev)} m` : `${fmtInt(elev / FT)} ft`;
  let fireLine = inside ? `<span class="tt-in"><i class="in"></i>Inside the final perimeter</span>` : `<span class="tt-in"><i></i>Outside the final perimeter</span>`;
  if (inside) fireLine += `<div class="tt-f">${arr <= S.time ? 'Burned' : 'Burns'} ${fmtTime(arr)}${arr <= S.time && S.time - arr < 1 ? ' · <b style="color:#ff9a62">active</b>' : ''}</div>`;
  let extra = '';
  if (R()) {
    const n = R().dnbrN; const i = clamp(Math.floor((x + C.HALF) / C.SIZE * n), 0, n - 1), j = clamp(Math.floor((z + C.HALF) / C.SIZE * n), 0, n - 1);
    const dn = R().dnbr[j * n + i] / 255;
    const cs = R().cos ? R().cos[clamp(Math.floor((z + C.HALF) / C.SIZE * C.FN), 0, C.FN - 1) * C.FN + clamp(Math.floor((x + C.HALF) / C.SIZE * C.FN), 0, C.FN - 1)] : null;
    extra = `${cs ? `<div class="tt-f">COS 2018: ${COS_NAMES[cs] || '—'}</div>` : ''}<div class="tt-f">dNBR ${dn.toFixed(2)} · ${SEV(dn)}</div>`;
  }
  tt.innerHTML = `<b>${el}</b> · ${Math.round(slope)}° slope · ${compassName(asp)}-facing<br>${fireLine}<div class="tt-f">${(R() ? FUEL_NAMES_PT : FUEL_NAMES)[fuel]}</div>${extra}<div class="tt-ll">${fmtLatLon(x, z)}</div>`;
  const r = $('#viewport').getBoundingClientRect();
  let px = cx - r.left + 16, py = cy - r.top + 14;
  tt.classList.remove('hidden');
  const w = tt.offsetWidth, h = tt.offsetHeight;
  if (px + w > r.width - 8) px = cx - r.left - w - 12;
  if (py + h > r.height - 8) py = cy - r.top - h - 12;
  tt.style.left = `${px}px`; tt.style.top = `${py}px`;
}

// ------------------------------------------------------------------ analysis / evidence / notes
function renderAnalysis() {
  if (R()) return renderAnalysisReal();
  const f = app.fire;
  const maxRos = Math.max(...f.ros); const iMax = f.ros.indexOf(maxRos);
  let maxGrowth = 0, gT = 0; for (let i = 2; i < f.area.length; i++) { const g = f.area[i] - f.area[i - 2]; if (g > maxGrowth) { maxGrowth = g; gT = f.times[i]; } }
  $('#tab-analysis').innerHTML = `
    <div class="an-sec"><h4>Origin determination</h4>
      <div class="an-row"><span>Ignition (est.)</span><b>Aug 14, 14:26 ± 12 min</b></div>
      <div class="an-row"><span>Area of origin</span><span>${fmtLatLon(C.PLACES.ignition.x, C.PLACES.ignition.z)}</span></div>
      <div class="an-row"><span>Confidence</span><b>82%</b></div><div class="conf"><i style="width:82%"></i></div>
      <div class="an-row"><span>Indicators</span><span>Char depth, angle of char, protection</span></div>
      <div class="btnrow"><button class="btn red" id="anOrigin">${ic('target')}Fly to origin</button><button class="btn" id="anProfile">${ic('route')}Profile path</button></div>
    </div>
    <div class="an-sec"><h4>Fire behavior</h4>
      <div class="an-row"><span>Final area</span><b>${fmtInt(f.finalAcres)} acres</b></div>
      <div class="an-row"><span>Peak rate of spread</span><b>${Math.round(maxRos)} ch/hr · ${fmtTime(f.times[iMax])}</b></div>
      <div class="an-row"><span>Max growth (1 h)</span><b>${fmtInt(maxGrowth)} acres · ${fmtHM(gT)}</b></div>
      <div class="an-row"><span>Spot fire</span><span>${fmtTime(C.T_SPOT)} · ~0.9 km ahead</span></div>
      <div class="an-row"><span>Primary driver</span><span>SW wind + upslope alignment</span></div>
      <div class="btnrow"><button class="btn dark" id="anRerun">${ic('refresh')}Re-run spread model</button></div>
    </div>
    <div class="an-sec"><h4>Cause hypotheses</h4>
      ${CAUSES.map((c) => `<div class="an-row"><span>${c.name}</span><b>${Math.round(c.p * 100)}%</b></div><div class="conf"><i style="width:${c.p * 100}%"></i></div>`).join('')}
    </div>`;
  $('#anOrigin').onclick = () => { app.setTime(C.T_IGNITION + 0.4); app.flyTo(C.PLACES.ignition.x, C.PLACES.ignition.z, 2600, S.dim === '2d' ? 0.0001 : 0.9, S.dim === '2d' ? 0 : -0.3, 1.8); };
  $('#anProfile').onclick = () => app.startMeasure('profile');
  $('#anRerun').onclick = rerunDialog;
}
function rerunDialog() {
  modal(`<h3>Re-run spread model</h3>
    <div class="row"><span>Rate-of-spread factor</span><span><input type="range" id="rrRos" min="0.25" max="0.8" step="0.01" value="0.46"/> <b id="rrRosV">0.46</b></span></div>
    <div class="row"><span>Wind influence</span><span><input type="range" id="rrWind" min="0.5" max="1.6" step="0.05" value="1"/> <b id="rrWindV">1.00</b></span></div>
    <div class="row"><span>Wind ellipse eccentricity</span><span><input type="range" id="rrEcc" min="0.7" max="0.97" step="0.01" value="0.93"/> <b id="rrEccV">0.93</b></span></div>
    <p class="muted" style="font-size:11px;margin:8px 0 0">Recomputes arrival times with a time-varying Dijkstra spread over the terrain (fuel, slope, diurnal weather), then redraws the burn, perimeter, charts and events.</p>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn red" id="rrOk">Run model</button></div>`);
  [['rrRos', 2], ['rrWind', 2], ['rrEcc', 2]].forEach(([id, d]) => { const el = $(`#${id}`); el.oninput = () => ($(`#${id}V`).textContent = (+el.value).toFixed(d)); });
  $('#rrOk').onclick = () => {
    const opts = { rosScale: +$('#rrRos').value, windScale: +$('#rrWind').value, ecc: +$('#rrEcc').value };
    closeModal(); toast('Running spread model…');
    setTimeout(() => app.rerunModel(opts), 30);
  };
}
function renderAnalysisReal() {
  const rc = R(); const f = app.fire;
  const maxG = Math.max(...f.ros); const iG = f.ros.indexOf(maxG);
  const at = (t) => fmtInt(f.sampleSeries('area', t));
  $('#tab-analysis').innerHTML = `
    <div class="an-sec"><h4>Ignitions (SGIF / ICNF)</h4>
      ${rc.meta.ignitions.map((g) => `<div class="an-row"><span>${g.concelho} · ${g.name}</span><b>${fmtHM(g.t)} · alerta ${fmtHM(g.alert)}</b></div><div class="an-row"><span>Cause</span><span>${g.cause}</span></div><div class="an-row"><span>Area (SGIF)</span><span>${fmtInt(g.area)} ha</span></div>`).join('')}
      <div class="btnrow"><button class="btn red" id="anOrigin">${ic('target')}Fly to Escalos Fundeiros</button><button class="btn" id="anEN">${ic('route')}EN236-1</button></div>
    </div>
    <div class="an-sec"><h4>Reconstructed progression</h4>
      <div class="an-row"><span>Burned by Jun 17, 20:00</span><b>${at(T(17, 20))} ha</b></div>
      <div class="an-row"><span>Burned by Jun 18, 00:00</span><b>${at(T(18, 0))} ha</b></div>
      <div class="an-row"><span>Burned by Jun 18, 12:00</span><b>${at(T(18, 12))} ha</b></div>
      <div class="an-row"><span>Burned by Jun 19, 12:00</span><b>${at(T(19, 12))} ha</b></div>
      <div class="an-row"><span>Peak growth</span><b>${fmtInt(maxG)} ha/h · ${fmtTime(f.times[iG])}</b></div>
      <div class="an-row"><span>Final burn scar (Sentinel-2)</span><b>${fmtInt(rc.meta.burnedHa)} ha</b></div>
      <div class="an-row"><span>Official area (SGIF, 2 fires)</span><b>${fmtInt(rc.meta.sgifHa)} ha</b></div>
      <div class="an-row"><span>Official perimeter (ICNF, WFS)</span><b>48,050 ha · IoU 0.91 vs S2</b></div>
      <div class="an-row"><span>Burned on 17–18 Jun (ADAI)</span><b>97.6%</b></div>
      <p class="muted" style="font-size:10.5px;margin:6px 0 0;line-height:1.45">Progression digitized from the official ADAI/CEIF isochrone map (Ribeiro et al. 2020, Fig. 1: 15 classes, 17 Jun 16:00 → 21 Jun 23:59), aligned to the Sentinel-2 burn scar (IoU ${rc.meta.progressionSource?.iou ?? '—'}), interpolated by distance inside each band and fused with satellite detections as upper bounds (95% of detections time-consistent). Validation: fire reaches the CTI fatality sites 0–40 min before the recorded deaths; 19:30–20:30 growth ≈ 3,960 ha (ADAI: ~3,800 ha). Burned area = Sentinel-2 dNBR &gt; 0.22 (14 Jun → 8 Aug 2017). ${fmtInt(rc.hotspots.length)} VIIRS/MODIS detections shown as an independent check.</p>
    </div>
    <div class="an-sec"><h4>Buildings (ADAI field survey)</h4>
      ${Object.entries(rc.meta.structures.byMunicipality).map(([k, v]) => `<div class="an-row"><span>${k}</span><b>${v}</b></div>`).join('')}
      <div class="an-row"><span>Heavily damaged / destroyed</span><b>${rc.meta.structures.heavyOrDestroyed} of ${rc.meta.structures.surveyed}</b></div>
      <div class="an-row"><span>Fire arrival 18:30–20:30</span><b>${rc.meta.structures.arrival_18_30_20_30[0]} of ${rc.meta.structures.arrival_18_30_20_30[1]} answers</b></div>
    </div>
    <div class="an-sec"><h4>Pyro-meteorology</h4>
      <div class="an-row"><span>ERA5 at 15:00 (17 Jun)</span><span>${rc.meta.weather.find((w) => w.t === 15).temp} °C · RH ${rc.meta.weather.find((w) => w.t === 15).rh}%</span></div>
      <div class="an-row"><span>FWI / ISI (SGIF)</span><span>34.8 / 12.1 · FFMC 94.5</span></div>
      <div class="an-row"><span>Dry thunderstorm (IPMA)</span><span>14:30–16:00 · 277 discharges</span></div>
      <div class="an-row"><span>Downburst</span><span>~18:00 (ADAI) · 100–130 km/h (court)</span></div>
      <div class="an-row"><span>Junction fire Escalos + Regadas</span><span>~19:30</span></div>
    </div>
    ${rc.record.cti ? `<div class="an-sec"><h4>CTI 2017 — key findings</h4>
      ${Object.entries({ 'Dominated': rc.record.cti.facts.dominated, 'No aircraft': rc.record.cti.facts.noAir, 'Fatalities': rc.record.cti.facts.fatalityWindow, 'Causes of death': rc.record.cti.facts.causes, 'Vehicles': rc.record.cti.facts.inCars, 'International': rc.record.cti.facts.international, 'Entities': `${rc.record.cti.facts.entities} entities · ${rc.record.cti.facts.fireBrigades} fire brigades` }).map(([k, v]) => `<div class="an-row" style="gap:10px"><span>${k}</span><span style="text-align:right">${v}</span></div>`).join('')}
      <h4 style="margin-top:8px">Incident commanders (COS)</h4>
      ${rc.record.cti.cos.map(([t, n]) => `<div class="an-row"><span>${fmtTime(t)}</span><span>${n}</span></div>`).join('')}</div>` : ''}
    ${rc.record.military ? `<div class="an-sec"><h4>Armed forces (ADAI report)</h4>
      <div class="an-row"><span>Navy</span><span>${rc.record.military.navy}</span></div>
      <div class="an-row"><span>Dozers</span><span>Army ${rc.record.military.army_dozers} · Air Force ${rc.record.military.airforce_dozers}</span></div>
      <div class="an-row"><span>Air Force flight hours</span><span>${rc.record.military.flight_hours}</span></div>
      <div class="an-row"><span>Meals served</span><span>${fmtInt(rc.record.military.meals)}</span></div></div>` : ''}
    <div class="an-sec"><h4>Data sources</h4>
      ${rc.record.sources.map((s2) => `<div class="an-row" style="display:block"><a href="${s2.url.startsWith('http') ? s2.url : '#'}" target="_blank" rel="noopener" style="color:var(--text)">${esc(s2.name)}</a></div>`).join('')}
    </div>`;
  $('#anOrigin').onclick = () => { const g = rc.meta.ignitions[0]; app.setTime(g.t + 0.5); app.flyTo(g.x, g.z, 4000, S.dim === '2d' ? 0.0001 : 0.9, S.dim === '2d' ? 0 : -0.3, 1.8); };
  $('#anEN').onclick = () => { const p = C.PLACES.en2361; app.setTime(T(17, 19, 5)); app.flyTo(p.x, p.z, 3500, S.dim === '2d' ? 0.0001 : 0.85, S.dim === '2d' ? 0 : 0.5, 1.8); };
}
export function renderEvidence() {
  const host = $('#tab-evidence');
  host.innerHTML = `${S.evidence.map((e, i) => `<div class="ev-card" data-i="${i}"><span class="ev-thumb" style="background-image:${e.thumb};background:${e.thumb.startsWith('url') ? '' : e.thumb};${e.thumb.startsWith('url') ? `background-image:${e.thumb}` : ''}"></span><div><b>${esc(e.title)}</b><small>${esc(e.meta)}</small><span class="tag">${e.id} · ${e.tag}</span></div></div>`).join('')}
    <button class="small-btn" id="evAdd">+ Add evidence</button>`;
  $$('.ev-card', host).forEach((el) => el.addEventListener('click', () => {
    const e = S.evidence[+el.dataset.i];
    modal(`<h3>${esc(e.title)}</h3>${e.img ? `<img src="${e.img}" style="width:100%;border-radius:6px;margin-bottom:8px"/>` : `<div style="height:140px;border-radius:6px;background:${e.thumb};margin-bottom:8px"></div>`}
      <div class="row"><span>Evidence ID</span><b>${e.id}</b></div><div class="row"><span>Type</span><span>${e.tag}</span></div><div class="row"><span>Details</span><span>${esc(e.meta)}</span></div>
      <div class="row"><span>Chain of custody</span><span>Logged · sealed</span></div><div class="foot"><button class="btn" data-close>Close</button></div>`);
  }));
  $('#evAdd').onclick = () => {
    modal(`<h3>Add evidence</h3><div class="row"><span>Title</span><input id="evT" style="flex:1;margin-left:16px;padding:6px 8px;border:1px solid #d8d1c4;border-radius:5px;font:inherit"/></div>
      <div class="row"><span>Type</span><select id="evK"><option>Photo</option><option>Physical</option><option>Statement</option><option>Data</option><option>Report</option></select></div>
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn red" id="evS">Add</button></div>`);
    $('#evT').focus();
    $('#evS').onclick = () => {
      const t = $('#evT').value.trim(); if (!t) return;
      S.evidence.unshift({ id: `EV-${String(100 + S.evidence.length).padStart(3, '0')}`, title: t, meta: `Added ${new Date().toLocaleString()}`, tag: $('#evK').value, thumb: 'linear-gradient(135deg,#e4ded4,#cfc7ba)' });
      closeModal(); renderEvidence();
    };
  };
}
function renderNotes() {
  const host = $('#tab-notes');
  host.innerHTML = `<textarea class="notes-in" id="noteIn" placeholder="Add an investigation note at ${fmtTime(S.time)}…"></textarea>
    <button class="small-btn" id="noteAdd">Add note</button>
    <div id="noteList">${S.notes.slice().reverse().map((n, i) => `<div class="note" data-i="${S.notes.length - 1 - i}"><button class="x" title="Delete">×</button><small>${fmtTime(n.t)} · ${new Date(n.created).toLocaleDateString()}</small>${esc(n.text)}</div>`).join('') || '<div class="muted" style="padding:8px 2px;font-size:11px">No notes yet. Notes are pinned to the timeline position.</div>'}</div>`;
  $('#noteAdd').onclick = () => {
    const v = $('#noteIn').value.trim(); if (!v) return;
    S.notes.push({ text: v, t: S.time, created: Date.now() });
    try { localStorage.setItem('firetrace.notes', JSON.stringify(S.notes)); } catch (e) { /* ignore */ }
    renderNotes();
  };
  $$('.note', host).forEach((el) => {
    el.addEventListener('click', (e) => {
      const i = +el.dataset.i;
      if (e.target.classList.contains('x')) { S.notes.splice(i, 1); try { localStorage.setItem('firetrace.notes', JSON.stringify(S.notes)); } catch (er) { /* ignore */ } renderNotes(); return; }
      app.setTime(S.notes[i].t);
    });
  });
}

// ------------------------------------------------------------------ drones
export function renderDrones() {
  const list = $('#droneList'); if (!app.units) return;
  const ds = app.units.drones;
  list.innerHTML = ds.map((d) => `<div class="li ${d.id === S.selDrone ? 'sel' : ''}" data-id="${d.id}">
    <span class="li-ic">${ic(d.def.kind === 'quad' ? 'drone' : 'fixed')}</span>
    <div class="li-b"><b>${d.id}</b><span class="nm">${d.def.name}</span><small>${d.def.mission}</small></div>
    <div class="d-mid"><span class="li-r"><span class="st">${d.def.status}</span><small>${fmtInt((d.agl || d.def.agl * FT) / FT)} ft</small></span></div>
    <div class="batt"><span class="bb"><i style="width:${d.battery}%"></i></span><span>${Math.round(d.battery)}%</span></div>
  </div>`).join('');
  $$('.li', list).forEach((el) => el.addEventListener('click', () => app.selectDrone(el.dataset.id)));
  renderDroneDetail();
}
function renderDroneDetail() {
  const d = app.curDrone(); if (!d) return;
  const left = Math.round(d.def.endurance * d.battery / 100);
  $('#droneDetail').innerHTML = `<div class="card-h"><b>${d.id}</b><span class="muted">${d.def.name}</span><span class="pill">${d.def.status}</span></div>
    <div class="detail">
      <div class="metrics">
        <div><small>Altitude</small><b>${fmtInt(d.agl / FT)}</b><span>ft AGL</span></div>
        <div><small>Ground speed</small><b>${Math.round(d.speed / KT)}</b><span>kn</span></div>
        <div><small>Heading</small><b>${Math.round(d.headingDeg)}°</b><span>${compassName(d.headingDeg)}</span></div>
        <div><small>Battery</small><b>${Math.round(d.battery)}%</b><span>~${left} min left</span></div>
        <div><small>Link</small><b>${d.link}</b><span>dBm</span></div>
        <div><small>Flight time</small><b>${d.flight >= 0 ? fmtDurS(d.flight) : 'cycle'}</b><span>&nbsp;</span></div>
      </div>
      <div class="kv2">
        <span>Aircraft</span><span>${d.def.aircraft}</span>
        <span>Mission</span><b style="font-weight:600">${d.def.mission}</b>
        <span>Task</span><span>${d.def.task}</span>
        <span>Sensor</span><span>${d.def.sensor}</span>
        <span>Position</span><span>${fmtLatLon(d.pos.x, d.pos.z)}</span>
        <span>Gimbal</span><span>${Math.round(d.gimbalHdg ?? 0)}° · ${Math.round(d.gimbalPitch ?? 0)}° · ${d.zoom.toFixed(1)}×</span>
      </div>
      <div class="btnrow"><button class="btn red" id="ddFull">${ic('expand')}${S.pip.full && S.pip.open ? 'Exit full view' : 'Full camera view'}</button><button class="btn ${d.sensor === 'ir' ? 'dark' : ''}" id="ddTherm">Thermal</button><button class="btn" id="ddSnap" title="Capture still">${ic('camera')}</button></div>
    </div>`;
  $('#ddFull').onclick = () => { if (!S.pip.open) { S.pip.open = true; $('#pip').classList.remove('hidden'); } app.togglePipFull(); };
  $('#ddTherm').onclick = () => { d.sensor = d.sensor === 'ir' ? 'eo' : 'ir'; if (!S.pip.open) { S.pip.open = true; $('#pip').classList.remove('hidden'); } updatePip(); renderDroneDetail(); };
  $('#ddSnap').onclick = () => { if (!S.pip.open) { S.pip.open = true; $('#pip').classList.remove('hidden'); } setTimeout(() => app.snapshot(), 50); };
}
const fmtDurS = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
export function renderDroneLive() { renderDrones(); }
export function updatePip() {
  const d = app.curDrone(); if (!d) return;
  $('#pipId').textContent = d.id; $('#pipName').textContent = d.def.name;
  $$('.pip-seg button').forEach((b) => b.classList.toggle('on', b.dataset.sensor === d.sensor));
  $('#pipPalette').textContent = d.palette; $('#pipPalette').style.display = d.sensor === 'ir' ? '' : 'none';
  $('#pipZoom').textContent = `${d.zoom.toFixed(1)}×`;
}
export function checkDetections(a, clk) {
  const act = app.fire.activeCells(S.time, 1.0);
  const recent = app.fire.activeCells(S.time, 6.0);
  if (!recent.length) return;
  for (const d of app.units.drones) {
    if (clk - d.lastDetect < 18 + (d.id.charCodeAt(4) % 5) * 3) continue;
    const pool = act.length ? act : recent;
    let best = null, bd = 1e12;
    for (let k = 0; k < pool.length; k += 3) { const [x, z] = app.fire.cellXZ(pool[k]); const dd = (x - d.camTarget.x) ** 2 + (z - d.camTarget.z) ** 2; if (dd < bd) { bd = dd; best = [x, z]; } }
    if (!best || bd > 900 * 900) continue;
    d.lastDetect = clk;
    const temp = act.length ? 640 + Math.round(Math.random() * 350) : 320 + Math.round(Math.random() * 240);
    S.detections.unshift({ id: d.id, temp, x: best[0], z: best[1], time: fmtHM(S.time) });
    if (S.detections.length > 40) S.detections.pop();
    if (S.mode === 'drones') renderFeed(app);
    break;
  }
}

// ------------------------------------------------------------------ resources
const UNIT_ICON = { tanker: 'plane', heli: 'heli', attack: 'plane', engine: 'engine', engine1: 'engine', tender: 'tender', crew: 'crew', dozer: 'dozer' };
function unitRowsReal(list) {
  return list.map((u) => {
    const d = u.def; const sel = S.selUnit === u.id; const on = d.windows ? d.windows.some(([a, b]) => S.time >= a && S.time <= b) : S.time >= (d.from ?? 0);
    const icon = UNIT_ICON[d.role] || UNIT_ICON[d.model] || 'truck';
    const right = u.kind === 'air' ? (d.role === 'attack' ? `${d.crew} pers.` : `${fmtInt(u.load)} L`) : (d.cap ? `${fmtInt(d.cap)} L` : `${d.crew} pers.`);
    const dot = !on ? '#b8b0a6' : u.statusColor === 'r' ? '#d63a2a' : u.statusColor === 'g' ? '#3f8f3a' : '#c79a1e';
    return `<div class="li ${sel ? 'sel' : ''}" data-id="${u.id}" style="${on ? '' : 'opacity:.55'}"><span class="li-ic">${ic(icon)}</span>
      <div class="li-b"><b>${u.id}</b><span class="nm">${d.type}</span><small><span class="sd" style="background:${dot}"></span>${on ? u.status : d.windows ? `on scene ${d.windows.map(([a, b]) => `${fmtHM(a)}–${fmtHM(b)}`).join(', ')}` : `from ${fmtTime(d.from)}`}</small></div>
      <span class="li-r">${right}</span></div>`;
  }).join('');
}
function unitRows(list) {
  return list.map((u) => {
    const d = u.def; const sel = S.selUnit === u.id;
    const icon = UNIT_ICON[d.role] || UNIT_ICON[d.model] || 'truck';
    let right;
    if (u.kind === 'air') right = d.role === 'attack' ? `${d.crew} pers.` : `${fmtInt(u.load)} gal`;
    else if (u.kind === 'crew') right = `${Math.round(u.line ? u.line.chainsAt(S.time) : d.chains)} ch`;
    else right = d.cap ? `${fmtInt(d.cap)} gal` : `${d.crew} pers.`;
    const dot = u.statusColor === 'r' ? '#d63a2a' : u.statusColor === 'g' ? '#3f8f3a' : '#c79a1e';
    const status = u.kind === 'crew' ? `${d.crew} · ${u.status}` : u.status;
    return `<div class="li ${sel ? 'sel' : ''}" data-id="${u.id}"><span class="li-ic">${ic(icon)}</span>
      <div class="li-b"><b>${u.id}</b><span class="nm">${d.type}</span><small><span class="sd" style="background:${dot}"></span>${status}</small></div>
      <span class="li-r">${right}</span></div>`;
  }).join('');
}
export function renderResources() {
  if (!app.units) return;
  const U = app.units;
  const air = U.air, eng = U.ground.filter((u) => u.kind === 'ground'), crews = U.ground.filter((u) => u.kind === 'crew');
  if (R()) {
    $('#resList').innerHTML = `<div class="grp">Aircraft · illustrative positions</div>${unitRowsReal(air)}<div class="grp">Ground · illustrative positions</div>${unitRowsReal(eng)}`;
    $$('#resList .li').forEach((el) => el.addEventListener('click', () => { const u = app.units.all.find((q) => q.id === el.dataset.id); if (!(u.def.windows ? u.def.windows.some(([a, b]) => S.time >= a && S.time <= b) : S.time >= (u.def.from ?? 0))) { toast(u.def.windows ? `${u.id} on scene only ${u.def.windows.map(([a, b]) => `${fmtHM(a)}–${fmtHM(b)}`).join(', ')} (CTI)` : `${u.id} only joins from ${fmtTime(u.def.from)}`); return; } app.selectUnit(el.dataset.id); }));
    $('#resCount').textContent = '· documented totals (ANPC/press)';
    renderResStats(); renderResDetail(); return;
  }
  $('#resList').innerHTML = `<div class="grp">Aircraft</div>${unitRows(air)}<div class="grp">Engines &amp; Tenders</div>${unitRows(eng)}<div class="grp">Crews &amp; Dozers</div>${unitRows(crews)}`;
  $$('#resList .li').forEach((el) => el.addEventListener('click', () => app.selectUnit(el.dataset.id)));
  renderResStats();
  renderResDetail();
}
export function renderResStats() {
  if (!app.units) return;
  if (R()) {
    const r = R().res; const v = (f) => { const q = f(S.time); return q === null ? '—' : fmtInt(q); };
    $('#resStats').innerHTML = `<div><b>${v(r.ops)}</b><span>operatives (ANPC)</span></div><div><b>${v(r.veh)}</b><span>vehicles</span></div><div><b>${v(r.air)}</b><span>aerial means</span></div><div><b style="color:#c9372c">${v(r.dead)}</b><span>fatalities</span></div>`;
    return;
  }
  const up = app.units.air.filter((a) => a.status !== 'Reloading').length;
  const ret = app.retSeries ? retAt(S.time) : 0;
  const chains = app.lines.reduce((s, l) => s + l.chainsAt(S.time), 0);
  const pers = app.personnel.filter(([t]) => t <= S.time).slice(-1)[0]?.[1] ?? 0;
  $('#resStats').innerHTML = `<div><b>${up}<small>/6</small></b><span>aircraft up</span></div><div><b>${fmtK(ret)}</b><span>gal retardant</span></div><div><b>${fmtInt(chains)}</b><span>chains line</span></div><div><b>${pers}</b><span>personnel</span></div>`;
}
function retAt(t) { let v = 0; for (const [tt, vv] of app.retSeries) { if (tt <= t) v = vv; else break; } return v + (t >= C.T_CONTAIN - 0.01 ? S.retardantLive : 0); }
const fmtK = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`);
function renderResDetail() {
  const host = $('#resDetail');
  const u = app.units.all.find((q) => q.id === S.selUnit);
  if (!u) {
    host.innerHTML = `<div class="card-h"><b>Operations</b><span class="ops-badge"><i></i>Air ops active</span></div>
      <div class="hint">${ic('plane')}<span>Click an aircraft to ride along with it. Click an engine, crew or dozer to follow it. Drops leave retardant lines that fade over the following days.</span></div>`;
    return;
  }
  const d = u.def;
  const dot = u.statusColor === 'r' ? 'red' : u.statusColor === 'g' ? '' : 'gray';
  let metrics, extra = '', kv, btns;
  const cm = S.camMode === 'follow' ? 'overview' : S.camMode;
  if (u.kind === 'air') {
    metrics = `<div><small>Airspeed</small><b>${Math.round(u.speed / KT)}</b><span>kt</span></div><div><small>Altitude</small><b>${fmtInt(u.agl / FT)}</b><span>ft AGL</span></div><div><small>Heading</small><b>${Math.round(u.headingDeg)}°</b><span>${compassName(u.headingDeg)}</span></div>`;
    if (d.cap) extra = `<div class="loadbar"><div class="lb-h"><span>Load · ${d.liquid}</span><b>${fmtInt(u.load)} / ${fmtInt(d.cap)} gal</b></div><div class="bar"><i style="width:${u.load / d.cap * 100}%"></i></div></div>`;
    kv = `<span>Agency</span><span>${d.agency}</span><span>Assignment</span><span>${u.status}${d.model === 'vlat' && u.status === 'On final' ? ' · lead plane' : ''}</span><span>Drops</span><span>${u.drops} this session</span><span>Position</span><span>${fmtLatLon(u.pos.x, u.pos.z)}</span>`;
    btns = `<div class="seg-btns">${['chase', 'cockpit', 'overview'].map((m) => `<button data-cm="${m}" class="${cm === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>`;
  } else {
    const spd = u.kind === 'crew' ? u.speed * 0 : u.speed / MPH;
    metrics = `<div><small>Speed</small><b>${Math.round(spd)}</b><span>mph</span></div><div><small>Personnel</small><b>${d.crew}</b><span>on unit</span></div><div><small>Division</small><b>${d.div}</b><span>ICS</span></div>`;
    if (u.kind === 'crew' && u.line) extra = `<div class="loadbar"><div class="lb-h"><span>Line built</span><b>${Math.round(u.line.chainsAt(S.time))} / ${d.chains} ch</b></div><div class="bar g"><i style="width:${u.line.progress(S.time) * 100}%"></i></div></div>`;
    kv = `<span>Agency</span><span>${d.agency}</span><span>Assignment</span><span>${u.status}</span><span>Position</span><span>${fmtLatLon(u.pos.x, u.pos.z)}</span>`;
    btns = `<div class="seg-btns">${[['chase', 'Ride along'], ['overview', 'Overview']].map(([m, l]) => `<button data-cm="${m}" class="${cm === m ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }
  host.innerHTML = `<div class="card-h"><b>${u.id}</b><span class="muted">${d.type}</span><span class="pill ${dot}" style="background:none;padding:0">● ${u.kind === 'crew' ? `${d.crew} · ` : ''}${u.status}</span></div>
    <div class="detail"><div class="metrics" style="border:0;padding-bottom:4px">${metrics}</div>${extra}<div class="kv2" style="border-top:1px solid var(--line2)">${kv}</div>${btns}</div>`;
  $$('[data-cm]', host).forEach((b) => b.addEventListener('click', () => app.setCamMode(b.dataset.cm)));
}
export function renderResLive() { renderResources(); }
export function renderUnitHud(a, liveOnly) {
  const hud = $('#unitHud');
  const u = app.units?.all.find((q) => q.id === S.selUnit);
  const show = u && (S.camMode === 'chase' || S.camMode === 'cockpit') && S.mode === 'resources';
  hud.classList.toggle('hidden', !show);
  if (!show) return;
  const d = u.def;
  const stCls = u.statusColor === 'r' ? '' : u.statusColor === 'g' ? 'g' : 'y';
  let body;
  if (u.kind === 'air') {
    body = `<div class="uh-m"><small>IAS</small><b>${Math.round(u.speed / KT)}</b><span>kt</span></div>
      <div class="uh-m"><small>ALT</small><b>${fmtInt(u.agl / FT)}</b><span>ft AGL</span></div>
      <div class="uh-m"><small>HDG</small><b>${Math.round(u.headingDeg)}°</b><span>${compassName(u.headingDeg)}</span></div>
      ${d.cap ? `<div class="uh-m uh-load"><small>${d.liquid === 'water' ? 'Water' : 'Retardant'}</small><div class="bar"><i style="width:${u.load / d.cap * 100}%;${d.liquid === 'water' ? 'background:#4c9be0' : ''}"></i></div><b>${fmtInt(u.load)} gal</b></div>` : '<div class="uh-m uh-load"><small>Role</small><b>Supervising</b></div>'}`;
  } else {
    body = `<div class="uh-m"><small>SPD</small><b>${Math.round(u.kind === 'crew' ? 0 : u.speed / MPH)}</b><span>mph</span></div>
      <div class="uh-m"><small>ALT</small><b>0</b><span>ft AGL</span></div>
      <div class="uh-m"><small>HDG</small><b>${Math.round(u.headingDeg)}°</b><span>${compassName(u.headingDeg)}</span></div>`;
  }
  const btns = u.kind === 'air' ? ['chase', 'cockpit'] : ['chase'];
  hud.innerHTML = `<div class="uh-top"><b>${u.id}</b><span class="t">${d.type}</span><span class="uh-st ${stCls}"><i></i>${u.status}${d.model === 'vlat' && u.status === 'On final' ? ' · lead plane' : ''}</span></div>
    <div class="uh-row">${body}<div class="uh-btns">${btns.map((m) => `<button data-cm="${m}" class="${S.camMode === m ? 'on' : ''}">${m === 'chase' ? 'Chase' : 'Cockpit'}</button>`).join('')}</div><button class="uh-x" title="Close">✕</button></div>
    <div class="uh-hint">Drag to look around · scroll to move the camera · C to switch view</div>`;
  $$('[data-cm]', hud).forEach((b) => b.addEventListener('click', () => app.setCamMode(b.dataset.cm)));
  $('.uh-x', hud).addEventListener('click', () => app.deselectUnit());
}

// ------------------------------------------------------------------ charts
const DAY_TICKS = [[T(14, 12), 'Aug 14'], [T(15, 12), 'Aug 15'], [T(16, 12), 'Aug 16'], [T(17, 12), 'Aug 17'], [T(18, 6), 'Aug 18']];
export function drawCharts(a, charts) {
  const f = app.fire; const t = S.time;
  if (R() && S.mode !== 'drones') return drawChartsReal(charts);
  const set = (i, title, meta) => { charts[i].title.textContent = title; charts[i].meta.textContent = meta || ''; };
  const X = [T(14, 6), T(18, 12)];
  if (S.mode === 'incident') {
    set(0, 'Fire Area (acres)'); set(1, 'Rate of Spread (chains/hr)'); set(2, 'Elevation Profile (selected path)');
    const area = f.times.map((tt, i) => [tt, f.area[i]]);
    charts[0].chart.draw({ x: X, y: [0, 15000], yTicks: [0, 5000, 10000, 15000], xTicks: DAY_TICKS, series: [{ pts: area, color: '#d0613e', fill: 'rgba(222,120,80,A)', splitAt: t, futureAlpha: 0.6 }], cursor: t, cursorY: f.sampleSeries('area', t) });
    const ros = f.times.map((tt, i) => [tt, f.ros[i]]);
    const mr = Math.max(40, Math.ceil(Math.max(...f.ros) / 20) * 20);
    charts[1].chart.draw({ x: X, y: [0, mr], yTicks: [0, mr / 2, mr], padL: 30, xTicks: DAY_TICKS, series: [{ pts: ros, color: '#c62f26', fill: 'rgba(214,80,70,A)', splitAt: t, futureAlpha: 0.5 }], cursor: t, cursorY: f.sampleSeries('ros', t) });
    const pr = app.profile; const ys = pr.map((p) => p[1]);
    const lo = Math.floor((Math.min(...ys) - 60) / 300) * 300, hi = Math.ceil((Math.max(...ys) + 60) / 300) * 300;
    const L = app.profileLen / 1000;
    // marker: fire head projected onto the path
    const h = f.sampleSeries('head', Math.max(t, C.T_IGNITION)); let bi = 0, bd = 1e12;
    const pp = S.profilePath; let acc = 0, bs = 0;
    for (let i = 0; i < pp.length; i++) { if (i) acc += Math.hypot(pp[i][0] - pp[i - 1][0], pp[i][1] - pp[i - 1][1]); const dd = (pp[i][0] - h.x) ** 2 + (pp[i][1] - h.z) ** 2; if (dd < bd) { bd = dd; bs = acc; } }
    const mk = bs / 1000; const me = app.terrain.elev(h.x, h.z);
    const ticksX = []; const step = L > 12 ? 5 : L > 5 ? 2 : 1; for (let k = 0; k <= L + 0.01; k += step) ticksX.push([k, k === Math.floor(L / step) * step && L - k < step * 0.3 ? `${k} km` : `${k}`]);
    ticksX[ticksX.length - 1][1] = `${ticksX[ticksX.length - 1][0]} km`;
    charts[2].chart.draw({ x: [0, L], y: [lo, hi], yTicks: [lo, (lo + hi) / 2, hi].map((v) => Math.round(v / 100) * 100), xTicks: ticksX, series: [{ pts: pr, color: '#5c7a4a', fill: 'rgba(110,145,90,A)', width: 1.4 }], marker: bd < 800 * 800 ? [mk, me, '#d63a2a'] : null });
  } else if (S.mode === 'drones') {
    const d = app.curDrone(); const ds = app.units.drones;
    const ser = (key, scale = 1) => ds.map((q) => {
      const h = q.hist[key]; const n = h.length; const pts = h.map((v, i) => [-(n - 1 - i) * 0.5, v * scale]);
      return q === d ? { pts, color: '#c62f26', fill: 'rgba(214,80,70,A)', width: 2, endDot: true } : { pts, color: '#9a928a', width: 1, alpha: 0.6 };
    }).sort((p, q) => (p.endDot ? 1 : 0) - (q.endDot ? 1 : 0));
    set(0, 'Altitude (ft AGL)', `${d.id} · ${fmtInt(d.agl / FT)} ft`);
    set(1, 'Max Temperature in View (°C)', `${d.maxTemp ?? 0} °C`);
    set(2, 'Battery (%)', `${d.id} · ${Math.round(d.battery)}%`);
    const xt = [[-60, '−60 s'], [0, 'now']];
    charts[0].chart.draw({ x: [-60, 0], y: [0, 1800], yTicks: [0, 900, 1800], xTicks: xt, series: ser('alt') });
    const tp = d.hist.temp.map((v, i, a2) => [-(a2.length - 1 - i) * 0.5, v]);
    charts[1].chart.draw({ x: [-60, 0], y: [0, 1000], yTicks: [0, 500, 1000], xTicks: xt, series: [{ pts: tp, color: '#c62f26', fill: 'rgba(214,80,70,A)', width: 2, endDot: true }] });
    charts[2].chart.draw({ x: [-60, 0], y: [0, 100], yTicks: [0, 50, 100], xTicks: xt, padL: 30, series: ser('batt') });
  } else {
    set(0, 'Retardant Dropped (gal)'); set(1, 'Fire Line Built (chains)'); set(2, 'Personnel Assigned');
    const rs = app.retSeries.slice(); if (S.retardantLive) rs.push([C.T_END, rs[rs.length - 1][1] + S.retardantLive]);
    charts[0].chart.draw({ x: X, y: [0, 500000], yTicks: [0, 250000, 500000], padL: 50, xTicks: DAY_TICKS, series: [{ pts: rs, color: '#c62f26', fill: 'rgba(214,80,70,A)', splitAt: t }], cursor: t });
    const fl = []; for (let tt = X[0]; tt <= X[1]; tt += 1) fl.push([tt, app.lines.reduce((s, l) => s + l.chainsAt(tt), 0)]);
    charts[1].chart.draw({ x: X, y: [0, 2000], yTicks: [0, 1000, 2000], padL: 40, xTicks: DAY_TICKS, series: [{ pts: fl, color: '#4a433d', fill: 'rgba(120,110,100,A)', splitAt: t }], cursor: t });
    const pe = []; app.personnel.forEach(([tt, v], i) => { if (i) pe.push([tt, app.personnel[i - 1][1]]); pe.push([tt, v]); });
    charts[2].chart.draw({ x: X, y: [0, 100], yTicks: [0, 50, 100], padL: 30, xTicks: DAY_TICKS, series: [{ pts: pe, color: '#5c7a4a', fill: 'rgba(110,145,90,A)', splitAt: t }], cursor: t });
  }
}
function drawChartsReal(charts) {
  const f = app.fire; const t = S.time; const rc = R();
  const set = (i, title, meta) => { charts[i].title.textContent = title; charts[i].meta.textContent = meta || ''; };
  const X = [T(17, 12), T(22, 24)];
  const DT = [17, 18, 19, 20, 21, 22].map((d) => [T(d, 12), `Jun ${d}`]);
  if (S.mode === 'incident') {
    set(0, 'Burned Area (ha)', `${fmtInt(f.sampleSeries('area', t))} ha`); set(1, 'Growth Rate (ha/h)'); set(2, 'Elevation Profile · EN236-1');
    const area = f.times.map((tt, i) => [tt, f.area[i]]);
    charts[0].chart.draw({ x: X, y: [0, 50000], yTicks: [0, 25000, 50000], padL: 44, xTicks: DT, series: [{ pts: area, color: '#d0613e', fill: 'rgba(222,120,80,A)', splitAt: t, futureAlpha: 0.6 }], cursor: t, cursorY: f.sampleSeries('area', t) });
    const ros = f.times.map((tt, i) => [tt, f.ros[i]]);
    const mr = Math.ceil(Math.max(...f.ros) / 1000) * 1000;
    charts[1].chart.draw({ x: X, y: [0, mr], yTicks: [0, mr / 2, mr], padL: 40, xTicks: DT, series: [{ pts: ros, color: '#c62f26', fill: 'rgba(214,80,70,A)', splitAt: t, futureAlpha: 0.5 }], cursor: t, cursorY: f.sampleSeries('ros', t) });
    const pr = app.profile; const ys = pr.map((p) => p[1]);
    const lo = Math.floor((Math.min(...ys) - 40) / 100) * 100, hi = Math.ceil((Math.max(...ys) + 40) / 100) * 100;
    const L = app.profileLen / 1000; const ticksX = []; for (let k = 0; k <= L + 0.01; k += L > 10 ? 5 : L > 4 ? 2 : 1) ticksX.push([k, `${k}`]);
    if (ticksX.length) ticksX[ticksX.length - 1][1] += ' km';
    // marker: where the fire front is along the path
    const pp = S.profilePath; let acc = 0, mk = null;
    for (let i = 0; i < pp.length; i++) { if (i) acc += Math.hypot(pp[i][0] - pp[i - 1][0], pp[i][1] - pp[i - 1][1]); const a2 = f.arrivalAt(pp[i][0], pp[i][1]); if (a2 <= t && mk === null) mk = [acc / 1000, app.terrain.elev(pp[i][0], pp[i][1])]; }
    charts[2].chart.draw({ x: [0, L], y: [lo, hi], yTicks: [lo, Math.round((lo + hi) / 200) * 100, hi], xTicks: ticksX, series: [{ pts: pr, color: '#5c7a4a', fill: 'rgba(110,145,90,A)', width: 1.4 }], marker: mk ? [mk[0], mk[1], '#d63a2a'] : null });
  } else {
    const stepSeries = (key) => { const out = [[X[0], 0]]; let last = 0; rc.record.resources.forEach((r) => { if (r[key] === null || r[key] === undefined) return; out.push([r.t, last]); out.push([r.t, r[key]]); last = r[key]; }); out.push([X[1], last]); return out; };
    const r = rc.res; const v = (q) => (q === null ? '—' : fmtInt(q)); const A = rc.record.anpc;
    const X2 = [T(17, 12), T(24, 0)];
    const DT2 = [17, 18, 19, 20, 21, 22, 23].map((d) => [T(d, 12), `Jun ${d}`]);
    if (A) {
      const ops = [[X2[0], 0], ...A.ops_onscene_early, ...A.ops_onscene.filter(([tt]) => tt > 19.1)];
      const arr = [[X2[0], 0], ...A.ops_arrived_cum_early, ...A.ops_arrived_cum.filter(([tt]) => tt > 19.1)];
      set(0, 'Operatives on scene · ANPC', `${v(r.ops(t))} · arrived ${v(r.opsArr ? r.opsArr(t) : null)}`);
      charts[0].chart.draw({ x: X2, y: [0, 1200], yTicks: [0, 600, 1200], padL: 40, xTicks: DT2, series: [
        { pts: arr, color: '#e08a3c', width: 1.2, splitAt: t, futureAlpha: 0.5 },
        { pts: ops, color: '#c62f26', fill: 'rgba(214,80,70,A)', splitAt: t },
        { pts: stepSeries('ops'), color: '#6a625a', width: 1, alpha: 0.6, splitAt: t }], cursor: t });
      set(1, 'Vehicles by type · ANPC', `VFCI ${v((t2 => { let q = null; for (const [a2, b2] of A.veh_VFCI) { if (a2 <= t2) q = b2; } return q; })(t))}`);
      charts[1].chart.draw({ x: X2, y: [0, 60], yTicks: [0, 30, 60], padL: 28, xTicks: DT2, series: [
        { pts: A.veh_VCOT, color: '#d0453a', width: 1.4, splitAt: t }, { pts: A.veh_VTTU, color: '#4b9a3f', width: 1.4, splitAt: t },
        { pts: A.veh_VFCI, color: '#2a2520', width: 1.8, splitAt: t }], cursor: t });
      set(2, 'Aerial Means', v(r.air(t)));
      charts[2].chart.draw({ x: X2, y: [0, 16], yTicks: [0, 8, 16], padL: 28, xTicks: DT2, series: [{ pts: A.veh_air, color: '#3f6fd6', fill: 'rgba(80,120,210,A)', splitAt: t, width: 1.2 }, { pts: stepSeries('air'), color: '#1f3f8a', width: 1.4, splitAt: t }], cursor: t });
    } else {
    set(0, 'Operatives (Pedrógão)', v(r.ops(t))); set(1, 'Vehicles', v(r.veh(t))); set(2, 'Aerial Means', v(r.air(t)));
    charts[0].chart.draw({ x: X, y: [0, 1200], yTicks: [0, 600, 1200], padL: 40, xTicks: DT, series: [{ pts: stepSeries('ops'), color: '#c62f26', fill: 'rgba(214,80,70,A)', splitAt: t }], cursor: t });
    charts[1].chart.draw({ x: X, y: [0, 400], yTicks: [0, 200, 400], padL: 34, xTicks: DT, series: [{ pts: stepSeries('veh'), color: '#4a433d', fill: 'rgba(120,110,100,A)', splitAt: t }], cursor: t });
    charts[2].chart.draw({ x: X, y: [0, 12], yTicks: [0, 6, 12], padL: 28, xTicks: DT, series: [{ pts: stepSeries('air'), color: '#3f6fd6', fill: 'rgba(80,120,210,A)', splitAt: t }], cursor: t });
    }
  }
}
function exportCsv(i) {
  const c = app.charts[i]; const cfg = c.chart.cfg; if (!cfg) return;
  const rows = [['x', ...cfg.series.map((s, k) => `series${k}`)]];
  const s0 = cfg.series[cfg.series.length - 1].pts;
  s0.forEach((p, k) => rows.push([S.mode === 'drones' || (S.mode === 'incident' && i === 2) ? p[0] : fmtTime(p[0]), ...cfg.series.map((s) => (s.pts[k] ? s.pts[k][1].toFixed(2) : ''))]));
  const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${c.title.textContent.replace(/[^a-z0-9]+/gi, '_')}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ map chrome: compass, zoom, scale bar, grid labels
export function updateMapChrome(a, sph) {
  const az = sph.theta;
  $('#compass svg').style.transform = `rotate(${(az / Math.PI * 180).toFixed(1)}deg)`;
  const z = 40000 / sph.radius;
  $('#zoomVal').textContent = `${z < 10 ? z.toFixed(1) : z.toFixed(1)}×`;
  const h = $('#viewport').clientHeight;
  const mpp = 2 * sph.radius * Math.tan(app.camera.fov * Math.PI / 360) / h;
  const opts = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  let tot = opts[0]; for (const o of opts) { if (o / mpp <= 130) tot = o; }
  const px = tot / mpp;
  $('.scalebar').style.width = `${px.toFixed(0)}px`;
  const lab = (m) => (tot >= 1000 ? `${+(m / 1000).toFixed(2)}` : `${m}`);
  $('#sbMid').textContent = lab(tot / 2); $('#sbEnd').textContent = tot >= 1000 ? `${lab(tot)} km` : `${tot} m`;
  if (S.dim === '2d') updateGridLabels();
}
function gridSpec() {
  const g = geoInfo();
  const lonStep = g.M_PER_DEG_LON / 60, latStep = g.M_PER_DEG_LAT / 60;
  const lonM0 = Math.round(g.LON0 * 60), latM0 = Math.round(g.LAT0 * 60);
  return { g, lonStep, latStep, offX: (lonM0 / 60 - g.LON0) * g.M_PER_DEG_LON, offZ: (g.LAT0 - latM0 / 60) * g.M_PER_DEG_LAT, lonM0, latM0 };
}
const fmtDM = (min, pos, neg) => { const a = Math.abs(min); return `${Math.floor(a / 60)}°${String(a % 60).padStart(2, '0')}'${min >= 0 ? pos : neg}`; };
function updateGridLabels() {
  const host = $('#gridLabels'); const cam = app.camera; const W = $('#viewport').clientWidth, H = $('#viewport').clientHeight;
  const tgt = app.controls.target; const out = []; const G = gridSpec();
  const proj = (x, z) => { const p = new (cam.position.constructor)(x, app.world.groundY(x, z), z).project(cam); return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]; };
  // pick a minute multiple so labels are >= 80 px apart
  const px1 = Math.abs(proj(tgt.x + G.lonStep, tgt.z)[0] - proj(tgt.x, tgt.z)[0]) || 1;
  const every = [1, 2, 5, 10, 15, 30, 60].find((m) => px1 * m >= 80) || 60;
  const n = Math.ceil(C.HALF * 1.6 / G.lonStep);
  for (let k = -n; k <= n; k++) {
    const lonMin = G.lonM0 + k; if (lonMin % every) continue;
    const x = G.offX + k * G.lonStep; const [sx] = proj(x, tgt.z);
    if (sx > 30 && sx < W - 70) out.push(`<span class="glbl" style="left:${sx}px;top:6px">${fmtDM(lonMin, 'E', 'W')}</span>`);
  }
  for (let k = -n; k <= n; k++) {
    const latMin = G.latM0 - k; if (latMin % every) continue;
    const z = G.offZ + k * G.latStep; const [, sy] = proj(tgt.x, z);
    if (sy > 30 && sy < H - 40) out.push(`<span class="glbl v" style="right:6px;top:${sy}px">${fmtDM(latMin, 'N', 'S')}</span>`);
  }
  host.innerHTML = out.join('');
}
export { gridSpec };

// ------------------------------------------------------------------ menus, modal, toasts
let openMenu = null;
export function closeMenus() { if (openMenu) { openMenu.remove(); openMenu = null; } $$('.tb-btn.open').forEach((b) => b.classList.remove('open')); }
export function showMenu(anchor, items, dir = 'down') {
  const wasSame = openMenu && openMenu._anchor === anchor;
  closeMenus(); if (wasSame) return;
  const m = document.createElement('div'); m.className = 'menu'; m._anchor = anchor;
  m.innerHTML = items.map((it, i) => it.sep ? '<div class="sep"></div>' : it.header ? `<div class="mh">${it.header}</div>` :
    `<div class="mi ${it.disabled ? 'dis' : ''}" data-i="${i}">${it.check !== undefined ? `<span class="ck">${it.check ? '✓' : ''}</span>` : ''}${it.icon ? ic(it.icon) : ''}<span>${it.label}</span>${it.k ? `<span class="k">${it.k}</span>` : ''}</div>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  let left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8);
  let top = dir === 'up' ? r.top - m.offsetHeight - 6 : r.bottom + 6;
  m.style.left = `${Math.max(8, left)}px`; m.style.top = `${Math.max(8, top)}px`;
  $$('.mi', m).forEach((el) => el.addEventListener('click', () => { const it = items[+el.dataset.i]; if (it.disabled) return; closeMenus(); it.action && it.action(); }));
  openMenu = m; anchor.classList?.add('open');
}
function openTopMenu(name, anchor) {
  const L = app;
  const menus = {
    incidentMenu: [
      { header: 'Incidents' },
      { label: 'Pedrógão Grande 2017 · real data', check: true },
      { sep: true },
      { label: 'Incident overview…', icon: 'file', action: () => { if (S.mode !== 'incident') L.setMode('incident'); toast('Overview is in the side panel'); } },
    ],
    dateMenu: R() ? [
      { header: 'Analysis window · Jun 17 – Jun 22, 2017' },
      { label: 'Ignitions (Pedrógão · Góis)', k: '14:30 · 14:45', action: () => L.setTime(T(17, 14, 30)) },
      { label: 'Fire surrounds Pobrais', k: 'Jun 17 19:00', action: () => L.setTime(T(17, 19)) },
      { label: 'Downburst · EN236-1', k: 'Jun 17 19:01', action: () => { L.setTime(T(17, 19, 5)); const p = C.PLACES.en2361; L.flyTo(p.x, p.z, 3500, S.dim === '2d' ? 0.0001 : 0.85, S.dim === '2d' ? 0 : 0.5, 1.8); } },
      { label: 'First VIIRS night pass', k: 'Jun 18 03:05', action: () => L.setTime(T(18, 3, 5)) },
      { label: 'Extinction — Pedrógão (SGIF)', k: 'Jun 22 09:22', action: () => L.setTime(T(22, 9, 22)) },
      { sep: true },
      { label: 'Play full incident', icon: 'play', action: () => { L.setTime(C.T_START); L.togglePlay(true); } },
    ] : [
      { header: 'Analysis window · Aug 14 – Aug 18, 2024' },
      { label: 'Jump to ignition', k: fmtTime(C.T_IGNITION), action: () => L.setTime(C.T_IGNITION) },
      { label: 'Jump to spot fire', k: fmtTime(C.T_SPOT), action: () => L.setTime(C.T_SPOT) },
      { label: 'Jump to containment', k: fmtTime(C.T_CONTAIN), action: () => L.setTime(C.T_CONTAIN) },
      { sep: true },
      { label: 'Play full incident', icon: 'play', action: () => { L.setTime(C.T_START); L.togglePlay(true); } },
    ],
    viewMenu: [
      ...(R() ? [{ label: 'Post-fire imagery (S2, 8 Aug 2017)', check: !!S.postImagery, action: () => { S.postImagery = !S.postImagery; L.applyLayers(); toast(S.postImagery ? 'Sentinel-2 · 8 Aug 2017 (after)' : 'Sentinel-2 · 14 Jun 2017 (before)'); } }, { sep: true }] : []),
      { label: 'Place labels', check: S.labels, k: 'L', action: () => { S.labels = !S.labels; } },
      { label: 'Unit tags', check: S.unitTags, action: () => { S.unitTags = !S.unitTags; } },
      { label: 'Atmospheric haze', check: S.haze, action: () => { S.haze = !S.haze; } },
      { header: 'Terrain exaggeration' },
      ...[1, 1.5, 2, 3].map((v) => ({ label: `${v}×`, check: L.world.vex === v, action: () => { L.world.setExaggeration(v); L.applyLayers(); toast(`Vertical exaggeration ${v}×`); } })),
      { sep: true },
      { label: '2D map', k: '2', check: S.dim === '2d', action: () => L.setDim('2d') },
      { label: '3D terrain', k: '3', check: S.dim === '3d', action: () => L.setDim('3d') },
      { label: 'Reset camera', k: 'R', action: () => L.resetCamera() },
      { label: 'Toggle side panel', action: () => document.body.classList.toggle('side-collapsed') },
      { label: 'Fullscreen', k: 'F', action: () => L.toggleFullscreen() },
    ],
    analysisMenu: [
      { label: 'Measure distance', icon: 'ruler', k: 'M', action: () => L.startMeasure('measure') },
      { label: 'Draw elevation profile…', icon: 'route', action: () => { if (S.mode !== 'incident') L.setMode('incident'); L.startMeasure('profile'); } },
      { sep: true },
      { label: 'Fly to origin area', icon: 'target', action: () => { L.setTime(C.T_IGNITION + 0.4); L.flyTo(C.PLACES.ignition.x, C.PLACES.ignition.z, 2600, S.dim === '2d' ? 0.0001 : 0.9, S.dim === '2d' ? 0 : -0.3, 1.8); } },
      { label: 'Re-run spread model…', icon: 'refresh', action: rerunDialog },
      { label: 'Origin & cause summary', icon: 'file', action: () => { if (S.mode !== 'incident') L.setMode('incident'); $('#sideTabs [data-tab=analysis]').click(); } },
    ],
    shareMenu: [
      { label: 'Copy link to this view', icon: 'link', action: () => { L.writeHash(); navigator.clipboard?.writeText(location.href).then(() => toast('Link copied to clipboard'), () => toast('Copy failed')); } },
      { label: 'Export snapshot (PNG)', icon: 'image', action: exportSnapshot },
      { label: 'Export incident report', icon: 'file', action: exportReport },
      { sep: true },
      { label: 'Sources, limitations & credits', icon: 'info', action: () => showIntro(true) },
      { label: 'Present mode', icon: 'fullscreen', action: () => { document.body.classList.add('side-collapsed'); L.toggleFullscreen(); } },
    ],
  };
  showMenu(anchor, menus[name]);
}
function exportSnapshot() {
  const r = app.renderer; r.render(app.scene, app.camera);
  const url = r.domElement.toDataURL('image/png');
  const a = document.createElement('a'); a.href = url; a.download = `firetrace_${fmtTime(S.time).replace(/[^0-9a-z]+/gi, '_')}.png`; a.click();
  toast('Snapshot exported');
}
function exportReport() {
  const f = app.fire;
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the report'); return; }
  w.document.write(`<!doctype html><title>Pedrógão Grande 2017 — FireTrace report</title><style>body{font:14px/1.5 Inter,system-ui,sans-serif;max-width:760px;margin:40px auto;color:#2a2520}h1{font-size:22px}td{padding:4px 12px 4px 0}th{text-align:left;color:#777;font-weight:500;padding-right:12px}</style>
    <h1>Pedrógão Grande + Góis · 17–22 Jun 2017</h1><p>Leiria / Coimbra, Portugal · illustrative reconstruction · generated ${new Date().toLocaleString()}</p>
    <table>${overviewData().map(([k, v]) => `<tr><th>${k}</th><td>${v.replace(/<[^>]+>/g, '')}</td></tr>`).join('')}</table>
    <h2>Key events</h2><table>${app.events.concat(S.customEvents).map((e) => `<tr><td>${fmtTime(e.t)}</td><td>${esc(e.name)}</td></tr>`).join('')}</table>
    <h2>Fire behaviour</h2><p>Final modeled area ${fmtInt(f.finalAcres)} acres. Peak rate of spread ${Math.round(Math.max(...f.ros))} chains/hr.</p>
    <h2>Notes</h2>${S.notes.map((n) => `<p><b>${fmtTime(n.t)}</b> — ${esc(n.text)}</p>`).join('') || '<p>No notes.</p>'}
    <script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}
function openSettings() {
  modal(`<h3>Settings</h3>
    <div class="row"><span>Elevation units</span><select id="stUnits"><option value="m" ${S.metric ? 'selected' : ''}>Metric (m)</option><option value="ft" ${!S.metric ? 'selected' : ''}>Imperial (ft)</option></select></div>
    <div class="row"><span>Render resolution</span><select id="stRes"><option value="auto">Auto (adaptive)</option><option value="1">Standard (1×)</option><option value="1.5">High (1.5×)</option><option value="2" selected>Retina (2×)</option></select></div>
    <div class="row"><span>Show trees</span><input type="checkbox" id="stTrees" ${app.world.treesA.visible || S.dim === '2d' ? 'checked' : ''}/></div>
    <div class="row"><span>Show FPS counter</span><input type="checkbox" id="stFps" ${S.showFps ? 'checked' : ''}/></div>
    <div class="row"><span>Playback rate at 1×</span><span class="muted">0.75 h of incident time per second</span></div>
    <div class="foot"><button class="btn" data-close>Close</button><button class="btn red" id="stOk">Apply</button></div>`);
  $('#stRes').value = S.res === 'auto' ? 'auto' : String(S.res);
  $('#stOk').onclick = () => {
    S.metric = $('#stUnits').value === 'm';
    app.setRes($('#stRes').value);
    if (S.dim === '3d') { app.world.treesA.visible = app.world.treesB.visible = $('#stTrees').checked; }
    S.showFps = $('#stFps').checked; if (!S.showFps) setFps(null);
    window.dispatchEvent(new Event('resize'));
    closeModal(); toast('Settings applied');
  };
}
export function setFps(v) {
  let el = $('#fps');
  if (v === null) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'fps'; el.style.cssText = 'position:absolute;left:62px;top:22px;background:rgba(40,35,30,.8);color:#fff;font:11px JetBrains Mono,monospace;padding:2px 6px;border-radius:4px;z-index:4'; $('#viewport').appendChild(el); }
  el.textContent = `${Math.round(v)} fps`;
}
export function modal(html) {
  $('#modalCard').innerHTML = html; $('#modal').classList.remove('hidden');
  $$('[data-close]', $('#modalCard')).forEach((b) => (b.onclick = closeModal));
}
export function closeModal() { $('#modal').classList.add('hidden'); $('#modalCard').classList.remove('wide'); }
document.addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });
export function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2200);
}
// ------------------------------------------------------------------ opening notice (sources, limitations, credits)
const INTRO_KEY = 'firetrace.intro.hidden';
export function showIntro(force) {
  const real = !!R(); const pt = getLang() === 'pt';
  let hidden = false; try { hidden = localStorage.getItem(INTRO_KEY + (real ? '.pg' : '.demo')) === '1'; } catch (e) { /* storage unavailable */ }
  if (hidden && !force) return;
  const li = (a) => a.map((x) => `<li>${x}</li>`).join('');
  const T2 = pt ? {
    title: real ? 'Pedrógão Grande, 17–22 jun 2017 — reconstrução ilustrativa' : 'Demonstração com dados sintéticos',
    lead: real ? { who: 'Análise de dados', what: ['Recolha e cruzamento de relatórios oficiais (CTI, ADAI), registos do ICNF/SGIF e dados de satélite.', 'Reconstrução da progressão do fogo e validação com a área ardida oficial (ICNF vs Sentinel-2: 91% de sobreposição).', 'Digitalização dos meios da ANPC e geolocalização das vítimas, do PCO e dos cortes de estrada.'] } : { who: 'Rui Mendes', what: ['Adaptação e análise.'] },
    sign: 'Rui Mendes', memo: 'Em memória das 66 vítimas.', src: 'Fontes', lim: 'Limitações', cred: 'Créditos', hide: 'Não mostrar de novo', ok: 'Compreendi',
    credits: [
      '<b>Design inspirado</b> no protótipo <i>FireTrace</i> de <b>Dilum Sanjaya</b> (vídeo no X, out. 2026). O código dele não foi usado.',
      '<b>Código gerado por IA</b> (Claude Code, Anthropic); three.js e Python.',
    ],
    sources: real ? [
      '<b>CTI (2017)</b> — Relatório da Comissão Técnica Independente: vítimas, PCO, cortes de estrada, meios aéreos.',
      '<b>CEIF/ADAI (Viegas et al., 2017)</b> — <i>O complexo de incêndios de Pedrógão Grande…</i>: cronologia e meios da ANPC.',
      '<b>Ribeiro et al. (2020)</b>, <i>Fire</i> 3(4):57 — isócronas oficiais e danos; <b>Viegas et al. (2023)</b>, IJWF.',
      '<b>ICNF</b> (SGIF, áreas ardidas 2017) · <b>Copernicus</b> (Sentinel-2, DEM) · <b>NASA FIRMS</b> · <b>ERA5</b> · <b>DGT</b> (COS 2018) · <b>OpenStreetMap</b> · <b>Observador</b>.',
    ] : ['Terreno, fogo, meios e eventos <b>gerados por procedimento</b>.'],
    limits: real ? [
      '<b>Ilustrativo e para estudo</b> — não é documento oficial.',
      'Progressão <b>digitalizada e interpolada</b> do mapa da ADAI (erro no espaço e no tempo).',
      '<b>Posições de viaturas, aeronaves e drones são ilustrativas</b>; só totais, horas e janelas aéreas são documentados. Drones simulados.',
      'Vítimas por <b>localidade</b>; PCO e cortes de estrada aproximados.',
      'Gráficos da ANPC digitalizados; meteo ERA5 (~30 km) com downburst acrescentado. Eventos citados em português.',
    ] : ['Sem valor factual.'],
  } : {
    title: real ? 'Pedrógão Grande, 17–22 Jun 2017 — illustrative reconstruction' : 'Demo with synthetic data',
    lead: real ? { who: 'Data analysis', what: ['Collected and cross-checked official reports (CTI, ADAI), ICNF/SGIF records and satellite data.', 'Reconstructed the fire progression and validated it against the official burned area (ICNF vs Sentinel-2: 91% overlap).', 'Digitized ANPC resource data and geolocated fatalities, command posts and road closures.'] } : { who: 'Rui Mendes', what: ['Adaptation and analysis.'] },
    sign: 'Rui Mendes', memo: 'In memory of the 66 victims.', src: 'Sources', lim: 'Limitations', cred: 'Credits', hide: "Don't show again", ok: 'I understand',
    credits: [
      '<b>Design inspired</b> by the <i>FireTrace</i> prototype by <b>Dilum Sanjaya</b> (video on X, Oct 2026). His code was not used.',
      '<b>Code generated by AI</b> (Claude Code, Anthropic); three.js and Python.',
    ],
    sources: real ? [
      '<b>CTI (2017)</b> — Independent Technical Commission report: fatalities, command post, road closures, aircraft.',
      '<b>CEIF/ADAI (Viegas et al., 2017)</b> — <i>O complexo de incêndios de Pedrógão Grande…</i>: timeline and ANPC resources.',
      '<b>Ribeiro et al. (2020)</b>, <i>Fire</i> 3(4):57 — official isochrones and damage; <b>Viegas et al. (2023)</b>, IJWF.',
      '<b>ICNF</b> (SGIF, 2017 burned areas) · <b>Copernicus</b> (Sentinel-2, DEM) · <b>NASA FIRMS</b> · <b>ERA5</b> · <b>DGT</b> (COS 2018) · <b>OpenStreetMap</b> · <b>Observador</b>.',
    ] : ['Terrain, fire, resources and events are <b>procedurally generated</b>.'],
    limits: real ? [
      '<b>Illustrative, for study</b> — not an official document.',
      'Progression <b>digitized and interpolated</b> from the ADAI map (spatial and temporal error).',
      '<b>Vehicle, aircraft and drone positions are illustrative</b>; only totals, times and aircraft windows are documented. Drones simulated.',
      'Fatalities by <b>locality</b>; command post and road closures approximate.',
      'ANPC charts digitized; ERA5 weather (~30 km) with added downburst. Events quoted in Portuguese.',
    ] : ['No factual value.'],
  };
  modal(`<div class="intro" data-no-i18n>
    <div class="intro-head"><h3>${T2.title}</h3>
      <div class="seg lang-seg intro-lang" title="Language / Idioma"><button data-lang2="en" class="${pt ? '' : 'on'}">🇬🇧 EN</button><button data-lang2="pt" class="${pt ? 'on' : ''}">🇵🇹 PT</button></div></div>
    ${real ? `<p class="memo">${T2.memo}</p>` : ''}
    <div class="lead-credit"><b>${T2.lead.who}</b><ul>${li(T2.lead.what)}</ul></div>
    <h4>${T2.cred}</h4><ul>${li(T2.credits)}</ul>
    <h4>${T2.src}</h4><ul>${li(T2.sources)}</ul>
    <h4>${T2.lim}</h4><ul>${li(T2.limits)}</ul>
    <p class="sign">— ${T2.sign}</p>
    <div class="foot"><label class="muted" style="margin-right:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="introHide"/> ${T2.hide}</label>
      <button class="btn red" id="introOk">${T2.ok}</button></div>
  </div>`);
  $$('[data-lang2]').forEach((b) => b.addEventListener('click', () => document.querySelector(`#topbar [data-lang="${b.dataset.lang2}"]`).click()));
  $('#modalCard').classList.add('wide'); $('#modalCard').scrollTop = 0;
  $('#introOk').onclick = () => {
    try { if ($('#introHide').checked) localStorage.setItem(INTRO_KEY + (real ? '.pg' : '.demo'), '1'); } catch (e) { /* ignore */ }
    closeModal();
  };
}
export function renderAll() {
  renderTimelineMarkers(); renderOverview(); renderAnalysis(); renderFeed(app); renderResources(app); renderDrones(app);
}
