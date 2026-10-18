// Lightweight canvas charts: line/area/bar series, reference markers, bands, spans, legend and hover readout.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export class Chart {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cfg = null; this.hoverX = null;
    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.hoverPx = e.clientX - r.left; this.hoverX = this.xToValue(this.hoverPx); if (this.cfg) this.draw(this.cfg); });
    canvas.addEventListener('pointerleave', () => { this.hoverX = null; if (this.cfg) this.draw(this.cfg); });
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr; this.w = r.width; this.h = r.height;
  }
  draw(cfg) {
    this.cfg = cfg; this.resize();
    const c = this.ctx, W = this.w, H = this.h;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const padL = cfg.padL ?? 38, padR = cfg.padR ?? 10, padT = cfg.padT ?? (cfg.legend ? 18 : 6), padB = 16;
    const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    const [xa, xb] = cfg.x, [ya, yb] = cfg.y;
    const X = (v) => x0 + (v - xa) / (xb - xa) * (x1 - x0);
    const Y = (v) => y1 - (clamp(v, ya, yb) - ya) / (yb - ya) * (y1 - y0);
    this.X = X; this.Y = Y; this.x0 = x0; this.x1 = x1;
    c.font = '10px Inter, sans-serif'; c.textBaseline = 'middle';
    // horizontal bands (e.g. danger classes) and vertical spans (e.g. fatality window)
    (cfg.bands || []).forEach((b) => { c.fillStyle = b.color; c.fillRect(x0, Y(Math.min(b.y1, yb)), x1 - x0, Y(Math.max(b.y0, ya)) - Y(Math.min(b.y1, yb))); });
    let row = 0;
    (cfg.spans || []).forEach((s) => {
      const a = clamp(X(s.x0), x0, x1), b = clamp(X(s.x1), x0, x1); if (b <= a) return;
      c.fillStyle = s.color; c.fillRect(a, y0, Math.max(1.5, b - a), y1 - y0);
      if (s.label) {
        // labels of narrow spans are stacked so neighbouring spans never overprint
        c.save(); c.font = '600 9px Inter, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
        const tw = c.measureText(s.label).width; const yy = y0 + 2 + (b - a < tw + 6 ? row++ * 11 : 0);
        const tx = Math.min(a + 3, x1 - tw - 2);
        c.fillStyle = 'rgba(251,249,246,0.85)'; c.fillRect(tx - 2, yy - 1, tw + 4, 11);
        c.fillStyle = s.text || '#8a3a2a'; c.fillText(s.label, tx, yy); c.restore();
      }
    });
    // grid + y labels
    (cfg.yTicks || []).forEach((v) => {
      c.strokeStyle = '#e1dbd1'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, Math.round(Y(v)) + 0.5); c.lineTo(x1, Math.round(Y(v)) + 0.5); c.stroke();
      c.fillStyle = '#6f675f'; c.textAlign = 'right'; c.fillText(cfg.yFmt ? cfg.yFmt(v) : v.toLocaleString('en-US'), x0 - 5, Y(v));
    });
    if (cfg.y2) {
      const [za, zb] = cfg.y2.range; const Y2 = (v) => y1 - (clamp(v, za, zb) - za) / (zb - za) * (y1 - y0); this.Y2 = Y2;
      (cfg.y2.ticks || []).forEach((v) => { c.fillStyle = cfg.y2.color || '#6f675f'; c.textAlign = 'left'; c.fillText(cfg.y2.fmt ? cfg.y2.fmt(v) : String(v), x1 + 4, Y2(v)); });
    }
    // x labels
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#6f675f';
    let lastX = -1e9;
    (cfg.xTicks || []).forEach(([v, label], i, arr) => {
      const x = X(v); const w = c.measureText(label).width;
      const isLast = i === arr.length - 1;
      if (x - w / 2 < lastX + 6 && !isLast) return;
      if (isLast && x - w / 2 < lastX + 6) return;
      c.fillText(label, clamp(x, w / 2, W - w / 2), H - 3); lastX = x + w / 2;
    });
    // series
    (cfg.series || []).forEach((s) => (s.type === 'bar' ? this._bars(s, X, s.axis === 2 ? this.Y2 : Y, y1, cfg) : this._series(s, X, s.axis === 2 ? this.Y2 : Y, y1, cfg)));
    // reference points (official values to validate against)
    (cfg.refs || []).forEach((r) => {
      const px = X(r.x), py = (r.axis === 2 ? this.Y2 : Y)(r.y);
      c.save(); c.translate(px, py); c.rotate(Math.PI / 4); c.fillStyle = '#fff'; c.strokeStyle = r.color || '#2a2520'; c.lineWidth = 1.5;
      c.fillRect(-3.5, -3.5, 7, 7); c.strokeRect(-3.5, -3.5, 7, 7); c.restore();
    });
    // cursor
    if (cfg.cursor !== undefined && cfg.cursor !== null && cfg.cursor >= xa && cfg.cursor <= xb) {
      const cx = Math.round(X(cfg.cursor)) + 0.5;
      c.strokeStyle = '#4a433d'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(cx, y0 + 2); c.lineTo(cx, y1); c.stroke();
      const dot = (y, fill) => { c.beginPath(); c.arc(cx, y, 3.6, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.lineWidth = 1.3; c.strokeStyle = '#4a433d'; c.stroke(); };
      dot(y0 + 3, '#fff'); dot(y1, '#fff');
      if (cfg.cursorY !== undefined) dot(Y(cfg.cursorY), '#fff');
    }
    if (cfg.marker) {
      c.beginPath(); c.arc(X(cfg.marker[0]), Y(cfg.marker[1]), 4, 0, Math.PI * 2); c.fillStyle = cfg.marker[2] || '#d63a2a'; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke();
    }
    if (cfg.legend) this._legend(cfg, x0, x1);
    if (this.hoverX !== null && this.hoverX >= xa && this.hoverX <= xb && cfg.hover !== false) this._hover(cfg, X, Y, y0, y1, W);
  }
  _legend(cfg, x0, x1) {
    const c = this.ctx; c.save(); c.font = '9.5px Inter, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
    let x = x0;
    const items = [...(cfg.series || []).filter((s) => s.label && !s.noLegend).map((s) => ({ label: s.label, color: s.color, kind: s.type === 'bar' ? 'bar' : 'line', dashed: s.dashed })),
      ...(cfg.refs?.length && cfg.refsLabel ? [{ label: cfg.refsLabel, color: '#2a2520', kind: 'ref' }] : [])];
    for (const it of items) {
      const w = c.measureText(it.label).width + 18; if (x + w > x1) break;
      c.strokeStyle = it.color; c.fillStyle = it.color; c.lineWidth = 2;
      if (it.kind === 'bar') c.fillRect(x, 5, 9, 7);
      else if (it.kind === 'ref') { c.save(); c.translate(x + 4.5, 8.5); c.rotate(Math.PI / 4); c.fillStyle = '#fff'; c.lineWidth = 1.3; c.fillRect(-3, -3, 6, 6); c.strokeRect(-3, -3, 6, 6); c.restore(); }
      else { c.beginPath(); if (it.dashed) c.setLineDash([2, 2]); c.moveTo(x, 8.5); c.lineTo(x + 10, 8.5); c.stroke(); c.setLineDash([]); }
      c.fillStyle = '#57504a'; c.fillText(it.label, x + 13, 9); x += w + 4;
    }
    c.restore();
  }
  _hover(cfg, X, Y, y0, y1, W) {
    const c = this.ctx, hx = this.hoverX, px = X(hx);
    c.save(); c.strokeStyle = 'rgba(42,37,32,0.35)'; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(Math.round(px) + 0.5, y0); c.lineTo(Math.round(px) + 0.5, y1); c.stroke(); c.setLineDash([]);
    const rows = [];
    for (const s of cfg.series || []) {
      if (!s.label || !s.pts || !s.pts.length) continue;
      const v = s.type === 'bar' ? nearestBar(s.pts, hx, s.barW) : interp(s.pts, hx, s.step);
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      rows.push({ label: s.label, color: s.color, v, fmt: s.fmt || cfg.fmt });
      const yy = (s.axis === 2 ? this.Y2 : Y)(v);
      if (s.type !== 'bar') { c.beginPath(); c.arc(px, yy, 3, 0, Math.PI * 2); c.fillStyle = s.color; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.stroke(); }
    }
    if (!rows.length) { c.restore(); return; }
    const head = cfg.xFmt ? cfg.xFmt(hx) : hx.toFixed(1);
    c.font = '600 10px Inter, sans-serif'; let w = c.measureText(head).width;
    c.font = '10px Inter, sans-serif';
    const lines = rows.map((r) => `${r.label}: ${r.fmt ? r.fmt(r.v) : Math.round(r.v).toLocaleString('en-US')}`);
    lines.forEach((l) => { w = Math.max(w, c.measureText(l).width + 12); });
    const bw = w + 14, bh = 16 + lines.length * 13;
    let bx = px + 10; if (bx + bw > W - 4) bx = px - bw - 10;
    const by = y0 + 2;
    c.fillStyle = 'rgba(42,37,32,0.92)'; roundRect(c, bx, by, bw, bh, 5); c.fill();
    c.fillStyle = '#fff'; c.font = '600 10px Inter, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText(head, bx + 7, by + 4);
    c.font = '10px Inter, sans-serif';
    lines.forEach((l, i) => { c.fillStyle = rows[i].color; c.fillRect(bx + 7, by + 19 + i * 13, 6, 6); c.fillStyle = '#efe9e0'; c.fillText(l, bx + 18, by + 16 + i * 13); });
    c.restore();
  }
  _bars(s, X, Y, yBase, cfg) {
    const c = this.ctx; const bw = s.barW ?? 1;
    c.save(); c.fillStyle = s.color; c.globalAlpha = s.alpha ?? 0.9;
    for (const [x, y, col] of s.pts) {
      const a = X(x - bw / 2), b = X(x + bw / 2);
      const w = Math.max(1.5, b - a - (s.gap ?? 1));
      if (col) c.fillStyle = col; else c.fillStyle = s.color;
      if (s.splitAt !== undefined && x > s.splitAt) c.globalAlpha = (s.alpha ?? 0.9) * 0.35; else c.globalAlpha = s.alpha ?? 0.9;
      c.fillRect(a, Y(y), w, yBase - Y(y));
    }
    c.restore();
  }
  _series(s, X, Y, yBase, cfg) {
    const c = this.ctx; const pts = s.pts; if (!pts || pts.length < 2) return;
    const split = s.splitAt;
    const solid = split === undefined ? pts : pts.filter((p) => p[0] <= split);
    const rest = split === undefined ? [] : pts.filter((p) => p[0] >= split);
    if (split !== undefined && solid.length && rest.length && solid[solid.length - 1][0] < split) {
      const a = solid[solid.length - 1], b = rest[0]; const f = (split - a[0]) / ((b[0] - a[0]) || 1);
      const m = [split, a[1] + (b[1] - a[1]) * f]; solid.push(m); rest.unshift(m);
    }
    const line = (arr, dashed, alpha) => {
      if (arr.length < 2) return;
      c.save();
      if (s.fill) {
        const g = c.createLinearGradient(0, Y(cfg.y[1]), 0, yBase);
        g.addColorStop(0, s.fill.replace('A', alpha * 0.45)); g.addColorStop(1, s.fill.replace('A', alpha * 0.08));
        c.beginPath(); c.moveTo(X(arr[0][0]), yBase); arr.forEach((p) => c.lineTo(X(p[0]), Y(p[1]))); c.lineTo(X(arr[arr.length - 1][0]), yBase); c.closePath();
        c.fillStyle = g; c.fill();
      }
      c.beginPath(); arr.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
      c.strokeStyle = s.color; c.globalAlpha = alpha; c.lineWidth = s.width || 1.6; c.lineJoin = 'round';
      if (dashed || s.dashed) c.setLineDash([3, 3]);
      c.stroke(); c.restore();
    };
    line(solid, false, s.alpha ?? 1);
    if (rest.length) line(rest, s.futureDashed !== false, (s.alpha ?? 1) * (s.futureAlpha ?? 0.55));
    if (s.endDot && solid.length) { const p = solid[solid.length - 1]; c.beginPath(); c.arc(X(p[0]), Y(p[1]), 3.2, 0, Math.PI * 2); c.fillStyle = s.color; c.fill(); }
  }
  xToValue(px) { if (!this.cfg) return 0; const [xa, xb] = this.cfg.x; return xa + (px - this.x0) / (this.x1 - this.x0) * (xb - xa); }
}
function interp(pts, x, step) {
  if (x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= x) {
      const a = pts[i - 1], b = pts[i];
      if (a[1] === null || b[1] === null) return null;
      if (step) return a[1];
      const f = (x - a[0]) / ((b[0] - a[0]) || 1); return a[1] + (b[1] - a[1]) * f;
    }
  }
  return pts[pts.length - 1][1];
}
function nearestBar(pts, x, bw = 1) { let best = null, bd = bw * 0.75; for (const p of pts) { const d = Math.abs(p[0] - x); if (d <= bd) { bd = d; best = p[1]; } } return best; }
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
