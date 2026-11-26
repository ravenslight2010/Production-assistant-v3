# Skill: running the stress rig

The shared 2-core test box doubles as deploy target and load generator.
Server, client load, and Postgres compete for the same cores - trust
server-side logs over client wall time.

## Start the server (env as found on the rig)

```sh
cd <repo>
PATH=/opt/node24/bin:$PATH \
PORT=5000 \
V3_DATABASE_URL=postgresql://v3:v3pass@127.0.0.1:5432/v3 \
V3_API_DB_POOL_MAX=8 \
V3_INITIAL_MANAGER_BOOTSTRAP_CODE=test-bootstrap-code-0123456789abcdef \
V3_WORKER_HEALTH_PORT=3001 \
nohup node server/main.mjs > /tmp/pa3-live.log 2>&1 &
```

Notes:

- **PORT, not V3_PORT** (an older note in project memory says otherwise —
  the running process's environ is the truth).
- Set BOTH `PUBLIC_BASE_URL` and `APP_ORIGIN` if the flows under test send
  email (invitation acceptance) — the mailer crashes on send even with
  `resend: null` when origins are unset.
- **Kill and start in separate shell calls.** `pgrep -f "node server/main.mjs"`
  matches the wrapping shell's own command line and kills your session
  (burned twice). Anchor if you must: `pgrep -f "^node server/main.mjs$"`.

Start the worker too — the health route hard-depends on it:

```sh
cd <repo>
PATH=/opt/node24/bin:$PATH \
V3_DATABASE_URL=postgresql://v3:v3pass@127.0.0.1:5432/v3 \
V3_WORKER_HEALTH_PORT=3001 \
nohup node server/worker-main.mjs > /tmp/pa3-worker.log 2>&1 &
```

A healthy rig answers `GET /healthz` with 200 and `stationWorker.status:
"active"`. If it 503s instead, read the API log before touching anything:

- `v3.health.unavailable` with `errorName: "TypeError"` → the worker health
  port is not answering; the worker is down. The API still serves the whole
  client protocol (sign-in, lists, commands), so smoke and stress clients can
  look green against a half-dead rig. Start the worker.
- `v3.health.worker_unavailable` → the worker answered but reported
  `starting`/`degraded`/`stopped`; read `/tmp/pa3-worker.log`.
- A 503 with no worker fields and a different error → the database probe
  failed; check Postgres before restarting anything.

## Accounts

- Manager on the disposable rig DB: `dj.tester` (bootstrap). Managers are
  403 on run lifecycle commands **by design** - floor commands need an
  operator. Invite one per `skills/api-client-protocol.md` §Roles.
- The DB accumulates runs forever (lists grow linearly). Old-run cleanup is
  an open idea, not a bug.

## Acceptance bar (unchanged since 2026-11-26)

A change passes only if, against the same DB:

1. **Zero 5xx** on commands.
2. **Command latency p95 < 300 ms** under concurrent poll load.
3. Every client converges on byte-identical canonical state (the harness's
   job - `serverNow` stripped).

Measured history on this rig:

| Date | Scenario | Poll p95 | Command p95 | 5xx | Verdict |
| --- | --- | --- | --- | --- | --- |
| 2026-11-26 (pre-fix) | 40 clients poll, 71 % 304s | 754 ms | n/a (no write load) | 0 | FAIL (p95) |
| 2026-11-27 (`549d022`) | 6 clients @400 ms + pause/resume ~700 ms | 45.8 ms (23 % were 200s) | 12.9 ms | 0 | PASS |

## Method rules

- A/B against the same DB; same bar both runs; report FAILs as FAILs.
- Client scripts must implement the full session protocol (both cookies,
  CSRF header) - half the rig's false alarms were client-protocol bugs, not
  server bugs. See `skills/api-client-protocol.md`.
- `REUSE_SESSION=1` only after a successful sign-in; the sign-in limiter
  is 20/min/account.
