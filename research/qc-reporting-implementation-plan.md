# V3 QC, incidents, and reporting implementation plan

Status: Slice 1 implemented and verified in the isolated development environment on 2026-11-25; Slices 2–7 remain the approved implementation plan. No production deployment or production database operation is authorized by this document.

Baseline: `main` at `c5cb4839903db1c5d644cb901f34200396ea6500`, with reviewed migrations through `0023` and the deterministic importer complete for the current approved corpus.

## 1. Objective and completion boundary

Rebuild the approved non-AI V1 QC/reporting outcomes on V3's server-owned PostgreSQL state, using the V1 Industrial Slate/Amber organization and the existing V3 Node/OpenAPI/React boundaries. Implement as seven dependent vertical slices:

1. QC evidence foundation, current-run dashboard, lots, weights, Brix, and reviewed targets.
2. Component identity/presence, allergen/staging review, cleaning verification, and run sign-off.
3. Versioned label/date-code references and advisory literal checks.
4. Upcoming-QC planning plus committed-import and applied-recipe review.
5. Quality history, corrections/redactions, exports, allergen activity, and QC intelligence.
6. Incident reporting, review workflow, and deterministic patterns.
7. Operational reports, handoff, finalized evidence, exports, and safe operational audit/receipt visibility.

The complete QC/reporting area is done only when every approved row in `research/feature-matrix.md` is represented by a working server-backed workflow or an explicit owner-approved exclusion/deferral. Placeholder removal alone is not completion. Each slice must ship with its own migration, SQL/API/client coverage, browser evidence, and documentation update; later slices must not be used as an excuse to leave earlier slices unverified.

Feature-matrix traceability:

| Approved row | Implementation coverage |
|---|---|
| QC workflow | Slices 1–5: planning, measurements, component/allergen/cleaning verification, sign-off, recipe/import review, labels/date codes, and advisory history. |
| Quality history | Slice 5, including corrections, redactions, retention, activity, and intelligence. |
| Incident reporting and patterns | Slice 6. |
| Operational reports | Slice 7, including insights/counts, handoff availability, finalized history, and integrity. |
| CSV export | Slice 5 QC exports; Slice 7 current/historical operational report exports; existing confirmed setup exports remain intact. |
| Audit and receipt visibility | Slice 7 safe operational evidence, with privacy/redaction projections shared across QC, incidents, and reports. |

### Product invariants

- QC is evidence and advisory evaluation, not production, regulatory, release, or shipping approval.
- Missing checks and missing references remain missing or `not-evaluated`; neither becomes a pass.
- Weight and Brix values, units, targets, and outcomes remain separate.
- Run-linked checks use the immutable run snapshot and effective substitutions, never the current browser setup or a later catalog value.
- Every read and write is facility-scoped by authenticated server context. The client never supplies facility authority.
- The server remains authoritative offline. Offline is read-only confirmed state, with no queued writes.
- No AI assessment, diagnosis, narration, confidence score, provider, prompt, model, or runtime dependency is introduced.
- Historical source behavior is evidence for product behavior only. V1 implementation claims are not V3 completion evidence.

## 2. Owner decisions required before affected implementation

These are unresolved policy/source contradictions or missing authorities. Engineering may complete unaffected work, but must not silently select an answer for a gated behavior.

| Gate | Decision required | Recommendation | Blocks |
|---|---|---|---|
| QC-1 — photo quality without AI | Whether manual photos are required, and if so the secure storage, access, retention, download, and redaction contract. V1 photo history depends on AI assessment/confidence and thumbnails; V3 has neither an AI nor attachment boundary. | Keep manual written quality observations distinct from computed QC outcomes. Do not invent confidence. Defer photo capture/storage until a separate attachment design is approved. This must not block Slices 1–7. | Any photo capture, thumbnail, bytes, or photo-history claim. |
| QC-2 — label reference authority | What constitutes an approved finished-label reference and who may publish/withdraw it. No authoritative finished-label master was found. | Manager-authored, versioned exact-text references with explicit active/withdrawn status; checks remain observation-only/not-evaluated until an approved reference version exists. Never infer expected text from recipes, shipping guides, AI, or ingredient data. | Slice 3 label-reference activation and pass/fail evaluation. |
| QC-3 — date-code authority | Approved code format, reference source, production-date mapping, facility timezone rule, and batch identity. None was found. | Store and compare literal exact text only. No date generation, decoding, shelf-life inference, or current-date substitution. Keep missing/ambiguous/inapplicable references `not-evaluated`. | Slice 3 date-code evaluation beyond literal text comparison. |
| QC-4 — allergen enforcement/cross-contact | Whether V3 should ever turn allergen, staging, cleaning, or QC evidence into a hold, violation, release, or shipping decision. Source enforcement Slice 8 and allergen Phase 2 were not adopted. | Retain recorded evidence, independent verification, and explicit unknowns. No risk score, cross-contact conclusion, near-miss, hold, release, or shipping clearance in this plan. Any enforcement requires a new safety/policy design. | All enforcement behavior; not the advisory evidence workflows. |
| QC-5 — report date basis | Source QC intelligence uses inclusive UTC event dates, while operational planning uses production dates and V3 schedules use `America/Chicago`. | Run-linked daily operational/QC summaries group by immutable `runs.production_date`. Unlinked incidents/reviews/audit activity use a clearly labeled facility-local event-date basis. Measurement-history filters display exact event timestamps and their filter basis. | Final grouping semantics in Slices 5 and 7. Implement timestamp-cursor history before approval, but not daily aggregates. |
| QC-6 — finalized-report signing | Whether finalized V3 reports require external cryptographic signing and key rotation in addition to immutable content and hashes. V3 has no signing-key configuration. | Implement immutable finalized snapshots, canonical content hashes, deterministic exports, and integrity verification. Keep external signing/keyring rotation out unless explicitly approved; do not add secrets merely to imitate V1. | Signed proof, key IDs, key storage, and rotation controls only. |
| QC-7 — navigation for unauthorized roles | Whether users without QC/report capabilities should see those sections. Current navigation exposes both placeholders. | Keep QC and Reports reachable with a concise access-guidance surface, while hiding controls/data the role cannot use. Server authorization remains authoritative. This avoids changing established navigation without approval. | Only a proposal to hide/rename navigation; not implementation of authorized screens. |

No gate permits production deployment or a production database operation.

## 3. Shared V3 architecture and contracts

### 3.1 Migration and evidence model

Use one reviewed additive migration and matching SQL test per slice, provisionally `0024` through `0030`. A slice may change its migration filename only to preserve ordering; it must not append to an already applied migration. Startup must not automatically migrate or purge data.

Slice 1 establishes the common QC evidence boundary:

- `v3.qc_records`: append-only facility-scoped evidence with an identity/UUID, monotonically ordered event sequence, kind, optional run/product/ingredient/station linkage, related-record link, actor, bounded `jsonb` details, and recorded timestamp. Use typed constraints and per-kind validation in SQL functions; do not expose arbitrary JSON writes.
- `v3.qc_command_receipts`: stable request ID, canonical request SHA-256, actor/facility, stored outcome, and replay metadata. Exact retry returns the original outcome; same ID/different hash fails.
- `v3.qc_audit_events`: append-only bounded actor/action/request/record/changed-field metadata, without request bodies or sensitive detail. Domain evidence remains in `v3.qc_records`; this stream proves command handling without duplicating it.
- `v3.qc_targets`: current reviewed target settings with a revision and scope; target changes also append target-set evidence to `v3.qc_records`.
- `v3.qc_outbox_events`: QC event-sequence outbox with an optional run link. The existing run outbox requires a run revision and cannot represent global target changes, so QC must not fabricate one.
- Reuse `v3.reject_immutable_row_mutation()` for append-only tables. Never update or delete recorded evidence to implement a correction or redaction.
- Write domain evidence, command receipt, audit metadata, and QC outbox entry in one transaction. Do not duplicate existing run, inventory, operations, or account event streams.

The common record is the evidence ledger, not a second copy of canonical runs/schedules/inventory. Foreign keys and functions link to those owners. Numeric measurement values and outcome fields required by reports must be constrained and projected deterministically; free-form notes cannot become the only source of a computed outcome.

### 3.2 SQL functions and runtime access

All new SQL functions must:

1. Resolve the authenticated actor and single facility using the existing account/facility helpers.
2. Check the exact capability in the database function as well as at HTTP dispatch.
3. Validate UUIDs, enum-like values, bounded text, finite numeric values, units, record linkage, and expected revisions/high-water marks.
4. Lock the aggregate being changed where revision or one-time semantics require it.
5. Replays before executing duplicate effects; persist state/receipt/audit/outbox atomically.
6. Return canonical projected state, not a client-constructed approximation.

Review every function signature in `db/development-runtime-access.sql` and the restricted-role setup in `db/run-local-tests.sh`. Grant function execution only. Add negative tests proving direct table/sequence access remains denied and revoked/disabled actors cannot retain authority.

### 3.3 Authorization matrix

| Capability/actor | Allowed scope |
|---|---|
| Any authenticated, enabled user | Submit a sanitized incident report; read only the non-sensitive submission confirmation. |
| `record-qc` | Read authorized QC run/planning state; record lots, measurements, component checks, allergen/staging reviews, cleaning records, and advisory observations. |
| `manage-qc` | Everything above plus targets, reference publication/withdrawal, independent cleaning verification, run sign-off, import/recipe decisions, corrections/redactions, QC intelligence/history exports. |
| `review-incidents` | Incident list/detail/review/assignment/state/notes/patterns; operational reports, handoff, finalized reports, and safe operational evidence views. |

The existing `manager` and `qc-manager` equivalents must retain their reviewed capabilities. Independent cleaning verification must reject self-verification even when the recorder also has `manage-qc`. Navigation visibility never substitutes for these checks.

### 3.4 HTTP and OpenAPI conventions

Add route modules using the existing `server/run-api.mjs`/`server/inventory-api.mjs` style, register them in `server/api.mjs`, and add bounded safe route names. Do not port Express/Drizzle handlers.

All routes live under `/api/v3`. Mutations require authentication and CSRF. Responses use `Cache-Control: no-store`; list endpoints use bounded limits and opaque or explicitly structured cursors. Errors use safe status/message/code mapping without SQL, stack, request-body, credential, or private-operational disclosure.

Command bodies use a stable `requestId` and a server-defined canonical request hash. Mutable settings/workflow aggregates also use `expectedRevision`; sign-off uses an expected QC event high-water mark; import/recipe decisions fence the reviewed source revision/snapshot. Additive run observations do not fence on the rapidly changing run progress revision: they validate the facility-owned run and immutable setup/effective-plan identity instead. A stale mutable command returns `409` with canonical current state. Exact retry returns the original accepted outcome, including after a lost response.

Define every route and schema in `api/openapi.yaml`, run `generate:api`, and extend `client/src/api/index.ts` with typed wrappers and conflict/replay handling. Never hand-edit `client/src/api/schema.d.ts`.

### 3.5 React, offline, and accessibility

Replace the QC and Reports `FeaturePage` fallbacks with real pages while preserving hash navigation and the V1 visual organization. Use reusable run selectors, status badges, review dialogs, tables, accessible charts, and error/conflict notices rather than duplicate state owners.

- A successful mutation updates from the canonical response and refreshes dependent read models.
- A stale conflict shows what changed and requires review before retrying with a new intent; it is not silently overwritten.
- A lost response retains the same request ID for exact retry. A deliberately changed payload receives a new request ID.
- Offline disables every mutation and export that needs a fresh server response. Cached confirmed read models must be labeled by their confirmation time; no cached value is represented as current server truth.
- All dialogs and tables support keyboard use, visible focus, useful labels, status announcements, and phone/tablet portrait/landscape layouts. Every chart has an equivalent table.

## 4. Slice 1 — QC evidence and run measurements

**Depends on:** reviewed migrations through `0023`.
**Owner gates:** none for written/manual measurements; QC-1 remains separate.
**Migration:** `0024-qc-evidence-foundation.sql` plus `.test.sql`.
**Implementation status:** complete in the isolated development environment, including the SQL/API/OpenAPI/React vertical slice and real Chromium/PostgreSQL qualification. Observed evidence and remaining limits are recorded in `research/feature-matrix.md`; this does not complete the overall QC workflow row or authorize Slices 2–7.

### Observable outcome

A QC-authorized user can select a facility-owned run, see its immutable production/setup context and confirmed QC high-water mark, record a separate ingredient/component lot, pre-run or 30-minute weight check, and Brix observation, and see each result after reload. Weight/Brix outcomes use reviewed target snapshots when available and otherwise say `not-evaluated`. A manager can revise targets without rewriting prior measurements.

### Data and functions

Create `v3.qc_records`, `v3.qc_command_receipts`, `v3.qc_audit_events`, and `v3.qc_targets` as described above. Lot and weight records are separate record kinds; never encode a weight as a lot attribute. A measurement stores the observed value/unit, check phase, effective target version/value snapshot, outcome, and `not-evaluated` reason. Cadence timestamps describe recorded checks only; they do not prove a missing interval was compliant.

Functions:

- `v3.get_qc_run_dashboard(actor_id, run_id)`
- `v3.record_qc_lot(actor_id, request_id, run_id, details)`
- `v3.record_qc_weight_check(actor_id, request_id, run_id, details)`
- `v3.record_qc_brix_check(actor_id, request_id, run_id, details)`
- `v3.get_qc_targets(actor_id)`
- `v3.save_qc_target(actor_id, request_id, target_scope, expected_revision, details)`

Target evaluation is a pure shared domain function with SQL persistence tests: normalize only the allowed unit representation, compare against the captured reviewed target, and return `pass`, `fail`, or `not-evaluated` with an explicit reason. No confidence or regulatory interpretation.

### API and UI

Routes:

- `GET /api/v3/qc/runs/{runId}`
- `POST /api/v3/qc/lots`
- `POST /api/v3/qc/weight-checks`
- `POST /api/v3/qc/brix-checks`
- `GET /api/v3/qc/targets`
- `POST /api/v3/qc/targets`

Add `client/src/pages/QcPage.tsx` and focused QC dashboard/record-form components. The initial page contains Run, Records, and Targets areas, with V1-style status and review presentation. `AppShell.tsx` routes `qc` to this page. The dashboard shows recorded evidence and availability honestly; empty sections say no checks were recorded.

### Acceptance evidence

- SQL: append-only guards, target revision history, facility isolation, all role denials, self-contained transaction/replay behavior, direct-access denial, invalid units/numbers/text, run linkage, and concurrent distinct records.
- Unit: target boundary evaluation, missing target/reason behavior, separate weight/Brix units, projection ordering, correction-safe base projection, and canonical request hashing.
- HTTP: CSRF, bounded bodies, exact retry after post-commit response loss, stale target conflict, safe `404`/`403`/`409`, and canonical dashboard readback.
- Browser: record/reload each type, target change preserves old outcome snapshots, two-session readback, offline lockout, keyboard forms, and desktop/phone/tablet layouts.

## 5. Slice 2 — Run verification and sign-off

**Depends on:** Slice 1 evidence, targets, dashboard, and receipts.
**Owner gates:** QC-4; no enforcement is included.
**Migration:** `0025-qc-run-verification.sql` plus `.test.sql`.

### Observable outcome

Authorized staff can record effective-component identity/presence, allergen/staging review, and cleaning evidence against a run. A different authorized reviewer can independently verify cleaning. A manager can sign off the run's QC evidence at a specific event high-water mark; later evidence visibly makes that sign-off historical/stale rather than silently extending it.

### Data and functions

Reuse `v3.qc_records` for component, allergen/staging, cleaning, verification, and sign-off evidence. Add `v3.qc_run_signoffs` for the immutable run/actor/high-water-mark assertion and its canonical receipt linkage. Do not add allergen options or infer cross-contact risk.

Resolve components from the run's frozen setup plus `v3.completed_run_substitutions`/effective-plan functions. Persist the effective component identity/snapshot reference with each check. Presence values must include an explicit unknown/not-checked state; absence of a row is not presence or absence evidence.

Functions:

- `v3.record_qc_component_check(actor_id, request_id, run_id, details)`
- `v3.record_qc_allergen_review(actor_id, request_id, run_id, details)`
- `v3.record_qc_cleaning(actor_id, request_id, run_id, details)`
- `v3.verify_qc_cleaning(actor_id, request_id, cleaning_record_id, details)`
- `v3.sign_off_qc_run(actor_id, request_id, run_id, expected_high_water_mark)`

Cleaning verification checks that the target record exists in the same facility and that verifier ≠ recorder. Sign-off locks/reads the current high-water mark in one transaction and cannot sign a later unseen event.

### API and UI

Routes:

- `POST /api/v3/qc/component-checks`
- `POST /api/v3/qc/allergen-reviews`
- `POST /api/v3/qc/cleaning-records`
- `POST /api/v3/qc/cleaning-records/{recordId}/verification`
- `POST /api/v3/qc/runs/{runId}/sign-off`

Extend `QcPage.tsx` with Components, Allergens/staging, Cleaning, and Sign-off panels. Show the effective substituted components and fixed reviewed allergen mappings, distinguishing reviewed-empty from missing/unreviewed. Display sign-off actor/time/high-water mark and a clear “new evidence recorded since sign-off” state. No Hold/Release control or cross-contact conclusion.

### Acceptance evidence

Prove effective-component resolution before/after substitution, unknown states, reviewed-empty versus unreviewed allergens, independent verification, high-water-mark staleness, exact retry, concurrent sign-off/new-event behavior, facility/role denial, offline lockout, and responsive/keyboard screen reader-readable status. A sign-off must not alter run status, inventory, schedule, shipping, or production eligibility.

## 6. Slice 3 — Advisory label and date-code checks

**Depends on:** Slice 1.
**Owner gates:** QC-2 and QC-3 before activating evaluated comparisons; QC-4 remains unchanged.
**Migration:** `0026-qc-advisory-references.sql` plus `.test.sql`.

### Observable outcome

A manager can publish, revise, and withdraw exact-text references for a bounded subject. Authorized staff can record observed shipper-label or date-code text. With an applicable active reference, V3 reports a literal match/mismatch; without one, it reports `not-evaluated` and the reason. Historical checks retain the exact reference version used.

### Data and functions

Add:

- `v3.qc_references`: current reference head, kind, subject, revision, and status.
- `v3.qc_reference_versions`: immutable versioned normalized exact text, author, timestamp, and withdrawal/metadata history through append-only evidence.

Store observations and comparisons in `v3.qc_records`, including reference version or non-evaluation reason. Normalize with NFC and boundary-whitespace trimming only. Do not punctuation-fold, case-fold, parse dates, calculate shelf life, or infer expected values.

Functions:

- `v3.list_qc_references(actor_id, filters, cursor)`
- `v3.publish_qc_reference(actor_id, request_id, reference_id, expected_revision, details)`
- `v3.set_qc_reference_status(actor_id, request_id, reference_id, expected_revision, status)`
- `v3.record_qc_label_check(actor_id, request_id, run_id, details)`
- `v3.record_qc_date_code_check(actor_id, request_id, run_id, details)`

Evaluation snapshots the selected reference version in the same transaction. Withdrawn, stale, ambiguous, missing, or inapplicable references return `not-evaluated`, never fail/pass by implication.

### API and UI

Routes:

- `GET /api/v3/qc/references`
- `POST /api/v3/qc/references`
- `POST /api/v3/qc/references/{referenceId}/status`
- `POST /api/v3/qc/label-checks`
- `POST /api/v3/qc/date-code-checks`

Add References and Advisory checks areas to QC. Every result states “literal text comparison only”; mismatch is not called a regulatory, shelf-life, or shipping failure. Reference editing has revision conflict/readback and withdrawal history.

### Acceptance evidence

Pin Unicode NFC/boundary-space cases and prove case/punctuation/internal-space differences remain meaningful. Cover missing, stale, ambiguous, withdrawn, and inapplicable references; reference-version immutability; stale edits; exact retries; role/facility isolation; no recipe/shipping/date inference; accessible result explanations; and offline write lockout.

## 7. Slice 4 — Planning and committed-state review

**Depends on:** Slices 1–3 for run context and review projections.
**Owner gates:** none beyond the existing advisory-only boundary.
**Migration:** `0027-qc-planning-and-review.sql` plus `.test.sql`.

### Observable outcome

QC staff can see upcoming work from canonical V3 schedules without editing the schedule. Managers can verify or reject the QC review of an already committed import revision or an already applied run recipe/effective-plan snapshot. Decisions survive reload and exact retry. Rejection is visible QC evidence only: it does not Undo an import, alter a run, or block activation.

### Data and functions

Store planning as a read projection, not a copied schedule. Store import/recipe review decisions in `v3.qc_records`, with committed object ID, exact reviewed revision/snapshot hash, decision, bounded note, actor, and timestamp. Only the latest effective decision for the same fenced object projects as current; prior decisions remain history.

Functions:

- `v3.get_qc_planning(actor_id, from_date, to_date)`
- `v3.review_committed_import(actor_id, request_id, import_id, expected_import_revision, decision, note)`
- `v3.review_applied_recipe(actor_id, request_id, run_id, expected_plan_snapshot_hash, decision, note)`

Import review validates the existing committed `v3.setup_imports`/applicable import history record and its revision. Recipe review validates the run's immutable applied snapshot plus effective substitutions. Neither function calls import Undo, run lifecycle, inventory, or schedule writers.

### API and UI

Routes:

- `GET /api/v3/qc/planning?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/v3/qc/import-reviews`
- `POST /api/v3/qc/recipe-reviews`

Add Upcoming and Review areas to QC. Planning identifies scheduled runs and existing/missing QC evidence without treating missing evidence as failed cadence. Review screens identify the exact committed revision/snapshot and show stale-review conflict when it changes. Rejection uses neutral advisory wording.

### Acceptance evidence

Prove canonical schedule/date readback, no schedule mutation, bounded date ranges, committed-only review, revision/snapshot fencing, verify/reject idempotency, superseding review history, exact retry, no Undo/run/eligibility side effects, role/facility denial, reload persistence, and responsive keyboard operation.

## 8. Slice 5 — Quality history, corrections, and intelligence

**Depends on:** Slices 1–4.
**Owner gates:** QC-5 for daily/date-grouped aggregates; QC-4 remains advisory.
**Migration:** `0028-qc-history-and-intelligence.sql` plus `.test.sql`.

### Observable outcome

Managers can search scoped QC history, append a correction, redact designated sensitive detail through a new projection rule, view allergen activity, inspect quality intelligence, and export the same corrected/redacted projection to CSV. Original evidence remains append-only; users never see a supposedly corrected export that silently bypasses redaction.

### Data and functions

Use `related_record_id` and correction/redaction record kinds in `v3.qc_records`. A correction supersedes selected values through projection; a redaction suppresses approved fields while retaining minimal event provenance. Neither edits the original row. Redaction policy must be deny-by-default for protected payloads and must apply identically to screen, JSON read models, CSV, and reports.

Functions:

- `v3.list_qc_history(actor_id, filters, limit, cursor)`
- `v3.append_qc_correction(actor_id, request_id, record_id, details)`
- `v3.append_qc_redaction(actor_id, request_id, record_id, details)`
- `v3.get_qc_allergen_activity(actor_id, filters, limit, cursor)`
- `v3.get_qc_intelligence(actor_id, filters)`
- Shared canonical export/projection helpers used by history, intelligence, and Slice 7.

Filters have bounded ranges and stable `(recorded_at, id)` cursors. Intelligence keeps units/targets separate, counts only recorded checks in pass/fail/not-evaluated denominators, exposes counts alongside rates, and never treats a missing check as a pass or proof of cadence compliance. Lot-to-run evidence is limited to explicit recorded lot/run links and exact V3 consumption records; no lot-to-customer/outbound inference.

QC evidence has no automatic retention cleanup in this plan. Reset/purge tooling must not silently include it; any future retention/maintenance command needs separate authorization and tests.

### API and UI

Routes:

- `GET /api/v3/qc/history`
- `POST /api/v3/qc/corrections`
- `POST /api/v3/qc/redactions`
- `GET /api/v3/qc/allergen-activity`
- `GET /api/v3/qc/intelligence`
- `GET /api/v3/qc/exports/history.csv`
- `GET /api/v3/qc/exports/intelligence.csv`

Add History, Allergen activity, and Intelligence areas. Corrections/redactions show actor, time, reason, and affected record without exposing redacted content. Charts have accessible tabular equivalents and explicit date basis. CSV exports stream or bounded-generate confirmed server projections with safe filenames, formula-injection protection for spreadsheet cells, correct escaping, and no secrets.

### Acceptance evidence

Prove correction chains, redaction projection parity across every read/export, append-only triggers, stable pagination, bounded filters, denominator/count math, unknowns, unit separation, missing-check behavior, exact lot/run links only, CSV escaping/formula safety, role/facility denial, exact retry, no cleanup on startup/reset, offline behavior, accessible tables/charts, and responsive layouts.

## 9. Slice 6 — Incidents and deterministic patterns

**Depends on:** existing accounts/capabilities; QC linkage is optional and uses Slice 1 identifiers when present.
**Owner gates:** none for manual sanitized reporting; AI diagnosis remains excluded.
**Migration:** `0029-incidents.sql` plus `.test.sql`.

### Observable outcome

Any signed-in user can submit an issue with bounded context and receive a safe reference. Authorized reviewers can search incidents, inspect sanitized detail, set priority/state/assignment, add notes, review activity, resolve/reopen through revision-fenced commands, and view deterministic groupings/counts. No AI diagnosis is generated.

### Data and functions

Add:

- `v3.incidents`: current facility-scoped report/workflow head with reporter snapshot, sanitized screen/platform/build/context, priority, state, assignee, revision, created/updated timestamps, and deterministic group key.
- `v3.incident_events`: append-only creation, workflow, assignment, note, review, resolution, and reopening activity.
- `v3.incident_command_receipts`: exact-retry/request-hash boundary.

Functions:

- `v3.create_incident(actor_id, request_id, details)`
- `v3.list_incidents(actor_id, filters, limit, cursor)`
- `v3.get_incident(actor_id, incident_id)`
- `v3.update_incident_workflow(actor_id, request_id, incident_id, expected_revision, details)`
- `v3.add_incident_note(actor_id, request_id, incident_id, expected_revision, note)`
- `v3.get_incident_patterns(actor_id, filters)`

Creation sanitizes and bounds diagnostic text before persistence. Permit manual context and explicitly allowlisted deterministic crash metadata (screen, platform, app build, coarse error category); exclude raw stacks, cookies, headers, credentials, connection strings, query strings, request payloads, unrestricted URLs, and operational record bodies. Group only normalized allowlisted fields. Apply per-user and trusted-client rate limits without storing sensitive network metadata.

### API and UI

Routes:

- `POST /api/v3/incidents`
- `GET /api/v3/incidents`
- `GET /api/v3/incidents/counts`
- `GET /api/v3/incidents/patterns`
- `GET /api/v3/incidents/{incidentId}`
- `POST /api/v3/incidents/{incidentId}/workflow`
- `POST /api/v3/incidents/{incidentId}/notes`

Add a global Report issue dialog and a Reports → Incidents review panel. A reporter receives confirmation but cannot read other report detail without `review-incidents`. Reviewers get accessible queues, detail/activity, assignment, and conflict handling. No notification/push system or AI fields are added.

### Acceptance evidence

Prove any-authenticated creation, reviewer-only reads/workflow, reporter data isolation, rate limits, sanitization/redaction, bounded payloads, assignment/state transition rules, append-only activity, stale conflict, exact retry after response loss, deterministic grouping, counts, CSRF, facility isolation, direct-access denial, offline lockout, and responsive keyboard workflows.

## 10. Slice 7 — Operational reports and safe evidence

**Depends on:** Slices 1–6 plus existing runs, operations, schedules, inventory, receipts, and audit foundations.
**Owner gates:** QC-5 for date grouping; QC-6 for signing only.
**Migration:** `0030-operational-reports.sql` plus `.test.sql`.

### Observable outcome

Authorized managers can view production summary/attainment, downtime/stoppages, quality availability/counts, incident totals/unresolved counts, inventory flagged-item availability/counts, and a handoff digest from canonical server state. Each source is either available with its basis/time range or explicitly unavailable; unavailable is never rendered as a successful zero. They can export current confirmed run/report state, finalize an immutable report snapshot, verify its content hash, reopen historical reports, export deterministic CSV/JSON, and inspect safe run operational evidence/receipts without internal secrets.

### Data and functions

Build read projections over:

- `v3.runs`, run events/progress, and immutable `production_date`.
- `v3.run_stoppages` and `v3.facility_operation_events`, excluding voided stoppages from effective operational totals.
- Projected QC evidence from Slice 5.
- Incident current state/activity from Slice 6.
- `v3.inventory_movements`, `v3.run_inventory_consumptions`, and flagged-item availability/counts without manufacturing unsupported flag data.
- `v3.command_receipts`, `v3.run_events`, `v3.qc_command_receipts`, and safe operational metadata for evidence views.

Add:

- `v3.finalized_reports`: immutable facility/period/report-kind snapshot, actor/time, canonical payload, content SHA-256, hash-contract version, and export metadata.
- `v3.report_command_receipts`: finalization exact-retry/request-hash boundary.
- `v3.report_events`: append-only bounded finalization/audit metadata; report payloads remain only in the finalized snapshot.

Functions:

- `v3.get_operational_report(actor_id, report_kind, filters)`
- `v3.get_handoff_digest(actor_id, production_date)`
- `v3.finalize_operational_report(actor_id, request_id, report_kind, filters, expected_source_high_water_marks)`
- `v3.list_finalized_reports(actor_id, filters, limit, cursor)`
- `v3.get_finalized_report(actor_id, report_id)`
- `v3.get_operational_evidence(actor_id, run_id, filters, limit, cursor)`

Finalization captures source high-water marks and canonical availability. A changed source produces a conflict requiring review rather than silently finalizing a different report. Hash canonical bytes with a versioned serialization contract. Reopening returns stored immutable payload, not a recomputed current report. Current-report and finalized CSV/JSON exports derive from the same canonical projections/snapshots; finalized exports verify the stored hash before download.

Safe evidence exposes bounded actor/action/time/correlation/request outcome and changed-field metadata where approved. It excludes SQL, session/CSRF data, account password/reset/invitation internals, outbox payloads, network metadata, secrets, raw request bodies, and redacted QC/incident content.

### API and UI

Routes:

- `GET /api/v3/reports/production`
- `GET /api/v3/reports/downtime`
- `GET /api/v3/reports/quality`
- `GET /api/v3/reports/incidents`
- `GET /api/v3/reports/inventory`
- `GET /api/v3/reports/handoff`
- `GET /api/v3/reports/exports/{reportKind}?format=csv|json`
- `POST /api/v3/reports/finalized`
- `GET /api/v3/reports/finalized`
- `GET /api/v3/reports/finalized/{reportId}`
- `GET /api/v3/reports/finalized/{reportId}/export?format=csv|json`
- `GET /api/v3/reports/evidence`

Replace the Reports placeholder with `client/src/pages/ReportsPage.tsx` and report-specific components. Include Overview, Handoff, Incidents, Finalized history, and Operational evidence areas. Label every date basis, source availability, confirmation time, and export scope. No PDF, automated schedule, cost/waste analysis, push notification, or signing control is added without separate approval.

### Acceptance evidence

Use synthetic known runs/stoppages/QC/incidents/inventory to pin every total and unavailable state. Prove voided-stoppage handling, production-date/event-date labeling, source high-water conflicts, immutable history, deterministic hash/export stability, corrupted-payload failure, exact retry, bounded history/evidence pagination, redaction parity, no secret fields, role/facility denial, offline behavior, accessible tables/charts, and responsive layouts.

## 11. Shared verification matrix

Every slice updates and runs the applicable rows below on synthetic data and disposable PostgreSQL 15. Record `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `NOT REACHED`; never convert an unavailable check into a pass.

| Layer | Required evidence |
|---|---|
| SQL migration/invariants | Fresh full-chain migration through the new slice; append-only triggers; constraints; revisions/high-water marks; concurrent commands; no startup migration/retention side effect. |
| SQL security | Authenticated facility derivation; every capability allow/deny; manager and qc-manager equivalence; disabled/revoked actor denial; function-only grants; direct table/sequence denial. |
| Domain unit | Pure comparison/evaluation/grouping/projection functions; boundaries; unknown/not-evaluated states; canonical request and report hashes; correction/redaction parity. |
| HTTP/PostgreSQL | Route contracts; exact JSON keys; body/query limits; CSRF; safe errors; request IDs; exact post-commit retry; mismatched-request rejection; stale canonical conflicts; pagination; no duplicate effects. |
| OpenAPI/client | `generate:api`, `check:api-generated`, strict TypeScript, typed wrappers, no generated-file hand edits, no `any` escape hatch for contract drift. |
| Authenticated browser | Real React/Chromium/PostgreSQL journey for each new workflow, reload/reconnect readback, two-session editing, lost response/exact retry, stale conflict, role denial, and no duplicate records. |
| Offline/PWA | Read-only confirmed state, visible staleness/confirmation context, every mutation disabled offline, no queued intent, no API response caching that exposes stale state as current. |
| Accessibility/responsive | Keyboard/focus/dialog/status announcements, accessible table equivalent for charts, desktop and phone/tablet portrait+landscape. |
| Engines | Chromium required; WebKit where the pinned executable is available, clearly labeled emulation rather than physical Safari evidence. Current lack of a WebKit executable remains `BLOCKED`, not passed. |
| Repository guards | Production build, server/static syntax, public synthetic tests, dependency audit, `check:no-ai`, `check:research`, and `git diff --check`. Required-private importer corpus remains unchanged and must remain green when provisioned. |

Final area qualification runs the complete chain through `0030`, full public and required-private suites, all HTTP/PostgreSQL integrations, authenticated browser journeys, build/type/generated-client checks, and security/research/no-AI guards. Update `research/feature-matrix.md` with only observed results and explicit limitations. No production-readiness claim is allowed.

## 12. Explicit exclusions and deferred scope

- AI photo assessment, confidence, diagnosis, narration, providers, prompts, adapters, models, and runtime dependencies.
- Photo bytes/thumbnails until QC-1 is approved with a secure attachment contract.
- Offline writes, offline command queues, and browser-authoritative state.
- Production/QC holds, release/shipping clearance, cross-contact scores, violations, near-miss conclusions, and regulatory/shelf-life claims.
- Expected label/date inference from recipes, shipping guides, ingredients, current date, or AI.
- Lot-to-customer/outbound traceability without explicit stored evidence.
- Push/email notifications and automated report scheduling.
- PDF reports, multi-day cost/waste/comparison analytics, and other historical proposals not explicitly included above.
- External report signing/key storage/rotation unless QC-6 approves it.
- New administrative retention/purge commands; QC retention remains indefinite by default.
- Production migration, deployment, pilot, database operation, or production-readiness claim.

These exclusions do not erase other deferred feature-matrix rows. Any later scope reduction requires owner approval.

## 13. Execution order and handoff rules

Implement one slice at a time in the listed order, except Slice 6 may proceed independently after its account/capability prerequisites if scheduling requires it. Do not start a gated behavior before its owner decision. Keep each slice's investigation, repair, regression coverage, generated-client update, and final verification together.

At each slice boundary, record: migration/commit, observable workflow, verification matrix status, known limits, and next dependency. Use normal reviewed changes only; never force-push `main`, bypass checks, commit private operational evidence, or claim WebKit/physical-device/deployment qualification without the corresponding evidence.

### Existing integration points

- `research/feature-matrix.md`
- `research/decisions/approved-v3-design.md`
- `api/openapi.yaml`
- `server/api.mjs`, `server/run-api.mjs`, `server/inventory-api.mjs`
- `client/src/api/index.ts`, `client/src/api/schema.d.ts` (generated only)
- `client/src/components/AppShell.tsx`, `client/src/pages/FeaturePage.tsx`
- `db/0001-run-control.sql`, `db/0002-staff-auth.sql`, `db/0004-import-inventory.sql`
- `db/0006-run-inventory-linkage.sql`, `db/0007-staff-role-equivalents.sql`, `db/0009-production-schedules.sql`
- `db/0015-setup-management.sql`, `db/0017-run-operations.sql`, `db/0018-temporary-substitutions.sql`, `db/0020-account-lifecycle.sql`
- `db/development-runtime-access.sql`, `db/run-local-tests.sh`
- `package.json`
