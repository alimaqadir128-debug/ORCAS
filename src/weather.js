'use strict';
// Live weather from Open-Meteo (no API key needed). Never blocks and never throws:
// if the request fails or times out, the engine silently keeps using its seasonal climate model.
const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
const POINTS = [
  { key: 'valley', lat: 34.0837, lng: 74.7973 },  // Srinagar
  { key: 'jammu',  lat: 32.7266, lng: 74.8570 },  // Jammu
  { key: 'ladakh', lat: 34.1526, lng: 77.5771 }   // Leh
];
const state = { source: 'model', updated: null, groups: { valley: null, jammu: null, ladakh: null } };

async function refresh() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const url = URL_BASE + '?latitude=' + POINTS.map(p => p.lat).join(',') +
      '&longitude=' + POINTS.map(p => p.lng).join(',') +
      '&current=temperature_2m,cloud_cover&timezone=Asia%2FKolkata';
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [data];
    const next = { valley: null, jammu: null, ladakh: null };
    POINTS.forEach((p, i) => {
      const cur = arr[i] && arr[i].current;
      if (cur && Number.isFinite(cur.temperature_2m)) {
        next[p.key] = { temp: cur.temperature_2m, cloud: Number.isFinite(cur.cloud_cover) ? cur.cloud_cover : 25 };
      }
    });
    if (next.valley || next.jammu || next.ladakh) {
      state.groups = next; state.source = 'live'; state.updated = Date.now();
    }
  } catch (e) {
    // keep previous values / model; nothing to report to the user
  } finally {
    clearTimeout(timer);
  }
}

function start() {
  refresh();
  const t = setInterval(refresh, 10 * 60 * 1000);
  if (t.unref) t.unref();
}
function get() { return state; }

module.exports = { start, get, refresh };
