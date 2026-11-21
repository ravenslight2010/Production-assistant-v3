# V1/V2 non-AI feature matrix

Status: approved target scope with implementation waves; not a claim that every row is complete.
Last updated: 2026-11-21.

## Disposition and status vocabulary

Dispositions:

- `port`: carry forward the behavior with the smallest compatible adaptation.
- `combine`: retain complementary V1 and V2 behavior in one V3 workflow.
- `rebuild`: preserve the user outcome but replace the implementation boundary.
- `defer`: retain in approved later scope; not part of the first verified slice.
- `exclude`: deliberately outside the initial non-AI V3 product.

Status labels describe this checkout: `ported` means the underlying V2 behavior was carried into V3; `shell` means the React surface exists; `vertical-slice` means it is in the first end-to-end qualification target; `pending` means no complete V3 user workflow is claimed. Unit tests alone do not establish browser or deployment qualification.

## Identity, access, and application shell

| Feature | V1 behavior | V2 behavior | V3 disposition | Current status |
|---|---|---|---|---|
| Branded entry and authentication | Dark amber landing, sign-in/sign-up, password visibility | Fresh staff sign-in and guarded first-manager bootstrap | `combine`: V1 presentation with V2 Argon2id/opaque-session boundary | `vertical-slice` |
| Account transfer | Existing V1 users and sessions | Fresh V2-only accounts | `rebuild`: fresh V3 accounts; no credential/session transfer | `vertical-slice` |
| Staff directory | Staff management surfaces | Manager-only account list/create, role change, disable | `combine` | `vertical-slice` |
| Roles and permissions | Manager/operator and custom operational roles | Facility-scoped capabilities and role equivalents | `port` with inherited AI capability removed | `ported` |
| Invitations and password recovery | Invitation and forgotten-password routes | Not part of the current staff API | `defer`: design a reviewed V3 account-recovery flow later | `pending` |
| Session revocation | V1 session handling | Revocation on sign-out and affected account changes | `port` | `ported` |
| CSRF and same-origin writes | V1 API protections | Readable CSRF cookie plus required mutation header | `port` | `ported` |
| Facility isolation | Shared application data model | Facility-scoped server queries and commands | `port` | `ported` |
| Navigation | V1 operational sections and manager screens | V2 static operational interface | `combine`: V1-style shell over V3 server state | `shell` |
| PWA/installability | V1 application shell and update handling | V2 service worker/static assets | `rebuild`: V3 manifest and service worker, no API caching | `shell` |
| Offline behavior | Rich local/offline operation and queued intent | Read-only confirmed state; writes wait | `rebuild`: V2 boundary approved | `vertical-slice` |
| Multi-device consistency | V1 synchronization/reconciliation engine | Server revisions, idempotency, receipts, and polling | `rebuild`: server authority, no V1 sync-engine port | `vertical-slice` |

## Live production and stations

| Feature | V1 behavior | V2 behavior | V3 disposition | Current status |
|---|---|---|---|---|
| Run list and detail | Operational home and run views | Facility-scoped canonical runs | `combine` | `vertical-slice` |
| Run creation | V1 planning forms and templates | Server-created planned runs from reviewed products | `rebuild`: V1-style input, V3 request ID and server snapshot | `vertical-slice` |
| Run lifecycle | Start/pause/resume/complete in operational UI | Revision-fenced, idempotent server commands | `combine` | `vertical-slice` |
| Frozen run setup | Recipe/profile snapshots | Product, recipe, setup, and warehouse snapshots | `port` | `ported` |
| Production-rule outcomes | V1 production-rule management/checks | Strict/flexible reviewed rule enforcement | `combine` | `ported` |
| Line station | Live line tracking | Server-owned line inputs/progress | `combine` | `vertical-slice` |
| Dough station | Batch, yield, freezer, and production math | Dough workflow and fractional-yield preservation | `combine` | `vertical-slice` |
| Cheese station | Recipe and batch/stock tracking | Cheese inputs and progress | `combine` | `vertical-slice` |
| Pepperoni station | Supply and applicator tracking | Pepperoni inputs and progress | `combine` | `vertical-slice` |
| Sauce station | Stock, carryover, and production tracking | Sauce inputs and progress | `combine` | `vertical-slice` |
| Frontline station | Frontline cadence and counts | Frontline inputs and progress | `combine` | `vertical-slice` |
| Packaging station | Cases packed and packaging controls | Packaging inputs and progress | `combine` | `vertical-slice` |
| Manual station edits | Rich V1 station controls | Validated station-specific manual commands | `combine`: bind V1 organization to V3 commands | `vertical-slice`; unstarted stations expose the legacy first-update form |
| Automatic progress | Browser/client timers participate in operation | External leased worker owns automatic progress | `port`: no browser-authoritative ticks | `vertical-slice` |
| Worker restart/pause/lease safety | Not the V1 boundary | Supervised worker, health, leases, and pause handling | `port` | `ported` |
| Run templates and run-to-time aids | V1 planning/operator aids | Not present as equivalent V2 workflow | `defer`: rebind only after core math and server state are qualified | `pending` |
| Stoppages, substitutions, and operational notes | V1 operational records | Partial domain candidates rather than complete parity | `defer`: one reviewed V3 audit-connected model | `pending` |

## Schedule and planning

| Feature | V1 behavior | V2 behavior | V3 disposition | Current status |
|---|---|---|---|---|
| Schedule catalog | Day planning and schedule editing | Server catalog and date-scoped schedule state | `combine` | `ported` |
| Schedule commands | Move/edit scheduled work | Revision-fenced schedule commands and exact retry | `rebuild` | `ported` |
| Schedule estimates | V1 run estimates and schedule warnings | Shared baseline estimates with unknown durations explicit | `combine` | `ported` |
| Schedule workbook import | V1 schedule workbook review | Deterministic flat/day-block preview and apply boundary | `port` | `ported` |
| Recipe/setup warnings | Scheduled recipe checks | Reviewed catalog linkage | `combine` | `pending` |
| Operational Mix Plan | Mix presets, mixes, and planning | Listed as later-phase work, not complete parity | `defer` | `pending` |

## Setup, recipes, and deterministic imports

| Feature | V1 behavior | V2 behavior | V3 disposition | Current status |
|---|---|---|---|---|
| Product/setup master data | Profiles, recipes, production setups | Reviewed setup catalogs and imported products | `combine`: reviewed setup/master data only | `ported` API and React setup CSV/history; full catalog editors `pending` |
| Source-workbook preview | Broad V1 workbook imports | Deterministic parse and read-only preview | `rebuild`: no AI fallback | `ported` API; React `pending` |
| Review and explicit Apply | Human review in V1 workflows | Staged imports with explicit manager Apply and governed Undo | `combine` | `ported` |
| Import history/retry | V1 import history and reconciliation | Persisted history, request hashes, safe idempotent retry, canonical reopen | `combine` | `ported` |
| CSV templates | V1 import/export templates | Strict synthetic templates, shared CSV parsers, and React template download | `combine` | `ported` |
| Ambiguous rows and aliases | V1 alias learning and broad matching | Exact/reviewed linking; unresolved remains unresolved | `rebuild`: no automatic alias learning | `ported` domain |
| Missing-row deletion | V1 merge/reconciliation behavior | No silent deletion from absent rows | `port` safety rule | `ported` |
| Production rules manager | V1 manager UI | Server enforcement and staged source attribution | `combine` | `ported` API; React `pending` |
| Reviewed die defaults | V1 die/setup defaults | Manager-only reviewed defaults and history | `combine` | `ported` API; React `pending` |
| Named recipes, cheese recipes, dough variants | Rich V1 recipe management | Reviewed catalog foundation, not full UI parity | `defer` complete V1 management parity | `pending` |
| Premixes and mixes | V1 premix/mix creation and reconciliation | Import/capability research and later-phase candidates | `defer` | `pending` |
| Shipping guide | V1 shipping import and packaging data | Deterministic shipping-capacity parser | `combine` | `ported` domain; UI `pending` |
| Dough/cheese/sauce guides | V1 guide imports and recipe effects | Deterministic source/capability importers | `combine` | `ported` domain; UI `pending` |
| Allergens and substitutions | V1 allergen mapping, warnings, logs | Later-phase candidate | `defer` | `pending` |

## Inventory and warehouse

| Feature | V1 behavior | V2 behavior | V3 disposition | Current status |
|---|---|---|---|---|
| Physical opening count | V1 stock setup | New explicit opening count, including zero quantities | `rebuild`: fresh physical count; no V1 balance transfer | `vertical-slice` |
| Product stock | Inventory dashboards | Facility/warehouse-scoped stock reads | `combine` | `ported` API; React `pending` |
| Multiple warehouses | Multi-location V1 behavior | Multi-warehouse V2 inventory | `combine` | `ported` API; React `pending` |
| Append-only movements | V1 inventory history | Append-only movement records and bounded history | `port` | `ported` API; React `pending` |
| Transfers | Warehouse movement workflows | Manager-scoped transfers | `combine` | `ported` API; React `pending` |
| Adjustments | V1 corrections and stock controls | Inventory movement boundary | `defer` complete adjustment UI and policy review | `pending` |
| Production warehouse | V1 warehouse selection | Manager-scoped run warehouse selection | `port` | `ported` API |
| Completion consumption | V1 automatic deduction behavior | Transactional exact-once consumption and shortage records | `combine`: V1 math, V3 receipted server write | `vertical-slice` |
| Inventory reconciliation | V1 operational reconciliation | Receipts, movement history, and exact-once protections | `combine` | `vertical-slice` |
| Freezer pull | V1 freezer-pull workflow | Later-phase candidate | `defer` | `pending` |
| Cycle counts | V1 cycle-count workflow | Later-phase candidate | `defer` | `pending` |
| Reorder and use-first aids | V1 warehouse aids | Not equivalent complete V2 workflows | `defer` | `pending` |
| Warehouse needs and switchover | V1 grouped needs and switchover warnings | Warehouse/run linkage foundation | `defer` full V1 presentation parity | `pending` |

## QC, incidents, and reporting

| Feature | V1 behavior | V2 behavior | V3 disposition | Current status |
|---|---|---|---|---|
| QC workflow | Planning, recipe review, labels/date codes, verification | Later-phase candidate | `defer`: rebuild against server-owned V3 data | `pending` |
| Quality history | V1 history and retention views | Later-phase candidate | `defer` | `pending` |
| Incident reporting and patterns | V1 issue reports and incident panels | Review-incident capability foundation | `defer` | `pending` |
| Operational reports | V1 reports, insights, handoff digest | Run/inventory/server history foundation | `combine` | `pending` |
| CSV export | Current/history run CSV and setup exports | Not complete equivalent V2 UI | `defer`: export confirmed V3 state without exposing secrets | `pending` |
| Audit and receipt visibility | V1 sync/conflict diagnostics | Command receipts, audit/outbox transaction boundary | `combine`: expose safe operational evidence, not internals | `pending` |

## Explicit exclusions and external qualification

| Item | Decision | Status |
|---|---|---|
| AI screens, providers, adapters, prompts, local models, and AI-only role capability | `exclude` from the initial build; research may remain as labeled documentation | Guarded by `check:no-ai` |
| V1 production data, historical runs, sessions, credentials, tokens, and inventory movements | `exclude` from V3 cutover | No access or transfer performed |
| V1 Drizzle schema or mixed V1/V2 migration chains | `exclude`; explicit reviewed V3 SQL only | Current V3 chain inherited from pinned V2 |
| Automatic offline writes | `exclude` initially | Read-only offline boundary |
| Production deployment claim from CI or emulation | `exclude` as evidence | Reserved VM and physical qualification remain separate |
| Self-hosting and local-AI implementation | `defer` research only | No runtime integration |

## First vertical-slice acceptance target

On disposable PostgreSQL, prove: bootstrap/sign-in → reviewed setup/product → opening count → create run → start → manual station update → worker automatic progress → pause/resume → completion → exact-once inventory receipt. Also prove stale-revision conflict, exact retry, reconnect readback, and no offline writes.

Remaining rows stay in approved scope according to their disposition. A `defer` row is phased implementation, not silent removal from the final non-AI target; any later scope reduction or newly discovered V1/V2 contradiction requires owner approval.

## Verification snapshot — 2026-11-21

Verified in an isolated checkout with synthetic data and disposable PostgreSQL 15:

- Production React build, strict TypeScript, server syntax checks, and generated OpenAPI client stability: **PASS**.
- Synthetic unit suite: **173 PASS, 0 FAIL, 2 SKIPPED**. Both skips require private customer workbooks that were not provisioned.
- React Chromium suite: **7 PASS, 0 FAIL**, covering service-worker migration/offline reading, run commands, station conflicts, schedule commands and exact retry, stale conflicts, workbook review/Apply, setup staging/review/exact-retry/Apply/Undo/reopen, manager-only access, offline write lockout, navigation, staff creation, sign-out, and phone/tablet/desktop layouts.
- Disposable PostgreSQL suite: **PASS**, covering migrations, SQL invariants, direct partial schedule updates, concurrent bootstrap/run/station/inventory commands, worker leases and automatic-progress functions, restricted runtime-role access, reviewed imports, inventory, schedules, role revocation, and cutover rehearsal.
- Real Chromium/React/PostgreSQL journey: **PASS**, covering authenticated session use, run preparation, start, first manual station update, stale conflict, pause/resume/complete, exact-once completion receipt, schedule add/update/exact-retry/move/swap/breaks/conflict, deterministic workbook Apply, setup post-commit response loss/exact retry without duplication, canonical setup review, real catalog Apply/Undo readback, history reopen, staff creation and authentication, reload persistence, offline write lockout, and desktop/phone/tablet emulation.
- WebKit 27.2/Safari-engine React/PostgreSQL run, schedule, and setup history/reopen readback plus tablet-landscape layout checks: **PASS** using the pinned Playwright browser. This is engine emulation, not physical iOS Safari evidence.
- Production dependency audit: **PASS**; no known vulnerabilities reported.
- No-AI and research-safety guards: **PASS**.

Qualification limits:

- Private-workbook fidelity: **NOT PROVEN**; the two corpus tests remain explicit skips.
- Supervised API plus external worker as one deployed runtime, physical Android/iOS devices, accessibility audit, Reserved VM pilot, backup/restore rehearsal, and production readiness: **NOT RUN / NOT ESTABLISHED** as applicable.
- This snapshot does not claim complete V1/V2 feature parity. No GitHub write, deployment, production access, or V1 data access occurred.
