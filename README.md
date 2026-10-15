# ORCAS: ORchard Cold-chain And Storage

Solar-powered cold storage and cold-chain logistics control room for Kashmir's perishable produce, starting with apples.
One product: a solar cold store with sensor-driven temperature control at the orchard, and a control room that watches every load from orchard to market across Jammu & Kashmir and Ladakh.

Prepared by **Alima Qadir**, SSM College of Engineering.

---

## Run it (2 minutes)

**Windows:** double-click `start.bat`
**Mac / Linux:** `./start.sh`
**Or manually:** `npm start` then open http://localhost:3000

Needs Node.js 18 or newer (https://nodejs.org). Dependencies are already included in this folder, so no internet is needed to start the server. The map background tiles and live weather use the internet when available; everything else works offline.

Check that everything is healthy at any time: `npm run check`

## What is inside (12 panels, one left sidebar)

| Panel | What it shows |
|---|---|
| Control Room Overview | KPIs, live network map, fleet temperature trend, top spoilage risks, activity feed |
| Solar Cold Store | Solar output, battery, cooling load and energy totals for each orchard store |
| Cold Box Health | Every store and transit box: temperature, humidity, door, compressor, battery, with fault buttons for demos |
| Cooling & Airflow | Animated fan/coil diagram, supply and return air, top/middle/bottom probes, humidity |
| Spoilage Risk | Product-specific ageing model (Q10), shelf life used, estimated days left, risk score |
| Alerts | Temperature, door, compressor, battery, spoilage and blocked-route alerts with acknowledge |
| Route Status | J&K + Ladakh road map with open / slowed / closed status for every segment |
| Disruption Events | Landslides, snow, accidents, holds; trigger your own for a live demo |
| Reroute Assistant | Compares waiting against alternate corridors, including arrival time and extra shelf life used |
| Loads in Transit | Live truck positions, progress, arrival time, box temperature, delays |
| Waste & Impact | Modelled waste avoided, value protected, solar energy used, CO2 avoided |
| Reports | Delay, Spoilage, Energy and Shift reports. View instantly, download CSV, print or save as PDF |

Products with their own spoilage models: apple, pear, cherry, walnut, saffron, trout, paneer/dairy, vaccines, tomato.

## Important: what is real and what is simulated

The dashboard runs a physics-based simulation (thermal model, solar curve, battery, compressor control, road events, product spoilage) so every panel is alive without hardware. The top bar says **Simulation data** for that reason.

Real sensors can replace the simulation for any unit: an ESP32 node (code in `firmware/orcas_node.ino`) posts readings to `/api/ingest`. While readings keep arriving, that unit shows **Live sensor** and uses your real temperature, humidity, door and battery values. If the node goes quiet for 90 seconds it falls back to simulation automatically.

The Waste & Impact numbers compare against **assumed** baseline losses and prices (`src/config.js`). Replace them with field-survey figures before quoting them as measured results.

Road distances and speeds are planning approximations, not survey data.

## About the report delay

Reports are built entirely in memory from live state. They never wait on the database, the weather service or any other network call. Saving to history and to Supabase happens in the background with a hard timeout, so even if Supabase is slow or down, a report still returns in milliseconds. If a request ever does fail, the page shows a clear message with a retry button instead of waiting forever.

## Configuration (all optional)

Copy `.env.example` to `.env`. Useful settings:

- `SIM_START_HOUR_IST=9`  hour the demo clock starts at (`auto` = real time). Use 9 to open with solar producing.
- `SIM_MIN_PER_TICK=6`  simulated minutes per 2 second tick. Also switchable live with Slow / Normal / Fast in the top bar. Pause / Resume is there too, handy for screen recording.
- `INGEST_KEY`  shared secret for sensor nodes.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`  optional. Run `supabase/schema.sql` first. Reports and telemetry are then mirrored to Supabase.

## Demo flow for a screen recording

1. Overview: open with the map, KPIs and fleet trend.
2. Disruption Events: trigger a landslide on NH-44 (Banihal to Ramban).
3. Route Status: the segment turns red; loads approaching it begin to hold.
4. Reroute Assistant: pick the holding load, compare "stay" against the Mughal Road corridor, apply the better one.
5. Cold Box Health: press Open door on a unit, watch temperature climb; Alerts panel raises it; press Clear.
6. Spoilage Risk and Solar Cold Store: show ageing factor and battery behaviour through the simulated day.
7. Reports: generate the Delay report, download the CSV.

## Deploying (Render / Railway)

Build command: `npm install`  Start command: `npm start`  The server reads `PORT` automatically. Add the same environment variables in the host dashboard if you use them.

## Project layout

```
server.js            Express server and API routes
src/config.js        Products, stores, assumptions
src/graph.js         J&K + Ladakh road network and routing
src/engine.js        Simulation, alerts, events, reroute assistant, impact
src/reports.js       Instant report builder (+ CSV)
src/store.js         Report history (local file, optional Supabase)
src/weather.js       Optional live weather (Open-Meteo, no key needed)
public/              Control room UI (HTML, CSS, vanilla JS, local Leaflet)
firmware/            ESP32 reference firmware
supabase/schema.sql  Optional database tables
scripts/selftest.js  Health check (npm run check)
```

## API quick reference

`GET /api/state`  `GET /api/bootstrap`  `GET /api/reports/{delay|spoilage|energy|shift}[?format=csv]`
`GET|POST /api/reroute/:loadId`  `POST /api/events`  `POST /api/events/:id/clear`
`POST /api/units/:id/fault`  `POST /api/alerts/:id/ack`  `POST /api/sim`  `POST /api/ingest` (header `x-orcas-key`)
