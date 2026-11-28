\set QUIET on
\pset footer off

DO $$
DECLARE
  v_facility uuid := '30000000-0000-4000-8000-000000000001';
  v_actor uuid := '30000000-0000-4000-8000-000000000002';
  v_run_planned uuid := '30000000-0000-4000-8000-000000000010';
  v_run_running uuid := '30000000-0000-4000-8000-000000000011';
  v_run_paused uuid := '30000000-0000-4000-8000-000000000012';
  v_run_completed uuid := '30000000-0000-4000-8000-000000000013';
  v_result jsonb;
  v_hash text := repeat('3', 64);
  v_failed boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO v3.runs (
    facility_id, id, status, revision, created_at, updated_at, started_at,
    paused_at, completed_at, setup_snapshot
  ) VALUES
    (v_facility, v_run_planned, 'planned', 0,
      v_now - interval '5 seconds', v_now - interval '5 seconds', NULL, NULL, NULL,
      '{"label":"Planned run","targetCases":100}'::jsonb),
    (v_facility, v_run_running, 'running', 1,
      v_now - interval '4 seconds', v_now - interval '4 seconds',
      v_now - interval '4 seconds', NULL, NULL,
      '{"label":"Running run","targetCases":100}'::jsonb),
    (v_facility, v_run_paused, 'paused', 2,
      v_now - interval '3 seconds', v_now - interval '3 seconds',
      v_now - interval '3 seconds', v_now - interval '1 second', NULL,
      '{"label":"Paused run","targetCases":100}'::jsonb),
    (v_facility, v_run_completed, 'completed', 1,
      v_now - interval '2 seconds', v_now - interval '1 second',
      v_now - interval '2 seconds', NULL, v_now - interval '1 second',
      '{"label":"Completed run","targetCases":100}'::jsonb);

  -- Planned runs cannot take an outcome: nothing has been produced yet.
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_planned, v_actor, 'cmd-outcome-planned', v_hash, 0,
    100, 4.5);
  ASSERT v_result->>'outcome' = 'invalid_transition',
    'planned run must refuse outcome capture';
  ASSERT (v_result->>'currentStatus') = 'planned', 'refusal must name the status';

  -- Happy path on a running run: both fields set, revision bumps once,
  -- snapshot carries the new keys.
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_running, v_actor, 'cmd-outcome-1', v_hash, 1,
    104, 3.25);
  ASSERT v_result->>'outcome' = 'accepted', 'outcome command must be accepted';
  ASSERT NOT (v_result->>'replayed')::boolean, 'first apply must not be a replay';
  ASSERT (v_result->'run'->>'revision')::bigint = 2, 'revision must bump exactly once';
  ASSERT (v_result->'run'->>'actualCases')::integer = 104, 'snapshot must carry actualCases';
  ASSERT (v_result->'run'->>'wasteLbs')::numeric = 3.25, 'snapshot must carry wasteLbs';
  ASSERT (SELECT actual_cases FROM v3.runs
    WHERE facility_id = v_facility AND id = v_run_running) = 104,
    'runs row must store actual_cases';
  ASSERT (SELECT waste_lbs FROM v3.runs
    WHERE facility_id = v_facility AND id = v_run_running) = 3.25,
    'runs row must store waste_lbs';

  -- Wholesale replace: resending only actualCases clears wasteLbs (v1
  -- updateRunMeta parity — undefined clears).
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_running, v_actor, 'cmd-outcome-2', repeat('4', 64), 2,
    105, NULL);
  ASSERT v_result->>'outcome' = 'accepted', 'replace command must be accepted';
  ASSERT (v_result->'run'->>'actualCases')::integer = 105, 'actualCases must replace';
  ASSERT jsonb_typeof(v_result->'run'->'wasteLbs') = 'null',
    'resending NULL must clear wasteLbs';
  ASSERT (SELECT waste_lbs IS NULL FROM v3.runs
    WHERE facility_id = v_facility AND id = v_run_running),
    'runs row must clear waste_lbs on NULL';

  -- Clear both: NULL for actualCases empties the closeout.
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_running, v_actor, 'cmd-outcome-3', repeat('5', 64), 3,
    NULL, NULL);
  ASSERT jsonb_typeof(v_result->'run'->'actualCases') = 'null',
    'NULL actualCases must clear the field';
  ASSERT (SELECT actual_cases IS NULL FROM v3.runs
    WHERE facility_id = v_facility AND id = v_run_running),
    'runs row must clear actual_cases on NULL';

  -- Replay: same command id + same hash returns the stored response flagged
  -- replayed without touching revision again.
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_running, v_actor, 'cmd-outcome-3', repeat('5', 64), 3,
    NULL, NULL);
  ASSERT (v_result->>'replayed')::boolean, 'same hash must replay';
  ASSERT (v_result->'run'->>'revision')::bigint = 4, 'replay must not bump revision';

  -- Reuse with a different request must fail.
  v_failed := false;
  BEGIN
    PERFORM v3.apply_run_outcome_command(
      v_facility, v_run_running, v_actor, 'cmd-outcome-3', v_hash, 4,
      10, 1);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'idempotency key reuse with a different request must be rejected';

  -- Stale revision returns a conflict carrying the canonical current run.
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_running, v_actor, 'cmd-outcome-stale', v_hash, 1,
    100, 1);
  ASSERT v_result->>'outcome' = 'conflict', 'stale revision must conflict';
  ASSERT (v_result->>'expectedRevision')::bigint = 1, 'conflict must echo expectedRevision';
  ASSERT (v_result->'currentRun'->>'revision')::bigint = 4,
    'conflict must carry the canonical current run';

  -- Paused and completed runs accept outcome capture.
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_paused, v_actor, 'cmd-outcome-paused', v_hash, 2,
    98, 0.5);
  ASSERT v_result->>'outcome' = 'accepted', 'paused run must accept outcome';
  v_result := v3.apply_run_outcome_command(
    v_facility, v_run_completed, v_actor, 'cmd-outcome-done', v_hash, 1,
    100, NULL);
  ASSERT v_result->>'outcome' = 'accepted', 'completed run must accept outcome';

  -- Out-of-range values are rejected.
  v_failed := false;
  BEGIN
    PERFORM v3.apply_run_outcome_command(
      v_facility, v_run_running, v_actor, 'cmd-outcome-bad-1', v_hash, 4,
      -1, 1);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'negative actualCases must be rejected';

  v_failed := false;
  BEGIN
    PERFORM v3.apply_run_outcome_command(
      v_facility, v_run_running, v_actor, 'cmd-outcome-bad-2', v_hash, 4,
      1, -0.5);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true; END;
  ASSERT v_failed, 'negative wasteLbs must be rejected';

  -- A completed run's final outcome survives alongside completed_at; the
  -- plain snapshot (via list) carries the keys too.
  v_result := (SELECT v3.get_run(v_facility, v_run_completed));
  ASSERT (v_result->>'actualCases')::integer = 100, 'get_run must carry actualCases';
  ASSERT jsonb_typeof(v_result->'wasteLbs') = 'null', 'unset wasteLbs reads as null';

  -- Receipt rows exist for the accepted commands only (conflicts/refusals
  -- store nothing).
  ASSERT (SELECT COUNT(*) FROM v3.command_receipts
    WHERE facility_id = v_facility AND actor_id = v_actor
      AND command_id IN ('cmd-outcome-1', 'cmd-outcome-2', 'cmd-outcome-3',
        'cmd-outcome-paused', 'cmd-outcome-done')) = 5,
    'accepted outcome commands must leave command receipts';

  -- Run events audit the accepted commands.
  ASSERT (SELECT COUNT(*) FROM v3.run_events
    WHERE facility_id = v_facility AND run_id = v_run_running
      AND event_type = 'run.outcome_recorded') = 3,
    'each accepted outcome must write a run event';

  -- No fixture cleanup: the harness scratch cluster is disposable, and
  -- run_events/outbox_events/command_receipts are append-only.

  RAISE NOTICE '0030 run outcome command tests passed';
END
$$;
