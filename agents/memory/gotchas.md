# Gotchas — bugs this project has already made once

Each entry is a failure mode that passed review and/or `npm test`. If you're
about to do something similar, stop and add the missing test layer first.

## 1. SQLSTATE 42501 — table permissions from the API role (2026-11-26)

**What happened:** an ETag change added `SELECT MAX(sequence) FROM
v3.outbox_events ...` directly in the service SQL. `npm test` mocked the
pool and passed; the DB harness hadn't run since the change entered the
tree. Every list request 500'd in production — `v3_api_login` is
function-execute-only and cannot touch tables.

**Detection:** git-stash A/B reproduced it at HEAD; the error only exists
against real Postgres with the real role.

**Fix + invariant:** security-definer functions (`ADR-2026-11-26-2`).
Also: the *live rig DB* needed separate `GRANT EXECUTE` for role `v3` —
the harness grants cover `v3_api_test` only. If a function works in the
harness but 500s on the rig, check grants on both roles.

**Rule:** `npm test` green ≠ SQL correct. The harness is the source of
truth for anything touching `core/*-service.mjs`.

## 2. Fused version+list query — 304s that cost full snapshot CPU (2026-11-26)

**What happened:** "one round trip either way" sounded clean, so the ETag
and the payload came from one `list_*_with_version` call. Under 30-way
concurrency the function cost 176–463 ms **even when the client got a
304** — the server built the snapshot to learn the version. Conditional
GET saved bandwidth, not CPU. The 2-core rig saturated linearly.

**Rule:** cheap probe first, expensive build only on change
(`ADR-2026-11-27-1`). When you add a conditional-GET path, measure the
unchanged case, not just the payload size.

## 3. Mock-shaped blind spots (2026-11-27)

Unit tests at the API boundary mock the service; services mock the pool.
Two shapes that sailed through mocks and broke live:

- Run create requires `productCode` + `productionSetupCode` in
  `setupSnapshot` (`requireProductionSetup: true` in `create()`) — the
  mock accepted a bare `{label, targetCases}`.
- The rig's disposable DB had **no reviewed production setups imported**,
  so no run could be created there at all. Stress reruns command existing
  runs instead.

**Rule:** when a live test fails on "missing or unsupported fields" that
the unit test accepted, the discrepancy IS the bug — the validation layer
and the mock disagree.

## 4. Client-protocol bugs masquerading as server bugs (2026-11-27)

A stress script sent only the session cookie → every mutation 403'd
"Refresh your session...". Another sent `type` instead of `commandType`.
Both looked like server regressions until the wire was inspected.

**Rule:** see `agents/skills/api-client-protocol.md` before blaming the
server. CSRF requires the csrf cookie *on the wire* AND the header.

## 5. pgrep kills its own shell (repeatedly)

`pgrep -f "node server/main.mjs"` matches the wrapping `bash -c` whose
command line contains the same substring — `pkill` then kills your own
session mid-restart. Split kill and start into separate exec calls, or
anchor the pattern: `pgrep -f "^node server/main.mjs$"`.

## 6. Playwright from outside the repo root

`playwright` is not resolvable from /tmp — run browser scripts from the
repo root. The SPA is view-state only: `goto("/")`, sign in, click "Live
run" (there is no "Run" button). Navigating to `/run` yields a JSON 404.

## 7. Pinned Node

Repos hard-pin Node (24.22.3 at `/opt/node24/bin` on the rig). Bare system
node (24.16.0) fails the start-script tests. Always
`PATH=/opt/node24/bin:$PATH` first.

## 8. serverNow breaks byte-equality in payload assertions

Run snapshots embed wall-clock `serverNow`, so two calls 3 ms apart are
never byte-equal. Tests compare element-wise with `serverNow` stripped.
Don't "fix" this by freezing time in more places.

## 9. Dead Chromium discovery prevented WebKit from launching (2026-11-27)

**What happened:** six multi-engine harnesses unconditionally ran
`which chromium` on macOS and stored an unused `browserPath`. The Safari hosted
lane failed before WebKit launched when that executable was absent.

**Fix + invariant:** delete the unused lookup and import. Only Chromium-only
harnesses need a conditional `CHROMIUM_PATH`/`which chromium` fallback. Never
run engine-specific discovery before selecting the requested engine.

**Rule:** reproduce hosted launch failures with the same `BROWSER` and
`BROWSER_ENGINE` values. Do not add page-error filtering or skip WebKit to hide
a launcher defect.

## 10. A visible control was not ready for input (2026-11-27)

**What happened:** the mixed-workbook scenario timed out waiting for its second
queued workbook. The heading was visible, but canonical loading still disabled
the file input; `setInputFiles()` did not establish the enabled prerequisite,
and the application's queue handler correctly returned while disabled.

**Fix + invariant:** add a retrying `await expect(workbookInput).toBeEnabled()`
before setting files. Application source already proved disabled controls were
intentional, so no application change was needed. Preserve every queue,
rejection, retry, staging, and no-Apply assertion.

**Rule:** visibility is not actionability. Wait for the specific prerequisite
and keep the original outcome assertions; do not add a broad sleep or weaken
the expected result.

## 11. Approved-plan migration numbers go stale

The QC plan provisionally named Slice 2 `0025-qc-run-verification.sql`, but
active-run work later occupied `0025-active-runs-and-auto-track-debounce.sql`.
Slice 2 now uses `0026-qc-run-verification.sql`; later provisional plan numbers
were shifted accordingly. The plan describes intent, not future allocation.

**Rule:** fetch `main`, inventory `db/NNNN-*.sql`, and allocate the next actually
available paired filename immediately before implementation. Never overwrite or
renumber an existing migration to match a plan. See `memory/qc-roadmap.md`.

## 12. Background workers and pool pressure (2026-11)

**What happened:** connection delays and wake failures appeared even when
nobody was using the app. Outbox polling (5 s), auto-track ticks (15 s),
and capacity telemetry (1 min) kept the API process busy. The default pool
was 10 connections with a short checkout timeout.

**Rule:** keep API and worker pools small on shared or low-core hosts
(`start-v3.sh` uses 3 and 2). Do not raise pool size to hide a slow query.
Measure which worker holds connections before changing intervals.

**Detection:** health shows a healthy database but a `backgroundWorkers`
warning, or checkout timeouts in logs while the app is idle.

## 13. Green client protocol on a half-dead rig (2026-11-27)

**What happened:** the rig's API was up and answered sign-in, run lists,
and ETag 304s normally, but the background worker had died. `/healthz`
returned 503 (`v3.health.unavailable`, `errorName: "TypeError"` — the
health route's fetch to the worker health port throws when nothing listens).
Every client-protocol check looked green; only the health route revealed
the rig was degraded.

**Rule:** check `GET /healthz` (200 + `stationWorker.status: "active"`) before
trusting rig state or reporting stress numbers. `agents/scripts/smoke.mjs`
runs this check first for exactly this reason. See
[Run the stress rig](../skills/run-the-stress-rig.md) for the worker start
command and the 503 field-by-field reading.
