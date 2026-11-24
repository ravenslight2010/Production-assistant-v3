# Approved deterministic import completion and corpus-fidelity design

Status: approved by the owner on 2026-11-24.
Authority: current implementation decision for the import-completion phase.

## Scope

The current private Lucias Drive folder is the approved working corpus. Every current file is used and must be accounted for. The implementation covers both V1-style cross-workbook setup completion and the broader file/format coverage required by that corpus. The initial build remains deterministic and does not activate AI.

Raw workbooks, detailed private manifests, operational rows, and protected evidence remain outside Git and the research library.

## Architecture

- Keep individual workbook imports and their independent staging, exact retry, canonical history, Apply, and guarded Undo.
- Add a mixed-file queue and a server-owned combined review above those imports.
- The combined review coordinates and explains imports; it is not a second writer to setup data.
- A review session references staged or applied imports by canonical ID, revision, source hash, and parser version.
- Setup decisions enter the existing staged setup-import path. Apply revalidates all source revisions.
- Independent Applies can complete partially. The interface names successful receipts and remaining work rather than claiming a corpus-wide transaction or automatically rolling back successful receipts.
- Drive is a private source location, not an automatic runtime synchronization channel.

## Dependency order and identity

The default review order is pizza specs, dough and sauce, premixes, cheese, then shipping. Schedules remain operationally separate and Apply per production date.

Specs establish product and recipe references. A specialized workbook supplies the actual recipe definition. A spec reference without its specialized definition remains a visible missing dependency and must not create an all-zero recipe stub.

Exact and normalized matches may auto-link only when unique. Deterministic near-name matches are suggestions. Managers confirm uncertain links with stable canonical codes. Confirmed identity links can survive a source-version change only when the stable source identity and active target still exist. Fuzzy matches are never learned automatically.

Size digits, product-line qualifiers, station-specific applicator slots, and the mix-versus-cheese boundary remain distinguishing information.

## Values and conflicts

- Blank/default fields can be filled in bulk, but the result is staged until explicit Apply.
- Existing different values require an individual keep-current or use-imported decision.
- Sources proposing different values require an individual source choice or keep-current decision.
- Sources agreeing on a value retain all supporting citations.
- Missing rows never imply deletion.
- Missing dough yield remains unavailable; batch-only premix rows do not acquire derived per-pizza values.
- Unresolved identities stay excluded until linked or explicitly excluded from the import.

The combined projection exposes current and proposed values, source workbook and cell, import ID/revision, parser version, and the reason for each fill, mismatch, conflict, missing dependency, or unresolved identity.

## Corpus, formats, and versions

A private manifest records every file's relative path, hash, family, format, parser expectations, and cross-workbook relationships. No fixed dough/shipping count or mixed-queue count defines completeness.

Provide deterministic handling for every format present in the corpus, using container-appropriate validation. Macros and external links are never executed or fetched. Formula or cached results remain unresolved unless explicitly supported as source text. Malformed, renamed, and unreadable inputs fail visibly. No AI fallback is permitted.

Identical hashes identify the same source version. A changed hash is a new version and invalidates value-level review and Apply approval. Valid identity links can carry forward under the identity rule above. Added, removed, renamed, or ambiguous rows return to review. History remains pinned to the exact applied source version.

## Schedule lifecycle

Schedule workbooks have staged source hashes and parser versions, canonical reopen, exact retry, independent per-date Apply receipts, and guarded Undo for created runs that remain unchanged. Multi-day Apply is explicitly non-atomic and can be partial.

Opening-count corrections remain explicit inventory adjustments in the append-only movement ledger; no generic opening-count Undo deletes or disguises that history.

## Verification

Use three evidence layers:

1. Public synthetic parser, identity, conflict, security, retry, Apply, and Undo regressions.
2. Required private whole-corpus qualification against exact hashes, expected parser outcomes, relationships, and deterministic combined projections.
3. Local PostgreSQL and Chromium/WebKit workflows covering mixed staging, no mutation before Apply, identity decisions, blank fills, conflicts, exact retry, changed hashes, Undo, schedules, persistence, offline lockout, and responsive layouts.

Ordinary public tests skip private evidence when absent and state that the skip is not fidelity evidence. Required qualification fails on missing inputs. Setup-3 closes only after the complete private corpus passes. Private browser runs retain no raw screenshots, exports, or unsanitized diagnostics.

Implementation sequence: corpus foundation, deterministic format/parser completion, combined backend, mixed/combined UI, schedule history/Undo, then full-corpus qualification. Every verified update uses normal commit and push. Production deployment and production database operations remain separately authorized work.
