# Skill: verify and publish a repository change

Use before every commit or push and before describing a change as verified.

## Before editing

```sh
git fetch origin main
git status --short
git rev-parse HEAD origin/main
```

If they differ, integrate current `origin/main` first. Preserve existing local
work, prove whether it is already published before overwriting anything, and do
not edit files owned by another active task.

## Verify the changed surface

Use the smallest focused checks first, then all relevant shared checks:

```sh
pnpm test
pnpm run typecheck
pnpm run build
pnpm run check:api-generated
pnpm run check:no-ai
pnpm run check:research
```

Also run:

- `node agents/scripts/check-agent-docs.mjs` for `agents/` changes;
- the full browser matrix from [Run browser tests](run-browser-tests.md) for
  client, browser-harness, or browser-workflow changes;
- `pnpm test:db` through the repository's documented Postgres harness for SQL,
  service-query, authorization, or grant changes.

Do not claim an uninstalled engine, unavailable database, unrun test, or
independent review passed. Keep unexpected skips and advisory steps explicit.
Run `git diff --check` and inspect the final diff for accidental artifacts,
private operational data, credentials, cookies, and generated files.

## Commit safely

`git status` must contain only intended files before staging and must be clean
after committing. Never place a token in a remote URL, commit message, script,
repository file, or logged command. Use the environment's configured credential
store or approved secret file without displaying its contents. Do not retain
temporary credential helpers.

Commit only the reviewed change with a message that states what and why. Do not
commit ignored test output, raw diagnostics, private source workbooks, or local
environment files.

## Publish without clobbering

1. Fetch and confirm the remote `main` still equals the commit's parent.
2. If it advanced, reconcile the change onto the new head and rerun affected
   checks; do not force the old head over it.
3. Use a normal fast-forward-capable update. Never force-push `main`, alter
   branch protection, or bypass required checks.
4. Verify the remote branch and tree match the reviewed local commit. For API
   publication, preserve exact commit metadata and raw message bytes when local
   commit identity matters; an orphan/mismatched commit is not a successful push.
5. Watch the actual hosted workflows for that commit and report their real
   conclusions. Do not infer hosted success from local green checks.

Publication is not production deployment. Production database operations,
release approval, and physical-device qualification require separate authority
and evidence.
