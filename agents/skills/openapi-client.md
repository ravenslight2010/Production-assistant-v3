# Skill: regenerate and check the OpenAPI client

Use when API routes, request bodies, or response shapes change.

## Toolchain

The repo uses `openapi-typesafe` and `openapi-typesafe-fetch` with TypeScript
7. Do not switch back to `openapi-typescript` or `openapi-fetch` without
confirming TypeScript 7 compatibility. See
[ADR-2026-11-25-1](../memory/decisions.md).

## Commands

```sh
pnpm generate:api
# writes client/src/api/schema.d.ts from api/openapi.yaml

pnpm check:api-generated
# regenerates and fails if the committed schema drifts
```

`pnpm build` runs `generate:api` before typecheck and the Vite build.

## When you change an endpoint

1. Update `api/openapi.yaml` (or the generator source if the YAML is derived).
2. Run `pnpm generate:api`.
3. Commit the updated `client/src/api/schema.d.ts` with the API change.
4. Run `pnpm check:api-generated` and `pnpm typecheck`.

## If generate:api fails

- Confirm `openapi-typesafe` is installed (`pnpm ls openapi-typesafe`).
- Confirm `api/openapi.yaml` is valid YAML.
- Do not hand-edit `schema.d.ts` to silence the error; fix the spec or the
  generator input.
