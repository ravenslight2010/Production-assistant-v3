# Skill: work on V3 importers

Use for V3 workbook or CSV importer changes, import bug investigations, and
changes to source parsing, identity linking, staged review, explicit Apply,
receipts, or imported-data persistence.

## Start with the current authority

1. Read [agent guidance](../AGENTS.md), the
   [source index](../../research/source-index.md), and the
   [approved import-completion design](../../research/decisions/import-completion-design.md).
2. Read the [V1 importer lessons](../memory/v1-importer-lessons.md) and
   [importer test map](../memory/importer-test-map.md).
3. Check the current implementation and tests before trusting remembered paths
   or coverage claims. The source index pins the V1 revision; later V1 changes
   are not authority until reviewed and pinned there.

V3's deterministic, no-AI design is authoritative. Do not add prompts, model
calls, provider SDKs, credentials, or learned-auto-alias behavior. V1 AI
matching and re-import behavior are historical evidence only.

## Trace the full import path

For a reported mismatch, follow the same record through:

1. Source selection and workbook layout.
2. Parsing and normalization, including units and row/cell provenance.
3. Exact identity linking, review suggestion, ambiguity, or unresolved result.
4. Staged diff, source hash, parser version, conflicts, and manager choices.
5. Explicit Apply, revision checks, idempotency, and receipt.
6. Persisted canonical records after reload.

Find the first boundary where the value or identity diverges. A correct parse
does not prove review, Apply, or persistence is correct. Do not replay an import
to repair an audit record; use the scoped idempotent audit-recovery path when
the audit write alone failed.

## Preserve safety and meaning

- Keep quantities in their source units and basis; do not infer a missing
  recipe, yield, tray count, or conversion.
- Formula-derived or cached values stay unresolved unless the approved design
  explicitly supports them as source text. Never execute macros or fetch
  external links.
- Auto-link only a unique deterministic identity. Keep near matches as
  suggestions and ambiguous matches unresolved.
- Keep parsing and staging non-mutating. Only explicit Apply writes setup
  data; Apply must revalidate source/version and current-record revisions.
- Missing rows and omitted optional blocks do not imply deletion.
- Preserve source provenance, stable canonical codes, idempotent receipts,
  retry behavior, and guarded Undo where applicable.
- Keep raw workbooks, customer rows, private expected-output manifests,
  production rows, credentials, and protected evidence outside Git and reports.
  Private corpus verification uses the separately provisioned corpus only.

## Verify the change

1. Run the smallest relevant parser test.
2. Run the documented V3 unit, database, browser, or private-corpus checks
   required by the changed boundary; do not claim a skipped private corpus is
   workbook-fidelity evidence.
3. Run the documentation checker if you change importer guidance:
   `node agents/scripts/check-agent-docs.mjs`.

Use the [importer test map](../memory/importer-test-map.md) to select current
tests. Do not point checks at production. Record only evidence actually
observed; synthetic fixtures and CI are not physical-device or production
qualification.
