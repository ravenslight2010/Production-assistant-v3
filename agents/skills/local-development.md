# Skill: run the app locally

Use when you need a working API, worker, and web client on a machine.

## Requirements

- Node version in `.nvmrc` (currently 24.22.3). `scripts/start-v3.sh` refuses
  any other version.
- pnpm matching `package.json`
- A disposable PostgreSQL database. Never point local work at production.

## Environment

```sh
export V3_DATABASE_URL="postgres://user:pass@localhost:5432/v3_dev"
# or
export V3_USE_PROJECT_DATABASE=true
export DATABASE_URL="postgres://..."
```

See `.env.example` for the full list. `V3_DATABASE_URL` is required unless
`V3_USE_PROJECT_DATABASE=true`.

## Commands

| Command | What it starts |
|---------|----------------|
| `pnpm dev` | API (`server/main.mjs`), worker (`server/worker-main.mjs`), and Vite web |
| `pnpm start` | API only |
| `pnpm start:worker` | Worker only |
| `pnpm dev:web` | Vite only (host 0.0.0.0) |
| `bash scripts/start-v3.sh` | Production-style start with pool defaults |

Default ports: API 5000 (or `PORT`), worker health 3001, Vite on its own port.

## Pool defaults in start-v3.sh

- `V3_API_DB_POOL_MAX=3`
- `V3_WORKER_DB_POOL_MAX=2`

Raise these only after measuring. Background workers and the API share the
database; oversized pools caused connection pressure in earlier debugging.

## Verify

```sh
curl -s http://localhost:5000/health
# or the port you set
```

A healthy response means the API can reach the database. The worker health
port is separate.
