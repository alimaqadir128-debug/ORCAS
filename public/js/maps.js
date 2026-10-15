(function () {
  'use strict';
  // Leaflet helpers. Everything is guarded: if Leaflet or map tiles are unavailable the panels still work
  // (road lines and markers draw on the dark map background without tiles).
  const COL = { open: '#46e6a0', delayed: '#ffc46b', closed: '#ff6f91' };

  function create(elId, boot) {
    const el = document.getElementById(elId);
    if (!el) return null;
    if (!window.L) { el.innerHTML = '<div class="empty">Map library did not load. Road status is still available in the lists.</div>'; return null; }
    const map = L.map(el, { zoomControl: true, minZoom: 6, maxZoom: 12, zoomSnap: 0.25, attributionControl: true, worldCopyJump: false });
    map.fitBounds(boot.bounds, { padding: [10, 10] });
    if (boot.tiles) L.tileLayer(boot.tiles.url, { attribution: boot.tiles.attribution, maxZoom: 12, crossOrigin: true }).addTo(map);
    const nodeById = {}; boot.nodes.forEach(n => { nodeById[n.id] = n; });
    const ctx = { map, boot, nodeById, edges: {}, nodes: null, loads: {}, units: {}, extra: L.layerGroup().addTo(map), el };
    ctx.nodes = L.layerGroup().addTo(map);
    boot.edges.forEach(e => {
      const a = nodeById[e.a], b = nodeById[e.b];
      ctx.edges[e.id] = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: COL.open, weight: 5, opacity: .9, lineCap: 'round' }).addTo(map)
        .bindTooltip(e.road + ': ' + a.name.split(' (')[0] + ' to ' + b.name.split(' (')[0], { sticky: true });
    });
    boot.nodes.forEach(n => {
      L.circleMarker([n.lat, n.lng], { radius: n.type === 'hub' ? 7 : 5, color: '#fff', weight: 2, fillColor: '#0f2a55', fillOpacity: 1 }).addTo(ctx.nodes)
        .bindTooltip(n.name, { direction: 'top', offset: [0, -6] });
    });
    return ctx;
  }

  function show(ctx) { if (ctx && ctx.map) setTimeout(() => { try { ctx.map.invalidateSize(); ctx.map.fitBounds(ctx.boot.bounds, { padding: [10, 10] }); } catch (e) { /* ignore */ } }, 60); }

  function drawEdges(ctx, state) {
    if (!ctx) return;
    state.edges.forEach(s => {
      const l = ctx.edges[s.id]; if (!l) return;
      const col = COL[s.status] || COL.open;
      l.setStyle({ color: col, weight: s.status === 'open' ? 4 : 6, dashArray: s.status === 'closed' ? '3 10' : null, opacity: s.status === 'open' ? .75 : .98 });
    });
  }

  function truckIcon(color) {
    return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div class="truck-pin" style="background:' + color + '">' + ico('truck', 16) + '</div>' });
  }
  function storeIcon() { return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div class="store-pin">' + ico('snow', 16) + '</div>' }); }

  function drawLoads(ctx, state, opts) {
    if (!ctx) return;
    opts = opts || {};
    const seen = {};
    state.loads.forEach(l => {
      if (!(l.lat > 0)) return;
      seen[l.id] = true;
      const col = U.riskColor(l.risk >= 80 ? 'critical' : l.risk >= 55 ? 'high' : l.risk >= 25 ? 'watch' : 'low');
      const tip = l.id + ' · ' + l.productName + ' · ' + U.int(l.kg) + ' kg<br>' + l.origin + ' to ' + l.dest + '<br>' + (l.status === 'waiting' ? 'Holding at closure' : 'ETA ' + l.etaClock) + ' · ' + U.fmt(l.temp, 1) + ' C';
      let m = ctx.loads[l.id];
      if (!m) { m = L.marker([l.lat, l.lng], { icon: truckIcon(col), zIndexOffset: 500 }).addTo(ctx.map); m.bindTooltip(tip, { direction: 'top', offset: [0, -12] }); m._col = col; ctx.loads[l.id] = m; if (opts.onClick) m.on('click', () => opts.onClick(l.id)); }
      else { m.setLatLng([l.lat, l.lng]); m.setTooltipContent(tip); if (m._col !== col) { m.setIcon(truckIcon(col)); m._col = col; } }
    });
    Object.keys(ctx.loads).forEach(id => { if (!seen[id]) { ctx.map.removeLayer(ctx.loads[id]); delete ctx.loads[id]; } });
  }

  function drawStores(ctx, state) {
    if (!ctx) return;
    state.units.filter(u => u.kind === 'store').forEach(u => {
      const tip = u.name + '<br>' + U.fmt(u.temp, 1) + ' C · battery ' + U.fmt(u.battPct, 0) + '%';
      let m = ctx.units[u.id];
      if (!m) { m = L.marker([u.lat, u.lng], { icon: storeIcon(), zIndexOffset: 300 }).addTo(ctx.map); m.bindTooltip(tip, { direction: 'top', offset: [0, -12] }); ctx.units[u.id] = m; }
      else m.setTooltipContent(tip);
    });
  }

  function drawPaths(ctx, paths) {
    if (!ctx) return;
    ctx.extra.clearLayers();
    let bounds = [];
    paths.forEach(p => {
      const pts = p.nodes.map(id => { const n = ctx.nodeById[id]; return n ? [n.lat, n.lng] : null; }).filter(Boolean);
      if (pts.length < 2) return;
      L.polyline(pts, { color: p.color, weight: p.weight || 7, opacity: p.opacity || .95, dashArray: p.dash || null, lineCap: 'round' }).addTo(ctx.extra);
      bounds = bounds.concat(pts);
    });
    if (bounds.length) { try { ctx.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 }); } catch (e) { /* ignore */ } }
  }

  window.Maps = { create, show, drawEdges, drawLoads, drawStores, drawPaths, COL };
})();
