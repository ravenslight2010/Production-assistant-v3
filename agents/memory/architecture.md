# Architecture notes

## Run state and versioning

- Runs are event-sourced through an outbox table (`v3.outbox_events`).
  The list "version" a client polls is `MAX(sequence)` for the facility —
  one indexed lookup (`v3.run_list_version`).
- The run **snapshot** (what the API returns) is a projection rebuilt per
  list request: ~100+ subqueries across stations, history, stoppages, and
  pause intervals. Cost scales with runs-in-list × facility history, not
  with the client's last-seen version. That asymmetry is the whole reason
  the polling path is version-first (ADR-2026-11-27-1).
- Version bumps are debounced on the write side
  (`v3.apply_station_command`, `make_interval(secs => GREATEST(60/v_rate, 3))`)
  so a busy line doesn't invalidate every poller continuously.

## Polling design (client)

- Strong ETag conditional GETs on `/api/v3/runs`.
- Version-first on the server: probe → 304 without building, or build
  once and emit the authoritative version.
- Adaptive cadence in `web/runs-list-cadence.mjs`: 12 s base, +50 % per
  consecutive 304, cap 45 s; snap back on 200 or tab visibility.
- gzip on JSON ≥ 1 KB (75 KB → 6.6 KB for a 22-run list).

## Roles and authorization

- Service layer authorizes every call (`authorize(authorizeAction, auth,
  "<capability>")`) — capability names like `run.read`, `run.create`,
  `run.lifecycle.command`.
- Route handlers never cache authorization decisions.
- Capability → role mapping lives in `v3.roles`; managers get staff/
  inventory/settings/run-create/run-read, operators get floor commands.

## Data ownership

- Schema `v3` tables owned by `postgres`; migrations applied as
  `postgres`.
- API role `v3_api_login`: EXECUTE on `v3.*` functions only.
- Test role `v3_api_test`: same shape, used by the harness.

## Client app shape

- React/TS SPA in `client/`, view-state navigation (`activeView`), no URL
  routes — `/run` as a URL is a JSON 404. Browser tests sign in at `/` and
  click nav.
- TS imports shared JS logic via colocated `.d.mts` declarations
  (moduleResolution bundler) — keep the `.d.mts` in sync when you change a
  `web/*.mjs` export.
