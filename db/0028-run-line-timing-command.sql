-- Run line-timing command. The run snapshot already carries the reviewed
-- die-line timing (setup_snapshot.dieSetup.lineSettings, filled from reviewed
-- die-line defaults at creation); this command lets an operator adjust the
-- transit timings of a planned, running, or paused run without recreating it,
-- mirroring v1's LineTransitSettings behavior. preTunnelMin is always
-- re-derived as pressOvenMin + frontlineMin so the v1 invariant (pre-tunnel
-- equals press/oven + frontline) cannot drift. Server-owned: revision bump,
-- command receipt idempotency, run event, and outbox event, same envelope as
-- apply_run_lifecycle_command.

CREATE OR REPLACE FUNCTION v3.apply_line_timing_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_timing jsonb
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
  v_line_settings jsonb;
  v_press_oven numeric;
  v_frontline numeric;
  v_next_settings jsonb;
  v_key text;
  v_value numeric;
  v_response jsonb;
  v_revision bigint;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0
     OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_timing IS NULL OR jsonb_typeof(p_timing) <> 'object'
     OR p_timing = '{}'::jsonb
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_timing) AS keys(key)
       WHERE keys.key NOT IN ('pressOvenMin', 'frontlineMin', 'postTunnelMin', 'freezerTime')
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_timing) AS entries(key, value)
       WHERE jsonb_typeof(entries.value) <> 'number'
          OR entries.value::text::numeric < 0
          OR entries.value::text::numeric > 100000
     ) THEN
    RAISE EXCEPTION 'Invalid line timing command' USING ERRCODE = '22023';
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

  IF v_run.status NOT IN ('planned', 'running', 'paused') THEN
    RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
  END IF;

  IF v_run.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Run revision is exhausted' USING ERRCODE = '22003';
  END IF;

  v_now := clock_timestamp();
  IF v_now < v_run.updated_at THEN
    RAISE EXCEPTION 'Database clock precedes the current run state'
      USING ERRCODE = '22008';
  END IF;

  v_line_settings := v_run.setup_snapshot #> '{dieSetup,lineSettings}';
  IF v_line_settings IS NULL OR jsonb_typeof(v_line_settings) <> 'object' THEN
    RAISE EXCEPTION 'Run has no line timing settings' USING ERRCODE = '22023';
  END IF;

  -- Apply the patch onto the stored settings, then re-derive preTunnelMin so
  -- the press/oven + frontline invariant holds exactly.
  v_next_settings := v_line_settings;
  FOR v_key, v_value IN SELECT key, value::text::numeric FROM jsonb_each(p_timing) LOOP
    v_next_settings := jsonb_set(v_next_settings, ARRAY[v_key], to_jsonb(v_value));
  END LOOP;
  v_press_oven := COALESCE((v_next_settings->>'pressOvenMin')::numeric, 0);
  v_frontline := COALESCE((v_next_settings->>'frontlineMin')::numeric, 0);
  v_next_settings := jsonb_set(
    v_next_settings, ARRAY['preTunnelMin'], to_jsonb(v_press_oven + v_frontline)
  );

  UPDATE v3.runs
    SET setup_snapshot = jsonb_set(
          setup_snapshot, '{dieSetup,lineSettings}', v_next_settings),
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
    'run.line_timing_changed', v_now,
    jsonb_build_object(
      'outcome', 'accepted',
      'commandId', p_command_id,
      'lineSettings', v_next_settings
    )
  );

  INSERT INTO v3.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, p_run_id, v_revision,
    'run.line_timing_changed', v_response, v_now
  );

  INSERT INTO v3.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now
  );

  RETURN v_response;
END
$$;
