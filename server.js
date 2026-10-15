'use strict';
// ORCAS server: Express API + static control-room UI.
try { require('fs').readFileSync('.env', 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) { /* .env is optional */ }

const express = require('express');
const path = require('path');
const cfg = require('./src/config');
const E = require('./src/engine');
const R = require('./src/reports');
const store = require('./src/store');
const weather = require('./src/weather');
const G = require('./src/graph');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

const api = express.Router();
const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
api.use(noStore);

api.get('/health', (req, res) => res.json({ ok: true, name: 'ORCAS', tick: E.state.tick, uptimeSec: Math.round(process.uptime()), persistence: store.supabaseOn() ? 'supabase' : 'local' }));
api.get('/bootstrap', (req, res) => res.json(E.bootstrap()));
api.get('/state', (req, res) => res.json(E.snapshot()));

api.post('/alerts/:id/ack', (req, res) => E.ackAlert(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ ok: false, error: 'Alert not found' }));

api.post('/units/:id/fault', (req, res) => {
  const r = E.setFault(req.params.id, String((req.body || {}).type || ''));
  res.status(r.ok ? 200 : 400).json(r);
});

api.post('/events', (req, res) => {
  const b = req.body || {};
  if (!G.edgeById[b.edgeId]) return res.status(400).json({ ok: false, error: 'Unknown road segment' });
  if (!E.EVENT_TYPES[b.type]) return res.status(400).json({ ok: false, error: 'Unknown event type' });
  const dur = Number(b.durationMin);
  const ev = E.createEvent(b.edgeId, b.type, 'manual', Number.isFinite(dur) && dur >= 10 && dur <= 720 ? Math.round(dur) : undefined);
  res.json({ ok: true, id: ev.id });
});
api.post('/events/:id/clear', (req, res) => E.clearEvent(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ ok: false, error: 'Event not found' }));

api.get('/reroute/:loadId', (req, res) => {
  const L = E.state.loads.find(l => l.id === req.params.loadId);
  if (!L) return res.status(404).json({ ok: false, error: 'Load not found (it may have been delivered)' });
  res.json({ ok: true, ...E.buildOptions(L) });
});
api.post('/reroute/:loadId', (req, res) => {
  const r = E.applyReroute(req.params.loadId, String((req.body || {}).option || ''));
  res.status(r.ok ? 200 : 400).json(r);
});

api.post('/sim', (req, res) => res.json({ ok: true, ...E.setSim(req.body || {}) }));

api.get('/reports/history', (req, res) => res.json({ ok: true, items: store.listReports() }));
api.get('/reports/:type', (req, res) => {
  const rep = R.build(req.params.type);
  if (!rep) return res.status(404).json({ ok: false, error: 'Unknown report type. Use: ' + R.TYPES.join(', ') });
  const entry = store.saveReport(rep);
  if (req.query.format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="orcas-' + rep.type + '-report.csv"' });
    return res.send(R.toCSV(rep));
  }
  res.json({ ok: true, id: entry.id, report: rep });
});

// Hardware / sensor node ingestion (ESP32 firmware in /firmware)
api.post('/ingest', (req, res) => {
  if (req.get('x-orcas-key') !== cfg.INGEST_KEY) return res.status(401).json({ ok: false, error: 'Bad or missing x-orcas-key header' });
  const r = E.ingest(req.body || {});
  res.status(r.ok ? 200 : (r.status || 400)).json(r.ok ? r : { ok: false, error: r.error });
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  console.error('[error]', err && err.message);
  res.status(500).json({ ok: false, error: 'Internal error' });
});
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e && e.message));
process.on('uncaughtException', e => console.error('[uncaughtException]', e && e.message));

E.init();
weather.start();
setInterval(E.tick, cfg.TICK_MS);
app.listen(cfg.PORT, () => {
  console.log('\n  ORCAS control room running');
  console.log('  Open  http://localhost:' + cfg.PORT);
  console.log('  Data  simulation clock, persistence: ' + (store.supabaseOn() ? 'Supabase + local file' : 'local file') + '\n');
});
