'use strict';
// Persistence for reports and telemetry.
//  - Always keeps a local JSON file (data/reports.json) so history survives restarts on a normal host.
//  - If SUPABASE_URL + key are set, also mirrors to Supabase over REST.
// Every write is fire-and-forget with a hard timeout, so persistence can NEVER slow down or break a request
// (this is what keeps report generation instant).
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'reports.json');
let history = [];
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) history = JSON.parse(fs.readFileSync(FILE, 'utf8')) || [];
  if (!Array.isArray(history)) history = [];
} catch (e) { history = []; }

function supabaseOn() { return !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY); }

function sbInsert(table, row) {
  if (!supabaseOn()) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  fetch(cfg.SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: cfg.SUPABASE_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_KEY,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify(row),
    signal: ctl.signal
  }).catch(() => {}).finally(() => clearTimeout(t));
}

let writing = false; let dirty = false;
function flush() {
  if (writing) { dirty = true; return; }
  writing = true;
  fs.writeFile(FILE, JSON.stringify(history.slice(0, 50)), () => {
    writing = false;
    if (dirty) { dirty = false; flush(); }
  });
}

function saveReport(report) {
  const entry = { id: 'RPT-' + Date.now().toString(36).toUpperCase(), type: report.type, title: report.title, generatedAt: report.generatedAt, summary: report.summary };
  history.unshift(entry);
  history = history.slice(0, 50);
  flush();
  sbInsert('orcas_reports', { report_id: entry.id, report_type: report.type, title: report.title, payload: report });
  return entry;
}
function listReports() { return history.slice(0, 20); }
function saveTelemetry(rows) { rows.forEach(r => sbInsert('orcas_telemetry', r)); }

module.exports = { saveReport, listReports, saveTelemetry, supabaseOn };
