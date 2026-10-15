'use strict';
// Quick health check: npm run check
// Runs the engine for a simulated day, builds every report and verifies nothing is NaN or undefined.
process.env.SIM_START_HOUR_IST = '6';
const E = require('../src/engine');
const R = require('../src/reports');
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL  ' + m); } else console.log('ok    ' + m); };

E.init();
const t0 = Date.now();
for (let i = 0; i < 300; i++) E.tick();
ok(Date.now() - t0 < 5000, 'simulated 300 ticks (~30 hours) in ' + (Date.now() - t0) + ' ms');
const s = E.snapshot(); const j = JSON.stringify(s);
ok(!/NaN|undefined/.test(j), 'snapshot contains no NaN / undefined');
ok(s.units.length >= 4 && s.loads.length > 0, 'units and loads present (' + s.units.length + ' units, ' + s.loads.length + ' loads)');
ok(s.units.every(u => u.temp > -30 && u.temp < 60), 'all unit temperatures are physically sensible');
R.TYPES.forEach(t => {
  const t1 = Date.now(); const rep = R.build(t); const txt = JSON.stringify(rep) + R.toCSV(rep);
  ok(rep && rep.rows && !/NaN|undefined/.test(txt) && Date.now() - t1 < 200, 'report "' + t + '" built in ' + (Date.now() - t1) + ' ms, ' + rep.rows.length + ' rows, clean');
});
const L = E.state.loads[0];
ok(E.buildOptions(L) && Array.isArray(E.buildOptions(L).options), 'reroute assistant returns options');
const ing = E.ingest({ unitId: s.units[0].id, tempC: 3.1, rh: 90 });
ok(ing.ok, 'sensor ingest accepted');
ok(!E.ingest({ unitId: s.units[0].id, tempC: 'abc' }).ok, 'sensor ingest rejects bad data');
console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll checks passed');
process.exit(failed ? 1 : 0);
