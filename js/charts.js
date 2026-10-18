// Lightweight canvas charts used in the bottom panel.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export class Chart {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cfg = null; }
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
    const padL = cfg.padL ?? 38, padR = 10, padT = 6, padB = 16;
    const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    const [xa, xb] = cfg.x, [ya, yb] = cfg.y;
    const X = (v) => x0 + (v - xa) / (xb - xa) * (x1 - x0);
    const Y = (v) => y1 - (v - ya) / (yb - ya) * (y1 - y0);
    this.X = X; this.Y = Y; this.x0 = x0; this.x1 = x1;
    c.font = '10px Inter, sans-serif'; c.textBaseline = 'middle';
    // grid + y labels
    (cfg.yTicks || []).forEach((v) => {
      c.strokeStyle = '#e1dbd1'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, Math.round(Y(v)) + 0.5); c.lineTo(x1, Math.round(Y(v)) + 0.5); c.stroke();
      c.fillStyle = '#6f675f'; c.textAlign = 'right'; c.fillText(cfg.yFmt ? cfg.yFmt(v) : v.toLocaleString('en-US'), x0 - 5, Y(v));
    });
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
    (cfg.series || []).forEach((s) => this._series(s, X, Y, y1, cfg));
    // cursor
    if (cfg.cursor !== undefined && cfg.cursor !== null) {
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
  }
  _series(s, X, Y, yBase, cfg) {
    const c = this.ctx; const pts = s.pts; if (!pts || pts.length < 2) return;
    const split = s.splitAt;
    const solid = split === undefined ? pts : pts.filter((p) => p[0] <= split);
    const rest = split === undefined ? [] : pts.filter((p) => p[0] >= split);
    if (split !== undefined && solid.length && rest.length && solid[solid.length - 1][0] < split) {
      // interpolate join
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
      if (dashed) c.setLineDash([3, 3]);
      if (s.step) { /* already stepped */ }
      c.stroke(); c.restore();
    };
    line(solid, false, s.alpha ?? 1);
    if (rest.length) line(rest, s.futureDashed !== false, (s.alpha ?? 1) * (s.futureAlpha ?? 0.55));
    if (s.endDot && solid.length) { const p = solid[solid.length - 1]; c.beginPath(); c.arc(X(p[0]), Y(p[1]), 3.2, 0, Math.PI * 2); c.fillStyle = s.color; c.fill(); }
  }
  xToValue(px) { if (!this.cfg) return 0; const [xa, xb] = this.cfg.x; return xa + (px - this.x0) / (this.x1 - this.x0) * (xb - xa); }
}
