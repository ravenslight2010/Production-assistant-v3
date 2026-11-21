# Approved V3 design

Decision status: approved by the owner through the V1/V2 design review; final specification response: “No changes.”
Decision date: 2026-11-20.
Implementation record updated: 2026-11-21.

## Objective

Build Production Assistant V3 with V1 appearance, navigation, and existing non-AI features; Replit V2 architecture and features; and eligible research preserved as versioned documentation. Lucia V2 is reference only. The initial build contains no AI. Implementation proceeds in tested vertical slices without silently reducing the approved final feature scope.

Any newly discovered V1/V2 contradiction stops the affected implementation. The owner receives the conflict and a recommendation before a choice is made.

## Resolved architecture decisions

### Application authority

V3 is server-owned with interactive clients. The server owns runs, timers, inventory, imports, and permissions. Clients display confirmed state and submit role-checked commands. Browser timers never submit authoritative automatic progress.

Mutations use expected revisions and stable idempotency keys. State change, receipt, audit event, and outbox event share one transaction. A supervised external worker owns automatic progress. Exact retries return the original outcome; stale writes return canonical conflicts.

### Frontend and visual system

Use React, TypeScript, Vite, Tailwind, and the V1 Industrial Slate/Amber visual language. Preserve V1 navigation, manager-screen organization, reusable interaction patterns, keyboard focus, and responsive behavior.

The floor home is a V3 server-backed operational cockpit organized like V1, not a wholesale port of V1 client-authoritative state. Planning, setup, inventory, warehouse, QC, reports, and permitted staff screens remain reachable without duplicate screens maintaining separate state.

### Backend and data

Use the Replit V2 Node `.mjs` server boundary, `pg`, PostgreSQL, explicit reviewed SQL migrations, database functions/triggers/grants, and a supervised worker. V3 has a new OpenAPI contract and generated typed client.

Do not graft Hono, tRPC, Drizzle, MySQL, Kimi authentication, or another platform backend onto V3. Do not mix V1 and V2 migration systems. The V3 SQL schema and API names are independent of V1/V2 runtime state.

### Authentication and authorization

Use V2 Argon2id password hashes, opaque HttpOnly sessions, CSRF protection, facility membership, role checks, and session revocation. First-manager creation requires the server-held one-time bootstrap secret. V3 starts with fresh accounts; no V1 credentials, sessions, or tokens are transferred.

### Offline and synchronization

Offline mode is read-only cached confirmed state. Writes wait for reconnection. There is no offline write queue in the initial build. Reconnect and reload obtain canonical server state rather than replaying browser timers or inventing writes.

### Cutover data

Transfer only reviewed setup/master data after explicit review. Do not transfer historical runs, V1 inventory balances/movements, sessions, credentials, or tokens. Opening inventory comes from a new physical count. Development uses synthetic or disposable data.

### Imports

Initial imports are deterministic only. The lifecycle is Upload → Parse → Review → explicit manager Apply → persisted history. Unknown formats and ambiguous rows remain unresolved. There is no AI fallback, automatic alias learning, silent deletion from missing rows, or inventory mutation from previews. Retries are idempotent and history remains reviewable.

### Production mathematics and inventory

Reuse eligible V1 non-AI calculations as pure domain functions against V2-owned server state. Freeze run product/recipe/setup/warehouse snapshots. Verify calculations with synthetic and separately authorized workbook-derived golden fixtures.

Completion consumes inventory through a receipted, exact-once server transaction. Shortages remain explicit. Previews and failed/stale commands cannot mutate stock.

### AI exclusion

No AI screens, provider calls, adapters, prompts, local-model integration, model downloads, or AI runtime dependency are required or permitted in the initial build. AI research may remain only as labeled documentation. The inherited `use-ai-tools` capability is removed.

### Deployment boundary

Target a separate Replit Reserved VM project with an isolated PostgreSQL database and supervised API/worker. Do not deploy into V1, share its production database, or assume Autoscale supports the worker. The API and worker use one external web port; worker health remains loopback-only.

A separate owner-authorized pilot is required. No production database operation is authorized by this design.

## Implementation sequence

1. Pin source provenance; record the feature matrix and research index.
2. Establish the V3 workspace, V2 server/database boundary, and V1-style React shell.
3. Prove the first vertical slice on disposable PostgreSQL.
4. Port remaining feature groups in tested waves.
5. Import and classify the eligible research library.
6. Run browser, security, accessibility, concurrency, and offline verification.
7. Qualify a separate Reserved VM pilot later, after independent authorization.

## Verification and evidence

Required engineering checks include:

- Strict TypeScript, production build, server syntax, and generated OpenAPI drift checks.
- Production-math and synthetic workbook fixtures.
- Disposable PostgreSQL migration, function, trigger, permission, and rollback tests.
- Authentication, facility isolation, roles, revisions, idempotency, stale writes, and CSRF checks.
- Worker lease, restart, pause, and duplicate-effect tests.
- Import review/Apply/retry/history and inventory exact-once/reconciliation checks.
- Dependency, secret, path, session, and security checks.
- Chromium and WebKit where supported; desktop, phone, and tablet layouts.
- Two-session editing, disconnect/reconnect, lost responses, wake, and reload.
- Keyboard and accessibility checks.

Use `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `NOT REACHED` accurately. Emulation is not physical-device proof. CI is not deployment approval. Private-workbook tests may be explicitly skipped when the corpus is not provisioned; that skip is not workbook-fidelity evidence.

Before any production claim, require a separate Reserved VM pilot, physical-device pass, backup/restore rehearsal, and owner review.

## Repository and credential safety

Use normal reviewed changes only. Never force-push `main`, bypass required checks, or alter branch protection without explicit authorization. Do not commit credentials, connection strings, cookies, raw customer workbooks, production rows, protected operational captures, generated build artifacts, or unreadable binary evidence.

A GitHub PAT, if needed for publication, must be fine-grained, repository-scoped, minimally privileged, stored with mode 600, never echoed, and scrubbed after use. The owner deletes/rotates it afterward. No token is requested in chat.

## Current implementation limits

The initial React shell and ported server boundary do not establish complete V1/V2 feature parity. Placeholder-free pending surfaces identify unported areas. No production, Reserved VM, V1 database, or live AI access is implied or performed.
