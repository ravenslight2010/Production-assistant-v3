\set QUIET on
\pset footer off

DO $$
DECLARE
  v_facility uuid := '25000000-0000-4000-8000-000000000001';
  v_other_facility uuid := '25000000-0000-4000-8000-00000000000f';
  v_actor uuid := '25000000-0000-4000-8000-000000000002';
  v_run_running uuid := '25000000-0000-4000-8000-000000000010';
  v_run_planned uuid := '25000000-0000-4000-8000-000000000011';
  v_run_completed uuid := '25000000-0000-4000-8000-000000000012';
  v_run_other uuid := '25000000-0000-4000-8000-00000000001f';
  v_result jsonb;
  v_ids text[];
  v_due_in numeric;
  v_produced numeric;
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO v3.runs (
    facility_id, id, status, revision, created_at, updated_at, started_at, completed_at, setup_snapshot
  ) VALUES
    (v_facility, v_run_completed, 'completed', 1,
      v_now - interval '4 seconds', v_now - interval '4 seconds', v_now - interval '4 seconds', v_now - interval '4 seconds',
      '{"label":"Completed run","targetCases":100}'::jsonb),
    (v_facility, v_run_running, 'running', 1,
      v_now - interval '3 seconds', v_now - interval '3 seconds', v_now - interval '3 seconds', NULL,
      '{"label":"Running run","targetCases":100}'::jsonb),
    (v_facility, v_run_planned, 'planned', 0,
      v_now - interval '2 seconds', v_now - interval '2 seconds', NULL, NULL,
      '{"label":"Planned run","targetCases":100}'::jsonb),
    (v_other_facility, v_run_other, 'running', 1,
      v_now - interval '1 second', v_now - interval '1 second', v_now - interval '1 second', NULL,
      '{"label":"Other facility run","targetCases":100}'::jsonb);

  SELECT array_agg(x->>'id' ORDER BY ord) INTO v_ids
  FROM (
    SELECT value AS x, ordinality AS ord
    FROM jsonb_array_elements(v3.list_active_runs(v_facility, 50)) WITH ORDINALITY
  ) AS elems;
  ASSERT v_ids[1] = v_run_planned::text, 'active list should order newest first (planned run)';
  ASSERT v_ids[2] = v_run_running::text, 'active list should order newest first (running run)';
  ASSERT NOT (v_run_completed::text = ANY(v_ids)), 'completed run must be excluded from active list';
  ASSERT NOT (v_run_other::text = ANY(v_ids)), 'active list must stay facility-fenced';

  ASSERT jsonb_array_length(v3.list_active_runs(v_facility, 1)) = 1,
    'active list must respect the limit';
  ASSERT v3.list_active_runs(v_facility, 50)->0->>'status' IS NOT NULL,
    'active list entries must use the canonical run snapshot shape';

  DECLARE
    v_versioned record;
    v_expected_version bigint;
  BEGIN
    SELECT version, result INTO v_versioned
      FROM v3.list_runs_with_version(v_facility, 50);
    SELECT COALESCE(MAX(sequence), 0) INTO v_expected_version
      FROM v3.outbox_events WHERE facility_id = v_facility;
    ASSERT v_versioned.version = v_expected_version,
      'versioned list must return the facility outbox position';
    ASSERT (
      SELECT bool_and((va.elem - 'serverNow') = (vb.elem - 'serverNow'))
      FROM jsonb_array_elements(v_versioned.result) WITH ORDINALITY AS va(elem, ord)
      JOIN jsonb_array_elements(v3.list_runs(v_facility, 50)) WITH ORDINALITY AS vb(elem, ord)
        USING (ord)
    ) IS NOT FALSE,
      'versioned list payload must match the canonical list apart from serverNow';

    SELECT version, result INTO v_versioned
      FROM v3.list_active_runs_with_version(v_facility, 50);
    ASSERT v_versioned.version = v_expected_version,
      'active versioned list must return the facility outbox position';
    ASSERT (
      SELECT bool_and((va.elem - 'serverNow') = (vb.elem - 'serverNow'))
      FROM jsonb_array_elements(v_versioned.result) WITH ORDINALITY AS va(elem, ord)
      JOIN jsonb_array_elements(v3.list_active_runs(v_facility, 50)) WITH ORDINALITY AS vb(elem, ord)
        USING (ord)
    ) IS NOT FALSE,
      'active versioned list payload must match the active list apart from serverNow';
  END;

  BEGIN
    PERFORM v3.list_active_runs(NULL, 50);
    RAISE EXCEPTION 'active list accepted a null facility';
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'active list accepted a null facility';
  WHEN others THEN
    NULL;
  END;
  BEGIN
    PERFORM v3.list_active_runs(v_facility, 0);
    RAISE EXCEPTION 'active list accepted an invalid limit';
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'active list accepted an invalid limit';
  WHEN others THEN
    NULL;
  END;

  v_result := v3.apply_station_command(
    v_facility, v_run_running, v_actor, '0025-set-rate', repeat('a', 64), 1,
    'line', 'manual', '{"autoTrackRatePerMinute":600}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  ASSERT v_result->>'outcome' = 'accepted', 'rate setup should be accepted';
  v_revision := (v_result->'run'->>'revision')::bigint;

  SELECT EXTRACT(EPOCH FROM (next_due_at - clock_timestamp())) INTO v_due_in
    FROM v3.run_station_progress
    WHERE facility_id = v_facility AND run_id = v_run_running AND station_key = 'line';
  ASSERT v_due_in BETWEEN 2.5 AND 3.5,
    format('debounced next_due_at must be ~3s out at rate 600/min, got %s', v_due_in);

  PERFORM pg_sleep(3.2);

  v_result := v3.apply_station_command(
    v_facility, v_run_running, v_actor, '0025-tick', repeat('b', 64), v_revision,
    'line', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  ASSERT v_result->>'outcome' = 'accepted', 'auto-track tick should accrue units after 3.2s at 600/min';
  v_produced := (v_result->'run'->'stationProgress'->'line'->'progress'->>'casesProduced')::numeric;
  ASSERT v_produced BETWEEN 31 AND 33,
    format('debounced tick must reflect wall-clock time (~32 units), got %s', v_produced);
  v_revision := (v_result->'run'->>'revision')::bigint;

  SELECT EXTRACT(EPOCH FROM (next_due_at - clock_timestamp())) INTO v_due_in
    FROM v3.run_station_progress
    WHERE facility_id = v_facility AND run_id = v_run_running AND station_key = 'line';
  ASSERT v_due_in BETWEEN 2.5 AND 3.5,
    format('auto-track tick must reschedule ~3s out, got %s', v_due_in);

  v_result := v3.apply_station_command(
    v_facility, v_run_running, v_actor, '0025-tick-early', repeat('c', 64), v_revision,
    'line', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  ASSERT v_result->>'outcome' = 'not_due', 'immediate second tick must be not_due';
  ASSERT (v_result->'currentRun'->>'revision')::bigint = v_revision,
    'not_due tick must not write or advance the run revision';

  v_result := v3.apply_station_command(
    v_facility, v_run_running, v_actor, '0025-set-slow', repeat('d', 64), v_revision,
    'dough', 'manual', '{"autoTrackRatePerMinute":12}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  ASSERT v_result->>'outcome' = 'accepted', 'slow rate setup should be accepted';
  SELECT EXTRACT(EPOCH FROM (next_due_at - clock_timestamp())) INTO v_due_in
    FROM v3.run_station_progress
    WHERE facility_id = v_facility AND run_id = v_run_running AND station_key = 'dough';
  ASSERT v_due_in BETWEEN 4.5 AND 5.5,
    format('rate 12/min must keep its natural 5s cadence, got %s', v_due_in);
END $$;
