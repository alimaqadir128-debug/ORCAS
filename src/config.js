'use strict';
// ORCAS configuration. Every value can be overridden through environment variables (.env or host dashboard).
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

// Product spoilage profiles.
// q10        : how many times faster the product ages for every +10 C
// shelfDays  : shelf life at the ideal temperature
// baselineLossPct / pricePerKg are ASSUMED placeholder values used only by the Waste & Impact panel.
// Replace them with field-survey figures before quoting numbers outside the prototype.
const PRODUCTS = {
  apple:   { name: 'Apple',            tIdeal: 2,   tMin: 0,    tMax: 4,   freezeT: -1.5, rh: 92, q10: 2.5, shelfDays: 90,  chill: false, baselineLossPct: 15, pricePerKg: 90 },
  pear:    { name: 'Pear',             tIdeal: 0,   tMin: -1,   tMax: 2,   freezeT: -2,   rh: 92, q10: 2.6, shelfDays: 60,  chill: false, baselineLossPct: 15, pricePerKg: 80 },
  cherry:  { name: 'Cherry',           tIdeal: 0.5, tMin: -0.5, tMax: 2,   freezeT: -1.5, rh: 92, q10: 3.0, shelfDays: 14,  chill: false, baselineLossPct: 25, pricePerKg: 400 },
  walnut:  { name: 'Walnut',           tIdeal: 4,   tMin: 0,    tMax: 10,  freezeT: -10,  rh: 65, q10: 2.0, shelfDays: 180, chill: false, baselineLossPct: 5,  pricePerKg: 700 },
  saffron: { name: 'Saffron',          tIdeal: 15,  tMin: 10,   tMax: 20,  freezeT: -10,  rh: 55, q10: 1.5, shelfDays: 365, chill: false, baselineLossPct: 3,  pricePerKg: 250000 },
  trout:   { name: 'Trout',            tIdeal: 0,   tMin: -1,   tMax: 2,   freezeT: -2.5, rh: 95, q10: 3.5, shelfDays: 7,   chill: false, baselineLossPct: 20, pricePerKg: 450 },
  dairy:   { name: 'Paneer / Dairy',   tIdeal: 3,   tMin: 1,    tMax: 5,   freezeT: -1,   rh: 85, q10: 3.0, shelfDays: 10,  chill: false, baselineLossPct: 18, pricePerKg: 350 },
  vaccine: { name: 'Vaccines',         tIdeal: 5,   tMin: 2,    tMax: 8,   freezeT: 0,    rh: 60, q10: 4.0, shelfDays: 180, chill: false, baselineLossPct: 10, pricePerKg: 20000 },
  tomato:  { name: 'Tomato',           tIdeal: 12,  tMin: 10,   tMax: 14,  freezeT: 2,    rh: 90, q10: 2.5, shelfDays: 14,  chill: true,  baselineLossPct: 25, pricePerKg: 40 }
};

// What each product typically moves between (node ids from graph.js) and in what quantity.
const LOAD_PROFILES = {
  apple:   { w: 0.34, origins: ['shopian', 'pulwama', 'sopore', 'baramulla'], dests: ['jammu', 'lakhanpur', 'leh', 'kargil'], kg: [6000, 12000] },
  pear:    { w: 0.10, origins: ['shopian', 'pulwama'], dests: ['jammu', 'lakhanpur', 'srinagar'], kg: [4000, 8000] },
  cherry:  { w: 0.05, origins: ['srinagar', 'anantnag'], dests: ['jammu', 'lakhanpur'], kg: [800, 2000] },
  walnut:  { w: 0.12, origins: ['anantnag', 'srinagar', 'sopore'], dests: ['jammu', 'lakhanpur'], kg: [1500, 4000] },
  saffron: { w: 0.07, origins: ['pulwama', 'srinagar'], dests: ['jammu', 'lakhanpur'], kg: [2, 6] },
  trout:   { w: 0.08, origins: ['anantnag', 'qazigund'], dests: ['srinagar', 'jammu', 'leh'], kg: [300, 900] },
  dairy:   { w: 0.08, origins: ['srinagar', 'anantnag'], dests: ['kargil', 'leh', 'jammu'], kg: [500, 1500] },
  vaccine: { w: 0.07, origins: ['srinagar'], dests: ['leh', 'kargil', 'jammu'], kg: [80, 250] },
  tomato:  { w: 0.09, origins: ['jammu', 'udhampur'], dests: ['srinagar', 'leh', 'kargil'], kg: [3000, 7000] }
};

// Solar cold stores at orchard / collection sites.
const STORES = [
  { id: 'ORC-S1', name: 'Shopian Orchard Store',   node: 'shopian',   product: 'apple',   kg: 12000, solarPeakW: 8000, battCapKwh: 24 },
  { id: 'ORC-S2', name: 'Pulwama Collection Hub',  node: 'pulwama',   product: 'pear',    kg: 7000,  solarPeakW: 6000, battCapKwh: 18 },
  { id: 'ORC-S3', name: 'Sopore Mandi Store',      node: 'sopore',    product: 'apple',   kg: 10000, solarPeakW: 8000, battCapKwh: 24 },
  { id: 'ORC-S4', name: 'Anantnag Walnut Store',   node: 'anantnag',  product: 'walnut',  kg: 3500,  solarPeakW: 4000, battCapKwh: 12 }
];

module.exports = {
  PORT: num(process.env.PORT, 3000),
  TICK_MS: num(process.env.TICK_MS, 2000),
  SIM_MIN_PER_TICK: num(process.env.SIM_MIN_PER_TICK, 6),
  // 'auto' = start the simulation clock at the real current IST time, otherwise an hour 0-23 (default 9 = morning, solar is producing)
  SIM_START_HOUR_IST: process.env.SIM_START_HOUR_IST === undefined ? '9' : process.env.SIM_START_HOUR_IST,
  // Map background: 'osm' (default, OpenStreetMap), 'none' (no background, roads only) or a custom tile URL like https://example.com/{z}/{x}/{y}.png
  MAP_TILES: process.env.MAP_TILES || 'osm',
  TARGET_LOADS: num(process.env.TARGET_LOADS, 8),
  INGEST_KEY: process.env.INGEST_KEY || 'orcas-demo-key',
  SUPABASE_URL: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '',
  GRID_CO2_KG_PER_KWH: 0.82,
  PRODUCTS, LOAD_PROFILES, STORES
};
