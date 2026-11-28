-- Run outcome capture (slice: downtime/reject capture port — outcome half).
--
-- v1's RunMeta carried actualCases and wasteLbs: closeout capture on the run
-- record, editable while the run was running (supervisor) or after it
-- finished, with wholesale-replace semantics (sending undefined cleared the
-- field). v3's downtime half (run_stoppages via apply_run_operation_command)
-- already shipped in db/0017, so this migration adds only the outcome
-- columns and their command. Server-owned: revision bump, command receipt
-- idempotency, run event, and outbox event — the same envelope as
-- apply_run_lifecycle_command and apply_line_timing_command.

BEGIN;

ALTER TABLE v3.runs
  ADD COLUMN actual_cases integer
    CHECK (actual_cases IS NULL OR actual_cases BETWEEN 0 AND 10000000),
  ADD COLUMN waste_lbs numeric
    CHECK (waste_lbs IS NULL OR waste_lbs BETWEEN 0 AND 10000000);

CREATE OR REPLACE FUNCTION v3.apply_run_outcome_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_actual_cases integer,
  p_waste_lbs numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_run v3.runs%ROWTYPE;
  v_existing_hash text;
  v_existing_response jsonb;
  v_now timestamptz;
  v_response jsonb;
  v_revision bigint;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0
     OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR (p_actual_cases IS NOT NULL AND p_actual_cases NOT BETWEEN 0 AND 10000000)
     OR (p_waste_lbs IS NOT NULL AND p_waste_lbs NOT BETWEEN 0 AND 10000000) THEN
    RAISE EXCEPTION 'Invalid run outcome command' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );

  SELECT request_hash, response
    INTO v_existing_hash, v_existing_response
    FROM v3.command_receipts
    WHERE facility_id = p_facility_id
      AND actor_id = p_actor_id
      AND command_id = p_command_id;

  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was reused with a different request'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  SELECT *
    INTO v_run
    FROM v3.runs
    WHERE facility_id = p_facility_id
      AND id = p_run_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'expectedRevision', p_expected_revision,
      'currentRun', v3.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;

  IF v_run.status NOT IN ('running', 'paused', 'completed') THEN
    RETURN jsonb_build_object(
      'outcome', 'invalid_transition',
      'currentStatus', v_run.status,
      'currentRun', v3.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;

  IF v_run.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Run revision is exhausted' USING ERRCODE = '22003';
  END IF;

  v_now := clock_timestamp();
  IF v_now < v_run.updated_at THEN
    RAISE EXCEPTION 'Database clock precedes the current run state'
      USING ERRCODE = '22008';
  END IF;

  UPDATE v3.runs
    SET actual_cases = p_actual_cases,
        waste_lbs = p_waste_lbs,
        updated_at = v_now, revision = revision + 1
    WHERE facility_id = p_facility_id AND id = p_run_id
    RETURNING * INTO v_run;

  v_revision := v_run.revision;

  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'commandId', p_command_id,
    'run', v3.run_snapshot(p_facility_id, p_run_id)
  );

  INSERT INTO v3.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, p_run_id, v_revision, p_actor_id,
    'run.outcome_recorded', v_now,
    jsonb_build_object(
      'outcome', 'accepted',
      'commandId', p_command_id,
      'actualCases', p_actual_cases,
      'wasteLbs', p_waste_lbs
    )
  );

  INSERT INTO v3.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, p_run_id, v_revision,
    'run.outcome_recorded', v_response, v_now
  );

  INSERT INTO v3.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now
  );

  RETURN v_response;
END
$$;

-- Extend the snapshot with the outcome fields so every command response,
-- operational read, and ETag-cached run list carries them.
CREATE OR REPLACE FUNCTION v3.run_snapshot(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT v3.run_snapshot_without_rules(p_facility_id, p_run_id) ||
    jsonb_build_object(
      'productionRules', COALESCE((
        SELECT e.payload#>'{run,productionRules}' FROM v3.run_events e
        WHERE e.facility_id=p_facility_id AND e.run_id=p_run_id
          AND e.event_type='run.started'
        ORDER BY e.revision LIMIT 1
      ), v3.assess_production_rules(p_facility_id, r.setup_snapshot, p_run_id)),
      'actualCases', r.actual_cases,
      'wasteLbs', r.waste_lbs
    )
  FROM v3.runs r WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$$;

REVOKE ALL ON FUNCTION v3.apply_run_outcome_command(uuid, uuid, uuid, text, text, bigint, integer, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION v3.apply_run_outcome_command(uuid, uuid, uuid, text, text, bigint, integer, numeric) TO v3;

COMMIT;
