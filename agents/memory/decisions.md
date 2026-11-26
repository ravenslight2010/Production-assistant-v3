# Decisions (ADRs, newest first)

## ADR-2026-11-25-1 — openapi-typesafe for TypeScript 7
**Status:** accepted. `openapi-typescript` does not support TypeScript 7
(`ts.factory` / `ts.SyntaxKind` removed). The repo uses `openapi-typesafe`
and `openapi-typesafe-fetch` (1.0.0-rc.16) with TypeScript 7.0.2.
**Why:** TypeScript 7 was required; the original OpenAPI toolchain broke
`generate:api`. `openapi-typesafe` is a maintained fork that works with TS 7
and OpenAPI 3.2.
**Consequence:** `pnpm generate:api` writes `client/src/api/schema.d.ts`.
Do not reintroduce `openapi-typescript` or `openapi-fetch` without a TS 7
compatibility check. `check:api-generated` fails the build if the generated
file drifts.

## ADR-2026-11-27-3 — Run page lists all runs (scope=all), not active-only
**Status:** accepted. `scope=active` exists in the API (from `5fe69ae`) but
the Run page calls `listRuns()` with no scope.
**Why:** the browser integration test asserts completed runs stay visible
on the Run page (dropdown selection + `completed` badge assertions) —
that's product contract, not test scaffolding. An active-only list hid
completed runs and failed the harness. The performance win (version-first
304 + gzip + backoff) doesn't depend on the narrower scope.
**Consequence:** if a future All/Active toggle appears, reuse
`listRuns(limit, { scope: "active" })`; per-scope caches already key on it.

## ADR-2026-11-27-2 — Adaptive poll backoff in shared pure logic
**Status:** accepted. `web/runs-list-cadence.mjs` owns the delay math;
streak bookkeeping lives in the TS API client.
**Why:** house pattern is pure logic in `web/*.mjs` + `node --test`; pages
stay thin. Formula: `min(round(12000 × (1 + min(streak,6) × 0.5)), 45000)`
ms; jitter (0–6 s) stays in the page scheduler; `visibilitychange` resets.
No explicit invalidation on mutations — a write bumps the server version,
the next poll 200s, streak resets naturally.

## ADR-2026-11-27-1 — Version-first 304 split for run-list
**Status:** accepted (`549d022`). The list handler calls the cheap
`v3.run_list_version` probe first, returns 304 without building the snapshot
when unchanged, and builds via `listWithVersion`/`listActiveWithVersion`
only on change. ETag `"${version}-${limit}-${scope}"`.
**Why:** the previous fused design (`5fe69ae`) computed version+list in one
query, so a 304 poll paid full snapshot CPU (~25 ms on the 2-core rig, up
to ~460 ms under 30-way load). Conditional GET saved bandwidth, not
database work — the thundering herd lived in the snapshot builder.
**Measured:** unchanged polls dropped to ~0.3–3 ms; 22-run payload gzips
75 KB → 6.6 KB; mixed-load stress (6 pollers + writes) poll p95 45.8 ms,
command p95 12.9 ms, zero 5xx. Acceptance bar passed.
**Cost:** two DB round trips per 200 (probe + build), one per 304.

## ADR-2026-11-26-2 — SECURITY DEFINER functions, never table grants
**Status:** accepted, hard invariant. The API role is function-execute-only;
every new query path is wrapped in `SECURITY DEFINER SET search_path = v3,
pg_temp` with explicit EXECUTE grants.
**Why:** an earlier change queried outbox/runs tables directly from the
service and every list request 500'd with SQLSTATE 42501 in production
(see gotchas.md). Function-wrapping also gives stable query plans and a
single place to audit row-level scoping.

## ADR-2026-11-26-1 — Debounced auto-track writes
**Status:** accepted. `v3.apply_station_command` commits progress at most
every `GREATEST(60/rate, 3)` seconds per station line.
**Why:** high-rate station telemetry was bumping the outbox (and thus the
list version, and thus every poller's 304→200 flip) continuously. Wall-clock
progress makes debounced writes safe — no state is lost by waiting.
