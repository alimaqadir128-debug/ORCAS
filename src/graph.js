'use strict';
// Road network of Jammu & Kashmir and Ladakh used by the logistics panels.
// Distances / average speeds are planning approximations for a prototype, not survey data.
const NODES = [
  { id: 'srinagar',  name: 'Srinagar (Parimpora Mandi)', lat: 34.0837, lng: 74.7973, climate: 'valley', type: 'hub' },
  { id: 'pulwama',   name: 'Pulwama',                    lat: 33.8716, lng: 74.8946, climate: 'valley', type: 'town' },
  { id: 'shopian',   name: 'Shopian',                    lat: 33.7170, lng: 74.8340, climate: 'valley', type: 'town' },
  { id: 'anantnag',  name: 'Anantnag',                   lat: 33.7311, lng: 75.1487, climate: 'valley', type: 'town' },
  { id: 'qazigund',  name: 'Qazigund',                   lat: 33.5877, lng: 75.1658, climate: 'valley', type: 'town' },
  { id: 'banihal',   name: 'Banihal',                    lat: 33.4403, lng: 75.1928, climate: 'valley', type: 'town' },
  { id: 'ramban',    name: 'Ramban',                     lat: 33.2400, lng: 75.2400, climate: 'jammu',  type: 'town' },
  { id: 'udhampur',  name: 'Udhampur',                   lat: 32.9160, lng: 75.1416, climate: 'jammu',  type: 'town' },
  { id: 'jammu',     name: 'Jammu (Narwal Mandi)',       lat: 32.7266, lng: 74.8570, climate: 'jammu',  type: 'hub' },
  { id: 'lakhanpur', name: 'Lakhanpur (exit to Punjab / Delhi)', lat: 32.3733, lng: 75.5456, climate: 'jammu', type: 'gateway' },
  { id: 'peerkigali',name: 'Peer Ki Gali (Mughal Road)', lat: 33.6200, lng: 74.5500, climate: 'pass',   type: 'pass' },
  { id: 'rajouri',   name: 'Rajouri',                    lat: 33.3770, lng: 74.3100, climate: 'jammu',  type: 'town' },
  { id: 'sonamarg',  name: 'Sonamarg',                   lat: 34.3000, lng: 75.2900, climate: 'pass',   type: 'town' },
  { id: 'zojila',    name: 'Zojila Pass',                lat: 34.2850, lng: 75.4700, climate: 'ladakh', type: 'pass' },
  { id: 'kargil',    name: 'Kargil',                     lat: 34.5539, lng: 76.1349, climate: 'ladakh', type: 'hub' },
  { id: 'leh',       name: 'Leh',                        lat: 34.1526, lng: 77.5771, climate: 'ladakh', type: 'hub' },
  { id: 'sopore',    name: 'Sopore',                     lat: 34.2960, lng: 74.4660, climate: 'valley', type: 'town' },
  { id: 'baramulla', name: 'Baramulla',                  lat: 34.1980, lng: 74.3636, climate: 'valley', type: 'town' }
];

const SOFT = ['traffic', 'accident', 'fog'];
const EDGES_RAW = [
  { a: 'srinagar',  b: 'pulwama',    km: 30,  kmph: 45, road: 'Srinagar-Pulwama Road' },
  { a: 'pulwama',   b: 'shopian',    km: 28,  kmph: 40, road: 'Pulwama-Shopian Road' },
  { a: 'srinagar',  b: 'anantnag',   km: 55,  kmph: 55, road: 'NH-44' },
  { a: 'shopian',   b: 'anantnag',   km: 42,  kmph: 40, road: 'Shopian-Anantnag Road' },
  { a: 'anantnag',  b: 'qazigund',   km: 25,  kmph: 50, road: 'NH-44' },
  { a: 'qazigund',  b: 'banihal',    km: 17,  kmph: 40, road: 'NH-44 (Jawahar Tunnel)' },
  { a: 'banihal',   b: 'ramban',     km: 35,  kmph: 35, road: 'NH-44', hazards: ['landslide', 'shooting_stones', 'traffic'] },
  { a: 'ramban',    b: 'udhampur',   km: 90,  kmph: 45, road: 'NH-44', hazards: ['landslide', 'traffic', 'accident'] },
  { a: 'udhampur',  b: 'jammu',      km: 65,  kmph: 55, road: 'NH-44' },
  { a: 'jammu',     b: 'lakhanpur',  km: 85,  kmph: 60, road: 'NH-44' },
  { a: 'shopian',   b: 'peerkigali', km: 45,  kmph: 25, road: 'Mughal Road', pass: true, hazards: ['snow', 'landslide'] },
  { a: 'peerkigali',b: 'rajouri',    km: 55,  kmph: 30, road: 'Mughal Road', pass: true, hazards: ['snow', 'landslide'] },
  { a: 'rajouri',   b: 'jammu',      km: 150, kmph: 50, road: 'Rajouri-Jammu Road', hazards: ['landslide', 'traffic', 'accident'] },
  { a: 'srinagar',  b: 'sonamarg',   km: 80,  kmph: 45, road: 'NH-1', hazards: ['landslide', 'traffic', 'fog'] },
  { a: 'sonamarg',  b: 'zojila',     km: 18,  kmph: 20, road: 'NH-1 (Zojila Pass)', pass: true, hazards: ['snow', 'landslide'] },
  { a: 'zojila',    b: 'kargil',     km: 105, kmph: 40, road: 'NH-1', pass: true, hazards: ['snow', 'landslide', 'fog'] },
  { a: 'kargil',    b: 'leh',        km: 215, kmph: 50, road: 'NH-1', hazards: ['snow', 'fog', 'accident'] },
  { a: 'srinagar',  b: 'sopore',     km: 48,  kmph: 55, road: 'NH-1', hazards: ['traffic', 'fog', 'accident'] },
  { a: 'sopore',    b: 'baramulla',  km: 16,  kmph: 50, road: 'NH-1' }
];

const nodeById = {};
NODES.forEach(n => { nodeById[n.id] = n; });
const EDGES = EDGES_RAW.map(e => ({ ...e, id: e.a + '~' + e.b, pass: !!e.pass, hazards: e.hazards || SOFT }));
const edgeById = {};
EDGES.forEach(e => { edgeById[e.id] = e; });

const adj = {};
NODES.forEach(n => { adj[n.id] = []; });
EDGES.forEach(e => { adj[e.a].push({ edge: e, to: e.b }); adj[e.b].push({ edge: e, to: e.a }); });

function edgeBetween(a, b) { return edgeById[a + '~' + b] || edgeById[b + '~' + a] || null; }

// Dijkstra. costFn(edge, fromId, toId) returns a non-negative number or Infinity.
function shortestPath(from, to, costFn) {
  if (!nodeById[from] || !nodeById[to]) return null;
  if (from === to) return { nodes: [from], cost: 0 };
  const dist = {}; const prev = {}; const done = {};
  NODES.forEach(n => { dist[n.id] = Infinity; });
  dist[from] = 0;
  for (;;) {
    let u = null; let best = Infinity;
    for (const id in dist) if (!done[id] && dist[id] < best) { best = dist[id]; u = id; }
    if (u === null) break;
    if (u === to) break;
    done[u] = true;
    for (const { edge, to: v } of adj[u]) {
      const c = costFn(edge, u, v);
      if (!Number.isFinite(c)) continue;
      if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const nodes = [to];
  while (nodes[0] !== from) nodes.unshift(prev[nodes[0]]);
  return { nodes, cost: dist[to] };
}

module.exports = { NODES, EDGES, nodeById, edgeById, adj, edgeBetween, shortestPath };
