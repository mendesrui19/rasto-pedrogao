// QA harness: paste-able into the browser console (or run via the preview) with the app loaded.
// Steps every unit for `secs` simulated seconds and reports NaN, underground, teleport and stuck problems.
window.__qaUnits = function (secs = 600, dt = 0.05, times = null) {
  const a = window.__ft, ctx = a.unitCtx, W = a.world, U = a.units;
  const report = [];
  const tlist = times || (a.real ? [17.5, 20, 30, 45, 70] : [20, 40, 60, 90]);
  for (const t of tlist) {
    a.setTime(t, true);
    for (const group of ['drones', 'air', 'ground']) {
      for (const u of U[group]) {
        const issues = { nan: 0, under: 0, jump: 0, maxJump: 0, stuck: 0 };
        let prev = null, still = 0, active = 0;
        for (let k = 0; k < secs / dt; k++) {
          ctx.clk += dt;
          const on = u.def.windows ? u.def.windows.some(([x, y]) => t >= x && t <= y) : t >= (u.def.from ?? 0);
          if (!on) break;
          active++;
          u.update(dt, ctx);
          const p = u.pos;
          if (![p.x, p.y, p.z, u.heading].every(Number.isFinite)) { issues.nan++; break; }
          const g = W.groundY(p.x, p.z);
          if (p.y < g - 2 && u.group.visible !== false) issues.under++;
          if (prev) {
            const d = Math.hypot(p.x - prev.x, p.z - prev.z);
            const lim = Math.max((u.speed || 0) * dt * 4, 30);
            if (d > lim && u.group.visible !== false) { issues.jump++; issues.maxJump = Math.max(issues.maxJump, Math.round(d)); }
            if (d < 1e-3) still++; else still = 0;
            if (still > 60 / dt) { issues.stuck++; still = 0; }
          }
          prev = { x: p.x, z: p.z };
        }
        if (!active) continue;
        const bad = issues.nan || issues.under || issues.jump || issues.stuck;
        if (bad) report.push({ t, id: u.id, kind: u.kind, status: u.status, ...issues });
      }
    }
  }
  return report;
};
