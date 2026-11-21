# V3 source and research index

Status: current implementation authority for the initial V3 build.
Last updated: 2026-11-21.

## Purpose

This index pins the source baselines, records which research artifacts are eligible for the repository, and separates implementation authority from historical evidence. Research informs review; it does not authorize runtime behavior, production access, deployment, AI use, or schema changes by itself.

## Pinned application sources

| Source | Repository and ref | Commit | V3 use | Classification |
|---|---|---|---|---|
| V1 | `ravenslight2010/Production-run-calculator`, `main` | `8769908bc25f5ed05943d1a2e50f34dee108b91a` | Visual system, navigation, non-AI product behavior, pure production calculations, and feature inventory | `current` |
| Replit V2 | `ravenslight2010/Replit-v2-main`, `main` | `7413225e5577a952570f37c207e6c940166c8e61` | Node server, explicit PostgreSQL migrations, authentication, run authority, worker, deterministic imports, inventory, and scheduling boundary | `current` |
| Lucia V2 | `ravenslight2010/Lucias-production-assistant-v2`, `main` | `e3ab0880ed95b7e0a9581b2ca9f7da368d11c8c1` | Reference and research only; not the V3 runtime base | `historical` |
| PRC Replit line | `ravenslight2010/Production-run-calculator`, `Replit` | `82c2f8858fab962a9b018f780470024693814dd1` | Recovery provenance and later-feature delta review | `historical` |
| V3 destination | `ravenslight2010/Production-assistant-v3`, `main` | Unpublished local work at this index revision | New implementation; normal reviewed changes only | `current` |

No source pin is a floating branch reference. A later source change requires a new review and an updated pin before it influences V3.

## Imported research artifacts

| Artifact | Repository path | SHA-256 | Use | Classification |
|---|---|---|---|---|
| Consolidated four-repository, 77-branch research report | `research/handoffs/Consolidated-Research-All-Repositories-2026-11-20.md` | `da5050069abfcfa074eaa84df7155e6df92afe5ba19500b8df3305f048620bf0` | Branch disposition, research-path inventory, active-versus-historical guidance, and source provenance | `current` |

The consolidated report inventories 1,419 current-main research/documentation/evidence paths and 555 unique branch-only research paths. Those counts describe the source inventory, not the number of files approved for V3 import.

## Pending source collections

| Collection | Current handling | Classification |
|---|---|---|
| V1 `research/` and `docs/` | Review file by file or by tightly scoped evidence bundle before import | `candidate` |
| Replit V2 research, handoffs, and roadmap records | Import eligible text after superseded guidance is labeled | `candidate` |
| Prior local-assistant and self-hosting handoffs | Retain eligible documents as research only; no AI or hosting implementation is authorized | `historical` |
| Old Replit synchronization documents | Keep only with later authorities and superseded advice explicitly identified | `historical` |
| Archived generated artifacts and unreadable binaries | Do not use as source-of-truth implementation evidence | `superseded` or excluded |

## Classification vocabulary

- `current`: consistent with the approved V3 design and usable as present review input.
- `historical`: useful evidence about an earlier state, decision, or incident; not current behavior by default.
- `superseded`: replaced by a later decision, source pin, or implementation; retained only when its history is valuable and the replacement is named.
- `candidate`: not yet eligibility-reviewed or not yet accepted as V3 guidance.

Feature dispositions are defined in `research/feature-matrix.md`.

## Eligibility and safety boundary

Eligible library content is readable, reviewable documentation or sanitized structured evidence with an identifiable source and classification. The following must not be committed:

- Credentials, tokens, cookies, connection strings, private keys, or credential-bearing environment files.
- Raw customer workbooks, production database rows, or unapproved operational exports.
- Protected operational captures or evidence whose authorization is unclear.
- Generated build output, dependency stores, or unreadable binary evidence presented as documentation.
- Runtime prompts or provider configuration intended to activate AI.

Private workbook names and hashes already present in inherited test pins are not a license to import those workbooks. Workbook-backed tests remain separately provisioned and explicitly skippable when the private corpus is absent.

## Authority order

1. Explicit owner decisions recorded in `research/decisions/`.
2. Reviewed V3 code, SQL migrations, OpenAPI contract, and executable tests.
3. Current pinned V1/V2 source evidence.
4. Current research syntheses and runbooks.
5. Historical, candidate, and superseded material with its labels intact.

A research document cannot override a higher authority. Any newly discovered V1/V2 contradiction requires an owner decision and a recommendation before implementation.
