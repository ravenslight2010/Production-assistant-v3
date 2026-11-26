# V3 importer test map

Use this map alongside [V1 importer lessons](v1-importer-lessons.md) and
[Work on V3 importers](../skills/work-on-importers.md). Paths were checked against the current
V3 repository tree when this transfer was prepared; inspect current `main`
before relying on them.

## Deterministic parser and mapping tests

| Area | Source and tests | Existing coverage to preserve |
| --- | --- | --- |
| Source workbook parse | `core/source-workbook-import.mjs` and `core/source-workbook-import.test.mjs` | Supported layout and value extraction, row/cell provenance, duplicate identity, file/size bounds, formulas and cached values failing closed. |
| Setup catalog CSV | `core/setup-catalog-csv.mjs` and `core/setup-catalog-csv.test.mjs` | Header/layout validation, stable catalog identity, normalized fields, and explicit invalid-row handling. |
| General CSV import | `core/import-csv.mjs` and `core/import-csv.test.mjs` | Supported columns, strict value parsing, duplicates, invalid input, and row-level import semantics. |
| Schedule workbook | `core/schedule-workbook-import.mjs` and `core/schedule-workbook-import.test.mjs` | Explicit dates/day blocks, schedule normalization, unsupported templates, and no guessed schedule date. |
| Capacity workbook | `core/workbook-capacity-import.mjs` and `core/workbook-capacity-import.test.mjs` | Capacity/template mapping, strict source values, and unresolved unsupported layouts. |
| Private corpus boundary | `core/private-source-corpus.mjs`, `core/private-source-corpus.test.mjs`, and `core/source-workbook-corpus.test.mjs` | Manifest and corpus availability checks without committing workbooks or expected customer data. |

## End-to-end and database checks

- `e2e/setup-catalog.browser.test.mjs` exercises the manager setup-catalog flow
  in a browser with mocked APIs.
- `e2e/schedule.browser.test.mjs` exercises schedule import and review in a
  browser with mocked APIs.
- `server/schedule-api.test.mjs` covers schedule API contracts.
- `db/0021-source-workbook-parser-v2.test.sql` checks database behavior for
  source-workbook parser state.
- `db/0023-schedule-import-history.test.sql` checks schedule import history.
- `db/0007-approved-setup-catalogs.test.sql` and
  `db/0014-setup-catalog-editors.test.sql` cover setup catalog storage and
  edits.

Choose server/database suites by the code boundary changed; do not point these
tests at production. See `package.json` for current script definitions.

## Confirmed coverage gap to resolve

A synthetic XLSX check found that a formula-backed dough yield with a cached
display value is currently returned by `parseDoughCapacityWorkbook` as a
numeric `doughballYield`. The approved V3 design says formula or cached results
remain unresolved unless explicitly supported as source text. The capacity
tests cover literal and missing yields but do not cover a formula with a
cached result. Treat this as an importer correctness gap, not as covered
behavior. Keep any code fix and regression test in a separate reviewed change;
the documentation transfer itself does not alter the runtime.

## Synthetic importer scenario matrix

Use only synthetic workbooks generated in tests (for example with the existing XLSX helpers). Never check in customer workbooks, private corpus manifests, or expected customer rows. “Gap” means the current public tests do not prove the invariant; it is not evidence that the runtime already behaves correctly.

| Scenario | Synthetic input/change | Expected V3 behavior | Existing test evidence and remaining gap |
| --- | --- | --- | --- |
| Formula or cached result | Put a formula and cached display value in an otherwise supported source cell; repeat for a dough-capacity yield cell. | Do not treat a formula/cache as a literal. Keep unsupported values unresolved with a visible reason; never calculate a replacement. | `core/source-workbook-import.test.mjs` covers formula/cache rejection for source workbooks. **Gap:** `core/workbook-capacity-import.test.mjs` covers literal and missing yields, but not a formula-backed cached yield. |
| Blank cell vs omitted row | Compare an explicit blank field with a source row removed from a later workbook revision. | Preserve blank/omitted as unresolved or absent; a missing row must not clear or delete previously saved/manual setup. | Premix blank preservation is covered in `core/source-workbook-import.test.mjs`. The no-delete-on-omission rule is in the approved design; **gap:** no explicit import/Apply regression is mapped for it. |
| Units and decimal precision | Use explicit `lb`/`oz` labels, a decimal quantity such as `0.125`, and one mixed-unit table. | Preserve the source unit and supported decimal value; do not silently convert or round. Keep unsupported/mixed units review-only. | Annotated cheese pounds, mixed-unit sauce, and setup-catalog unit cases are covered by `core/source-workbook-import.test.mjs` and `core/setup-catalog-csv.test.mjs`. **Gap:** no named decimal round-trip boundary case is mapped. |
| Duplicate or ambiguous identity | Add duplicate source identities, or two catalog candidates with the same normalized name. | Reject duplicate source identity; link only a unique exact match. Leave ambiguous links unresolved for manager review; do not guess. | Covered by duplicate-identity checks in `core/source-workbook-import.test.mjs` and `core/workbook-capacity-import.test.mjs`, and duplicate-key checks in `core/setup-catalog-csv.test.mjs`. |
| Workbook changes after review | Stage workbook A, change a source cell to produce workbook B, then attempt the old approval. | A changed source hash invalidates value-level review/Apply approval. Require fresh review; valid identity links may carry forward only under the approved identity rule. | `db/0022-combined-setup-review.test.sql` pins source revisions. **Gap:** no mapped test proves changed-hash approval rejection through Apply. |
| Preview, staging, Apply, and retry | Preview a synthetic workbook, stage it, retry the exact request, then Apply once. | Preview and staging do not mutate setup. Exact retry does not duplicate imports. Only explicit Apply changes values and produces stable history/receipt. | Covered by the source-review and retry flow in `e2e/setup-catalog.browser.test.mjs` and Apply retry checks in `db/0007-approved-setup-catalogs.test.sql`. |
| Missing cross-workbook dependency | Import a spec that references a recipe absent from the companion synthetic workbook. | Keep the missing dependency visible; do not create an all-zero recipe stub or silently resolve it. | The combined-review browser scenario exercises a visible missing dependency. Treat no-zero-stub persistence as **partial** unless a test asserts the stored catalog remains unchanged. |

Keep parser assertions in the smallest relevant `core/*.test.mjs` suite. Use browser tests for review/Apply behavior and SQL tests for persisted state or revision fencing. Update the status column when a regression is added; never promote a gap to covered based only on parser preview output.

## Recommended regression chain

For a parser or importer behavior change, assert as much of this chain as
applies:

1. Exact source rows, units, and provenance produce the intended parse result.
2. Exact unique identities link; near/ambiguous identities remain reviewable
   and unresolved.
3. Unsupported formulas/layouts fail closed with a visible reason.
4. Staging is non-mutating and displays omitted values as omitted, not deletes.
5. Apply is explicit, revision-fenced, idempotent, and returns a stable
   receipt.
6. Reloaded setup matches the applied result without overwriting
   unrelated/manual values.

`pnpm test` runs core/server/web/agent unit tests. Use `pnpm test:browser` for
browser journeys and `pnpm test:db` for real-Postgres SQL behavior. The
private-corpus suite requires separately provisioned files; never copy them
into Git to make a test pass.
