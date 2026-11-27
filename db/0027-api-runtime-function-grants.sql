-- The API connects as the runtime login role and may only reach data through
-- security-definer functions (house rule: never table grants to API roles).
-- EXECUTE grants for that role were maintained by a manual per-migration ops
-- step, which drifted out of date on live databases: functions added after a
-- database's bootstrap (schedule imports, workbook imports, combined setup
-- reviews, QC verification) had no grant, so those endpoints 403'd even though
-- every layer above Postgres was correct.
--
-- Backfill every function once, then make the grant automatic for all future
-- functions created by the role that applies migrations, so the ops step can
-- never drift again. The runtime role legitimately holds EXECUTE on the whole
-- v3 function surface: the API layer above it is the authorization boundary.
-- Reviewed restriction stays in the harness-only v3_api_test role, which keeps
-- its explicit per-function grant list and negative assertions.
--
-- Idempotent: GRANT and ALTER DEFAULT PRIVILEGES re-run cleanly. When the
-- runtime role does not exist yet (migration applied on a fresh cluster before
-- the login role is provisioned), the backfill skips by design and the default
-- privilege is recorded for whatever role applies this migration.

DO
$$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v3') THEN
    RAISE NOTICE 'runtime role v3 is not present; skipping runtime grant backfill';
  ELSE
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA v3 TO v3;
    ALTER DEFAULT PRIVILEGES IN SCHEMA v3 GRANT EXECUTE ON FUNCTIONS TO v3;
  END IF;
END
$$;
