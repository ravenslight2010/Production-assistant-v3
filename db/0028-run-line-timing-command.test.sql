\set QUIET on
\pset footer off

DO $$
DECLARE
  v_facility uuid := '28000000-0000-4000-8000-000000000001';
  v_actor uuid := '28000000-0000-4000-8000-000000000002';
  v_run_planned uuid := '28000000-0000-4000-8000-000000000010';
  v_run_running uuid := '28000000-0000-4000-8000-000000000011';
  v_run_completed uuid := '28000000-0000-4000-8000-000000000012';
  v_run_no_die uuid := '28000000-0000-4000-8000-000000000013';
  v_result jsonb;
  v_settings jsonb;
  v_revision bigint;
  v_hash text := repeat('a', 64);
  v_failed boolean;
  v_now timestamptz := clock_timestamp();
  v_die_setup jsonb := jsonb_build_object(
    'dieTypeCode', 'LINE-A', 'dieTypeName', 'Line A',
    'defaultStatus', 'active', 'defaultRevision', 1,
    'lineSettings', jsonb_build_object(
      'crustsPerCycle', 1, 'cycleSpeed', 1, 'speedAdjustment', 1,
      'freezerTime', 40, 'casesPerLayer', 6,
      'preTunnelMin', 5, 'postTunnelMin', 2.5,
      'pressOvenMin', 2.5, 'frontlineMin', 2.5
    )
  );
BEGIN
  INSERT INTO v3.runs (
    facility_id, id, status, revision, created_at, updated_at, started_at, completed_at, setup_snapshot
  ) VALUES
    (v_facility, v_run_planned, 'planned', 0,
      v_now - interval '4 seconds', v_now - interval '4 seconds', NULL, NULL,
      jsonb_build_object('label', 'Planned run', 'targetCases', 100, 'dieSetup', v_die_setup)),
    (v_facility, v_run_running, 'running', 1,
      v_now - interval '3 seconds', v_now - interval '3 seconds', v_now - interval '3 seconds', NULL,
      jsonb_build_object('label', 'Running run', 'targetCases', 100, 'dieSetup', v_die_setup)),
    (v_facility, v_run_completed, 'completed', 1,
      v_now - interval '2 seconds', v_now - interval '2 seconds', v_now - interval '2 seconds', v_now - interval '2 seconds',
      jsonb_build_object('label', 'Completed run', 'targetCases', 100, 'dieSetup', v_die_setup)),
    (v_facility, v_run_no_die, 'planned', 0,
      v_now - interval '1 second', v_now - interval '1 second', NULL, NULL,
      '{"label":"No-die run","targetCases":100}'::jsonb);

  -- Happy path on a planned run: partial patch, preTunnelMin re-derived.
  v_result := v3.apply_line_timing_command(
    v_facility, v_run_planned, v_actor, 'cmd-timing-1', v_hash, 0,
    '{"frontlineMin": 7.5, "freezerTime": 45}'::jsonb);
  ASSERT v_result->>'outcome' = 'accepted', 'timing command must be accepted';
  v_settings := v_result->'run'->'setupSnapshot'->'dieSetup'->'lineSettings';
  ASSERT (v_settings->>'frontlineMin')::numeric = 7.5, 'frontlineMin must update';
  ASSERT (v_settings->>'freezerTime')::numeric = 45, 'freezerTime must update';
  ASSERT (v_settings->>'pressOvenMin')::numeric = 2.5, 'untouched fields must keep prior values';
  ASSERT (v_settings->>'preTunnelMin')::numeric = 10,
    'preTunnelMin must re-derive as pressOvenMin + frontlineMin';
  ASSERT (v_result->'run'->>'revision')::bigint = 1, 'revision must bump exactly once';
  ASSERT NOT (v_result->>'replayed')::boolean, 'first apply must not be a replay';

  -- pressOvenMin edits re-derive preTunnelMin as well.
  v_result := v3.apply_line_timing_command(
    v_facility, v_run_planned, v_actor, 'cmd-timing-2', repeat('b', 64), 1,
    '{"pressOvenMin": 4}'::jsonb);
  v_settings := v_result->'run'->'setupSnapshot'->'dieSetup'->'lineSettings';
  ASSERT (v_settings->>'preTunnelMin')::numeric = 11.5,
    'pressOvenMin edit must re-derive preTunnelMin';

  -- Audit trail: run event and outbox event with the dedicated type.
  ASSERT EXISTS (
    SELECT 1 FROM v3.run_events
    WHERE facility_id = v_facility AND run_id = v_run_planned
      AND event_type = 'run.line_timing_changed'
      AND (payload->'lineSettings'->>'frontlineMin')::numeric = 7.5
  ), 'run event must record the changed line settings';
  ASSERT EXISTS (
    SELECT 1 FROM v3.outbox_events
    WHERE facility_id = v_facility AND run_id = v_run_planned
      AND event_type = 'run.line_timing_changed'
  ), 'outbox event must record the timing change';

  -- Exact replay: same command id and hash returns the stored response.
  v_result := v3.apply_line_timing_command(
    v_facility, v_run_planned, v_actor, 'cmd-timing-1', v_hash, 0,
    '{"frontlineMin": 7.5, "freezerTime": 45}'::jsonb);
  ASSERT (v_result->>'replayed')::boolean, 'identical retry must replay';
  ASSERT (v_result->'run'->>'revision')::bigint = 1,
    'replayed timing command must not bump revision';

  -- Reused command id with a different request must fail closed.
  v_failed := false;
  BEGIN
    PERFORM v3.apply_line_timing_command(
      v_facility, v_run_planned, v_actor, 'cmd-timing-1', repeat('c', 64), 0,
      '{"frontlineMin": 8}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'command id reuse with a different request must be rejected';

  -- Stale revision conflicts with the canonical run attached.
  v_result := v3.apply_line_timing_command(
    v_facility, v_run_running, v_actor, 'cmd-timing-3', repeat('d', 64), 0,
    '{"frontlineMin": 6}'::jsonb);
  ASSERT v_result->>'outcome' = 'conflict', 'stale expected revision must conflict';
  ASSERT v_result->'currentRun'->>'status' = 'running',
    'conflict response must carry the canonical run';

  v_result := v3.apply_line_timing_command(
    v_facility, v_run_running, v_actor, 'cmd-timing-4', repeat('e', 64), 1,
    '{"frontlineMin": 6}'::jsonb);
  ASSERT v_result->>'outcome' = 'accepted', 'running run must accept timing changes';

  -- Completed runs refuse timing changes.
  v_result := v3.apply_line_timing_command(
    v_facility, v_run_completed, v_actor, 'cmd-timing-5', repeat('f', 64), 1,
    '{"frontlineMin": 6}'::jsonb);
  ASSERT v_result->>'outcome' = 'invalid_transition',
    'completed run must refuse timing changes';
  ASSERT v_result->>'currentStatus' = 'completed',
    'invalid transition response must name the current status';

  -- Runs without a die setup have nothing to adjust.
  v_failed := false;
  BEGIN
    PERFORM v3.apply_line_timing_command(
      v_facility, v_run_no_die, v_actor, 'cmd-timing-6', repeat('1', 64), 0,
      '{"frontlineMin": 6}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'run without dieSetup must reject timing changes';

  -- Validation: unknown keys, negative values, empty patches, non-numbers.
  v_failed := false;
  BEGIN
    PERFORM v3.apply_line_timing_command(
      v_facility, v_run_running, v_actor, 'cmd-timing-7', repeat('2', 64), 2,
      '{"frontlineMin": 6, "mystery": 1}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'unknown timing keys must be rejected';

  v_failed := false;
  BEGIN
    PERFORM v3.apply_line_timing_command(
      v_facility, v_run_running, v_actor, 'cmd-timing-8', repeat('3', 64), 2,
      '{"freezerTime": -1}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'negative timing values must be rejected';

  v_failed := false;
  BEGIN
    PERFORM v3.apply_line_timing_command(
      v_facility, v_run_running, v_actor, 'cmd-timing-9', repeat('4', 64), 2,
      '{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'empty timing patch must be rejected';

  v_failed := false;
  BEGIN
    PERFORM v3.apply_line_timing_command(
      v_facility, v_run_running, v_actor, 'cmd-timing-a', repeat('5', 64), 2,
      '{"freezerTime": "45"}'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'non-numeric timing values must be rejected';

  -- Receipt rows exist for the accepted commands.
  ASSERT (SELECT COUNT(*) FROM v3.command_receipts
    WHERE facility_id = v_facility AND actor_id = v_actor
      AND command_id IN ('cmd-timing-1', 'cmd-timing-2', 'cmd-timing-4')) = 3,
    'accepted timing commands must leave command receipts';

  RAISE NOTICE '0028 run line timing command tests passed';
END
$$;
