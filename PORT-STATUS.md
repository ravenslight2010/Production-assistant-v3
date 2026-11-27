# v1 live-calc → pa3 port status (2026-11-28)

Branch `port-v1-livecalc-2026-11-27`, commits newest-first (all unpushed; fresh PAT needed):

- `5f24d67` Port v1 operational run view (audit surface over a sync snapshot)
- `1dc4a81` Port v1 operational projection as the server-owned read model
- `e5a3a73` Port v1 auto-track engine, wall-clock, schedule, and staged supply
- `baefc78` Port v1 line phases, timing, and on-line stock math
- `4fd15c1` Port v1 station live-calc math core (computeCalc chain)
- `4b83ec1` Complete development access group and fail fast on stale client builds

Suite: 390 pass / 0 fail. `npm run check:no-ai` PASS.

## Module map (v1 → pa3)

| v1 lib/live-calc/src | pa3 core module |
|---|---|
| index.ts (computeCalc chain, server calc) | station-live-calc.mjs |
| inventoryMath.ts (occupancy) | station-on-line.mjs, station-operational-math.mjs |
| linePhases.ts | station-line-phases.mjs |
| lineTiming.ts | station-line-timing.mjs |
| lineSections.ts | station-line-sections.mjs |
| stock.ts | station-stock.mjs |
| stagedSupply.ts | station-staged-supply.mjs |
| runEstimate.ts | station-run-estimate.mjs |
| autoTrackEngine.ts | station-autotrack-engine.mjs |
| wallClockEngine.ts | station-wallclock.mjs |
| autoTrackSchedule.ts | station-autotrack-schedule.mjs |
| operationalProjection.ts | station-operational-projection.mjs (adapted: computes calc via computeCalc, object-arg signature) |
| operationalRunView.ts | station-operational-view.mjs (same adaptation; snapshot contract kept verbatim) |

Adaptation note: v1's `computeServerCalc(snapshot, pepTypes, nowMs)` became direct
`computeCalc({v, ve, currentRun, nowTimeMs, doughSubTab, defaultPepTypes})` calls —
the snapshot payload shape (dayState/runs + runValues + packagingProgress +
syncVersion/completeness) is unchanged so the v3 transport can feed both view and
projection without a translation layer.

## Remaining: server-owned integration (round 6)

Goal: station math runs server-side; clients render, never recompute.

Existing skeleton to build on:
- `core/station-command-service.mjs` → `v3.apply_station_command` (revision-fenced commands)
- `core/station-auto-track-worker.mjs` (lease via `v3.claim_worker_lease`, dues from `v3.list_due_station_auto_track`) — the worker already owns server-side auto-track ticks
- `server/run-api.mjs` list route has the version-first 304 probe (`runs.listVersion` → cheap MAX(outbox seq); full snapshot only on change)
- Snapshot SQL: `v3.run_snapshot` / `v3.run_snapshot_without_rules` (db/0003, 0005, 0006, 0016, 0017); `run_station_progress` rows are the server-owned progress ledger (db/0017-run-operations.sql)

Design: add an operational read route `GET /api/v3/runs/:id/operational` backed by a
new `core/station-operational-read.mjs` service:
1. fetch the run snapshot via the existing run service (same query the client poll uses)
2. assemble `{dayState: {runs}, runValues, packagingProgress, syncVersion: 1, completeness: "complete"}`
3. compute schedule (computeAutoTrackSchedule) + projection (buildOperationalProjection) + view (deriveOperationalRunView)
4. respond `{view, projection, schedule}` with ETag = run revision (304 on unchanged)
Cost lands only on revision change (version-first probe), same pattern as the list route.
Then: integration test (http-postgres style) + stress rig run (6 clients @400 ms poll bar: polls p95 < 50 ms server-side, 5xx = 0) and tune if it fails.

## Stress notes for round 6

- 2-core box: measure server-side latency from request logs, not client-side.
- Gzip + adaptive poll backoff already shipped in sync round 2 (`549d022`/`c09a9b4`); the new route must reuse both (Vary header, JSON ≥ 1 KB threshold).
- ETag scope must be per-facility (outbox sequence needs `WHERE facility_id = $1`).
