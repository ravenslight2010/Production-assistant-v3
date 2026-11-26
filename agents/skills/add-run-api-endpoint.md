# Skill: adding an endpoint to a run-family API

Pattern from `server/run-api.mjs`. Applies to run/inventory/mix APIs alike.

## 1. Route and handler

- Routes match on `url.pathname` after the API checks authentication via
  the shared adapter (`authenticate(request)` → capabilities).
- GETs with unexpected query strings → 400. Mutations go through
  `verifyCsrf(request, auth)` **before** any body work.
- Parse the body with `readJsonBody(request, maxBodyBytes)`, then
  `requireExactKeys(body, [...])`. No silent key dropping.
- Call the service with `{ auth, ... }` — authorization is the service's
  first statement (`authorize(authorizeAction, auth, "<capability>")`).

## 2. Respond via `sendJson(request, response, status, body, headers?)`

- Signature takes **request first** (gzip needs `Accept-Encoding`).
- Base headers: `Cache-Control: no-store`, JSON content type,
  `X-Content-Type-Options: nosniff`. Bodies ≥ 1024 B gzip automatically when
  accepted; `Vary: Accept-Encoding` always set.
- 304s go through the `sendNotModified` helper — never gzip, never a body.
- List-style endpoints: probe a cheap version first (one indexed query),
  304 early, and only then build the payload; emit the final ETag from the
  build's authoritative version. See `memory/decisions.md`, ADR-2026-11-27-1.

## 3. Errors

Throw `RunApiError(status, message)` / the domain equivalent — the outer
catch maps to JSON with `safeStatus`. Don't hand-write error responses
inside handlers.

## 4. Tests (all three layers, no exceptions)

1. **Unit** in `server/<api>.test.mjs`: mock the service, assert calls,
   statuses, bodies, and header behavior (ETag, gzip, Vary).
2. **Compose test**: fake pg pool returning canned rows; assert the actual
   SQL text and parameter arrays issued, and the authorization sequence.
3. **Harness**: `db/run-local-tests.sh` as `v3test` exercises the real SQL
   against a real Postgres. A green `npm test` is necessary but NOT
   sufficient — mocked queries hide table-permission and dependency-order
   failures (see `memory/gotchas.md`).

Then `npm test`, `npm run typecheck`, `npm run build`, and the full harness.
