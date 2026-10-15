'use strict';
// ORCAS simulation + control engine.
// Models: solar cold stores, transit cold boxes, thermal behaviour, product spoilage (Q10),
// road disruptions, load movement, reroute assistant, alerts and impact accounting.
// Real sensor nodes (ESP32) can override any unit through POST /api/ingest.
const cfg = require('./config');
const G = require('./graph');
const weather = require('./weather');
const store = require('./store');

const PRODUCTS = cfg.PRODUCTS;
const HIST = 60;
const IST_MS = 5.5 * 3600e3;

// ---------- helpers ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(20261014);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const rr = (a, b) => a + rng() * (b - a);
const pick = arr => arr[Math.floor(rng() * arr.length)];

function istParts(ms) { const d = new Date(ms + IST_MS); return { month: d.getUTCMonth(), hour: d.getUTCHours() + d.getUTCMinutes() / 60 }; }
function istString(ms) { const d = new Date(ms + IST_MS); const p = n => String(n).padStart(2, '0'); return p(d.getUTCDate()) + '-' + p(d.getUTCMonth() + 1) + '-' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' IST'; }
function istClock(ms) { const d = new Date(ms + IST_MS); const p = n => String(n).padStart(2, '0'); return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); }

// ---------- climate ----------
const MEAN = {
  valley: [2, 4, 9, 14, 18, 22, 25, 24, 20, 14, 8, 3],
  jammu:  [13, 15, 20, 26, 32, 34, 31, 30, 29, 25, 19, 14],
  ladakh: [-7, -5, 0, 5, 9, 13, 17, 16, 12, 5, -1, -5],
  pass:   [-5, -3, 2, 7, 11, 15, 18, 17, 13, 6, 0, -3]
};
const AMP = { valley: 6, jammu: 6.5, ladakh: 8, pass: 5 };
const GROUP = { valley: 'valley', pass: 'valley', jammu: 'jammu', ladakh: 'ladakh' };
function modelTemp(climate, ms) { const p = istParts(ms); return MEAN[climate][p.month] + AMP[climate] * Math.cos(2 * Math.PI * (p.hour - 15) / 24); }
function irradiance(ms) {
  const p = istParts(ms);
  const dl = 12 + 2.3 * Math.sin(2 * Math.PI * (p.month + 0.5 - 3) / 12);
  const rise = 12.4 - dl / 2; const set = 12.4 + dl / 2;
  if (p.hour <= rise || p.hour >= set) return 0;
  return Math.pow(Math.sin(Math.PI * (p.hour - rise) / dl), 1.15);
}

// ---------- product model ----------
function ageRate(T, rh, P) {
  let m = Math.pow(P.q10, (T - P.tIdeal) / 10);
  if (T <= P.freezeT) m *= 1 + (P.freezeT - T + 0.5) * 3;
  if (P.chill && T < P.tMin) m *= 1 + (P.tMin - T) * 0.25;
  if (rh < P.rh - 10) m *= 1 + (P.rh - 10 - rh) / 25;
  return clamp(m, 0.2, 60);
}
function riskClass(r) { return r < 25 ? 'low' : r < 55 ? 'watch' : r < 80 ? 'high' : 'critical'; }

// ---------- state ----------
const S = {
  simTime: 0, tick: 0, paused: false, simMin: cfg.SIM_MIN_PER_TICK,
  units: [], loads: [], delivered: [], events: [], eventHistory: [], alerts: [], activity: [],
  alertSeq: 0, eventSeq: 0, loadSeq: 2400, unitSeq: 0, spawnWait: 0, rerouteCount: 0,
  retired: { kwhSolar: 0, kwhLoad: 0 }, cum: { avoided: 0, value: 0, kgMoved: 0, delivered: 0, byProduct: {} }, edgeState: {}, offsets: { valley: 0, jammu: 0, ladakh: 0 }, startedAt: Date.now()
};

function initClock() {
  const h = cfg.SIM_START_HOUR_IST;
  const now = Date.now();
  if (String(h).toLowerCase() === 'auto' || !Number.isFinite(Number(h))) { S.simTime = Math.floor(now / 60000) * 60000; return; }
  const d = new Date(now + IST_MS);
  const midnightIstUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_MS;
  S.simTime = midnightIstUtc + clamp(Math.floor(Number(h)), 0, 23) * 3600e3;
}

function log(text, kind) { S.activity.unshift({ ts: S.simTime, clock: istClock(S.simTime), text, kind: kind || 'info' }); S.activity = S.activity.slice(0, 40); }

function computeOffsets() {
  const w = weather.get();
  ['valley', 'jammu', 'ladakh'].forEach(g => {
    const live = w.groups[g];
    S.offsets[g] = live ? clamp(live.temp - modelTemp(g, Date.now()), -12, 12) : 0;
  });
}
function ambient(climate, ms) { return modelTemp(climate, ms) + (S.offsets[GROUP[climate]] || 0); }
function cloudFor(climate) {
  const live = weather.get().groups[GROUP[climate]];
  if (live) return clamp(live.cloud / 100, 0, 1);
  return clamp(0.22 + 0.15 * Math.sin(S.simTime / 3600e3 / 5), 0, 0.6);
}

// ---------- events / edge state ----------
const EVENT_TYPES = {
  landslide:       { label: 'Landslide debris on carriageway', mode: 'closed',  dur: [90, 240] },
  snow:            { label: 'Snowfall / icy carriageway',      mode: 'delayed', factor: 0.35, dur: [120, 360] },
  shooting_stones: { label: 'Shooting stones, one-way flow',   mode: 'delayed', factor: 0.5,  dur: [60, 180] },
  traffic:         { label: 'Convoy / traffic hold',           mode: 'delayed', factor: 0.6,  dur: [45, 150] },
  accident:        { label: 'Road accident, lane blocked',     mode: 'closed',  dur: [40, 100] },
  fog:             { label: 'Dense fog',                       mode: 'delayed', factor: 0.7,  dur: [60, 180] },
  flood:           { label: 'Flash flood / road washout',      mode: 'closed',  dur: [180, 420] }
};

function createEvent(edgeId, type, source, durMin, startOffsetMin) {
  const e = G.edgeById[edgeId]; const T = EVENT_TYPES[type];
  if (!e || !T) return null;
  const dur = durMin || Math.round(rr(T.dur[0], T.dur[1]));
  const start = S.simTime - (startOffsetMin || 0) * 60000;
  const ev = { id: 'EV-' + (++S.eventSeq), edgeId, road: e.road, from: G.nodeById[e.a].name, to: G.nodeById[e.b].name, type, label: T.label, mode: T.mode, factor: T.mode === 'closed' ? 0 : T.factor, startedAt: start, endsAt: start + dur * 60000, source: source || 'auto' };
  S.events.push(ev);
  log(T.label + ' on ' + e.road + ' (' + ev.from + ' - ' + ev.to + ')', T.mode === 'closed' ? 'bad' : 'warn');
  computeEdgeState();
  return ev;
}
function clearEvent(id) {
  const i = S.events.findIndex(e => e.id === id);
  if (i < 0) return false;
  const ev = S.events.splice(i, 1)[0];
  ev.clearedAt = S.simTime;
  S.eventHistory.unshift(ev); S.eventHistory = S.eventHistory.slice(0, 40);
  log('Cleared: ' + ev.label + ' on ' + ev.road, 'good');
  computeEdgeState();
  return true;
}
function computeEdgeState() {
  const st = {};
  G.EDGES.forEach(e => { st[e.id] = { status: 'open', factor: 1, closed: false, clearMin: 0, events: [], primary: null }; });
  S.events.forEach(ev => {
    const s = st[ev.edgeId]; if (!s) return;
    s.events.push(ev.id);
    const remain = Math.max(0, (ev.endsAt - S.simTime) / 60000);
    if (ev.mode === 'closed') { s.closed = true; s.clearMin = Math.max(s.clearMin, remain); s.factor = 0; s.status = 'closed'; if (!s.primary || s.primary.mode !== 'closed') s.primary = ev; }
    else if (!s.closed) { s.factor = Math.min(s.factor, ev.factor); s.status = 'delayed'; if (!s.primary || ev.factor < s.primary.factor) s.primary = ev; }
  });
  S.edgeState = st;
}
function stepEvents() {
  S.events.filter(e => e.endsAt <= S.simTime).forEach(e => clearEvent(e.id));
  const autoCount = S.events.filter(e => e.source === 'auto').length;
  if (autoCount < 2 && rng() < 0.035) {
    const edge = pick(G.EDGES);
    if (!S.events.some(e => e.edgeId === edge.id)) createEvent(edge.id, pick(edge.hazards), 'auto');
  }
}

// ---------- routing helpers ----------
function sf(edge) { return S.edgeState[edge.id] || { factor: 1, closed: false, clearMin: 0 }; }
function pathTimeMin(nodes, firstOff, sv) {
  let t = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const e = G.edgeBetween(nodes[i], nodes[i + 1]); const st = sf(e);
    const km = e.km - (i === 0 ? firstOff : 0);
    const base = km / (e.kmph * sv) * 60;
    t += st.closed ? st.clearMin + base : base / Math.max(st.factor, 0.05);
  }
  return t;
}
function plannedMin(nodes) { let t = 0; for (let i = 0; i < nodes.length - 1; i++) { const e = G.edgeBetween(nodes[i], nodes[i + 1]); t += e.km / e.kmph * 60; } return t; }
function pathKm(nodes) { let k = 0; for (let i = 0; i < nodes.length - 1; i++) k += G.edgeBetween(nodes[i], nodes[i + 1]).km; return k; }

// ---------- units ----------
function makeUnit(o) {
  const P = PRODUCTS[o.product];
  const isStore = o.kind === 'store';
  const setpoint = r1(P.tIdeal);
  const u = {
    id: o.id, name: o.name, kind: o.kind, node: o.node || null, loadId: o.loadId || null,
    product: o.product, kg: o.kg, setpoint,
    temp: setpoint + (rng() - 0.5) * 0.6, rh: P.rh + (rng() - 0.5) * 3,
    doorOpen: false, doorAutoCloseMin: null, fault: null, compCmd: false, compOn: false, heaterOn: false, fanPct: 45,
    solarPeakW: o.solarPeakW, solarW: 0, loadW: 0, battCapKwh: o.battCapKwh, battKwh: o.battCapKwh * rr(0.6, 0.9), powerSrc: 'solar',
    kwhSolar: 0, kwhLoad: 0, lifeUsedPct: o.lifeUsedPct || 0, excursionMin: 0, excursionNow: 0, excDecay: 0,
    ageFactor: 1, riskScore: 0, maxTemp: -99, minTemp: 99, dutyEma: 0.3,
    live: null, source: 'simulated', hist: { temp: [], risk: [], solar: [], load: [] }
  };
  u.isStore = isStore;
  return u;
}

function unitContext(u) {
  if (u.kind === 'store') {
    const n = G.nodeById[u.node];
    return { climateA: n.climate, climateB: n.climate, frac: 0, lat: n.lat, lng: n.lng };
  }
  const L = S.loads.find(x => x.id === u.loadId);
  if (!L) { const n = G.nodeById.srinagar; return { climateA: n.climate, climateB: n.climate, frac: 0, lat: n.lat, lng: n.lng }; }
  const pos = loadPos(L);
  return { climateA: pos.climateA, climateB: pos.climateB, frac: pos.frac, lat: pos.lat, lng: pos.lng };
}
function loadPos(L) {
  if (L.idx >= L.path.length - 1) {
    const n = G.nodeById[L.path[L.path.length - 1]];
    return { lat: n.lat, lng: n.lng, climateA: n.climate, climateB: n.climate, frac: 0, edge: null };
  }
  const a = G.nodeById[L.path[L.idx]]; const b = G.nodeById[L.path[L.idx + 1]];
  const e = G.edgeBetween(a.id, b.id); const f = clamp(L.offKm / e.km, 0, 1);
  return { lat: lerp(a.lat, b.lat, f), lng: lerp(a.lng, b.lng, f), climateA: a.climate, climateB: b.climate, frac: f, edge: e };
}

function stepUnit(u, dtMin) {
  const P = PRODUCTS[u.product];
  const ctx = unitContext(u);
  const amb = lerp(ambient(ctx.climateA, S.simTime), ambient(ctx.climateB, S.simTime), ctx.frac);
  const cloud = cloudFor(ctx.climateA);
  const isStore = u.kind === 'store';
  const live = u.live && (Date.now() - u.live.ts < 90000);
  u.source = live ? 'sensor' : 'simulated';

  if (u.doorOpen && u.doorAutoCloseMin != null) { u.doorAutoCloseMin -= dtMin; if (u.doorAutoCloseMin <= 0) { u.doorOpen = false; u.doorAutoCloseMin = null; } }

  const cap = isStore ? 0.10 : 0.12;
  const k = isStore ? 0.0012 : 0.0035;
  const compW = isStore ? 1800 : 600; const heatW = isStore ? 500 : 300; const fanW = isStore ? 150 : 60;

  u.solarW = u.solarPeakW * irradiance(S.simTime) * (1 - cloud * 0.7);
  if (live && Number.isFinite(u.live.solarW)) u.solarW = u.live.solarW;

  // controller
  if (u.temp > u.setpoint + 0.5) u.compCmd = true; else if (u.temp < u.setpoint - 0.5) u.compCmd = false;
  if (u.temp < u.setpoint - 0.8) u.heaterOn = true; else if (u.temp > u.setpoint - 0.2) u.heaterOn = false;

  // power budget
  const battAvailW = u.battKwh * 60000 / Math.max(dtMin, 1);
  const wantW = (u.compCmd && u.fault !== 'compressor' ? compW : 0) + (u.heaterOn ? heatW : 0) + fanW;
  const f = wantW > 0 ? clamp((u.solarW + battAvailW) / wantW, 0, 1) : 1;
  u.compOn = u.compCmd && u.fault !== 'compressor' && f > 0.02;
  const compP = u.compOn ? compW * f : 0; const heatP = u.heaterOn ? heatW * f : 0;
  u.loadW = compP + heatP + fanW;

  if (!live) {
    const doorMul = u.doorOpen ? 8 : 1;
    const leak = k * (amb - u.temp) * doorMul;
    const resp = isStore ? 0.0004 : 0.0006;
    const cooling = u.compOn ? cap * f : 0;
    const heat = u.heaterOn ? 0.06 * f : 0;
    u.temp += leak + resp - cooling + heat + (rng() - 0.5) * 0.016;
    u.rh += (P.rh - u.rh) * 0.04 - (u.compOn ? 0.12 : 0) - (u.doorOpen ? 1.2 : 0) + (rng() - 0.5) * 0.1;
    u.rh = clamp(u.rh, 40, 99);
  } else {
    u.temp = u.live.tempC; u.rh = Number.isFinite(u.live.rh) ? u.live.rh : u.rh;
    if (typeof u.live.doorOpen === 'boolean') u.doorOpen = u.live.doorOpen;
    if (typeof u.live.compressorOn === 'boolean') u.compOn = u.live.compressorOn;
    if (Number.isFinite(u.live.batteryPct)) u.battKwh = u.battCapKwh * clamp(u.live.batteryPct, 0, 100) / 100;
  }

  // battery
  const net = u.solarW - u.loadW;
  if (net >= 0) u.battKwh = Math.min(u.battCapKwh, u.battKwh + net * dtMin / 60000 * 0.95);
  else u.battKwh = Math.max(0, u.battKwh + net * dtMin / 60000);
  u.powerSrc = u.solarW >= u.loadW * 0.98 ? 'solar' : (u.battKwh > 0.02 ? 'battery' : 'depleted');
  u.kwhSolar += u.solarW * dtMin / 60000; u.kwhLoad += u.loadW * dtMin / 60000;

  // airflow
  u.fanPct = clamp((u.compOn ? 85 : 45) + (u.heaterOn ? 10 : 0) + (u.doorOpen ? 10 : 0), 0, 100);
  u.dutyEma = u.dutyEma * 0.98 + (u.compOn ? 1 : 0) * 0.02;

  // spoilage
  const m = ageRate(u.temp, u.rh, P);
  u.ageFactor = m;
  u.lifeUsedPct += m * dtMin / 60 / (P.shelfDays * 24) * 100;
  const out = u.temp > P.tMax || u.temp < P.tMin;
  if (out) { u.excursionMin += dtMin; u.excursionNow += dtMin; } else u.excursionNow = 0;
  u.excDecay = u.excDecay * Math.exp(-dtMin / 240) + (out ? dtMin : 0);
  u.maxTemp = Math.max(u.maxTemp, u.temp); u.minTemp = Math.min(u.minTemp, u.temp);
  const w = P.q10 / 2.5;
  const risk = (Math.min(45, u.excDecay * 0.5 + u.excursionNow * 0.3) + clamp((m - 1) * 14, 0, 35) + Math.min(20, u.lifeUsedPct * 0.4)) * w;
  u.riskScore = Math.round(clamp(risk, 0, 100));
}

// ---------- loads ----------
function spawnLoad(progress) {
  const keys = Object.keys(cfg.LOAD_PROFILES);
  const tot = keys.reduce((s, k) => s + cfg.LOAD_PROFILES[k].w, 0);
  let x = rng() * tot; let key = keys[0];
  for (const k of keys) { x -= cfg.LOAD_PROFILES[k].w; if (x <= 0) { key = k; break; } }
  const prof = cfg.LOAD_PROFILES[key];
  for (let tries = 0; tries < 20; tries++) {
    const origin = pick(prof.origins); const dest = pick(prof.dests);
    if (origin === dest) continue;
    const p = G.shortestPath(origin, dest, e => sf(e).closed ? Infinity : e.km / e.kmph);
    if (!p || p.nodes.length < 2) continue;
    const id = 'L-' + (++S.loadSeq);
    const kg = Math.round(rr(prof.kg[0], prof.kg[1]) / (prof.kg[1] > 100 ? 10 : 1)) * (prof.kg[1] > 100 ? 10 : 1);
    const L = { id, product: key, kg, origin, dest, path: p.nodes.slice(), idx: 0, offKm: 0, status: 'moving', speedVar: r2(rr(0.92, 1.08)),
      startedSim: S.simTime, deliveredSim: null, delayMin: 0, waitMin: 0, delayCauses: {}, reroutes: [], unitId: 'ORC-B' + (++S.unitSeq), plannedMin: plannedMin(p.nodes), kmTotal: pathKm(p.nodes), final: null };
    S.loads.push(L);
    const u = makeUnit({ id: L.unitId, name: 'Cold box ' + id, kind: 'box', product: key, kg, loadId: id, solarPeakW: 600, battCapKwh: 6 });
    S.units.push(u);
    // pre-advance for the initial fleet
    if (progress > 0) {
      let target = L.kmTotal * progress; let acc = 0;
      for (let i = 0; i < p.nodes.length - 1; i++) {
        const e = G.edgeBetween(p.nodes[i], p.nodes[i + 1]);
        if (acc + e.km > target) { L.idx = i; L.offKm = target - acc; break; }
        acc += e.km;
        if (i === p.nodes.length - 2) { L.idx = i; L.offKm = Math.max(0, e.km - 5); }
      }
      L.startedSim = S.simTime - Math.round(L.plannedMin * progress) * 60000;
    }
    return L;
  }
  return null;
}

function moveLoad(L, dtMin) {
  if (L.status === 'delivered') return;
  let rem = dtMin;
  let guard = 0;
  while (rem > 0 && L.status !== 'delivered' && guard++ < 20) {
    if (L.idx >= L.path.length - 1) { deliver(L); return; }
    const e = G.edgeBetween(L.path[L.idx], L.path[L.idx + 1]); const st = sf(e);
    if (L.offKm <= 0 && st.closed) {
      L.status = 'waiting'; L.waitMin += rem; L.delayMin += rem;
      const lbl = st.primary ? st.primary.label : 'Road closure'; L.delayCauses[lbl] = (L.delayCauses[lbl] || 0) + rem;
      return;
    }
    L.status = 'moving';
    const speed = e.kmph * Math.max(st.closed ? 1 : st.factor, 0.05) * L.speedVar;
    const needMin = (e.km - L.offKm) / speed * 60;
    const used = Math.min(needMin, rem);
    const lost = used * (1 - (st.closed ? 1 : st.factor));
    if (lost > 0.001) { L.delayMin += lost; const lbl = st.primary ? st.primary.label : 'Slow traffic'; L.delayCauses[lbl] = (L.delayCauses[lbl] || 0) + lost; }
    if (needMin <= rem) { rem -= needMin; L.idx++; L.offKm = 0; if (L.idx >= L.path.length - 1) { deliver(L); return; } }
    else { L.offKm += speed * rem / 60; rem = 0; }
  }
}

function snapshotLoadMetrics(L) {
  const u = S.units.find(x => x.id === L.unitId);
  if (u) return { lifeUsedPct: u.lifeUsedPct, excursionMin: u.excursionMin, maxTemp: u.maxTemp, risk: u.riskScore, temp: u.temp };
  return L.final || { lifeUsedPct: 0, excursionMin: 0, maxTemp: 0, risk: 0, temp: 0 };
}
function loadImpact(L, w) {
  const P = PRODUCTS[L.product]; const m = snapshotLoadMetrics(L);
  const kg = L.kg * w; const actual = clamp(m.lifeUsedPct * 0.8 + m.excursionMin * 0.02, 0, P.baselineLossPct);
  const av = kg * (P.baselineLossPct - actual) / 100;
  return { kg, av, value: av * P.pricePerKg };
}
function deliver(L) {
  const u = S.units.find(x => x.id === L.unitId);
  L.final = snapshotLoadMetrics(L);
  const im = loadImpact(L, 1);
  S.cum.avoided += im.av; S.cum.value += im.value; S.cum.kgMoved += im.kg; S.cum.delivered++;
  const cb = S.cum.byProduct[L.product] || (S.cum.byProduct[L.product] = { avoidedKg: 0, kgMoved: 0 });
  cb.avoidedKg += im.av; cb.kgMoved += im.kg;
  L.status = 'delivered'; L.deliveredSim = S.simTime; L.idx = L.path.length - 1; L.offKm = 0;
  if (u) { S.retired.kwhSolar += u.kwhSolar; S.retired.kwhLoad += u.kwhLoad; S.units = S.units.filter(x => x !== u); }
  S.loads = S.loads.filter(x => x !== L);
  S.delivered.unshift(L); S.delivered = S.delivered.slice(0, 40);
  log(L.id + ' delivered to ' + G.nodeById[L.dest].name + ' (' + PRODUCTS[L.product].name + ', ' + L.kg + ' kg)', 'good');
}

function etaMin(L) {
  if (L.idx >= L.path.length - 1) return 0;
  return pathTimeMin(L.path.slice(L.idx), L.offKm, L.speedVar);
}

// ---------- reroute assistant ----------
function buildOptions(L) {
  const P = PRODUCTS[L.product]; const u = S.units.find(x => x.id === L.unitId);
  if (!u || L.idx >= L.path.length - 1) return { load: L.id, options: [], note: 'This load has reached its last road segment.' };
  const anchor = L.offKm > 0 ? L.idx + 1 : L.idx;
  const anchorNode = L.path[anchor]; const dest = L.path[L.path.length - 1];
  if (anchorNode === dest) return { load: L.id, options: [], note: 'This load is on its final segment; there is no decision point left.' };
  const curE = G.edgeBetween(L.path[L.idx], L.path[L.idx + 1]);
  const headMin = L.offKm > 0 ? (curE.km - L.offKm) / (curE.kmph * Math.max(sf(curE).factor, 0.05) * L.speedVar) * 60 : 0;
  const sv = L.speedVar;
  const timeCost = e => { const st = sf(e); return st.closed ? Infinity : e.km / (e.kmph * sv * Math.max(st.factor, 0.05)); };
  const defs = [
    { key: 'current', label: 'Stay on planned route', nodes: L.path.slice(anchor) },
    { key: 'fastest', label: 'Fastest open route', nodes: (G.shortestPath(anchorNode, dest, timeCost) || {}).nodes },
    { key: 'safest', label: 'Safest route (avoid passes and slow roads)', nodes: (G.shortestPath(anchorNode, dest, e => { const t = timeCost(e); return Number.isFinite(t) ? t + (e.pass ? 1.2 : 0) + (sf(e).factor < 1 ? t : 0) : Infinity; }) || {}).nodes },
    { key: 'coolest', label: 'Lowest heat exposure', nodes: (G.shortestPath(anchorNode, dest, e => { const t = timeCost(e); if (!Number.isFinite(t)) return Infinity; const a = (ambient(G.nodeById[e.a].climate, S.simTime) + ambient(G.nodeById[e.b].climate, S.simTime)) / 2; return t * (1 + Math.max(0, a - 12) * 0.05); }) || {}).nodes }
  ];
  // Detour: best route that avoids each remaining segment of the planned route in turn (gives an alternative even with no closure)
  const planned = L.path.slice(anchor);
  let detour = null;
  for (let i = 0; i < planned.length - 1; i++) {
    const ban = G.edgeBetween(planned[i], planned[i + 1]).id;
    const p = G.shortestPath(anchorNode, dest, e => e.id === ban ? Infinity : timeCost(e));
    if (p && p.nodes.join('>') !== planned.join('>') && (!detour || p.cost < detour.cost)) detour = { nodes: p.nodes, cost: p.cost, avoid: G.edgeBetween(planned[i], planned[i + 1]).road };
  }
  if (detour) defs.push({ key: 'detour', label: 'Alternate corridor (avoids ' + detour.avoid + ')', nodes: detour.nodes });
  const seen = {}; const options = [];
  defs.forEach(d => {
    if (!d.nodes || d.nodes.length < 1) return;
    const sig = d.nodes.join('>'); if (seen[sig]) return; seen[sig] = true;
    const nodes = d.nodes;
    const tail = nodes.length > 1 ? pathTimeMin(nodes, 0, sv) : 0;
    const total = headMin + tail;
    // estimated ageing: minutes per edge at estimated box temperature
    let ageH = 0; let lifeAdd = 0; const waitHere = [];
    const accum = (min, a) => { const boxT = u.setpoint + 0.06 * Math.max(0, a - u.setpoint); const m = ageRate(boxT, P.rh, P); ageH += min / 60 * m; lifeAdd += min / 60 * m / (P.shelfDays * 24) * 100; };
    for (let i = 0; i < nodes.length - 1; i++) {
      const e = G.edgeBetween(nodes[i], nodes[i + 1]); const st = sf(e);
      const a = (ambient(G.nodeById[nodes[i]].climate, S.simTime) + ambient(G.nodeById[nodes[i + 1]].climate, S.simTime)) / 2;
      const base = e.km / (e.kmph * sv) * 60;
      const mins = st.closed ? st.clearMin + base : base / Math.max(st.factor, 0.05);
      accum(mins, a); if (st.closed) waitHere.push(e.road);
    }
    options.push({
      key: d.key, label: d.label, nodes, names: nodes.map(n => G.nodeById[n].name.split(' (')[0]),
      km: Math.round(pathKm(nodes) + (L.offKm > 0 ? curE.km - L.offKm : 0)), etaMin: Math.round(total),
      arrivalClock: istClock(S.simTime + total * 60000), ageingHours: r2(ageH), lifeAddPct: Math.round(lifeAdd * 1000) / 1000,
      blocked: waitHere.length > 0, blockedOn: waitHere
    });
  });
  const cur = options.find(o => o.key === 'current');
  options.forEach(o => { o.deltaMin = cur ? o.etaMin - cur.etaMin : 0; o.score = o.etaMin / 60 + o.lifeAddPct * 2 + (o.blocked ? 0.5 : 0); });
  let best = options[0]; options.forEach(o => { if (o.score < best.score - 1e-9) best = o; });
  options.forEach(o => { o.recommended = (o === best); });
  return { load: L.id, anchor: anchorNode, anchorName: G.nodeById[anchorNode].name, options, note: '' };
}
function applyReroute(loadId, key) {
  const L = S.loads.find(x => x.id === loadId);
  if (!L) return { ok: false, error: 'Load not found' };
  const info = buildOptions(L);
  const opt = info.options.find(o => o.key === key);
  if (!opt || opt.key === 'current') return { ok: false, error: 'Option not available' };
  const anchor = L.offKm > 0 ? L.idx + 1 : L.idx;
  const before = etaMin(L);
  L.path = L.path.slice(0, anchor).concat(opt.nodes);
  L.kmTotal = pathKm(L.path);
  L.reroutes.push({ at: S.simTime, savedMin: Math.round(before - etaMin(L)), via: opt.names.join(' > ') });
  S.rerouteCount++;
  log(L.id + ' rerouted via ' + opt.names.join(' > '), 'good');
  return { ok: true, load: L.id, newEtaMin: Math.round(etaMin(L)) };
}

// ---------- alerts ----------
function refreshAlerts() {
  const want = {};
  const raise = (key, sev, type, title, detail, ref) => { want[key] = { sev, type, title, detail, ref }; };
  S.units.forEach(u => {
    const P = PRODUCTS[u.product];
    if (u.temp > P.tMax + 0.5) raise('temp_high:' + u.id, u.temp > P.tMax + 3 ? 'critical' : 'warning', 'Temperature high', u.name + ' above safe band', u.temp.toFixed(1) + ' C against a limit of ' + P.tMax + ' C for ' + P.name, u.id);
    if (u.temp < P.freezeT + 0.3 || (P.chill && u.temp < P.tMin - 1)) raise('temp_low:' + u.id, 'critical', 'Chilling / freeze risk', u.name + ' too cold', u.temp.toFixed(1) + ' C is below the safe limit for ' + P.name, u.id);
    if (u.doorOpen) raise('door:' + u.id, 'warning', 'Door open', u.name + ' door is open', 'Cold air is escaping; temperature will climb quickly', u.id);
    if (u.fault === 'compressor') raise('comp:' + u.id, 'critical', 'Compressor fault', u.name + ' compressor not cooling', 'Cooling output is zero until the fault is cleared', u.id);
    const soc = u.battKwh / u.battCapKwh * 100;
    if (soc < 8) raise('batt:' + u.id, 'critical', 'Battery critical', u.name + ' battery almost empty', soc.toFixed(0) + '% left, waiting for solar', u.id);
    else if (soc < 20) raise('batt:' + u.id, 'warning', 'Battery low', u.name + ' battery low', soc.toFixed(0) + '% left', u.id);
    if (u.riskScore >= 55) raise('risk:' + u.id, u.riskScore >= 80 ? 'critical' : 'warning', 'Spoilage risk', u.name + ' spoilage risk ' + riskClass(u.riskScore), 'Risk score ' + u.riskScore + ' for ' + P.name, u.id);
  });
  S.loads.forEach(L => {
    if (L.status === 'waiting') {
      const e = G.edgeBetween(L.path[L.idx], L.path[L.idx + 1]);
      raise('route:' + L.id, 'warning', 'Route blocked', L.id + ' is holding at ' + G.nodeById[L.path[L.idx]].name, e.road + ' is closed; open the Reroute Assistant', L.id);
    }
  });
  // resolve cleared
  S.alerts.forEach(a => { if (a.active && !want[a.key]) { a.active = false; a.resolvedAt = S.simTime; } });
  Object.keys(want).forEach(key => {
    const w = want[key]; const ex = S.alerts.find(a => a.active && a.key === key);
    if (ex) { ex.sev = w.sev; ex.detail = w.detail; ex.title = w.title; }
    else {
      const a = { id: 'AL-' + (++S.alertSeq), key, sev: w.sev, type: w.type, title: w.title, detail: w.detail, ref: w.ref, ts: S.simTime, acked: false, active: true, resolvedAt: null };
      S.alerts.unshift(a);
      if (w.sev === 'critical') log(w.title + ': ' + w.detail, 'bad');
    }
  });
  S.alerts = S.alerts.slice(0, 120);
}

// ---------- tick ----------
function tick() {
  if (S.paused) return;
  try {
    computeOffsets();
    stepEvents();
    computeEdgeState();
    const n = S.simMin;
    for (let i = 0; i < n; i++) {
      S.simTime += 60000;
      S.loads.slice().forEach(L => moveLoad(L, 1));
      S.units.forEach(u => stepUnit(u, 1));
    }
    if (S.loads.length < cfg.TARGET_LOADS) { if (S.spawnWait-- <= 0) { spawnLoad(0); S.spawnWait = 2; } }
    refreshAlerts();
    S.units.forEach(u => {
      const push = (a, v) => { a.push(Number.isFinite(v) ? r2(v) : 0); if (a.length > HIST) a.shift(); };
      push(u.hist.temp, u.temp); push(u.hist.risk, u.riskScore); push(u.hist.solar, u.solarW / 1000); push(u.hist.load, u.loadW / 1000);
    });
    if (store.supabaseOn() && S.tick % 30 === 0) {
      store.saveTelemetry(S.units.map(u => ({ unit_id: u.id, product: u.product, temp_c: r2(u.temp), rh: r1(u.rh), risk: u.riskScore, battery_pct: r1(u.battKwh / u.battCapKwh * 100), solar_w: Math.round(u.solarW), source: u.source })));
    }
    S.tick++;
  } catch (e) { console.error('[tick]', e); }
}

// ---------- public views ----------
function unitView(u) {
  const P = PRODUCTS[u.product]; const ctx = unitContext(u);
  const fan = u.fanPct / 100;
  const supplyT = u.temp - (u.compOn ? 3.2 : 0.4); const returnT = u.temp + (u.compOn ? 1.1 : 0.3);
  return {
    id: u.id, name: u.name, kind: u.kind, node: u.node, loadId: u.loadId, product: u.product, productName: P.name, kg: u.kg,
    lat: ctx.lat, lng: ctx.lng, setpoint: u.setpoint, band: [P.tMin, P.tMax], temp: r2(u.temp), rh: r1(u.rh), doorOpen: u.doorOpen, fault: u.fault,
    compOn: u.compOn, heaterOn: u.heaterOn, fanPct: Math.round(u.fanPct), duty: r2(u.dutyEma),
    solarW: Math.round(u.solarW), loadW: Math.round(u.loadW), solarPeakW: u.solarPeakW, battPct: r1(u.battKwh / u.battCapKwh * 100), battKwh: r2(u.battKwh), battCapKwh: u.battCapKwh,
    powerSrc: u.powerSrc, source: u.source, kwhSolar: r2(u.kwhSolar), kwhLoad: r2(u.kwhLoad),
    ageFactor: r2(u.ageFactor), lifeUsedPct: Math.round(u.lifeUsedPct * 1000) / 1000, excursionMin: Math.round(u.excursionMin), riskScore: u.riskScore, riskClass: riskClass(u.riskScore),
    remainingDays: r1(Math.max(0, (100 - u.lifeUsedPct) / 100 * P.shelfDays / Math.max(u.ageFactor, 0.2))),
    airflow: { supplyT: r1(supplyT), returnT: r1(returnT), coilT: r1(supplyT - (u.compOn ? 4 : 0.5)), dT: r1(returnT - supplyT), flowM3h: Math.round(fan * (u.kind === 'store' ? 1400 : 320)),
      probes: { top: r1(u.temp + 0.35 * (1 - fan) + 0.15), mid: r1(u.temp), bottom: r1(u.temp - 0.25 * (1 - fan) - 0.1) } },
    hist: u.hist
  };
}
function loadView(L) {
  const pos = loadPos(L); const m = snapshotLoadMetrics(L); const P = PRODUCTS[L.product];
  const e = pos.edge; const st = e ? sf(e) : null;
  const top = Object.keys(L.delayCauses).sort((a, b) => L.delayCauses[b] - L.delayCauses[a])[0] || null;
  const done = L.status === 'delivered' ? L.kmTotal : (function () { let k = 0; for (let i = 0; i < L.idx; i++) k += G.edgeBetween(L.path[i], L.path[i + 1]).km; return k + L.offKm; })();
  const eta = L.status === 'delivered' ? 0 : etaMin(L);
  return {
    id: L.id, product: L.product, productName: P.name, kg: L.kg, origin: G.nodeById[L.origin].name.split(' (')[0], dest: G.nodeById[L.dest].name.split(' (')[0],
    path: L.path, pathNames: L.path.map(n => G.nodeById[n].name.split(' (')[0]), status: L.status,
    progressPct: Math.round(clamp(done / L.kmTotal, 0, 1) * 100), kmTotal: Math.round(L.kmTotal), kmDone: Math.round(done),
    etaMin: Math.round(eta), etaClock: L.status === 'delivered' ? istClock(L.deliveredSim) : istClock(S.simTime + eta * 60000),
    delayMin: Math.round(L.delayMin), waitMin: Math.round(L.waitMin), delayCause: top, reroutes: L.reroutes.length,
    unitId: L.unitId, lat: pos.lat, lng: pos.lng, edgeId: e ? e.id : null, edgeStatus: st ? st.status : 'open',
    risk: Math.round(m.risk || 0), temp: r2(m.temp || 0), lifeUsedPct: Math.round((m.lifeUsedPct || 0) * 1000) / 1000, excursionMin: Math.round(m.excursionMin || 0),
    plannedMin: Math.round(L.plannedMin), startedClock: istClock(L.startedSim), elapsedMin: Math.round(((L.deliveredSim || S.simTime) - L.startedSim) / 60000)
  };
}
function allLoadViews() { return S.loads.map(loadView).concat(S.delivered.map(loadView)); }

function impactCalc() {
  const byProduct = {}; let avoided = S.cum.avoided; let value = S.cum.value; let kgMoved = S.cum.kgMoved;
  Object.keys(S.cum.byProduct).forEach(k => { byProduct[k] = { product: k, name: PRODUCTS[k].name, avoidedKg: S.cum.byProduct[k].avoidedKg, kgMoved: S.cum.byProduct[k].kgMoved }; });
  S.loads.forEach(L => {
    let k = 0; for (let i = 0; i < L.idx; i++) k += G.edgeBetween(L.path[i], L.path[i + 1]).km;
    const w = clamp((k + L.offKm) / L.kmTotal, 0, 1);
    const im = loadImpact(L, w);
    avoided += im.av; value += im.value; kgMoved += im.kg;
    const b = byProduct[L.product] || (byProduct[L.product] = { product: L.product, name: PRODUCTS[L.product].name, avoidedKg: 0, kgMoved: 0 });
    b.avoidedKg += im.av; b.kgMoved += im.kg;
  });
  const kwhSolar = S.retired.kwhSolar + S.units.reduce((s, u) => s + u.kwhSolar, 0);
  const kwhLoad = S.retired.kwhLoad + S.units.reduce((s, u) => s + u.kwhLoad, 0);
  return {
    wasteAvoidedKg: Math.round(avoided), valueProtectedInr: Math.round(value), kgMoved: Math.round(kgMoved),
    kwhSolar: r1(kwhSolar), kwhLoad: r1(kwhLoad), co2AvoidedKg: Math.round(kwhLoad * cfg.GRID_CO2_KG_PER_KWH),
    delivered: S.cum.delivered, reroutes: S.rerouteCount,
    byProduct: Object.values(byProduct).map(b => ({ ...b, avoidedKg: Math.round(b.avoidedKg), kgMoved: Math.round(b.kgMoved) })).sort((a, b) => b.avoidedKg - a.avoidedKg)
  };
}

function statsCalc(unitViews, loadViews) {
  const inBand = unitViews.filter(u => u.temp >= u.band[0] && u.temp <= u.band[1]).length;
  const active = S.alerts.filter(a => a.active);
  return {
    unitsOnline: unitViews.length, stores: unitViews.filter(u => u.kind === 'store').length, boxes: unitViews.filter(u => u.kind === 'box').length,
    inBandPct: unitViews.length ? Math.round(inBand / unitViews.length * 100) : 0,
    avgTemp: unitViews.length ? r1(unitViews.reduce((s, u) => s + u.temp, 0) / unitViews.length) : 0,
    alertsActive: active.length, alertsCritical: active.filter(a => a.sev === 'critical').length, alertsUnacked: active.filter(a => !a.acked).length,
    loadsMoving: loadViews.filter(l => l.status === 'moving' && S.loads.some(x => x.id === l.id)).length,
    loadsWaiting: loadViews.filter(l => l.status === 'waiting').length,
    solarKw: r1(unitViews.reduce((s, u) => s + u.solarW, 0) / 1000), loadKw: r1(unitViews.reduce((s, u) => s + u.loadW, 0) / 1000),
    avgBattPct: unitViews.length ? Math.round(unitViews.reduce((s, u) => s + u.battPct, 0) / unitViews.length) : 0,
    eventsActive: S.events.length, closedRoads: Object.values(S.edgeState).filter(s => s.closed).length, delayedRoads: Object.values(S.edgeState).filter(s => s.status === 'delayed').length
  };
}

function snapshot() {
  const units = S.units.map(unitView);
  const active = S.loads.map(loadView);
  const delivered = S.delivered.map(loadView);
  const w = weather.get();
  // fleet average temperature history (aligned to the shortest unit history)
  const fleet = (function () { const n = Math.min(...units.map(u => u.hist.temp.length), HIST); if (!units.length || !n) return []; const out = []; for (let i = 0; i < n; i++) out.push(r2(units.reduce((s, u) => s + u.hist.temp[u.hist.temp.length - n + i], 0) / units.length)); return out; })();
  return {
    meta: { simTime: S.simTime, clock: istClock(S.simTime), dateTime: istString(S.simTime), tick: S.tick, paused: S.paused, simMinPerTick: S.simMin, tickMs: cfg.TICK_MS, mode: 'simulation',
      weather: { source: w.source, updated: w.updated, valley: w.groups.valley, jammu: w.groups.jammu, ladakh: w.groups.ladakh },
      persistence: store.supabaseOn() ? 'supabase' : 'local', sunlight: Math.round(irradiance(S.simTime) * 100) },
    units, loads: active, delivered,
    edges: G.EDGES.map(e => { const s = sf(e); return { id: e.id, status: s.status, factor: r2(s.factor), clearMin: Math.round(s.clearMin), event: s.primary ? s.primary.label : null }; }),
    events: { active: S.events.map(ev => ({ ...ev, remainMin: Math.max(0, Math.round((ev.endsAt - S.simTime) / 60000)), clock: istClock(ev.startedAt), clearClock: istClock(ev.endsAt) })),
      history: S.eventHistory.map(ev => ({ ...ev, clock: istClock(ev.startedAt), clearedClock: istClock(ev.clearedAt) })) },
    alerts: S.alerts.map(a => ({ ...a, clock: istClock(a.ts) })),
    activity: S.activity, stats: statsCalc(units, active.concat(delivered)), impact: impactCalc(), fleetTemp: fleet
  };
}

function bootstrap() {
  return {
    name: 'ORCAS', full: 'ORchard Cold-chain And Storage',
    nodes: G.NODES.map(n => ({ id: n.id, name: n.name, lat: n.lat, lng: n.lng, type: n.type })),
    edges: G.EDGES.map(e => ({ id: e.id, a: e.a, b: e.b, km: e.km, kmph: e.kmph, road: e.road, pass: e.pass })),
    products: Object.keys(PRODUCTS).map(k => ({ key: k, ...PRODUCTS[k] })),
    eventTypes: Object.keys(EVENT_TYPES).map(k => ({ key: k, label: EVENT_TYPES[k].label, mode: EVENT_TYPES[k].mode })),
    bounds: [[32.0, 73.6], [36.3, 78.8]],
    tiles: cfg.MAP_TILES === 'none' ? null : { url: cfg.MAP_TILES === 'osm' ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : cfg.MAP_TILES, attribution: '&copy; OpenStreetMap contributors' }
  };
}

// ---------- controls ----------
function setFault(unitId, type) {
  const u = S.units.find(x => x.id === unitId); if (!u) return { ok: false, error: 'Unit not found' };
  if (type === 'door') { u.doorOpen = true; u.doorAutoCloseMin = 45; log(u.name + ': door opened (simulated)', 'warn'); }
  else if (type === 'compressor') { u.fault = 'compressor'; log(u.name + ': compressor fault injected (simulated)', 'bad'); }
  else if (type === 'clear') { u.fault = null; u.doorOpen = false; u.doorAutoCloseMin = null; log(u.name + ': faults cleared', 'good'); }
  else return { ok: false, error: 'Unknown fault type' };
  return { ok: true };
}
function ackAlert(id) { const a = S.alerts.find(x => x.id === id); if (!a) return false; a.acked = true; return true; }
function ingest(b) {
  const u = S.units.find(x => x.id === b.unitId); if (!u) return { ok: false, status: 404, error: 'Unknown unitId' };
  const t = Number(b.tempC);
  if (!Number.isFinite(t) || t < -40 || t > 80) return { ok: false, status: 400, error: 'tempC must be a number between -40 and 80' };
  const opt = (v, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= lo && Number(v) <= hi) ? Number(v) : undefined;
  u.live = { ts: Date.now(), tempC: t, rh: opt(b.rh, 0, 100), doorOpen: typeof b.doorOpen === 'boolean' ? b.doorOpen : undefined, compressorOn: typeof b.compressorOn === 'boolean' ? b.compressorOn : undefined, batteryPct: opt(b.batteryPct, 0, 100), solarW: opt(b.solarW, 0, 100000) };
  return { ok: true, setpointC: u.setpoint };
}
function setSim(b) {
  if (typeof b.paused === 'boolean') S.paused = b.paused;
  if (Number.isFinite(Number(b.simMinPerTick))) S.simMin = clamp(Math.round(Number(b.simMinPerTick)), 1, 30);
  return { paused: S.paused, simMinPerTick: S.simMin };
}

function init() {
  initClock();
  computeOffsets();
  cfg.STORES.forEach(s => S.units.push(makeUnit({ id: s.id, name: s.name, kind: 'store', node: s.node, product: s.product, kg: s.kg, solarPeakW: s.solarPeakW, battCapKwh: s.battCapKwh, lifeUsedPct: rr(4, 22) })));
  computeEdgeState();
  createEvent('banihal~ramban', 'shooting_stones', 'auto', 300, 30);
  for (let i = 0; i < cfg.TARGET_LOADS; i++) spawnLoad((i + 0.5) / cfg.TARGET_LOADS * 0.8);
  // warm-up so charts start populated
  for (let i = 0; i < 12; i++) tick();
  log('ORCAS control room online', 'good');
}

module.exports = { init, tick, snapshot, bootstrap, buildOptions, applyReroute, createEvent, clearEvent, setFault, ackAlert, ingest, setSim,
  allLoadViews, impactCalc, state: S, istString, istClock, PRODUCTS, EVENT_TYPES, loadView, unitView, etaMin };
