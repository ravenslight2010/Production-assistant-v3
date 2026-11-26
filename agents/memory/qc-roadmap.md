# QC and reporting roadmap memory

The detailed source of truth is
[QC, incidents, and reporting implementation plan](../../research/qc-reporting-implementation-plan.md).
Read that plan before implementation; this file carries only durable handoff
constraints and known drift.

## Status and execution order

As of 2026-11-27, Slice 1 is implemented and Slices 2–7 remain approved but
unimplemented. Handle completion as one continuous objective, executed in order:

1. QC evidence foundation, current-run dashboard, lots, weights, Brix, targets.
2. Component identity/presence, allergen/staging review, cleaning evidence,
   independent cleaning verification, event-high-water-mark run sign-off.
3. Versioned label/date-code references and advisory literal checks.
4. Upcoming-QC planning and committed-import/applied-recipe review.
5. Quality history, corrections/redactions, exports, allergen activity, QC intelligence.
6. Incident reporting, review workflow, deterministic patterns.
7. Operational reports, handoff, finalized evidence, exports, safe audit/receipt visibility.

Each slice still needs its own migration, SQL/API/client tests, browser evidence,
documentation update, commit, and verification. Do not create an unverified
mega-commit or begin owner-gated behavior before its decision.

## Migration-number drift

The plan's provisional Slice 2 filename `0025-qc-run-verification.sql` is stale:
`0025-active-runs-and-auto-track-debounce.sql` and its paired test now occupy
that number. Slice 1 is `0024-qc-evidence-foundation.sql`.

Before every migration, inventory current `db/NNNN-*.sql` on freshly fetched
`main` and choose the next actually available number with a matching `.test.sql`.
Update the plan's stale filename when implementing the affected slice. Never
overwrite or renumber another feature's migration to match an older plan.

## Owner gates

| Gate | What must not be activated without the required decision |
| --- | --- |
| QC-1 | Photo capture/storage, thumbnails, bytes, or photo-history claims. This does not block Slices 1–7. |
| QC-2 | Slice 3 label-reference activation and evaluated pass/fail comparisons. |
| QC-3 | Slice 3 date-code evaluation beyond literal exact-text comparison. |
| QC-4 | Any allergen/QC enforcement, hold, release/shipping decision, cross-contact conclusion, risk score, or near-miss conclusion. Advisory evidence workflows are allowed. |
| QC-5 | Final daily/date-grouped aggregates in Slices 5 and 7. Timestamp-cursor history may precede the decision. |
| QC-6 | External report signing, key IDs/storage/rotation. Immutable snapshots and content hashes remain the default. |
| QC-7 | Hiding or renaming established navigation for unauthorized roles. Keep access guidance while server authorization remains authoritative. |

## Standing product boundary

QC evidence is advisory only. Missing checks and references remain missing or
`not-evaluated`; run-linked checks use immutable run snapshots and effective
substitutions. Reads and writes are facility-scoped through authenticated server
context. Offline is read-only confirmed state with no queued writes.

No AI assessment, diagnosis, confidence, provider, prompt, model, or runtime
dependency is part of this plan. No production deployment or production database
operation is authorized by the roadmap or this memory.
