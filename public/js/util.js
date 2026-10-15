(function () {
  'use strict';
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const fmt = (v, d) => { const n = num(v); if (n === null) return '-'; const t = n.toFixed(d === undefined ? 1 : d); return /^-0(\.0+)?$/.test(t) ? t.slice(1) : t; };
  const int = v => { const n = num(v); return n === null ? '-' : Math.round(n).toLocaleString('en-IN'); };
  const hm = min => { const n = num(min); if (n === null) return '-'; const m = Math.round(n); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  const inr = v => { const n = num(v); if (n === null) return '-'; if (n >= 1e7) return 'Rs ' + (n / 1e7).toFixed(2) + ' Cr'; if (n >= 1e5) return 'Rs ' + (n / 1e5).toFixed(2) + ' L'; return 'Rs ' + Math.round(n).toLocaleString('en-IN'); };
  const RISK = { low: '#46e6a0', watch: '#ffc46b', high: '#ff9a5c', critical: '#ff6f91' };
  const riskColor = c => RISK[c] || RISK.low;

  // ----- charts (pure SVG strings, no libraries) -----
  function spark(data, color, w, h) {
    w = w || 120; h = h || 34;
    const d = (data || []).filter(num);
    if (d.length < 2) return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '"></svg>';
    const mn = Math.min.apply(null, d), mx = Math.max.apply(null, d), rg = (mx - mn) || 1;
    const pts = d.map((v, i) => (i / (d.length - 1) * (w - 4) + 2).toFixed(1) + ',' + (h - 3 - (v - mn) / rg * (h - 6)).toFixed(1)).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  let gid = 0;
  function lineChart(o) {
    const W = 640, H = o.h || 210, L = 44, R = 12, T = 12, B = 26;
    const series = (o.series || []).map(s => ({ ...s, data: (s.data || []).filter(num) })).filter(s => s.data.length > 1);
    if (!series.length) return '<div class="empty">Collecting data...</div>';
    let mn = Infinity, mx = -Infinity;
    series.forEach(s => s.data.forEach(v => { mn = Math.min(mn, v); mx = Math.max(mx, v); }));
    if (o.band) { mn = Math.min(mn, o.band[0]); mx = Math.max(mx, o.band[1]); }
    if (o.min !== undefined) mn = Math.min(mn, o.min);
    if (o.max !== undefined) mx = Math.max(mx, o.max);
    const pad = (mx - mn) * 0.12 || 1; mn -= pad; mx += pad;
    const X = (i, n) => L + i / (n - 1) * (W - L - R);
    const Y = v => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = mn + (mx - mn) * i / 4, y = Y(v);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="grid"/><text x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) + '" class="axis" text-anchor="end">' + v.toFixed(o.dec === undefined ? 1 : o.dec) + '</text>';
    }
    let band = '';
    if (o.band) { const y1 = Y(o.band[1]), y2 = Y(o.band[0]); band = '<rect x="' + L + '" y="' + y1.toFixed(1) + '" width="' + (W - L - R) + '" height="' + Math.max(0, y2 - y1).toFixed(1) + '" fill="rgba(70,230,160,.14)" rx="6"/>'; }
    let paths = '';
    series.forEach((s, k) => {
      const n = s.data.length;
      const pts = s.data.map((v, i) => X(i, n).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
      const id = 'lg' + (++gid);
      if (k === 0 && o.area !== false) {
        paths += '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s.color + '" stop-opacity=".38"/><stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>';
        paths += '<polygon points="' + L + ',' + (H - B) + ' ' + pts + ' ' + (W - R) + ',' + (H - B) + '" fill="url(#' + id + ')"/>';
      }
      paths += '<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    const xl = o.xLabel ? '<text x="' + (W - R) + '" y="' + (H - 6) + '" class="axis" text-anchor="end">now</text><text x="' + L + '" y="' + (H - 6) + '" class="axis">' + esc(o.xLabel) + '</text>' : '';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'chart') + '">' + g + band + paths + xl + '</svg>';
  }
  function ring(pct, color, big, small) {
    const p = Math.max(0, Math.min(100, num(pct) === null ? 0 : pct)), r = 44, c = 2 * Math.PI * r;
    return '<div class="ring"><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="' + r + '" class="ring-bg"/><circle cx="55" cy="55" r="' + r + '" class="ring-fg" stroke="' + color + '" stroke-dasharray="' + (c * p / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 55 55)"/></svg><div class="ring-txt"><b>' + esc(big) + '</b><span>' + esc(small || '') + '</span></div></div>';
  }
  function bars(items, fmtv) {
    const mx = Math.max.apply(null, items.map(i => i.value).concat([1]));
    return '<div class="bars">' + items.map(i => '<div class="bar-row"><span class="bar-l">' + esc(i.label) + '</span><div class="bar-t"><i style="width:' + Math.max(2, i.value / mx * 100).toFixed(1) + '%;background:' + (i.color || 'linear-gradient(90deg,#35e0d2,#8b7cff)') + '"></i></div><span class="bar-v">' + esc(fmtv ? fmtv(i.value) : i.value) + '</span></div>').join('') + '</div>';
  }
  function kpi(tone, icon, label, value, sub) {
    return '<div class="kpi clay tone-' + tone + '"><div class="kpi-ic">' + ico(icon, 22) + '</div><div class="kpi-b"><div class="kpi-l">' + esc(label) + '</div><div class="kpi-v">' + value + '</div>' + (sub ? '<div class="kpi-s">' + sub + '</div>' : '') + '</div></div>';
  }
  function chip(text, tone) { return '<span class="chip ' + (tone || '') + '">' + esc(text) + '</span>'; }
  function toast(msg, bad) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2800);
  }
  async function api(path, opts) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch('/api' + path, Object.assign({ cache: 'no-store', signal: ctl.signal }, opts || {}));
      let j = null; try { j = await r.json(); } catch (e) { /* non-json */ }
      if (!r.ok) throw new Error((j && j.error) || ('Request failed (' + r.status + ')'));
      return j;
    } finally { clearTimeout(timer); }
  }
  const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  window.U = { esc, fmt, int, hm, inr, num, riskColor, RISK, spark, lineChart, ring, bars, kpi, chip, toast, api, post };
})();
