# Skill: adding a SQL migration

## Files

- `db/NNNN-short-name.sql` — the migration, next number in sequence.
- `db/NNNN-short-name.test.sql` — psql assertions, same number/name.
  Both must re-run cleanly (idempotent). The harness runs every pair.

Fetch `main` and inventory `db/NNNN-*.sql` immediately before allocating the
number. A filename in an older plan is provisional, not a reservation: for
example, `0025-active-runs-and-auto-track-debounce.sql` now occupies the number
once proposed for QC Slice 2. Never overwrite or renumber an existing migration
to match a stale plan.

## Rules that are easy to break

1. **Tables are owned by the `postgres` OS-level role** on the rig, not the
   `v3` role. Apply with `su postgres -c "psql -d v3 -v ON_ERROR_STOP=1 -f db/NNNN-....sql"`.
2. **The API role gets EXECUTE on functions only.** New queries surfaced to
   the API must live in `SECURITY DEFINER` functions (usually
   `SECURITY DEFINER SET search_path = v3, pg_temp`). Since
   `0027-api-runtime-function-grants.sql`, `GRANT EXECUTE ... TO v3` and the
   default privilege are applied by that migration itself — backfilled for all
   existing functions and automatic for future ones created by the migration
   runner's role — so no manual grant step is needed for the runtime role.
   Keep adding explicit `GRANT EXECUTE ... TO v3_api_test` for the harness.
   Never `GRANT SELECT/INSERT` on tables to API roles.
3. **SQL-language functions validate at CREATE.** If function B calls
   function A, declare A first in the same migration — or the migration
   fails at apply time.
4. `CREATE OR REPLACE` preserves grants; plain `CREATE` inside an idempotent
   guard (`IF NOT EXISTS` / check `pg_proc`) does not need re-grants, but a
   replace that changes the signature orphans them. Re-assert grants after
   signature changes.
5. Prefer `RETURNS TABLE(...)` + `jsonb` payloads over rowtypes when the
   API consumes them; the service maps columns positionally — changing
   column order or names is a breaking change for `core/*-service.mjs`.
6. Write the test file first if you're unsure what invariants matter; the
   harness fails loudly and tells you.

## Verify

```sh
su v3test -c "export PATH=/opt/node24/bin:/usr/lib/postgresql/16/bin:\$PATH; bash db/run-local-tests.sh"
```

Green exit 0 means SQL + http-postgres integration + browser suites all
passed. Don't declare victory after `npm test` alone — it never touches real
Postgres.
