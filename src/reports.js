'use strict';
// Report builder. Pure in-memory computation from the live engine state: no network, no database,
// no awaits. Reports therefore come back instantly and can never hang on an external service.
const E = require('./engine');

const n0 = v => Number.isFinite(Number(v)) ? String(Math.round(Number(v))) : '-';
const n1 = v => Number.isFinite(Number(v)) ? (Math.round(Number(v) * 10) / 10).toFixed(1) : '-';
const n2 = v => Number.isFinite(Number(v)) ? (Math.round(Number(v) * 100) / 100).toFixed(2) : '-';
const hm = min => { if (!Number.isFinite(Number(min))) return '-'; const m = Math.round(Number(min)); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const inr = v => Number.isFinite(Number(v)) ? 'Rs ' + Math.round(Number(v)).toLocaleString('en-IN') : '-';

function base(type, title, period) {
  return { type, title, period, generatedAt: E.istString(E.state.simTime), system: 'ORCAS - ORchard Cold-chain And Storage', summary: [], columns: [], rows: [], notes: [] };
}

function delayReport() {
  const r = base('delay', 'Delay & Disruption Report', 'All loads in transit plus the last ' + E.state.delivered.length + ' deliveries');
  const loads = E.allLoadViews();
  const delayed = loads.filter(l => l.delayMin > 0);
  const totalDelay = loads.reduce((s, l) => s + l.delayMin, 0);
  const totalWait = loads.reduce((s, l) => s + l.waitMin, 0);
  const causeMin = {};
  loads.forEach(l => { if (l.delayCause) causeMin[l.delayCause] = (causeMin[l.delayCause] || 0) + l.delayMin; });
  const top = Object.keys(causeMin).sort((a, b) => causeMin[b] - causeMin[a])[0];
  r.summary = [
    { label: 'Loads tracked', value: n0(loads.length) },
    { label: 'Loads delayed', value: n0(delayed.length) },
    { label: 'Total delay', value: hm(totalDelay) },
    { label: 'Time held at closures', value: hm(totalWait) },
    { label: 'Average delay per delayed load', value: delayed.length ? hm(totalDelay / delayed.length) : '0h 00m' },
    { label: 'Main cause', value: top || 'None recorded' },
    { label: 'Reroutes applied', value: n0(loads.reduce((s, l) => s + l.reroutes, 0)) },
    { label: 'Active road events', value: n0(E.state.events.length) }
  ];
  r.columns = ['Load', 'Product', 'Route', 'Status', 'Planned', 'Elapsed', 'Delay', 'Held', 'Main cause', 'Reroutes'];
  r.rows = loads.sort((a, b) => b.delayMin - a.delayMin).map(l => [l.id, l.productName + ' ' + n0(l.kg) + ' kg', l.origin + ' to ' + l.dest, l.status, hm(l.plannedMin), hm(l.elapsedMin), hm(l.delayMin), hm(l.waitMin), l.delayCause || '-', n0(l.reroutes)]);
  r.notes = ['Delay = extra minutes caused by road events (slow-down or closure), measured against the planned running time of the route.', 'Times use the simulation clock (IST).'];
  return r;
}

function spoilageReport() {
  const r = base('spoilage', 'Spoilage & Cold Chain Quality Report', 'Current state of every store and cold box');
  const units = E.state.units.map(E.unitView);
  const avgRisk = units.length ? units.reduce((s, u) => s + u.riskScore, 0) / units.length : 0;
  r.summary = [
    { label: 'Units monitored', value: n0(units.length) },
    { label: 'Within safe band now', value: n0(units.filter(u => u.temp >= u.band[0] && u.temp <= u.band[1]).length) + ' of ' + n0(units.length) },
    { label: 'High / critical risk', value: n0(units.filter(u => u.riskScore >= 55).length) },
    { label: 'Average risk score', value: n1(avgRisk) },
    { label: 'Total excursion time', value: hm(units.reduce((s, u) => s + u.excursionMin, 0)) }
  ];
  r.columns = ['Unit', 'Product', 'Temp C', 'Safe band C', 'RH %', 'Ageing factor', 'Shelf life used %', 'Est. days left', 'Excursion', 'Risk'];
  r.rows = units.sort((a, b) => b.riskScore - a.riskScore).map(u => [u.id + ' ' + u.name, u.productName, n1(u.temp), u.band[0] + ' to ' + u.band[1], n0(u.rh), 'x' + n2(u.ageFactor), n2(u.lifeUsedPct), n1(u.remainingDays), hm(u.excursionMin), n0(u.riskScore) + ' (' + u.riskClass + ')']);
  r.notes = ['Ageing factor = how many times faster than ideal the product is ageing at the current temperature and humidity (Q10 model).', 'Risk score combines recent excursion time, ageing factor and shelf life already used.'];
  return r;
}

function energyReport() {
  const r = base('energy', 'Solar & Energy Report', 'Cumulative since the control room started');
  const units = E.state.units.map(E.unitView); const im = E.impactCalc();
  r.summary = [
    { label: 'Solar generated', value: n1(im.kwhSolar) + ' kWh' },
    { label: 'Cooling load served', value: n1(im.kwhLoad) + ' kWh' },
    { label: 'CO2 avoided vs grid / genset', value: n0(im.co2AvoidedKg) + ' kg' },
    { label: 'Solar output now', value: n1(units.reduce((s, u) => s + u.solarW, 0) / 1000) + ' kW' },
    { label: 'Average battery', value: units.length ? n0(units.reduce((s, u) => s + u.battPct, 0) / units.length) + '%' : '-' }
  ];
  r.columns = ['Unit', 'Solar now W', 'Load now W', 'Battery %', 'Power source', 'Solar kWh', 'Load kWh', 'Compressor duty %'];
  r.rows = units.map(u => [u.id + ' ' + u.name, n0(u.solarW), n0(u.loadW), n0(u.battPct), u.powerSrc, n2(u.kwhSolar), n2(u.kwhLoad), n0(u.duty * 100)]);
  r.notes = ['CO2 figure uses ' + 0.82 + ' kg CO2 per kWh (India grid average) as the replaced source. Change GRID_CO2_KG_PER_KWH in src/config.js to use a different factor.'];
  return r;
}

function shiftReport() {
  const r = base('shift', 'Shift Summary Report', 'Control room hand-over summary');
  const st = E.snapshot(); const s = st.stats; const im = st.impact;
  const crit = st.alerts.filter(a => a.active && a.sev === 'critical');
  r.summary = [
    { label: 'Units online', value: n0(s.unitsOnline) + ' (' + s.stores + ' stores, ' + s.boxes + ' cold boxes)' },
    { label: 'Units within safe band', value: n0(s.inBandPct) + '%' },
    { label: 'Active alerts', value: n0(s.alertsActive) + ' (' + n0(s.alertsCritical) + ' critical)' },
    { label: 'Loads moving / holding', value: n0(s.loadsMoving) + ' / ' + n0(s.loadsWaiting) },
    { label: 'Roads closed / slowed', value: n0(s.closedRoads) + ' / ' + n0(s.delayedRoads) },
    { label: 'Deliveries completed', value: n0(im.delivered) },
    { label: 'Estimated waste avoided', value: n0(im.wasteAvoidedKg) + ' kg' },
    { label: 'Estimated value protected', value: inr(im.valueProtectedInr) }
  ];
  r.columns = ['Time', 'Event'];
  r.rows = st.activity.slice(0, 25).map(a => [a.clock, a.text]);
  r.notes = crit.length ? ['Open critical alerts: ' + crit.map(a => a.title).join('; ')] : ['No open critical alerts at the time of this report.'];
  r.notes.push('Waste and value figures are modelled against assumed baseline losses (see Waste & Impact panel).');
  return r;
}

const BUILDERS = { delay: delayReport, spoilage: spoilageReport, energy: energyReport, shift: shiftReport };
function build(type) { const f = BUILDERS[type]; return f ? f() : null; }

function toCSV(r) {
  const q = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [];
  lines.push([q(r.title)].join(','));
  lines.push([q('Generated'), q(r.generatedAt)].join(','));
  lines.push([q('Scope'), q(r.period)].join(','));
  lines.push('');
  r.summary.forEach(s => lines.push([q(s.label), q(s.value)].join(',')));
  lines.push('');
  lines.push(r.columns.map(q).join(','));
  r.rows.forEach(row => lines.push(row.map(q).join(',')));
  lines.push('');
  r.notes.forEach(n => lines.push(q(n)));
  return '\uFEFF' + lines.join('\r\n');
}

module.exports = { build, toCSV, TYPES: Object.keys(BUILDERS) };
