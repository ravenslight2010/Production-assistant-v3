# Local hosting memory

Notes for running v3 on a local network machine (Windows or Linux) instead of
a hosted publisher.

## What "self-host" means here

The API and worker run on a machine you control. Clients (tablets, phones,
browsers) connect over the local network. Updates still come from the GitHub
repo; the machine pulls and restarts.

This is separate from self-hosted GitHub Actions runners. See
[Self-hosted runners](../skills/self-hosted-runners.md) for CI machines.

## Start path

- `scripts/start-v3.sh` checks the pinned Node version and requires
  `V3_DATABASE_URL` (or `V3_USE_PROJECT_DATABASE=true` with `DATABASE_URL`).
- It sets conservative pool sizes (`V3_API_DB_POOL_MAX=3`,
  `V3_WORKER_DB_POOL_MAX=2`) so background work does not starve the API.
- `pnpm dev` is for development (API + worker + Vite). Use the start script
  or `pnpm start` / `pnpm start:worker` for a longer-running host.

## Constraints

- No AI providers in the runtime (`scripts/check-no-ai.mjs`).
- Do not point a local host at a production database.
- Windows 10/11 CI that runs the app requires a self-hosted runner with the
  matching label. See `docs/self-hosted-runners.md`.
