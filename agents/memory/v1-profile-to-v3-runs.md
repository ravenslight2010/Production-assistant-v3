# From V1 profiles to V3 runs

This is a crosswalk for agents and reviewers. The approved V3 design and current code are authoritative; this guide explains how the pieces relate and does not authorize runtime changes.

## What V1 called a profile

A V1 profile is a useful way to think about the product configuration needed to make a run, but V3 does not store that as one imported profile object. V3 distributes the approved setup across catalog records: a product, its production setup and recipe links, recipe definitions, and supporting setup such as warehouses and run templates. The relationships are joined by stable codes and validated when they are used.

When a person asks to import or update a profile, first identify which V3 records and fields they mean. Do not invent a single V3 profile row or copy V1's import behavior without checking the approved V3 design.

## Import paths

| Input | What it produces | What it does not do |
| --- | --- | --- |
| Source workbooks | Deterministic parsed records, source-cell citations, and unresolved items for the supported spec, recipe, cheese/mix, sauce/dough, and shipping families. | Does not call AI, execute formulas, silently infer missing values, or write setup during preview. |
| Setup catalog CSV | Strictly shaped, code-keyed setup records such as ingredients, mixes, recipes, production setups, run templates, and other allowlisted setup families. | Does not accept arbitrary fields or live run state. |
| Capacity workbooks | Typed dough/shipping capacity values with source-cell provenance and strict unsupported-layout handling. | Does not derive a missing dough yield from cached or guessed values. |
| Schedule workbooks | Reviewed planned-run rows with date, product, production setup, run template, target, and source citations. | Does not create or mutate live production runs. |

Use the [V1 importer lessons](v1-importer-lessons.md) for source-family semantics and the [test map](importer-test-map.md) for exact parser and test locations. The approved default review order for setup completion is product/spec references, dough and sauce, premixes, cheese, then shipping. Schedules are a separate workflow.

## Setup import lifecycle

```text
Source file
  -> deterministic parser and input validation
  -> source rows, stable identities, source-cell provenance
  -> exact unique links; ambiguous links and conflicts stay in manager review
  -> preview/review projection (no setup mutation)
  -> canonical staged import pinned to source hash and parser version
  -> explicit Apply, which revalidates revisions and writes approved setup
  -> current product/recipe/production-setup catalog
```

A combined review can coordinate several staged imports and explain dependencies, fills, mismatches, conflicts, and unresolved identities. It is not a second writer. Exact unique matches may be linked deterministically; near matches are suggestions. A spec reference without its specialized recipe remains a visible missing dependency and must not create an all-zero recipe stub. Missing rows do not delete existing setup. A changed source hash invalidates value-level review and Apply approval; valid identity links can survive only under the approved stable-identity rule.

## How setup becomes a V1-style run

1. A manager reviews and explicitly applies the product, recipe, production setup, and supporting catalog imports that the product needs.
2. On the Run page, the manager chooses a production date, imported product, production setup, and whole-number case target. The product determines the available production setups.
3. The server validates the selected product/setup and creates a run in `planned` status. It freezes a setup snapshot and server-derived production plan, including the reviewed recipes and production warehouse. A created run is not automatically started.
4. The run then follows the live run lifecycle through its existing server-owned commands. A later edit to imported master data is not the same action as changing or starting this run.

Relevant source locations: `client/src/components/CreateRunForm.tsx`, `client/src/pages/RunPage.tsx`, `core/run-service.mjs`, `server/run-api.mjs`, and `db/0001-run-control.sql`.

## Schedule imports are a separate track

A schedule workbook is parsed and reviewed separately. Flat workbooks do not get a guessed date; a manager supplies the date. Explicit day blocks keep their own dates. Product, production-setup, and run-template links are reviewed before the rows can be staged.

Schedule staging stores a canonical source hash, parser version, and row citations without changing the schedule. Apply is independent for each production date, so a multi-date import can be partially applied and the history shows which dates remain. Apply merges reviewed planned rows into the schedule, using the schedule revision fence. Guarded Undo removes only unchanged runs created by that import; it does not revert updates to pre-existing runs. The SQL regression explicitly asserts that schedule Apply/Undo does not create or modify live runs.

A scheduled row is therefore not a live run. It is a plan entry. Preparing a production run remains a separate action on the Run page, where V3 creates the live run snapshot from the reviewed product and setup.

Relevant source locations: `client/src/components/ScheduleImport.tsx`, `client/src/pages/SchedulePage.tsx`, `core/schedule-workbook-import.mjs`, `core/schedule-planning.mjs`, `server/schedule-api.mjs`, and `db/0023-schedule-import-history.sql`.

## Boundaries to preserve

- V3 imports remain deterministic and no-AI.
- Formula and cached results remain unresolved unless the approved V3 parser explicitly supports them as source text.
- Preview and staging are non-mutating; only explicit Apply writes catalog or schedule state.
- Keep source hashes, parser versions, stable codes, row/cell citations, and exact retry semantics.
- A missing row is not a deletion; an ambiguous identity is not an exact link.
- Do not commit customer workbooks, private corpus manifests, operational rows, or credentials.
- Private-corpus skips do not prove workbook fidelity.

## Verification pointers

- Parser and mapping: `core/source-workbook-import.test.mjs`, `core/setup-catalog-csv.test.mjs`, `core/import-csv.test.mjs`, `core/workbook-capacity-import.test.mjs`, and `core/schedule-workbook-import.test.mjs`.
- Review and Apply journeys: `e2e/setup-catalog.browser.test.mjs` and `e2e/schedule.browser.test.mjs`.
- Persistence and history: `db/0007-approved-setup-catalogs.test.sql`, `db/0022-combined-setup-review.test.sql`, and `db/0023-schedule-import-history.test.sql`.
- For exact hosted commands and current coverage gaps, follow `agents/memory/importer-test-map.md` and `agents/skills/work-on-importers.md`.
