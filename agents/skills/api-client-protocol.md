# Skill: talking to the v3 HTTP API

Everything below was burned in against a live rig. When in doubt, trust this
file over your assumptions — the API is strict on purpose.

## Sessions

`POST /api/v3/auth/sign-in` with body exactly:

```json
{ "password": "...", "username": "..." }
```

Success (200) sets two cookies you must keep together:

- `v3_session` — HttpOnly session token.
- `v3_csrf` — CSRF token (43-char base64url).

Every later request sends **both** cookies in one `Cookie` header:

```
Cookie: v3_session=...; v3_csrf=...
```

## CSRF

Any non-GET needs the header:

```
X-CSRF-Token: <raw value of the v3_csrf cookie, NOT url-decoded>
```

The server compares header == cookie value, then compares the hash against
the session record. Missing cookie OR missing header → 403 *"Refresh your
session..."*. If you get that 403, check CSRF plumbing **before** suspecting
authorization. (A session cookie alone, no csrf cookie on the wire, fails
even with the header present.)

## Exact body shapes (as of 2026-11-27)

All `requestId`/`commandId` values must be UUIDs. Extra keys → 400
"missing or unsupported fields".

| Endpoint | Method | Exact body keys |
| --- | --- | --- |
| `/api/v3/auth/sign-in` | POST | `password`, `username` |
| `/api/v3/auth/sign-out` | POST | (none; CSRF only) |
| `/api/v3/auth/invitations` | POST (manager) | `roleName`, `requestId` → returns `{ invitation, secret }` |
| `/api/v3/auth/invitations/accept` | POST | `secret`, `username`, `password`, `requestId` |
| `/api/v3/runs` | POST | `requestId`, `productionDate` (`YYYY-MM-DD`), `setupSnapshot` |
| `/api/v3/runs` | GET | query `limit`, `scope` (`all` default, `active`) |
| `/api/v3/runs/:id/commands` | POST | `commandId`, `commandType`, `expectedRevision` |
| `/api/v3/runs/:id/operations/commands` | POST | `commandId`, `commandType`, `expectedRevision`, `details` |
| `/api/v3/runs/:id/run-to-time` | POST | `commandId`, `expectedRevision`, `runToTime` |
| `/api/v3/runs/:id/plan` (and edits) | POST | `commandId`, `mode`, `expectedRevision`, `changes` |
| `/api/v3/stop-reasons` | POST | `commandId`, `expectedRevision`, `reasons` |

`setupSnapshot` allowed keys: `label`, `productCode`,
`productionSetupCode`, `targetCases`, `dieSetup` — `label` + `targetCases`
required. **Run creation requires a reviewed production setup**
(`productCode` + `productionSetupCode`) on the live path; a bare
label+targetCases body passes unit mocks and fails the real service.

`commandType` values: `start`, `pause`, `resume`, `complete`, `run_to_time`.

## Responses and conflicts

- Mutations return `{ outcome, replayed, run? }` (or the domain equivalent).
  `replayed: true` means your retry matched a prior request — success, not
  an error.
- Stale `expectedRevision` → 409 with `conflict: true`. Refetch the run,
  adopt `run.revision`, retry with a fresh `commandId`.
- List GETs return `ETag: "<version>-<limit>-<scope>"`. Send it back as
  `If-None-Match` → 304 with an empty body when nothing changed. A 304
  without a client-side cached list is a client bug (`ApiError("Run list
  could not be confirmed.", 304)` exists for exactly this).
- JSON ≥ 1 KB is gzipped when the client sends `Accept-Encoding: gzip`;
  `Vary: Accept-Encoding` is always present. 304s are never compressed.

## Roles (what 403 means)

- **manager**: staff invitations, inventory, factory settings, run create,
  run read. **Forbidden from run lifecycle commands by design.**
- **operator**: floor lifecycle commands (start/pause/resume/complete),
  station ops.
- Creating an operator on a fresh rig: sign in as manager → POST
  `/api/v3/auth/invitations` `{roleName: "operator"}` → accept with
  `{secret, username, password}` → sign in as the new operator.

## Polling cadence (client-side contract)

`web/runs-list-cadence.mjs` owns the backoff math: 12 s base, +50 % per
consecutive 304, streak cap 6, 45 s cap; snap back to base on a 200 or on
`visibilitychange`. Keep streak bookkeeping in the API client layer, not in
pages. Don't invent your own pacing — drift here re-creates the
thundering-herd problem the cadence file exists to prevent.
