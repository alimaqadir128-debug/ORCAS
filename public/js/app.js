(function () {
  'use strict';
  const APP = window.APP = {
    boot: null, state: null, panel: 'overview', online: false, lastReport: false,
    sel: { store: null, air: null, load: null, boxFilter: 'all', alertFilter: 'active', report: 'delay' },
    panelById(id) { return Panels.list.find(p => p.id === id); },
    render() { renderAll(); },
    async refresh() { await poll(true); }
  };
  const $ = id => document.getElementById(id);
  const roots = {};

  function buildShell() {
    $('brandMark').innerHTML = window.orcaMark;
    $('menuBtn').innerHTML = ico('menu', 22);
    $('nav').innerHTML = Panels.list.map(p => '<button class="nav-item" data-act="nav" data-id="' + p.id + '" id="nav-' + p.id + '"><span class="ni">' + ico(p.icon, 18) + '</span><span>' + U.esc(p.title) + '</span><span class="badge" id="nb-' + p.id + '" hidden></span></button>').join('');
    const host = $('panels');
    Panels.list.forEach(p => {
      const d = document.createElement('div'); d.className = 'panel'; d.id = 'p-' + p.id; host.appendChild(d); roots[p.id] = d;
      try { p.build(d); } catch (e) { console.error('build ' + p.id, e); d.innerHTML = '<div class="card glass empty">This panel could not be built.</div>'; }
    });
  }

  function setPanel(id, fromHash) {
    if (!Panels.list.find(p => p.id === id)) id = 'overview';
    APP.panel = id;
    Panels.list.forEach(p => { roots[p.id].classList.toggle('active', p.id === id); $('nav-' + p.id).classList.toggle('active', p.id === id); });
    const p = APP.panelById(id);
    $('panelTitle').textContent = p.title; $('panelSub').textContent = p.sub;
    document.title = p.title + ' | ORCAS';
    if (!fromHash) history.replaceState(null, '', '#' + id);
    $('sidebar').classList.remove('open');
    try { if (p.onShow) p.onShow(roots[id]); } catch (e) { console.error('show ' + id, e); }
    renderAll();
    window.scrollTo({ top: 0 });
  }

  function renderChrome(s) {
    const m = s.meta, st = s.stats;
    const w = m.weather || {};
    const wt = w.valley ? Math.round(w.valley.temp) + ' C Srinagar' : null;
    $('topChips').innerHTML =
      '<span class="pill sim">' + ico('activity', 15) + 'Simulation data</span>' +
      '<span class="pill">' + ico('clock', 15) + '<b>' + U.esc(m.clock) + '</b> IST</span>' +
      '<span class="pill">' + ico('cloud', 15) + (wt ? U.esc(wt) + ' · live' : 'Seasonal climate model') + '</span>' +
      '<button class="btn sm ' + (m.paused ? '' : 'ice') + '" data-act="simToggle">' + ico(m.paused ? 'play' : 'pause', 14) + (m.paused ? 'Resume' : 'Pause') + '</button>' +
      '<div class="seg"><button class="' + (m.simMinPerTick <= 3 ? 'on' : '') + '" data-act="simSpeed" data-id="2">Slow</button><button class="' + (m.simMinPerTick > 3 && m.simMinPerTick <= 8 ? 'on' : '') + '" data-act="simSpeed" data-id="6">Normal</button><button class="' + (m.simMinPerTick > 8 ? 'on' : '') + '" data-act="simSpeed" data-id="15">Fast</button></div>';
    const pill = $('simPill'); pill.className = 'sim-pill ' + (APP.online ? 'on' : 'off');
    $('simPillText').textContent = APP.online ? (m.paused ? 'Paused · ' + m.clock + ' IST' : 'Live simulation · ' + m.clock + ' IST') : 'Offline';
    const badge = (id, n, show) => { const el = $('nb-' + id); if (!el) return; el.hidden = !show || !n; el.textContent = n; };
    badge('alerts', st.alertsUnacked, true);
    badge('events', st.eventsActive, true);
    badge('reroute', st.loadsWaiting, true);
  }

  function renderAll() {
    const s = APP.state; if (!s) return;
    try { renderChrome(s); } catch (e) { console.error('chrome', e); }
    const p = APP.panelById(APP.panel);
    try { p.update(s, roots[p.id]); } catch (e) { console.error('update ' + p.id, e); }
  }

  let polling = false;
  async function poll(once) {
    if (polling && once) return;
    polling = true;
    try {
      const s = await U.api('/state');
      APP.state = s; APP.online = true; $('offlineBanner').hidden = true;
      renderAll();
    } catch (e) {
      APP.online = false; $('offlineBanner').hidden = false;
      if (APP.state) try { renderChrome(APP.state); } catch (x) { /* ignore */ }
    } finally { polling = false; }
  }

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act;
    if (act === 'nav') return setPanel(el.dataset.id);
    if (act === 'menu') return $('sidebar').classList.toggle('open');
    if (act === 'simToggle') { U.post('/sim', { paused: !(APP.state && APP.state.meta.paused) }).then(() => poll(true)).catch(e => U.toast(e.message, true)); return; }
    if (act === 'simSpeed') { U.post('/sim', { simMinPerTick: Number(el.dataset.id) }).then(() => poll(true)).catch(e => U.toast(e.message, true)); return; }
    const fn = Panels.actions[act]; if (fn) { try { const r = fn(el); if (r && r.catch) r.catch(e => U.toast(e.message || 'Action failed', true)); } catch (e) { console.error(act, e); U.toast('Action failed', true); } }
  });
  document.addEventListener('change', ev => {
    const el = ev.target.closest('[data-change]'); if (!el) return;
    const fn = Panels.actions[el.dataset.change]; if (fn) fn(el);
  });
  document.addEventListener('click', ev => { const sb = $('sidebar'); if (sb.classList.contains('open') && !ev.target.closest('#sidebar') && !ev.target.closest('#menuBtn')) sb.classList.remove('open'); });
  window.addEventListener('hashchange', () => setPanel(location.hash.replace('#', ''), true));

  async function start() {
    try {
      APP.boot = await U.api('/bootstrap');
    } catch (e) {
      $('panels').innerHTML = '<div class="card glass empty" style="padding:40px">Could not reach the ORCAS server. Make sure it is running (npm start) and refresh this page.</div>';
      setTimeout(start, 3000); return;
    }
    $('panels').innerHTML = '';
    buildShell();
    await poll();
    setPanel(location.hash.replace('#', '') || 'overview', true);
    setInterval(() => { if (!document.hidden) poll(); }, 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }
  start();
})();
