---
name: v3-importer-transfer
description: Use for V3 workbook import changes, importer bug investigations, or when carrying a V1 import behavior forward. Read the V3 source-pinned importer guide and test map, then keep current V3 decisions authoritative.
---

# V3 importer transfer

Use this skill when an agent is working on an importer in Production Assistant
V3, transferring a V1 workbook behavior, or investigating missing, skipped,
duplicated, mislinked, or incorrectly applied imported data.

## Start with the right authority

1. Read the local references
   [`v1-importer-lessons.md`](../memory/v1-importer-lessons.md) and
   [`importer-test-map.md`](../memory/importer-test-map.md), and
   [`v1-profile-to-v3-runs.md`](../memory/v1-profile-to-v3-runs.md), then read the
   current `agents/AGENTS.md` and `research/decisions/import-completion-design.md`
   in the V3 repository.
2. Check `research/source-index.md` and the approved import design before
   relying on a V1 rule. V3 owner decisions, current V3 source, and tests outrank
   historical memories.
3. Keep V3's deterministic no-AI rule. Never add prompts, provider SDKs,
   credentials, private workbooks, parser expectations, or production rows to
   the V3 runtime or agent docs.

## Connect imports to profiles and runs

Use [V1 profile to V3 runs](../memory/v1-profile-to-v3-runs.md) to distinguish reviewed setup catalogs, separate schedule plans, and server-created live-run snapshots. A V1 profile is a conceptual crosswalk, not a V3 table.

## Diagnose source-to-landed differences

- Trace the same import through source selection, parsing, normalization,
  identity linking, staging, review, Apply, and persisted result.
- Find the first point where the observed row or value diverges. Do not treat a
  correct parser preview as proof that links, Apply, or persistence were correct.
- Preserve source hash, parser version, row/cell provenance, stable product and
  recipe codes, and the relevant import receipt. Report only the minimum safe
  identifiers needed to explain the finding.
- Do not replay an import merely to restore an audit record. An ambiguous
  outcome requires the scoped idempotent audit-recovery path.

## Carry forward V1 behavior carefully

- Preserve source-family distinctions, units, product-line qualifiers, recipe
  families, applicator slots, and exact source semantics from the V1 guide.
- Translate only the invariant that still fits V3. For example, V1's learned
  aliases and AI matching are not permission to introduce auto-learning or AI
  into V3.
- Keep unique exact links deterministic. Treat near matches as review
  candidates; leave ambiguous identity unresolved.
- Missing rows are not deletion. Missing or formula-derived values remain
  unresolved instead of being guessed or calculated from cached Excel results.

## Verify

Run the smallest relevant parser test first, then the documented V3 unit,
database, browser, or private-corpus qualification required by the change.
Private-corpus skips are not workbook-fidelity evidence. Never describe
emulation or synthetic fixtures as real workbook or physical-device
qualification.

For a V1 import bug in this current workspace, use the existing
`import-bug-investigation` and `spec-import-guard` skills. Add
`customer-import-audit` for a new-customer post-import audit, and
`data-heal-playbook` only when incorrect values are already persisted.
