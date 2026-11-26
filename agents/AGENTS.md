# AGENTS.md — Working on Production-assistant-v3

Orientation for coding agents (and humans driving them). Read this first,
then the skill recipe that matches your task. The runtime has a hard
**no-AI policy** (`scripts/check-no-ai.mjs`): never add AI provider markers,
SDKs, or prompt plumbing to `api/`, `client/src`, `core/`, `db/`, or
`server/`. This folder contains documentation and test tooling only; it must
not contain credentials, private workbooks, production rows, or operational
captures.

## What this app is

Production-floor planning and run control for a dough/food manufacturing
facility. Multi-user, facility-scoped, event-sourced-ish: run state lives in
PostgreSQL, mutations go through versioned commands, clients poll JSON APIs.
Roles: manager (staff/inventory/factory settings, run create/read), operator
(floor lifecycle commands).

## Start every task

1. Fetch `origin/main`, compare it with `HEAD`, and inspect the working tree.
   Never overwrite another task's work or assume a remembered commit is current.
2. Read the relevant memory and skill below before editing. Approved project
   plans describe intent; current source and migrations describe reality.
3. Keep the change minimal and preserve its tests. No force-push to `main`, no
   bypassed checks, and no production deployment or database operation without
   separate explicit authorization.
4. Record only verified outcomes. Emulation, local tests, and CI are not
   physical-device or production qualification.

## Repo map

| Path | What lives there |
| --- | --- |
| `server/` | HTTP APIs (`*-api.mjs`), services (`*-service.mjs`), `main.mjs`, `worker-main.mjs` |
| `core/` | `run-service.mjs` — the run domain (SQL + authorization) |
| `client/` | React/TS SPA, view-state navigation (no URL routing) |
| `web/` | Shared pure logic (`*.mjs`) + hand-written `*.d.mts` for TS import |
| `db/` | Numbered migrations `NNNN-name.sql` + paired `NNNN-name.test.sql` |
| `e2e/` | Node-test Playwright harnesses serving `dist/` with mocked APIs |
| `scripts/` | Guard scripts (`check-no-ai.mjs`, `check-research.mjs`) |
| `agents/` | Orientation, reusable skills, durable memory, documentation checks, live smoke tooling |

## Golden commands

Everything assumes **pinned Node 24.22.3**. On the shared test rig it lives
at `/opt/node24/bin`; put it first on PATH or start-script tests fail. Use the
pinned `pnpm` from `package.json` when installing or running CI-equivalent
commands.

```sh
PATH=/opt/node24/bin:$PATH pnpm test   # node --test suites, including agents/scripts/*.test.mjs
pnpm run typecheck                     # tsc on client/
pnpm run build                         # generated API parity, typecheck, Vite, server syntax
node agents/scripts/check-agent-docs.mjs
```

The DB harness (as the non-root `v3test` user, Postgres 16 on PATH):

```sh
su v3test -c "export PATH=/opt/node24/bin:/usr/lib/postgresql/16/bin:\$PATH; bash db/run-local-tests.sh"
```

Browser tests require a build and installed Playwright engines, but not a live
application server:

```sh
pnpm exec playwright install --with-deps chromium webkit firefox
pnpm run build
pnpm test:browser
BROWSER=webkit BROWSER_ENGINE=webkit pnpm test:browser
BROWSER=firefox BROWSER_ENGINE=firefox pnpm test:browser
```

See [Run browser tests](skills/run-browser-tests.md) before changing a harness.

## Hard invariants — breaking these is a bug, not a style issue

1. **Exact-keys bodies.** Every mutation endpoint validates with
   `requireExactKeys`. Extra or missing fields → 400. Check the endpoint's
   handler before constructing a body.
2. **Sign-in body is exactly `{ "password": ..., "username": ... }`** — key
   order/content validated.
3. **CSRF**: mutations require both `v3_session` and `v3_csrf` cookies on the
   wire AND an `X-CSRF-Token` header equal to the raw `v3_csrf` cookie value.
4. **Idempotency**: every mutation carries a client-generated UUID
   (`requestId` / `commandId`). Retries with the same ID must be safe;
   server replays return `replayed: true` with original results.
5. **Revision fencing**: state-changing run commands take `expectedRevision`;
   stale values get 409 `conflict`, never silent clobber.
6. **Authorization runs per request** — roles can be revoked mid-session.
   Capability checks live in the service layer, not route caching.
7. **API role is function-execute-only.** `v3_api_login` has EXECUTE on
   `v3.*` functions and nothing on tables. New queries must be wrapped in
   `SECURITY DEFINER` functions with grants — never table grants.
8. **Migrations are idempotent and paired**: `db/NNNN-x.sql` always ships with
   `db/NNNN-x.test.sql`, and both re-run cleanly. Re-inventory `db/` before
   choosing a number; filenames in older plans may already be occupied.
9. **SQL-language functions validate at CREATE time** — a function that calls
   another must be declared after its dependency in the same migration.

## Test doctrine

- Every nontrivial thing has a test. Pure logic goes in `web/*.mjs` with a
  colocated `node --test` file; TS clients import via the hand-written
  `*.d.mts` next to it.
- API tests mock at the service boundary (`server/*-api.test.mjs`); the
  compose test fakes the pg pool and asserts the SQL actually issued.
- `pnpm test` mocks queries — **the DB harness is the source of truth for
  SQL**. A change can pass unit tests and still 500 against the real database
  (see [gotchas](memory/gotchas.md), the 42501 incident).
- Browser files are `e2e/*.browser.test.mjs`, executed by Node's test runner,
  not a Playwright project runner. Each harness serves the production `dist/`
  over loopback HTTP and intercepts API calls with deterministic route mocks.
  The SPA is view-state only; `/run` is not a client route.
- Chromium visual snapshots are intentionally Chromium-only. WebKit and Firefox
  retain behavioral coverage while skipping only those image comparisons.
- Live smoke/stress work is a separate boundary with explicit environment
  configuration; never point it at production by default.

## Hosted checks and evidence limits

`Test` runs syntax, generated-client parity, typecheck, unit tests, all three
browser engines, database tests, and repository guards. Separate automatic
workflows cover emulated WebKit mobile viewports, Chromium mobile viewports,
PWA files, and CodeQL. `Repair` is expected to skip on successful `Test` runs.
Windows workflows are manual-only and require suitable self-hosted runners.
Read [Browser and CI memory](memory/browser-and-ci.md) and
[Repair hosted CI](skills/repair-hosted-ci.md) before changing these lanes.

## Workbook importer boundary

V3 workbook imports are deterministic, source-versioned, staged, and explicitly applied. Exact unique links may be deterministic; near matches remain review-only. Missing rows do not delete setup, and formula/cache ambiguity fails closed. Start with [Work on V3 importers](skills/work-on-importers.md) and keep V1 history subordinate to the approved V3 import design.

## Skills

- [Work on V3 importers](skills/work-on-importers.md) — deterministic parsing, staged Apply, V1 lessons, and verification gates.
- [API client protocol](skills/api-client-protocol.md) — sessions, CSRF, exact body shapes per endpoint. Read before writing any API client.
- [Add a run API endpoint](skills/add-run-api-endpoint.md) — route, handler, service, OpenAPI, and test recipe.
- [Add a migration](skills/add-migration.md) — paired idempotent SQL and real-Postgres verification.
- [Run browser tests](skills/run-browser-tests.md) — harness architecture, engine matrix, visual and accessibility rules.
- [Repair hosted CI](skills/repair-hosted-ci.md) — reproduce, isolate, make the smallest repair, and watch actual runs.
- [Verify and publish](skills/verify-and-publish.md) — clean verification, non-forced publication, and hosted-check handoff.
- [Run the stress rig](skills/run-the-stress-rig.md) — disposable live-rig environment, restart procedure, acceptance bar.
- [Use Kimi Claw](skills/use-kimi-claw.md) — group setup, safe task routing, isolation, and evidence handoff.
- [Maintain agent docs](skills/maintain-agent-docs.md) — where project knowledge belongs and how to validate it.
- [Self-hosted runners](skills/self-hosted-runners.md) — install and use the Windows 10/11 runners that run the app and server.
- [Local development](skills/local-development.md) — start API, worker, and web with the pinned Node and a disposable database.
- [OpenAPI client](skills/openapi-client.md) — regenerate and check the typesafe client after API changes.
- [Database tests](skills/database-tests.md) — run the real-Postgres harness that unit tests do not replace.

## Memory

- [V1 importer lessons](memory/v1-importer-lessons.md) — source-family semantics and the boundaries that must not be carried into V3.
- [Importer test map](memory/importer-test-map.md) — current V3 parser, browser, and database test locations.
- [V1 profile to V3 runs](memory/v1-profile-to-v3-runs.md) — how reviewed catalog imports feed the V1-style setup concept, schedule plan, and live run snapshot.
- [Architecture](memory/architecture.md) — how runs, versions, and polling fit together.
- [Decisions](memory/decisions.md) — ADRs with dates and rationale.
- [Gotchas](memory/gotchas.md) — bugs already made and the tests their fixes require.
- [Browser and CI](memory/browser-and-ci.md) — current test topology, hosted lanes, and repair history.
- [QC roadmap](memory/qc-roadmap.md) — approved slice sequence, owner gates, and migration-number caution.
- [Local hosting](memory/local-hosting.md) — running the API and worker on a local machine, pool defaults, and what is not CI.

## Documentation and smoke tooling

`node agents/scripts/check-agent-docs.mjs` checks the agent index, relative
links, and common credential patterns. Its tests run automatically with
`pnpm test`; update both documentation and checker tests when conventions
change.

`agents/scripts/smoke.mjs` hits an explicitly configured live rig end-to-end
(sign-in → list → ETag 304 → gzip → CSRF'd sign-out). Credentials come from
environment variables only — never commit them. See the file header. A smoke
failure is not proof of a product regression until the client protocol and
disposable environment have been checked.
