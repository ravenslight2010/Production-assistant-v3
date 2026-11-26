# AGENTS.md — Working on Production-assistant-v3

Orientation for coding agents (and humans driving them). Read this first,
then the skill recipe that matches your task. The runtime has a hard
**no-AI policy** (`scripts/check-no-ai.mjs`): never add AI provider markers,
SDKs, or prompt plumbing to `api/`, `client/src`, `core/`, `db/`, or
`server/`. This folder is documentation and test tooling only.

## What this app is

Production-floor planning and run control for a dough/food manufacturing
facility. Multi-user, facility-scoped, event-sourced-ish: run state lives in
PostgreSQL, mutations go through versioned commands, clients poll JSON APIs.
Roles: manager (staff/inventory/factory settings, run create/read), operator
(floor lifecycle commands).

## Repo map

| Path | What lives there |
| --- | --- |
| `server/` | HTTP APIs (`*-api.mjs`), services (`*-service.mjs`), `main.mjs`, `worker-main.mjs` |
| `core/` | `run-service.mjs` — the run domain (SQL + authorization) |
| `client/` | React/TS SPA, view-state navigation (no URL routing) |
| `web/` | Shared pure logic (`*.mjs`) + hand-written `*.d.mts` for TS import |
| `db/` | Numbered migrations `NNNN-name.sql` + paired `NNNN-name.test.sql` |
| `e2e/` | Playwright browser suites |
| `scripts/` | Guard scripts (`check-no-ai.mjs`, `check-research.mjs`) |
| `agents/` | This folder: skills, memory, smoke tooling |

## Golden commands

Everything assumes **pinned Node 24.22.3**. On the shared test rig it lives
at `/opt/node24/bin`; put it first on PATH or start-script tests fail.

```sh
PATH=/opt/node24/bin:$PATH npm test        # node --test suite + typecheck + build
npm run typecheck                          # tsc on client/
npm run build                              # vite build
```

The DB harness (as the non-root `v3test` user, Postgres 16 on PATH):

```sh
su v3test -c "export PATH=/opt/node24/bin:/usr/lib/postgresql/16/bin:\$PATH; bash db/run-local-tests.sh"
```

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
   `db/NNNN-x.test.sql`, and both re-run cleanly.
9. **SQL-language functions validate at CREATE time** — a function that calls
   another must be declared after its dependency in the same migration.

## Test doctrine

- Every nontrivial thing has a test. Pure logic goes in `web/*.mjs` with a
  colocated `node --test` file; TS clients import via the hand-written
  `*.d.mts` next to it.
- API tests mock at the service boundary (`server/*-api.test.mjs`); the
  compose test fakes the pg pool and asserts the SQL actually issued.
- `npm test` mocks queries — **the DB harness is the source of truth for
  SQL**. A change can pass `npm test` and still 500 against the real
  database (see `agents/memory/gotchas.md`, the 42501 incident).
- Browser suites run against a live server; the SPA is view-state only, so
  tests `goto("/")`, sign in, and click nav (`e2e/` has the patterns).

## The test rig (shared box, treat as fragile)

2 cores — server, client load, and Postgres compete. Measure server-side
latency from logs, not client-side wall time. Full notes and the stress
bar live in `agents/skills/run-the-stress-rig.md`.

## Skills

- `skills/api-client-protocol.md` — sessions, CSRF, exact body shapes per endpoint. Read before writing any API client.
- `skills/add-run-api-endpoint.md` — route/handler/test recipe.
- `skills/add-migration.md` — SQL migration + harness recipe.
- `skills/run-the-stress-rig.md` — env, restart procedure, acceptance bar.

## Memory

- `memory/architecture.md` — how runs, versions, and polling fit together.
- `memory/decisions.md` — ADRs with dates and rationale.
- `memory/gotchas.md` — production-class bugs we already made, so you don't.

## Smoke tooling

`scripts/smoke.mjs` hits a live rig end-to-end (sign-in → list → ETag 304 →
gzip → CSRF'd sign-out). Credentials come from env vars only — never commit
them. See the file header.
