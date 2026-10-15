(function () {
  'use strict';
  const { esc, fmt, int, hm, inr, riskColor, spark, lineChart, ring, bars, kpi, chip, toast, api, post } = U;
  const $ = (root, sel) => root.querySelector(sel);
  const A = () => window.APP;
  const actions = {};
  const list = [];

  const SRC = { solar: ['Solar', 'ok'], battery: ['Battery', 'warn'], depleted: ['Battery empty', 'bad'] };
  const RISKCHIP = { low: 'ok', watch: 'warn', high: 'warn', critical: 'bad' };
  const EDGECHIP = { open: 'ok', delayed: 'warn', closed: 'bad' };
  const SEVIC = { critical: 'tone-coral', warning: 'tone-amber', info: 'tone-ice' };
  const productIcon = k => (k === 'trout' || k === 'dairy' || k === 'vaccine') ? 'snow' : 'leaf';
  const setIfChanged = (el, html) => { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } };
  const unitName = (s, id) => { const u = s.units.find(x => x.id === id); return u ? u.name : id; };
  const legendHtml = items => '<div class="legend">' + items.map(i => '<span><i style="background:' + i[0] + '"></i>' + esc(i[1]) + '</span>').join('') + '</div>';
  const mapLegend = '<div class="map-legend"><span><i style="background:#46e6a0"></i>Open</span><span><i style="background:#ffc46b"></i>Slowed</span><span><i style="background:repeating-linear-gradient(90deg,#ff6f91 0 4px,transparent 4px 8px)"></i>Closed</span></div>';

  // ---------- 1. Overview ----------
  list.push({
    id: 'overview', title: 'Control Room Overview', sub: 'Stores, cold boxes and roads at a glance.', icon: 'dashboard',
    build(r) {
      r.innerHTML = '<div class="grid g-kpi" id="ov-kpi"></div>' +
        '<div class="grid g-21" style="margin-top:24px"><div class="card glass"><h3>' + ico('globe') + 'Live network<span class="sp" id="ov-note"></span></h3><div class="map" id="ov-map"></div>' + mapLegend + '</div>' +
        '<div class="stack"><div class="card glass"><h3>' + ico('shield') + 'Needs attention</h3><div class="list" id="ov-risk"></div></div>' +
        '<div class="card glass"><h3>' + ico('activity') + 'Recent activity</h3><div id="ov-act"></div></div></div></div>';
    },
    onShow(r) { const a = A(); if (!this.map) this.map = Maps.create('ov-map', a.boot); Maps.show(this.map); },
    update(s, r) {
      const st = s.stats;
      setIfChanged($(r, '#ov-kpi'),
        kpi('cyan', 'thermo', 'Units in safe band', st.inBandPct + '<small>%</small>', st.unitsOnline + ' units online') +
        kpi(st.alertsCritical ? 'coral' : st.alertsActive ? 'amber' : 'green', 'bell', 'Active alerts', int(st.alertsActive), st.alertsCritical + ' critical') +
        kpi('violet', 'truck', 'Loads moving', int(st.loadsMoving), st.loadsWaiting + ' holding at closures') +
        kpi('amber', 'sun', 'Solar output', fmt(st.solarKw, 1) + '<small> kW</small>', 'Battery average ' + st.avgBattPct + '%'));
      if (this.map) { Maps.drawEdges(this.map, s); Maps.drawStores(this.map, s); Maps.drawLoads(this.map, s); }
      $(r, '#ov-note').textContent = st.closedRoads + ' closed, ' + st.delayedRoads + ' slowed';
      const top = s.units.slice().sort((a, b) => b.riskScore - a.riskScore).slice(0, 3);
      setIfChanged($(r, '#ov-risk'), top.map(u => '<div class="item"><div><div class="t">' + esc(u.name) + '</div><div class="d">' + esc(u.productName) + ' · ' + fmt(u.temp, 1) + ' °C</div></div><div class="r">' + chip('Risk ' + u.riskScore, RISKCHIP[u.riskClass]) + '</div></div>').join(''));
      setIfChanged($(r, '#ov-act'), s.activity.slice(0, 5).map(a => '<div class="act-line ' + esc(a.kind) + '"><span class="tm">' + esc(a.clock) + '</span><span>' + esc(a.text) + '</span></div>').join('') || '<div class="empty">No activity yet</div>');
    }
  });

  // ---------- 2. Solar Cold Store ----------
  list.push({
    id: 'store', title: 'Solar Cold Store', sub: 'Solar generation, battery and cooling load for each orchard store.', icon: 'sun',
    build(r) {
      r.innerHTML = '<div class="row" style="margin-bottom:22px"><div class="seg" id="st-tabs"></div></div><div id="st-body"></div>';
    },
    update(s, r) {
      const stores = s.units.filter(u => u.kind === 'store');
      const a = A(); if (!stores.find(u => u.id === a.sel.store)) a.sel.store = stores[0] && stores[0].id;
      setIfChanged($(r, '#st-tabs'), stores.map(u => '<button class="' + (u.id === a.sel.store ? 'on' : '') + '" data-act="selStore" data-id="' + esc(u.id) + '">' + esc(u.name.replace(' Store', '').replace(' Hub', '')) + '</button>').join(''));
      const u = stores.find(x => x.id === a.sel.store); if (!u) { $(r, '#st-body').innerHTML = '<div class="empty">No stores online</div>'; return; }
      const src = SRC[u.powerSrc] || SRC.solar;
      const bc = u.battPct < 20 ? '#ff6f91' : u.battPct < 45 ? '#ffc46b' : '#46e6a0';
      const status = u.fault ? chip('Compressor fault', 'bad') : (u.temp >= u.band[0] && u.temp <= u.band[1]) ? chip('In safe band', 'ok') : chip('Out of band', 'bad');
      setIfChanged($(r, '#st-body'),
        '<div class="grid g-21"><div class="card glass"><h3>' + ico('activity') + 'Solar vs cooling load<span class="sp">kW</span></h3>' +
        lineChart({ series: [{ data: u.hist.solar, color: '#ffc46b' }, { data: u.hist.load, color: '#8b7cff' }], min: 0, dec: 1, label: 'Solar versus load', xLabel: 'earlier' }) +
        legendHtml([['#ffc46b', 'Solar generation'], ['#8b7cff', 'Cooling load']]) + '</div>' +
        '<div class="card glass"><h3>' + ico('battery') + esc(u.name) + '</h3><div class="row" style="gap:22px;flex-wrap:nowrap;margin-bottom:18px">' + ring(u.battPct, bc, Math.round(u.battPct) + '%', fmt(u.battKwh, 1) + ' kWh') +
        '<div class="small muted">Lasts about <b style="color:var(--txt)">' + (u.loadW > 0 ? hm(u.battKwh * 1000 / u.loadW * 60) : '-') + '</b> at the current load with no sun.</div></div>' +
        '<div class="kv"><div><span>Status</span><b>' + status + '</b></div><div><span>Power source</span><b>' + chip(src[0], src[1]) + '</b></div>' +
        '<div><span>Temperature</span><b>' + fmt(u.temp, 1) + ' °C <i>set ' + fmt(u.setpoint, 1) + '</i></b></div><div><span>Solar now</span><b>' + int(u.solarW) + ' W <i>of ' + fmt(u.solarPeakW / 1000, 1) + ' kWp</i></b></div>' +
        '<div><span>Cooling load</span><b>' + int(u.loadW) + ' W <i>' + (u.fault ? 'fault' : u.compOn ? 'running' : 'idle') + '</i></b></div><div><span>Energy since start</span><b>' + fmt(u.kwhSolar, 1) + ' kWh <i>generated</i></b></div></div></div></div>');
    }
  });
  actions.selStore = el => { A().sel.store = el.dataset.id; A().render(); };

  // ---------- 3. Cold Box Health ----------
  list.push({
    id: 'boxes', title: 'Cold Box Health', sub: 'Live condition of every cold store and transit box.', icon: 'thermo',
    build(r) {
      r.innerHTML = '<div class="toolbar"><div class="seg" id="bx-f"></div><div class="demo"><span class="small muted">Demo fault</span><select class="select" id="bx-demo" data-change="selDemo" aria-label="Unit for demo fault"></select>' +
        '<button class="btn sm amber" data-act="fault" data-type="door">' + ico('door', 14) + 'Open door</button><button class="btn sm coral" data-act="fault" data-type="compressor">' + ico('wrench', 14) + 'Fail compressor</button><button class="btn sm ice" data-act="fault" data-type="clear">' + ico('check', 14) + 'Clear</button></div></div>' +
        '<div class="grid g-cards" id="bx-grid"></div>';
    },
    update(s, r) {
      const f = A().sel.boxFilter;
      setIfChanged($(r, '#bx-f'), [['all', 'All'], ['store', 'Cold stores'], ['box', 'Transit boxes']].map(x => '<button class="' + (f === x[0] ? 'on' : '') + '" data-act="boxFilter" data-id="' + x[0] + '">' + x[1] + '</button>').join(''));
      const sel = $(r, '#bx-demo'); const key = s.units.map(u => u.id).join(',');
      if (sel._k !== key) { sel._k = key; sel.innerHTML = s.units.map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>').join(''); }
      if (!s.units.find(u => u.id === A().sel.demo)) A().sel.demo = s.units[0] && s.units[0].id;
      sel.value = A().sel.demo || '';
      const us = s.units.filter(u => f === 'all' || u.kind === f);
      setIfChanged($(r, '#bx-grid'), us.map(u => {
        const inBand = u.temp >= u.band[0] && u.temp <= u.band[1];
        const status = u.fault ? chip('Compressor fault', 'bad') : u.doorOpen ? chip('Door open', 'bad') : inBand ? chip('In band', 'ok') : chip('Out of band', 'bad');
        const note = [u.compOn ? 'Cooling' : 'Idle', (SRC[u.powerSrc] || SRC.solar)[0] + ' power', u.source === 'sensor' ? 'Live sensor' : 'Simulated'].join(' · ');
        return '<div class="card glass unit"><div class="unit-h"><div><div class="unit-n">' + esc(u.name) + '</div><div class="unit-s">' + esc(u.productName) + ' · ' + int(u.kg) + ' kg</div></div><div style="margin-left:auto">' + status + '</div></div>' +
          '<div class="unit-t"><b style="color:' + (inBand ? 'var(--txt)' : '#ffb0c3') + '">' + fmt(u.temp, 1) + '</b><span>°C</span><em>set ' + fmt(u.setpoint, 1) + '</em></div>' +
          '<div class="unit-line"><span>Humidity <b>' + fmt(u.rh, 0) + '%</b></span><span>Battery <b>' + fmt(u.battPct, 0) + '%</b></span><span>Risk <b style="color:' + riskColor(u.riskClass) + '">' + u.riskScore + '</b></span></div>' +
          '<div class="unit-note">' + esc(note) + '</div></div>';
      }).join('') || '<div class="empty">No units</div>');
    }
  });
  actions.boxFilter = el => { A().sel.boxFilter = el.dataset.id; A().render(); };
  actions.selDemo = el => { A().sel.demo = el.value; };
  actions.fault = async el => {
    const id = A().sel.demo; if (!id) return;
    try { await post('/units/' + encodeURIComponent(id) + '/fault', { type: el.dataset.type }); toast(el.dataset.type === 'clear' ? 'Faults cleared' : 'Fault injected for demo'); await A().refresh(); }
    catch (e) { toast(e.message, true); }
  };

  // ---------- 4. Cooling & Airflow ----------
  list.push({
    id: 'airflow', title: 'Cooling & Airflow', sub: 'Fan, coil and air-temperature behaviour inside the selected unit.', icon: 'fan',
    build(r) {
      r.innerHTML = '<div class="row" style="margin-bottom:18px"><div class="field" style="max-width:380px"><label for="af-sel">Unit</label><select class="select" id="af-sel" data-change="selAir"></select></div><p class="small muted" style="flex:1;min-width:240px;max-width:620px">Shows how evenly cold air reaches the crates. Even air means even ageing. A wide top-to-bottom gap or a weak fan points to a hot spot before produce is damaged. Internal probe values are modelled in this prototype.</p></div>' +
        '<div class="grid g-21"><div class="card glass"><h3>' + ico('fan') + 'Air circulation<span class="sp" id="af-state"></span></h3><div class="airbox">' +
        '<svg viewBox="0 0 520 250" role="img" aria-label="Cooling airflow diagram"><defs><linearGradient id="afc" x1="0" x2="1"><stop offset="0" stop-color="#35e0d2"/><stop offset="1" stop-color="#8b7cff"/></linearGradient></defs>' +
        '<rect x="10" y="10" width="500" height="230" rx="26" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.35)" stroke-width="2"/>' +
        '<rect x="28" y="28" width="62" height="86" rx="14" fill="#8fb8ee" opacity=".9"/><text x="59" y="76" fill="#06233a" font-size="12" font-weight="800" text-anchor="middle">COIL</text><text x="59" y="94" id="af-coil" fill="#06233a" font-size="12" font-weight="800" text-anchor="middle">-</text>' +
        '<g id="af-fan" class="fan-spin" style="animation-duration:1s"><circle cx="59" cy="160" r="26" fill="rgba(255,255,255,.12)" stroke="#35e0d2" stroke-width="2.5"/><path d="M59 160 59 138a10 10 0 0 1 9 14zM59 160 78 171a10 10 0 0 1-17 7zM59 160 40 171a10 10 0 0 1 3-17z" fill="#35e0d2"/></g>' +
        '<path id="af-f1" class="flow" d="M100 50 C 220 40, 400 40, 480 58" fill="none" stroke="url(#afc)" stroke-width="4" stroke-linecap="round" style="animation-duration:1.4s"/>' +
        '<path id="af-f2" class="flow" d="M100 70 C 240 70, 380 90, 480 100" fill="none" stroke="url(#afc)" stroke-width="4" stroke-linecap="round" style="animation-duration:1.6s"/>' +
        '<path id="af-f3" class="flow" d="M480 190 C 380 215, 220 215, 100 170" fill="none" stroke="#ffc46b" stroke-width="4" stroke-linecap="round" style="animation-duration:1.5s;animation-direction:normal" opacity=".85"/>' +
        '<g fill="#d9a35e"><rect x="150" y="150" width="90" height="62" rx="9"/><rect x="250" y="150" width="90" height="62" rx="9"/><rect x="350" y="150" width="90" height="62" rx="9"/><rect x="200" y="112" width="90" height="38" rx="9" opacity=".92"/><rect x="300" y="112" width="90" height="38" rx="9" opacity=".92"/></g>' +
        '<g font-size="12" font-weight="800" fill="#eef6ff"><circle cx="485" cy="40" r="6" fill="#35e0d2"/><text x="474" y="30" text-anchor="end">Top <tspan id="af-ptop">-</tspan></text><circle cx="485" cy="125" r="6" fill="#8b7cff"/><text x="474" y="120" text-anchor="end">Mid <tspan id="af-pmid">-</tspan></text><circle cx="485" cy="205" r="6" fill="#ffc46b"/><text x="474" y="228" text-anchor="end">Bottom <tspan id="af-pbot">-</tspan></text></g></svg></div>' +
        '<div class="legend"><span><i style="background:#35e0d2"></i>Cold supply air</span><span><i style="background:#ffc46b"></i>Warm return air</span></div></div>' +
        '<div class="stack" id="af-side"></div></div>';
    },
    update(s, r) {
      const a = A(); const sel = $(r, '#af-sel');
      const key = s.units.map(u => u.id).join(',');
      if (sel._k !== key) { sel._k = key; sel.innerHTML = s.units.map(u => '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (' + esc(u.productName) + ')</option>').join(''); }
      if (!s.units.find(u => u.id === a.sel.air)) a.sel.air = s.units[0] && s.units[0].id;
      sel.value = a.sel.air;
      const u = s.units.find(x => x.id === a.sel.air); if (!u) return;
      const f = u.airflow;
      const dur = Math.max(0.5, 2.6 - u.fanPct / 100 * 2.0).toFixed(2) + 's';
      ['af-f1', 'af-f2', 'af-f3'].forEach(id => { $(r, '#' + id).style.animationDuration = dur; });
      $(r, '#af-fan').style.animationDuration = Math.max(0.35, 2.2 - u.fanPct / 100 * 1.8).toFixed(2) + 's';
      $(r, '#af-coil').textContent = fmt(f.coilT, 1) + ' C';
      $(r, '#af-ptop').textContent = fmt(f.probes.top, 1) + ' C'; $(r, '#af-pmid').textContent = fmt(f.probes.mid, 1) + ' C'; $(r, '#af-pbot').textContent = fmt(f.probes.bottom, 1) + ' C';
      $(r, '#af-state').textContent = u.fault ? 'Compressor fault' : u.compOn ? 'Compressor running' : 'Compressor idle';
      const strat = f.probes.top - f.probes.bottom;
      setIfChanged($(r, '#af-side'),
        '<div class="card glass"><h3>' + ico('thermo') + 'Readings</h3><div class="kv">' +
        '<div><span>Fan speed</span><b>' + u.fanPct + '% <i>' + int(f.flowM3h) + ' m3/h</i></b></div>' +
        '<div><span>Supply air</span><b>' + fmt(f.supplyT, 1) + ' °C</b></div><div><span>Return air</span><b>' + fmt(f.returnT, 1) + ' °C</b></div>' +
        '<div><span>Top of load</span><b>' + fmt(f.probes.top, 1) + ' °C</b></div><div><span>Middle</span><b>' + fmt(f.probes.mid, 1) + ' °C</b></div><div><span>Bottom</span><b>' + fmt(f.probes.bottom, 1) + ' °C</b></div>' +
        '<div><span>Humidity</span><b>' + fmt(u.rh, 0) + '% <i>target ' + ((A().boot.products.find(p => p.key === u.product) || {}).rh) + '%</i></b></div></div>' +
        '<p class="small muted" style="margin-top:14px">Top-to-bottom spread <b style="color:var(--txt)">' + fmt(strat, 2) + ' °C</b>. ' + (strat > 0.8 ? 'Air is stratifying; fans should run faster.' : 'Air is mixing well.') + '</p></div>');
    }
  });
  actions.selAir = el => { A().sel.air = el.value; A().render(); };

  // ---------- 5. Spoilage Risk ----------
  list.push({
    id: 'spoilage', title: 'Spoilage Risk', sub: 'How fast each load is losing shelf life right now.', icon: 'drop',
    build(r) {
      r.innerHTML = '<div class="card glass"><h3>' + ico('shield') + 'Risk by unit<span class="sp">highest first</span></h3><div class="table-wrap"><table><thead><tr><th>Unit</th><th>Product</th><th>Temp</th><th>Ageing</th><th>Shelf life used</th><th>Est. days left</th><th>Risk</th></tr></thead><tbody id="sp-body"></tbody></table></div></div>' +
        '<details class="card glass fold" style="margin-top:22px"><summary>' + ico('leaf') + 'How the model works</summary><p class="small muted" style="max-width:880px;margin:14px 0">Each product ages faster as it gets warmer: <b style="color:var(--txt)">ageing factor = Q10 ^ ((T - ideal) / 10)</b>. A factor of 2.5 means shelf life is used 2.5 times faster than at the ideal temperature. Low humidity, freezing and chilling injury add penalties. The risk score blends recent time outside the safe band, the current ageing factor and shelf life already used.</p><div class="table-wrap"><table><thead><tr><th>Product</th><th>Ideal</th><th>Safe band</th><th>Q10</th><th>Shelf life</th><th>Target RH</th></tr></thead><tbody id="sp-model"></tbody></table></div></details>';
    },
    update(s, r) {
      setIfChanged($(r, '#sp-body'), s.units.slice().sort((a, b) => b.riskScore - a.riskScore).map(u => '<tr><td class="wrap"><b>' + esc(u.name) + '</b></td><td>' + esc(u.productName) + '</td><td>' + fmt(u.temp, 1) + ' °C <span class="faint small">(' + u.band[0] + ' to ' + u.band[1] + ')</span></td><td>x' + fmt(u.ageFactor, 2) + '</td><td>' + fmt(u.lifeUsedPct, 2) + '%</td><td>' + fmt(u.remainingDays, 1) + '</td><td><div class="row" style="flex-wrap:nowrap;gap:10px"><div class="pbar" style="width:80px"><i style="width:' + Math.max(3, u.riskScore) + '%;background:' + riskColor(u.riskClass) + '"></i></div>' + chip(u.riskScore + ' ' + u.riskClass, RISKCHIP[u.riskClass]) + '</div></td></tr>').join(''));
      const m = $(r, '#sp-model');
      if (!m._done) { m._done = 1; m.innerHTML = A().boot.products.map(p => '<tr><td><b>' + esc(p.name) + '</b></td><td>' + p.tIdeal + ' °C</td><td>' + p.tMin + ' to ' + p.tMax + ' °C</td><td>' + p.q10 + '</td><td>' + p.shelfDays + ' days</td><td>' + p.rh + '%</td></tr>').join(''); }
    }
  });

  // ---------- 6. Alerts ----------
  list.push({
    id: 'alerts', title: 'Alerts', sub: 'Everything that needs attention, from temperature excursions to blocked roads.', icon: 'bell',
    build(r) { r.innerHTML = '<div class="row" style="margin-bottom:18px"><div class="seg" id="al-f"></div></div><div class="list" id="al-list"></div>'; },
    update(s, r) {
      const f = A().sel.alertFilter;
      const rank = { critical: 0, warning: 1, info: 2 };
      let items = s.alerts.slice();
      if (f === 'active') items = items.filter(a => a.active);
      else if (f === 'new') items = items.filter(a => a.active && !a.acked);
      else items = items.filter(a => !a.active);
      items.sort((a, b) => (b.active - a.active) || (rank[a.sev] - rank[b.sev]) || (b.ts - a.ts));
      const cnt = { active: s.alerts.filter(a => a.active).length, new: s.alerts.filter(a => a.active && !a.acked).length };
      setIfChanged($(r, '#al-f'), [['active', 'Active (' + cnt.active + ')'], ['new', 'Unacknowledged (' + cnt.new + ')'], ['history', 'Resolved']].map(x => '<button class="' + (f === x[0] ? 'on' : '') + '" data-act="alertFilter" data-id="' + x[0] + '">' + x[1] + '</button>').join(''));
      setIfChanged($(r, '#al-list'), items.slice(0, 40).map(a => '<div class="item sev-' + esc(a.sev) + '"><div class="ic clay ' + (SEVIC[a.sev] || SEVIC.info) + '">' + ico(a.sev === 'critical' ? 'warn' : 'bell', 18) + '</div><div><div class="t">' + esc(a.title) + '</div><div class="d">' + esc(a.detail) + '</div><div class="d faint">Raised ' + esc(a.clock) + ' · ' + esc(a.type) + '</div></div><div class="r">' + chip(a.sev, a.sev === 'critical' ? 'bad' : a.sev === 'warning' ? 'warn' : 'info') + (a.active ? (a.acked ? chip('Acknowledged', 'ok') : '<button class="btn sm" data-act="ack" data-id="' + esc(a.id) + '">' + ico('check', 14) + 'Acknowledge</button>') : chip('Resolved', '')) + '</div></div>').join('') || '<div class="card glass empty">' + (f === 'history' ? 'No resolved alerts yet.' : 'All clear. No alerts in this view.') + '</div>');
    }
  });
  actions.alertFilter = el => { A().sel.alertFilter = el.dataset.id; A().render(); };
  actions.ack = async el => { try { await post('/alerts/' + encodeURIComponent(el.dataset.id) + '/ack'); await A().refresh(); } catch (e) { toast(e.message, true); } };

  // ---------- 7. Route Status ----------
  list.push({
    id: 'routes', title: 'Route Status', sub: 'Jammu & Kashmir and Ladakh road network with live status of every segment.', icon: 'route',
    build(r) {
      r.innerHTML = '<div class="card glass"><h3>' + ico('globe') + 'Road network<span class="sp" id="rt-note"></span></h3><div class="map tall" id="rt-map"></div>' + mapLegend + '<div class="map-note">Distances and speeds are planning approximations. Map tiles need an internet connection; road status works without it.</div></div>' +
        '<div class="card glass" style="margin-top:18px"><h3>' + ico('route') + 'Corridors</h3><div class="table-wrap"><table><thead><tr><th>Road</th><th>Segment</th><th>Distance</th><th>Status</th><th>Speed</th><th>Cause</th></tr></thead><tbody id="rt-body"></tbody></table></div></div>';
    },
    onShow() { const a = A(); if (!this.map) this.map = Maps.create('rt-map', a.boot); Maps.show(this.map); },
    update(s, r) {
      const a = A(); const nm = {}; a.boot.nodes.forEach(n => { nm[n.id] = n.name.split(' (')[0]; });
      if (this.map) { Maps.drawEdges(this.map, s); Maps.drawStores(this.map, s); Maps.drawLoads(this.map, s); }
      $(r, '#rt-note').textContent = s.stats.closedRoads + ' closed, ' + s.stats.delayedRoads + ' slowed';
      const st = {}; s.edges.forEach(e => { st[e.id] = e; });
      const order = { closed: 0, delayed: 1, open: 2 };
      setIfChanged($(r, '#rt-body'), a.boot.edges.slice().sort((x, y) => order[st[x.id].status] - order[st[y.id].status]).map(e => { const t = st[e.id]; return '<tr><td><b>' + esc(e.road) + '</b>' + (e.pass ? ' ' + chip('mountain pass', 'info') : '') + '</td><td>' + esc(nm[e.a]) + ' to ' + esc(nm[e.b]) + '</td><td>' + e.km + ' km</td><td>' + chip(t.status === 'open' ? 'Open' : t.status === 'delayed' ? 'Slowed' : 'Closed', EDGECHIP[t.status]) + '</td><td>' + (t.status === 'closed' ? '0 km/h' : Math.round(e.kmph * t.factor) + ' km/h') + '</td><td class="wrap">' + (t.event ? esc(t.event) + (t.status === 'closed' ? ' · clears in about ' + hm(t.clearMin) : '') : '<span class="faint">None</span>') + '</td></tr>'; }).join(''));
    }
  });

  // ---------- 8. Disruption Events ----------
  list.push({
    id: 'events', title: 'Disruption Events', sub: 'Landslides, snow, accidents and holds affecting the network, plus a simulator for demos.', icon: 'warn',
    build(r) {
      const b = A().boot; const nm = {}; b.nodes.forEach(n => { nm[n.id] = n.name.split(' (')[0]; });
      r.innerHTML = '<div class="grid g-21"><div class="stack"><div class="card glass"><h3>' + ico('warn') + 'Active events<span class="sp" id="ev-n"></span></h3><div class="list" id="ev-active"></div></div>' +
        '<div class="card glass"><h3>' + ico('clock') + 'Recently cleared</h3><div id="ev-hist"></div></div></div>' +
        '<div class="card glass"><h3>' + ico('wrench') + 'Simulate a disruption</h3><div class="stack" style="gap:14px">' +
        '<div class="field"><label for="ev-edge">Road segment</label><select class="select" id="ev-edge">' + b.edges.map(e => '<option value="' + esc(e.id) + '">' + esc(e.road) + ': ' + esc(nm[e.a]) + ' to ' + esc(nm[e.b]) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label for="ev-type">Event type</label><select class="select" id="ev-type">' + b.eventTypes.map(t => '<option value="' + esc(t.key) + '">' + esc(t.label) + (t.mode === 'closed' ? ' (closes road)' : ' (slows traffic)') + '</option>').join('') + '</select></div>' +
        '<div class="field"><label for="ev-dur">Duration</label><select class="select" id="ev-dur"><option value="60">1 hour</option><option value="120" selected>2 hours</option><option value="240">4 hours</option><option value="480">8 hours</option></select></div>' +
        '<button class="btn coral" data-act="evCreate">' + ico('warn', 16) + 'Trigger event</button><p class="small muted">Loads heading into a closed segment will hold at the previous town. Use the Reroute Assistant to move them.</p></div></div></div>';
    },
    update(s, r) {
      const ev = s.events.active;
      $(r, '#ev-n').textContent = ev.length + ' active';
      setIfChanged($(r, '#ev-active'), ev.map(e => '<div class="item"><div class="ic clay ' + (e.mode === 'closed' ? 'tone-coral' : 'tone-amber') + '">' + ico(e.type === 'snow' ? 'snow' : 'warn', 18) + '</div><div><div class="t">' + esc(e.label) + '</div><div class="d">' + esc(e.road) + ': ' + esc(e.from.split(' (')[0]) + ' to ' + esc(e.to.split(' (')[0]) + '</div><div class="d faint">Since ' + esc(e.clock) + ' · expected clear ' + esc(e.clearClock) + ' (' + hm(e.remainMin) + ')</div></div><div class="r">' + chip(e.mode === 'closed' ? 'Road closed' : 'Slowed to ' + Math.round(e.factor * 100) + '%', e.mode === 'closed' ? 'bad' : 'warn') + '<button class="btn sm ice" data-act="evClear" data-id="' + esc(e.id) + '">' + ico('check', 14) + 'Clear now</button></div></div>').join('') || '<div class="empty">No active disruptions. Roads are flowing normally.</div>');
      setIfChanged($(r, '#ev-hist'), s.events.history.slice(0, 8).map(e => '<div class="act-line"><span class="tm">' + esc(e.clearedClock) + '</span><span>' + esc(e.label) + ' on ' + esc(e.road) + '</span></div>').join('') || '<div class="empty">Nothing cleared yet.</div>');
    }
  });
  actions.evCreate = async () => {
    try { await post('/events', { edgeId: document.getElementById('ev-edge').value, type: document.getElementById('ev-type').value, durationMin: Number(document.getElementById('ev-dur').value) }); toast('Disruption triggered'); await A().refresh(); }
    catch (e) { toast(e.message, true); }
  };
  actions.evClear = async el => { try { await post('/events/' + encodeURIComponent(el.dataset.id) + '/clear'); toast('Event cleared'); await A().refresh(); } catch (e) { toast(e.message, true); } };

  // ---------- 9. Reroute Assistant ----------
  list.push({
    id: 'reroute', title: 'Reroute Assistant', sub: 'Compares waiting against alternate roads for any load, including the effect on shelf life.', icon: 'shuffle',
    build(r) {
      r.innerHTML = '<div class="row" style="margin-bottom:18px"><div class="field" style="max-width:520px"><label for="rr-sel">Load</label><select class="select" id="rr-sel" data-change="selLoad"></select></div></div>' +
        '<div class="grid g-21"><div class="stack"><div class="card glass"><h3>' + ico('route') + 'Route options<span class="sp" id="rr-from"></span></h3><div class="list" id="rr-opts"><div class="empty">Select a load</div></div></div></div>' +
        '<div class="card glass"><h3>' + ico('globe') + 'Map<span class="sp">highlighted = option</span></h3><div class="map" id="rr-map"></div><div class="legend" id="rr-leg"></div></div></div>';
      this.last = ''; this.lastFetch = 0; this.cache = null;
    },
    onShow() { const a = A(); if (!this.map) this.map = Maps.create('rr-map', a.boot); Maps.show(this.map); this.last = ''; this.lastFetch = 0; },
    update(s, r) {
      const a = A(); const sel = $(r, '#rr-sel');
      const ranked = s.loads.slice().sort((x, y) => ((y.status === 'waiting') - (x.status === 'waiting')) || (y.delayMin - x.delayMin));
      const key = ranked.map(l => l.id + l.status).join(',');
      if (sel._k !== key) { sel._k = key; sel.innerHTML = ranked.map(l => '<option value="' + esc(l.id) + '">' + esc(l.id) + ' · ' + esc(l.productName) + ' · ' + esc(l.origin) + ' to ' + esc(l.dest) + (l.status === 'waiting' ? ' (HOLDING)' : '') + '</option>').join(''); }
      if (!ranked.find(l => l.id === a.sel.load)) { a.sel.load = ranked[0] && ranked[0].id; this.last = ''; }
      sel.value = a.sel.load || '';
      Maps.drawEdges(this.map, s);
      const now = Date.now();
      if (!a.sel.load) { setIfChanged($(r, '#rr-opts'), '<div class="empty">No loads in transit right now.</div>'); return; }
      if (now - this.lastFetch < 2500 && this.cache && this.cache.load === a.sel.load) return;
      this.lastFetch = now;
      const wanted = a.sel.load;
      api('/reroute/' + encodeURIComponent(wanted)).then(j => {
        if (wanted !== a.sel.load) return;
        this.cache = j;
        const sig = wanted + '|' + j.options.map(o => o.key + o.etaMin + o.recommended).join(',') + '|' + (j.note || '');
        if (sig === this.last) return; this.last = sig;
        const L = s.loads.find(l => l.id === wanted);
        $(r, '#rr-from').textContent = j.anchorName ? 'Decision point: ' + j.anchorName.split(' (')[0] : '';
        if (!j.options.length) { setIfChanged($(r, '#rr-opts'), '<div class="empty">' + esc(j.note || 'No options available.') + '</div>'); Maps.drawPaths(this.map, []); return; }
        const COLS = { current: '#8fb8ee', fastest: '#35e0d2', safest: '#8b7cff', coolest: '#ffc46b', detour: '#ff9fc0' };
        setIfChanged($(r, '#rr-opts'), j.options.map(o => '<div class="item" style="flex-direction:column;gap:10px"><div class="row" style="width:100%"><div class="ic clay" style="background:' + COLS[o.key] + ';width:34px;height:34px;border-radius:12px;display:grid;place-items:center">' + ico(o.key === 'current' ? 'route' : 'shuffle', 17) + '</div><div style="min-width:0"><div class="t">' + esc(o.label) + '</div><div class="d">' + esc(o.names.join(' > ')) + '</div></div><div style="margin-left:auto" class="row">' + (o.recommended ? chip('Recommended', 'ok') : '') + (o.blocked ? chip('Blocked: ' + o.blockedOn.join(', '), 'bad') : '') + '</div></div>' +
          '<div class="mini-grid" style="width:100%;grid-template-columns:repeat(4,1fr)"><div class="mini"><span>Arrival</span><b>' + esc(o.arrivalClock) + '</b></div><div class="mini"><span>Time left</span><b>' + hm(o.etaMin) + '</b></div><div class="mini"><span>Distance</span><b>' + o.km + ' km</b></div><div class="mini"><span>Vs plan</span><b style="color:' + (o.deltaMin < 0 ? '#9af5c9' : o.deltaMin > 0 ? '#ffd994' : 'inherit') + '">' + (o.key === 'current' ? '-' : (o.deltaMin > 0 ? '+' : '') + hm(Math.abs(o.deltaMin)).replace(/^/, o.deltaMin < 0 ? '-' : '')) + '</b></div></div>' +
          '<div class="row" style="width:100%"><span class="small muted">Extra shelf life used: <b style="color:var(--txt)">' + (Math.round(o.lifeAddPct * 1000) / 1000) + '%</b> (' + o.ageingHours + ' ageing-hours)</span>' + (o.key === 'current' ? '' : '<button class="btn sm violet" style="margin-left:auto" data-act="applyRoute" data-id="' + esc(wanted) + '" data-opt="' + esc(o.key) + '">' + ico('check', 14) + 'Apply this route</button>') + '</div></div>').join(''));
        Maps.drawPaths(this.map, j.options.map(o => ({ nodes: o.nodes, color: COLS[o.key], weight: o.recommended ? 8 : 5, dash: o.key === 'current' ? '2 10' : null, opacity: o.recommended ? 1 : .75 })));
        $(r, '#rr-leg').innerHTML = j.options.map(o => '<span><i style="background:' + COLS[o.key] + '"></i>' + esc(o.label.split(' (')[0]) + '</span>').join('');
      }).catch(e => { setIfChanged($(r, '#rr-opts'), '<div class="empty">Could not load options: ' + esc(e.message) + '</div>'); });
    }
  });
  actions.selLoad = el => { A().sel.load = el.value; const p = A().panelById('reroute'); p.last = ''; p.lastFetch = 0; A().render(); };
  actions.applyRoute = async el => {
    el.disabled = true;
    try { const j = await post('/reroute/' + encodeURIComponent(el.dataset.id), { option: el.dataset.opt }); toast('Reroute applied. New time left ' + hm(j.newEtaMin)); const p = A().panelById('reroute'); p.last = ''; p.lastFetch = 0; await A().refresh(); }
    catch (e) { toast(e.message, true); el.disabled = false; }
  };

  // ---------- 10. Loads in Transit ----------
  list.push({
    id: 'transit', title: 'Loads in Transit', sub: 'Every shipment on the road with live position, temperature and arrival time.', icon: 'truck',
    build(r) {
      r.innerHTML = '<div class="card glass"><h3>' + ico('globe') + 'Live positions<span class="sp">marker colour = spoilage risk</span></h3><div class="map tall" id="tr-map"></div>' + mapLegend + '</div>' +
        '<div class="card glass" style="margin-top:18px"><h3>' + ico('truck') + 'On the road</h3><div class="table-wrap"><table><thead><tr><th>Load</th><th>Product</th><th>Route</th><th>Progress</th><th>Arrival</th><th>Box temp</th><th>Delay</th><th>Status</th></tr></thead><tbody id="tr-body"></tbody></table></div></div>' +
        '<details class="card glass fold" style="margin-top:22px"><summary>' + ico('check') + 'Recently delivered</summary><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Load</th><th>Product</th><th>Route</th><th>Delivered</th><th>Delay</th><th>Excursion</th></tr></thead><tbody id="tr-done"></tbody></table></div></details>';
    },
    onShow() { const a = A(); if (!this.map) this.map = Maps.create('tr-map', a.boot); Maps.show(this.map); },
    update(s, r) {
      if (this.map) { Maps.drawEdges(this.map, s); Maps.drawStores(this.map, s); Maps.drawLoads(this.map, s); }
      setIfChanged($(r, '#tr-body'), s.loads.map(l => '<tr><td><b>' + esc(l.id) + '</b></td><td>' + esc(l.productName) + '<div class="small faint">' + int(l.kg) + ' kg</div></td><td>' + esc(l.origin) + ' to ' + esc(l.dest) + '<div class="small faint">' + l.kmDone + ' of ' + l.kmTotal + ' km</div></td><td style="min-width:130px"><div class="pbar"><i style="width:' + l.progressPct + '%"></i></div><div class="small faint">' + l.progressPct + '%</div></td><td>' + esc(l.etaClock) + '<div class="small faint">in ' + hm(l.etaMin) + '</div></td><td>' + fmt(l.temp, 1) + ' C<div class="small" style="color:' + riskColor(l.risk >= 80 ? 'critical' : l.risk >= 55 ? 'high' : l.risk >= 25 ? 'watch' : 'low') + '">risk ' + l.risk + '</div></td><td>' + (l.delayMin > 0 ? hm(l.delayMin) : '<span class="faint">None</span>') + '</td><td>' + (l.status === 'waiting' ? chip('Holding', 'bad') : l.edgeStatus === 'delayed' ? chip('Slowed', 'warn') : chip('Moving', 'ok')) + (l.reroutes ? ' ' + chip('Rerouted', 'info') : '') + '</td></tr>').join('') || '<tr><td colspan="8" class="empty">No loads on the road</td></tr>');
      setIfChanged($(r, '#tr-done'), s.delivered.slice(0, 10).map(l => '<tr><td><b>' + esc(l.id) + '</b></td><td>' + esc(l.productName) + ' · ' + int(l.kg) + ' kg</td><td>' + esc(l.origin) + ' to ' + esc(l.dest) + '</td><td>' + esc(l.etaClock) + '</td><td>' + (l.delayMin > 0 ? hm(l.delayMin) : '<span class="faint">None</span>') + '</td><td>' + (l.excursionMin > 0 ? hm(l.excursionMin) : '<span class="faint">None</span>') + '</td></tr>').join('') || '<tr><td colspan="6" class="empty">No deliveries yet</td></tr>');
    }
  });

  // ---------- 11. Waste & Impact ----------
  list.push({
    id: 'impact', title: 'Waste & Impact', sub: 'Modelled food saved, value protected and emissions avoided.', icon: 'leaf',
    build(r) {
      r.innerHTML = '<div class="grid g-kpi" id="im-kpi"></div><div class="card glass" style="margin-top:24px"><h3>' + ico('leaf') + 'Waste avoided by product<span class="sp">kg, estimated</span></h3><div id="im-bars"></div></div>' +
        '<details class="card glass fold" style="margin-top:22px"><summary>' + ico('shield') + 'How these numbers are calculated</summary><p class="small muted" style="max-width:880px;margin:14px 0">For every load, ORCAS compares an <b style="color:var(--txt)">assumed typical loss</b> for uncontrolled transport with the <b style="color:var(--txt)">modelled loss</b> from the load\'s actual temperature history. The difference, multiplied by quantity, is the waste avoided. Value uses an assumed price per kg. Emissions use the solar energy supplied to cooling times the grid emission factor. These are simulation outputs; replace the assumed values in <b style="color:var(--txt)">src/config.js</b> with field-survey data before quoting them as measured results.</p><div class="table-wrap"><table><thead><tr><th>Product</th><th>Assumed loss</th><th>Assumed price</th></tr></thead><tbody id="im-assume"></tbody></table></div></details>';
    },
    update(s, r) {
      const im = s.impact;
      setIfChanged($(r, '#im-kpi'),
        kpi('green', 'leaf', 'Waste avoided', int(im.wasteAvoidedKg) + '<small> kg</small>', 'of ' + int(im.kgMoved) + ' kg moved') +
        kpi('amber', 'zap', 'Value protected', inr(im.valueProtectedInr), 'at assumed prices') +
        kpi('violet', 'cloud', 'CO2 avoided', int(im.co2AvoidedKg) + '<small> kg</small>', fmt(im.kwhLoad, 1) + ' kWh of solar cooling'));
      setIfChanged($(r, '#im-bars'), im.byProduct.length ? bars(im.byProduct.slice(0, 9).map(b => ({ label: b.name, value: b.avoidedKg })), v => int(v) + ' kg') : '<div class="empty">Collecting data...</div>');
      const t = $(r, '#im-assume'); if (!t._done) { t._done = 1; t.innerHTML = A().boot.products.map(p => '<tr><td>' + esc(p.name) + '</td><td>' + p.baselineLossPct + '%</td><td>Rs ' + int(p.pricePerKg) + ' / kg</td></tr>').join(''); }
    }
  });

  // ---------- 12. Reports ----------
  const REPORTS = [
    ['delay', 'Delay & Disruption', 'Which loads were slowed or held, by how long and why.', 'clock'],
    ['spoilage', 'Spoilage & Quality', 'Temperature, ageing and risk for every unit.', 'drop'],
    ['energy', 'Solar & Energy', 'Generation, battery state and emissions avoided.', 'sun'],
    ['shift', 'Shift Summary', 'Hand-over snapshot with recent activity.', 'file']
  ];
  list.push({
    id: 'reports', title: 'Reports', sub: 'Generate a report instantly from live data. Download as CSV or save as PDF.', icon: 'file',
    build(r) {
      r.innerHTML = '<div class="card glass no-print"><h3>' + ico('file') + 'Choose a report</h3><div class="rep-types" id="rp-types"></div><div class="row" style="margin-top:16px"><button class="btn" data-act="repGen">' + ico('refresh', 16) + 'Generate report</button><button class="btn ice" data-act="repCsv">' + ico('download', 16) + 'Download CSV</button><button class="btn violet" data-act="repPrint">' + ico('print', 16) + 'Print / Save as PDF</button></div></div>' +
        '<div class="card glass" style="margin-top:18px" id="rp-out"><div class="empty">Pick a report type and press Generate.</div></div>' +
        '<div class="card glass no-print" style="margin-top:18px"><h3>' + ico('clock') + 'Recent reports</h3><div id="rp-hist"></div></div>';
      this.histAt = 0;
    },
    onShow() { this.loadHistory(); },
    loadHistory() { const root = document.getElementById('rp-hist'); api('/reports/history').then(j => { root.innerHTML = (j.items || []).slice(0, 8).map(i => '<div class="act-line"><span class="tm" style="min-width:150px">' + esc(i.generatedAt) + '</span><span>' + esc(i.title) + '</span></div>').join('') || '<div class="empty">No reports generated yet.</div>'; }).catch(() => { root.innerHTML = '<div class="empty">History unavailable.</div>'; }); },
    update(s, r) {
      const cur = A().sel.report;
      setIfChanged($(r, '#rp-types'), REPORTS.map(x => '<button class="rep-type ' + (cur === x[0] ? 'on' : '') + '" data-act="repPick" data-id="' + x[0] + '"><span class="row" style="gap:8px;color:var(--cyan)">' + ico(x[3], 20) + '</span><b>' + x[1] + '</b><span>' + x[2] + '</span></button>').join(''));
    }
  });
  async function genReport() {
    const out = document.getElementById('rp-out'); const type = A().sel.report;
    out.innerHTML = '<div class="empty">Generating...</div>';
    try {
      const j = await api('/reports/' + encodeURIComponent(type));
      const rep = j.report;
      out.innerHTML = '<h3 style="font-size:20px;margin-bottom:4px">' + esc(rep.title) + '</h3><div class="small muted">' + esc(rep.system) + ' · Generated ' + esc(rep.generatedAt) + ' · ' + esc(rep.period) + '</div>' +
        '<div class="rep-sum">' + rep.summary.map(x => '<div><span>' + esc(x.label) + '</span><b>' + esc(x.value) + '</b></div>').join('') + '</div>' +
        '<div class="table-wrap"><table><thead><tr>' + rep.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + (rep.rows.map(row => '<tr>' + row.map((c, i) => '<td' + (i === 0 || rep.columns[i] === 'Event' || rep.columns[i] === 'Main cause' ? ' class="wrap"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') || '<tr><td colspan="' + rep.columns.length + '" class="empty">No rows in this report yet.</td></tr>') + '</tbody></table></div>' +
        '<div class="small muted" style="margin-top:12px">' + rep.notes.map(n => '<div>' + esc(n) + '</div>').join('') + '</div>';
      A().lastReport = true;
      const p = A().panelById('reports'); p.loadHistory();
    } catch (e) { out.innerHTML = '<div class="empty">Could not generate the report: ' + esc(e.message) + '. <button class="btn sm" data-act="repGen">Try again</button></div>'; }
  }
  actions.repPick = el => { A().sel.report = el.dataset.id; A().render(); genReport(); };
  actions.repGen = () => genReport();
  actions.repPrint = () => { if (!A().lastReport) { genReport().then(() => window.print()); } else window.print(); };
  actions.repCsv = async () => {
    try {
      const r = await fetch('/api/reports/' + encodeURIComponent(A().sel.report) + '?format=csv', { cache: 'no-store' });
      if (!r.ok) throw new Error('Download failed (' + r.status + ')');
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'orcas-' + A().sel.report + '-report.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000); toast('CSV downloaded');
    } catch (e) { toast(e.message, true); }
  };

  window.Panels = { list, actions };
})();
