\set QUIET on
\pset footer off

-- The disposable cluster creates a v3 role (NOLOGIN) so the runtime-grant
-- migration is observable. Production applies migrations before the runtime
-- login role exists; there the migration skips by design and these checks
-- skip with it.
DO
$$
DECLARE
  v_missing integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v3') THEN
    RAISE NOTICE 'role v3 absent; runtime grant checks skip';
  ELSE
    SELECT count(*) INTO v_missing
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'v3'
      AND p.prokind IN ('f', 'p')
      AND NOT has_function_privilege('v3', p.oid, 'EXECUTE');
    IF v_missing > 0 THEN
      RAISE EXCEPTION 'runtime role v3 lacks EXECUTE on % v3 function(s)', v_missing;
    END IF;

    -- Functions created after the backfill must inherit the grant automatically.
    CREATE FUNCTION v3.runtime_grant_probe_0027() RETURNS integer
      LANGUAGE sql
      AS 'SELECT 1';
    IF NOT has_function_privilege('v3', 'v3.runtime_grant_probe_0027()', 'EXECUTE') THEN
      DROP FUNCTION v3.runtime_grant_probe_0027();
      RAISE EXCEPTION 'default privileges did not grant EXECUTE to v3 on a new function';
    END IF;
    DROP FUNCTION v3.runtime_grant_probe_0027();

    -- House rule unchanged: the runtime role reaches data only through
    -- security-definer functions, never direct table access.
    IF has_table_privilege('v3', 'v3.runs', 'SELECT')
       OR has_table_privilege('v3', 'v3.staff_accounts', 'SELECT') THEN
      RAISE EXCEPTION 'runtime role v3 must not hold direct table privileges';
    END IF;
  END IF;
END
$$;
