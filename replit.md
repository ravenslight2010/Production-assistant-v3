# Production Assistant V3 on Replit

## Run in Preview

- Runtime: Node.js **24.22.3**, matching `.nvmrc`.
- Package manager: pnpm **12.8.1**, as pinned in `package.json`.
- Click **Run** to start the existing **V3 Production Assistant** workflow.
- The workflow runs `V3_USE_PROJECT_DATABASE=true NODE_ENV=development bash scripts/start-v3.sh`.
- The launcher explicitly maps the managed development `DATABASE_URL` to `V3_DATABASE_URL`. It starts both the HTTP API on `0.0.0.0:5000` and the station worker, whose health listener uses loopback port 3001.
- The API serves the built React application from `dist/`. After frontend edits, run `pnpm run build`, then restart the workflow.

## Dependencies and checks

Install the pinned dependencies with `pnpm install`. Do not change the existing stack or database ownership.

Useful commands:

```sh
pnpm run build
pnpm test
pnpm run audit:prod
```

## Database and first manager

The empty managed **development** database was initialized using the existing numbered, non-test SQL scripts in `db/`, in filename order. Do not rerun these scripts against an initialized database; they are not all idempotent. Test fixtures were not loaded.

On a fresh database, add `V3_INITIAL_MANAGER_BOOTSTRAP_CODE` through Replit Secrets with a unique 32–256 character value, then restart the workflow. Choose **Set up the first manager** on the sign-in screen, enter that code, and choose your own username and password. No default staff account or password is provided. Remove the bootstrap secret after creating the first manager.

The application exposes `/healthz` and `/api/v3/auth/bootstrap-status` for startup checks. Authentication remains enabled.

## Publishing is separate

This setup is for development Preview, not a completed production deployment. The application relies on PostgreSQL functions and permissions in addition to tables. Replit's automatic publish schema comparison does not copy all of those objects. Arrange and verify the required production database objects and access controls separately before publishing. Never add database migrations to application startup, change database object ownership, or expose secrets in source control.
