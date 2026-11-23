\set QUIET on
\pset footer off

DO $$
DECLARE
  v_facility uuid := '17000000-0000-4000-8000-000000000001';
  v_actor uuid := '17000000-0000-4000-8000-000000000002';
  v_run uuid := '17000000-0000-4000-8000-000000000003';
  v_stop uuid;
  v_pause uuid;
  v_result jsonb;
  v_run_json jsonb;
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO v3.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    v_facility, v_run, 'planned', 0,
    v_now - interval '1 second', v_now - interval '1 second',
    '{"label":"Operations SQL test","targetCases":20}'::jsonb
  );
  v_result := v3.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, '0017-start', repeat('b', 64), 'start', 0
  );
  ASSERT v_result->>'outcome' = 'accepted', 'run should start';
  v_revision := 1;
  v_now := clock_timestamp();

  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-stop', repeat('c', 64), 'start_stop',
    jsonb_build_object('reason', 'Equipment jam', 'notes', 'Infeed'), v_revision
  );
  ASSERT v_result->>'outcome' = 'accepted', 'active stop should be accepted';
  ASSERT v_result->'run'->>'revision' = '2', 'stop should advance run revision';
  SELECT id INTO v_stop FROM v3.run_stoppages WHERE facility_id=v_facility AND run_id=v_run;
  ASSERT v_stop IS NOT NULL, 'active stop should persist';
  ASSERT v_result->'run'->'stoppages'->0->>'type' = 'stop', 'stop should be serialized';

  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-stop', repeat('c', 64), 'start_stop',
    jsonb_build_object('reason', 'Equipment jam', 'notes', 'Infeed'), v_revision
  );
  ASSERT v_result->>'replayed' = 'true', 'exact stop retry should replay';
  ASSERT v_result->'run'->>'revision' = '2', 'replay must not advance revision';
  ASSERT (SELECT count(*) FROM v3.run_stoppages WHERE facility_id=v_facility AND run_id=v_run)=1,
    'replay must not duplicate a stop';

  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-stale', repeat('d', 64), 'set_notes',
    jsonb_build_object('operationalNotes', 'stale'), 1
  );
  ASSERT v_result->>'outcome' = 'conflict', 'stale operation should conflict';
  ASSERT v_result->'currentRun'->>'revision' = '2', 'conflict should include canonical run';

  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-notes', repeat('e', 64), 'set_notes',
    jsonb_build_object('operationalNotes', 'Night shift handoff'), 2
  );
  ASSERT v_result->'run'->>'operationalNotes' = 'Night shift handoff', 'notes should round-trip';

  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-end', repeat('f', 64), 'end_stop',
    jsonb_build_object('stoppageId', v_stop), 3
  );
  ASSERT v_result->>'outcome' = 'accepted', 'active stop should end';

  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-past', repeat('0', 64), 'add_past_stop',
    jsonb_build_object('reason', 'Break', 'notes', 'Crew rotation',
      'startedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), 4
  );
  ASSERT v_result->>'outcome' = 'accepted', 'past stop should be accepted';
  SELECT id INTO v_stop FROM v3.run_stoppages
    WHERE facility_id=v_facility AND run_id=v_run AND type='manual';
  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-edit', repeat('1', 64), 'update_stoppage',
    jsonb_build_object('stoppageId', v_stop, 'reason', 'Staffing', 'notes', 'Corrected',
      'startedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), 5
  );
  ASSERT v_result->>'outcome' = 'accepted', 'manual stop edit should be accepted';
  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-delete', repeat('2', 64), 'delete_stoppage',
    jsonb_build_object('stoppageId', v_stop), 6
  );
  ASSERT v_result->>'outcome' = 'accepted', 'manual stop deletion should be accepted';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'run'->'stoppages') AS item(value)
    WHERE (value->>'id')::uuid=v_stop), 'deleted stop should be hidden';
  ASSERT EXISTS (SELECT 1 FROM v3.run_stoppages WHERE facility_id=v_facility AND run_id=v_run
    AND id=v_stop AND voided_at IS NOT NULL), 'deletion should preserve the audited row';

  v_result := v3.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, '0017-pause', repeat('3', 64), 'pause', 7
  );
  SELECT id INTO v_pause FROM v3.run_pause_intervals
    WHERE facility_id=v_facility AND run_id=v_run AND resumed_at IS NULL;
  ASSERT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'run'->'stoppages') AS item(value)
    WHERE (value->>'id')::uuid=v_pause AND value->>'stopTunnel'='true'
  ), 'pause must default to stopping tunnel';

  INSERT INTO v3.run_station_progress (
    facility_id, run_id, station_key, status, revision, inputs, progress, next_due_at, updated_at
  )
  SELECT v_facility, v_run, station.key, 'not_started', 0,
    jsonb_build_object('autoTrackRatePerMinute', station.rate),
    jsonb_build_object('autoTrackLastAt', to_char(
      (clock_timestamp()-make_interval(secs => station.seconds_ago)) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'autoTrackRemainder', 0),
    clock_timestamp()-interval '1 second', clock_timestamp()
  FROM (VALUES
    ('line', 60, 60),
    ('packaging', 60, 60),
    ('dough', 1, 30)
  ) AS station(key, rate, seconds_ago);

  ASSERT (SELECT count(*) FROM v3.list_due_station_auto_track(20)
    WHERE facility_id=v_facility AND run_id=v_run)=0,
    'default pause must stop all automatic worker eligibility';

  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-tunnel', repeat('4', 64), 'set_pause_tunnel',
    jsonb_build_object('stoppageId', v_pause, 'stopTunnel', false), 8
  );
  ASSERT v_result->>'outcome' = 'accepted', 'timely tunnel override should be accepted';
  ASSERT (SELECT count(*) FROM v3.list_due_station_auto_track(20)
    WHERE facility_id=v_facility AND run_id=v_run)=2,
    'only line and packaging should remain worker eligible';

  v_result := v3.apply_station_command(
    v_facility, v_run, v_actor, '0017-line-auto', repeat('5', 64), 9,
    'line', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  ASSERT v_result->>'outcome' = 'accepted', 'line auto-track should continue with tunnel running';
  ASSERT (v_result->'run'->'stationProgress'->'line'->'progress'->>'casesProduced')::numeric >= 1,
    'line should progress during the tunnel-running pause';

  v_result := v3.apply_station_command(
    v_facility, v_run, v_actor, '0017-dough-auto', repeat('6', 64), 10,
    'dough', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  ASSERT v_result->>'outcome' = 'invalid_transition', 'dough must remain paused';

  v_result := v3.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, '0017-resume', repeat('7', 64), 'resume', 10
  );
  ASSERT v_result->>'outcome' = 'accepted', 'run should resume';
  v_result := v3.apply_station_command(
    v_facility, v_run, v_actor, '0017-dough-after-resume', repeat('8', 64), 11,
    'dough', 'auto_track', '{}'::jsonb, '{}'::jsonb, 'casesProduced'
  );
  ASSERT v_result->>'outcome' = 'not_due', v_result::text;

  v_result := v3.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, '0017-pause-late', repeat('9', 64), 'pause', 11
  );
  SELECT id INTO v_pause FROM v3.run_pause_intervals
    WHERE facility_id=v_facility AND run_id=v_run AND resumed_at IS NULL;
  UPDATE v3.run_pause_intervals SET paused_at=clock_timestamp()-interval '11 seconds'
    WHERE facility_id=v_facility AND run_id=v_run AND id=v_pause;
  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-too-late', repeat('a', 64), 'set_pause_tunnel',
    jsonb_build_object('stoppageId', v_pause, 'stopTunnel', false), 12
  );
  ASSERT v_result->>'outcome' = 'invalid_transition', 'server must reject a late tunnel override';

  v_result := v3.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, '0017-resume-late', repeat('b', 64), 'resume', 12
  );
  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-open-at-completion', repeat('c', 64), 'start_stop',
    jsonb_build_object('reason', 'Cleanup', 'notes', ''), 13
  );
  v_result := v3.apply_run_lifecycle_command(
    v_facility, v_run, v_actor, '0017-complete', repeat('d', 64), 'complete', 14
  );
  ASSERT v_result->>'outcome' = 'accepted', 'run should complete';
  ASSERT NOT EXISTS (SELECT 1 FROM v3.run_stoppages WHERE facility_id=v_facility AND run_id=v_run
    AND ended_at IS NULL AND voided_at IS NULL), 'completion must close open stops';
  v_result := v3.apply_run_operation_command(
    v_facility, v_run, v_actor, '0017-completed-notes', repeat('e', 64), 'set_notes',
    jsonb_build_object('operationalNotes', 'late edit'), 15
  );
  ASSERT v_result->>'outcome' = 'invalid_transition', 'completed run operations must be read-only';

  v_run_json := v3.get_run(v_facility, v_run);
  ASSERT jsonb_typeof(v_run_json->'stoppages')='array', 'stoppages must remain visible after completion';
  ASSERT (SELECT count(*) FROM v3.run_events WHERE facility_id=v_facility AND run_id=v_run
    AND event_type LIKE 'run.operation.%') = 8, 'operation audit events should persist once per accepted command';
END
$$;

DO $$
DECLARE
  v_facility uuid := '17100000-0000-4000-8000-000000000001';
  v_actor uuid := '17100000-0000-4000-8000-000000000002';
  v_result jsonb;
BEGIN
  ASSERT v3.get_stop_reason_settings(v_facility)->>'revision'='0', 'default settings revision should be zero';
  ASSERT jsonb_array_length(v3.get_stop_reason_settings(v_facility)->'reasons')=7,
    'V1 default reasons should be present';
  v_result := v3.save_stop_reason_settings(
    v_facility, v_actor, '0017-reasons', repeat('f', 64), 0,
    jsonb_build_array('Equipment jam', 'Break', 'Custom hold')
  );
  ASSERT v_result->>'outcome'='accepted', 'reason update should be accepted';
  ASSERT v_result->'settings'->>'revision'='1', 'reason revision should advance';
  v_result := v3.save_stop_reason_settings(
    v_facility, v_actor, '0017-reasons', repeat('f', 64), 0,
    jsonb_build_array('Equipment jam', 'Break', 'Custom hold')
  );
  ASSERT v_result->>'replayed'='true', 'reason retry should replay';
  v_result := v3.save_stop_reason_settings(
    v_facility, v_actor, '0017-reasons-stale', repeat('0', 64), 0,
    jsonb_build_array('Break')
  );
  ASSERT v_result->>'outcome'='conflict', 'stale reason update should conflict';
  ASSERT v_result->'currentSettings'->>'revision'='1', 'reason conflict should include current settings';
  ASSERT (SELECT count(*) FROM v3.facility_operation_events WHERE facility_id=v_facility
    AND event_type='facility.stop_reasons_updated')=1, 'reason updates should be audited once';
END
$$;

\echo '0017 run operations SQL tests passed'
