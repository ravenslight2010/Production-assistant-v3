# Skill: run the real-Postgres tests

Use when a change touches SQL, migrations, or anything the unit tests mock.

## Why they matter

`pnpm test` mocks the database. A change can pass unit tests and still 500
against real Postgres. `pnpm test:db` is the source of truth for SQL.
See [gotchas](../memory/gotchas.md) (42501 incident).

## Requirements

- PostgreSQL installed and `initdb` on `PATH`
- The test script creates a disposable database; it does not need a running
  server on the default port if it can init its own

## Command

```sh
pnpm test:db
```

On CI the workflow installs `postgresql` / `postgresql-contrib`, finds
`initdb` under `/usr/lib/postgresql`, and adds it to `PATH` before running
the script.

## When to run

- After any migration (`db/NNNN-*.sql` and its paired `.test.sql`)
- After changes to `SECURITY DEFINER` functions or grants
- Before calling a SQL change verified

## Paired migrations

Every `db/NNNN-name.sql` must have `db/NNNN-name.test.sql`. Both must re-run
cleanly. Inventory `db/` on fresh `main` before choosing the next number.
