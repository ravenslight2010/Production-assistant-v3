BEGIN;

-- Fast floor sync: let tablets poll only the runs that can still change,
-- and stop auto-track stations from writing more often than accuracy needs.
--
-- Auto-track progress is derived from wall-clock elapsed time (autoTrackLastAt
-- plus a carried fractional remainder), so stretching the write interval does
-- not change the accrued progress. Debounce the per-station write cadence at
-- three seconds: high-rate stations write at most every 3s regardless of rate,
-- low-rate stations keep their natural >=3s cadence unchanged.

CREATE INDEX v3_runs_active_list_idx
  ON v3.runs (facility_id, created_at DESC, id DESC)
  WHERE status <> 'completed';

CREATE FUNCTION v3.list_active_runs(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_runs jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid run list request'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(v3.run_snapshot(p_facility_id, selected.id) ORDER BY selected.created_at DESC, selected.id DESC),
    '[]'::jsonb
  )
    INTO v_runs
    FROM (
      SELECT r.id, r.created_at
      FROM v3.runs AS r
      WHERE r.facility_id = p_facility_id
        AND r.status <> 'completed'
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT p_limit
    ) AS selected;

  RETURN v_runs;
END
$$;

CREATE OR REPLACE FUNCTION v3.apply_station_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_station_key text,
  p_mode text,
  p_inputs_patch jsonb,
  p_progress_patch jsonb,
  p_auto_track_field text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_run v3.runs%ROWTYPE;
  v_station v3.run_station_progress%ROWTYPE;
  v_existing_hash text;
  v_existing_response jsonb;
  v_now timestamptz;
  v_station_exists boolean;
  v_allowed_inputs text[];
  v_allowed_progress text[];
  v_integer_fields text[];
  v_field text;
  v_inputs jsonb;
  v_progress jsonb;
  v_rate numeric;
  v_target numeric;
  v_current numeric;
  v_last timestamptz;
  v_active_seconds numeric;
  v_pause_ms numeric;
  v_remainder numeric;
  v_total numeric;
  v_increment numeric;
  v_elapsed_ms numeric;
  v_timer_status text;
  v_response jsonb;
  v_event_type text;
  v_revision bigint;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0
     OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_station_key IS NULL OR p_station_key NOT IN
       ('line', 'dough', 'cheese', 'pepperoni', 'sauce', 'frontline', 'packaging')
     OR p_mode IS NULL OR p_mode NOT IN
       ('manual', 'auto_track', 'timer_start', 'timer_pause', 'timer_resume', 'timer_reset')
     OR p_inputs_patch IS NULL OR jsonb_typeof(p_inputs_patch) <> 'object'
     OR p_progress_patch IS NULL OR jsonb_typeof(p_progress_patch) <> 'object'
     OR p_auto_track_field IS NULL OR length(p_auto_track_field) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid station command' USING ERRCODE = '22023';
  END IF;

  v_allowed_inputs := ARRAY['autoTrackRatePerMinute', 'timerDurationSeconds'];
  v_allowed_progress := ARRAY[]::text[];
  v_integer_fields := ARRAY['timerDurationSeconds'];
  CASE p_station_key
    WHEN 'line' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['casesPerSkid'];
      v_allowed_progress := ARRAY['casesProduced', 'casesOnLine', 'casesInFreezer'];
      v_integer_fields := v_integer_fields || ARRAY['casesPerSkid', 'casesProduced', 'casesOnLine', 'casesInFreezer'];
    WHEN 'dough' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['casesPerBatch', 'traysPerBatch'];
      v_allowed_progress := ARRAY['casesProduced', 'traysOnLine', 'batchesReady', 'batchesMade'];
      v_integer_fields := v_integer_fields || ARRAY['traysPerBatch', 'casesProduced', 'traysOnLine', 'batchesReady', 'batchesMade'];
    WHEN 'cheese' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'batchLbs'];
      v_allowed_progress := ARRAY['casesCompleted', 'batchesMade', 'stockOnLineLbs'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'casesCompleted', 'batchesMade'];
    WHEN 'pepperoni' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'batchLbs'];
      v_allowed_progress := ARRAY['casesCompleted', 'batchesMade', 'stockOnLineLbs'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'casesCompleted', 'batchesMade'];
    WHEN 'sauce' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'barrelLbs'];
      v_allowed_progress := ARRAY['barrelsMade', 'stockBarrels'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'barrelsMade'];
    WHEN 'frontline' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['pizzasPerCase', 'ozPerPizza', 'batchLbs'];
      v_allowed_progress := ARRAY['batchesMade', 'stockOnLineLbs', 'stockConsumedLbs'];
      v_integer_fields := v_integer_fields || ARRAY['pizzasPerCase', 'batchesMade'];
    WHEN 'packaging' THEN
      v_allowed_inputs := v_allowed_inputs || ARRAY['casesPerSkid'];
      v_allowed_progress := ARRAY['casesPacked'];
      v_integer_fields := v_integer_fields || ARRAY['casesPerSkid', 'casesPacked'];
  END CASE;

  IF p_auto_track_field <> (CASE p_station_key
    WHEN 'line' THEN 'casesProduced'
    WHEN 'dough' THEN 'casesProduced'
    WHEN 'cheese' THEN 'casesCompleted'
    WHEN 'pepperoni' THEN 'casesCompleted'
    WHEN 'sauce' THEN 'barrelsMade'
    WHEN 'frontline' THEN 'batchesMade'
    WHEN 'packaging' THEN 'casesPacked'
  END) THEN
    RAISE EXCEPTION 'Invalid station auto-track field' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_inputs_patch) AS key
    WHERE NOT key = ANY(v_allowed_inputs)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_progress_patch) AS key
    WHERE NOT key = ANY(v_allowed_progress)
  ) THEN
    RAISE EXCEPTION 'Unsupported station value' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_inputs_patch) AS item(key, value)
    WHERE jsonb_typeof(value) <> 'number' OR (value #>> '{}')::numeric < 0
      OR (value #>> '{}')::numeric > 1000000
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each(p_progress_patch) AS item(key, value)
    WHERE jsonb_typeof(value) <> 'number' OR (value #>> '{}')::numeric < 0
      OR (value #>> '{}')::numeric > 1000000
  ) THEN
    RAISE EXCEPTION 'Station values must be finite non-negative numbers' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_inputs_patch) AS item(key, value)
    WHERE key = ANY(v_integer_fields) AND (value #>> '{}')::numeric <> TRUNC((value #>> '{}')::numeric)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_each(p_progress_patch) AS item(key, value)
    WHERE key = ANY(v_integer_fields) AND (value #>> '{}')::numeric <> TRUNC((value #>> '{}')::numeric)
  ) THEN
    RAISE EXCEPTION 'Station case and batch counts must be whole numbers' USING ERRCODE = '22023';
  END IF;

  IF p_mode <> 'manual' AND (p_inputs_patch <> '{}'::jsonb OR p_progress_patch <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Non-manual station commands cannot include client values' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'manual' AND p_inputs_patch = '{}'::jsonb AND p_progress_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Station edits must contain at least one value' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response
    INTO v_existing_hash, v_existing_response
    FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Station command ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_run FROM v3.runs
    WHERE facility_id = p_facility_id AND id = p_run_id FOR UPDATE;
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
  IF v_run.status = 'completed' THEN
    RETURN jsonb_build_object(
      'outcome', 'invalid_transition',
      'currentRun', v3.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;

  SELECT * INTO v_station FROM v3.run_station_progress
    WHERE facility_id = p_facility_id AND run_id = p_run_id AND station_key = p_station_key
    FOR UPDATE;
  v_station_exists := FOUND;
  IF NOT v_station_exists THEN
    v_station.inputs := '{}'::jsonb;
    v_station.progress := '{}'::jsonb;
    v_station.status := 'not_started';
    v_station.revision := 0;
    v_station.started_at := NULL;
    v_station.paused_at := NULL;
    v_station.completed_at := NULL;
    v_station.next_due_at := NULL;
  END IF;

  v_now := clock_timestamp();
  v_inputs := v_station.inputs || p_inputs_patch;
  v_progress := v_station.progress || p_progress_patch;

  IF p_mode = 'manual' THEN
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    IF v_rate > 600 THEN
      RAISE EXCEPTION 'Automatic tracking rate is out of range' USING ERRCODE = '22023';
    END IF;
    IF p_progress_patch ? p_auto_track_field OR p_inputs_patch ? 'autoTrackRatePerMinute' THEN
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
    END IF;
    IF p_inputs_patch ? 'autoTrackRatePerMinute' THEN
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
    END IF;
  ELSIF p_mode = 'auto_track' THEN
    IF v_run.status <> 'running' AND NOT (
      v_run.status = 'paused' AND p_station_key IN ('line', 'packaging')
      AND EXISTS (
        SELECT 1 FROM v3.run_pause_intervals AS open_pause
        WHERE open_pause.facility_id = p_facility_id AND open_pause.run_id = p_run_id
          AND open_pause.resumed_at IS NULL AND open_pause.stop_tunnel = false
      )
    ) THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    IF v_rate <= 0 THEN
      RETURN jsonb_build_object('outcome', 'not_enabled',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;

    v_last := NULLIF(v_progress->>'autoTrackLastAt', '')::timestamptz;
    IF v_last IS NULL THEN
      v_last := v_now;
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
      RETURN jsonb_build_object('outcome', 'not_due',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    SELECT COALESCE(SUM(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (LEAST(COALESCE(p.resumed_at, v_now), v_now)
          - GREATEST(p.paused_at, v_last))) * 1000
      )
    ), 0)
      INTO v_pause_ms
      FROM v3.run_pause_intervals AS p
      WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
        AND p.paused_at < v_now AND COALESCE(p.resumed_at, v_now) > v_last
        AND (p.stop_tunnel OR p_station_key NOT IN ('line', 'packaging'));
    v_active_seconds := GREATEST(
      0,
      EXTRACT(EPOCH FROM (v_now - v_last)) - (v_pause_ms / 1000)
    );
    v_remainder := COALESCE((v_progress->>'autoTrackRemainder')::numeric, 0);
    v_total := v_remainder + (v_active_seconds * v_rate / 60);
    v_increment := FLOOR(v_total);
    IF v_increment < 1 THEN
      RETURN jsonb_build_object('outcome', 'not_due',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_target := CASE p_station_key
      WHEN 'sauce' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'barrelLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 30)
          / (v_inputs->>'barrelLbs')::numeric)
        ELSE 0 END
      WHEN 'frontline' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'batchLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 20)
          / (v_inputs->>'batchLbs')::numeric)
        ELSE 0 END
      ELSE COALESCE((v_run.setup_snapshot->>'targetCases')::numeric, 0)
    END;
    v_current := COALESCE((v_progress->>p_auto_track_field)::numeric, 0);
    v_increment := LEAST(v_increment, GREATEST(0, v_target - v_current));
    IF v_increment < 1 THEN
      v_progress := v_progress || jsonb_build_object(
        'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'autoTrackRemainder', 0
      );
      RETURN jsonb_build_object('outcome', 'not_due',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_progress := v_progress || jsonb_build_object(
      p_auto_track_field, v_current + v_increment,
      'autoTrackLastAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'autoTrackRemainder', CASE WHEN v_current + v_increment >= v_target THEN 0
        ELSE v_total - FLOOR(v_total) END
    );
  ELSIF p_mode IN ('timer_start', 'timer_resume') THEN
    IF v_run.status <> 'running' THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    IF COALESCE((v_inputs->>'timerDurationSeconds')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Set a timer duration before starting this station timer'
        USING ERRCODE = '22023';
    END IF;
    IF p_mode = 'timer_start' AND COALESCE(v_progress->>'timerStatus', 'idle') IN ('running', 'paused') THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    IF p_mode = 'timer_resume' AND v_progress->>'timerStatus' <> 'paused' THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_progress := v_progress || jsonb_build_object(
      'timerStatus', 'running',
      'timerStartedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timerPausedAt', NULL,
      'timerElapsedMs', CASE WHEN p_mode = 'timer_start' THEN 0
        ELSE COALESCE((v_progress->>'timerElapsedMs')::numeric, 0) END
    );
    v_station.status := 'running';
    v_station.started_at := COALESCE(v_station.started_at, v_now);
    v_station.paused_at := NULL;
  ELSIF p_mode = 'timer_pause' THEN
    IF v_progress->>'timerStatus' <> 'running' THEN
      RETURN jsonb_build_object('outcome', 'invalid_transition',
        'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
    END IF;
    v_last := NULLIF(v_progress->>'timerStartedAt', '')::timestamptz;
    IF v_last IS NULL THEN
      RAISE EXCEPTION 'Station timer start is missing' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (LEAST(COALESCE(p.resumed_at, v_now), v_now)
          - GREATEST(p.paused_at, v_last))) * 1000
      )
    ), 0)
      INTO v_pause_ms
      FROM v3.run_pause_intervals AS p
      WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
        AND p.paused_at < v_now AND COALESCE(p.resumed_at, v_now) > v_last;
    v_elapsed_ms := GREATEST(
      0,
      EXTRACT(EPOCH FROM (v_now - v_last)) * 1000 - v_pause_ms
    );
    v_progress := v_progress || jsonb_build_object(
      'timerStatus', 'paused',
      'timerStartedAt', NULL,
      'timerPausedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timerElapsedMs', COALESCE((v_progress->>'timerElapsedMs')::numeric, 0) + v_elapsed_ms
    );
    v_station.status := 'paused';
    v_station.paused_at := v_now;
  ELSIF p_mode = 'timer_reset' THEN
    v_progress := v_progress || jsonb_build_object(
      'timerStatus', 'idle',
      'timerStartedAt', NULL,
      'timerPausedAt', NULL,
      'timerElapsedMs', 0
    );
    v_station.status := 'not_started';
    v_station.started_at := NULL;
    v_station.paused_at := NULL;
    v_station.completed_at := NULL;
  END IF;

  IF p_mode = 'manual'
     AND (p_inputs_patch ? 'autoTrackRatePerMinute' OR p_progress_patch ? p_auto_track_field) THEN
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    v_target := CASE p_station_key
      WHEN 'sauce' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'barrelLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 30)
          / (v_inputs->>'barrelLbs')::numeric)
        ELSE 0 END
      WHEN 'frontline' THEN CASE
        WHEN COALESCE((v_inputs->>'pizzasPerCase')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'ozPerPizza')::numeric, 0) > 0
          AND COALESCE((v_inputs->>'batchLbs')::numeric, 0) > 0
        THEN CEIL(((v_run.setup_snapshot->>'targetCases')::numeric
          * (v_inputs->>'pizzasPerCase')::numeric * (v_inputs->>'ozPerPizza')::numeric / 16 + 20)
          / (v_inputs->>'batchLbs')::numeric)
        ELSE 0 END
      ELSE COALESCE((v_run.setup_snapshot->>'targetCases')::numeric, 0)
    END;
    v_current := COALESCE((v_progress->>p_auto_track_field)::numeric, 0);
    IF v_rate > 0 AND v_current < v_target THEN
      v_station.next_due_at := v_now + make_interval(secs => GREATEST(60.0 / v_rate, 3.0));
    ELSE
      v_station.next_due_at := NULL;
    END IF;
  ELSIF p_mode = 'auto_track' THEN
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    v_current := COALESCE((v_progress->>p_auto_track_field)::numeric, 0);
    v_station.next_due_at := CASE WHEN v_current >= v_target THEN NULL
      ELSE v_now + make_interval(secs => GREATEST(60.0 / v_rate, 3.0)) END;
  END IF;

  IF v_station_exists THEN
    UPDATE v3.run_station_progress
      SET status = v_station.status,
          revision = revision + 1,
          inputs = v_inputs,
          progress = v_progress,
          started_at = v_station.started_at,
          paused_at = v_station.paused_at,
          completed_at = v_station.completed_at,
          next_due_at = v_station.next_due_at,
          updated_at = v_now
      WHERE facility_id = p_facility_id AND run_id = p_run_id AND station_key = p_station_key
      RETURNING * INTO v_station;
  ELSE
    INSERT INTO v3.run_station_progress (
      facility_id, run_id, station_key, status, revision, inputs, progress,
      started_at, paused_at, completed_at, next_due_at, updated_at
    ) VALUES (
      p_facility_id, p_run_id, p_station_key, v_station.status, 1, v_inputs, v_progress,
      v_station.started_at, v_station.paused_at, v_station.completed_at, v_station.next_due_at, v_now
    ) RETURNING * INTO v_station;
  END IF;

  UPDATE v3.runs
    SET revision = revision + 1, updated_at = v_now
    WHERE facility_id = p_facility_id AND id = p_run_id
    RETURNING revision INTO v_revision;

  v_event_type := CASE p_mode
    WHEN 'auto_track' THEN 'station.auto_tracked'
    WHEN 'timer_start' THEN 'station.timer_started'
    WHEN 'timer_pause' THEN 'station.timer_paused'
    WHEN 'timer_resume' THEN 'station.timer_resumed'
    WHEN 'timer_reset' THEN 'station.timer_reset'
    ELSE 'station.updated'
  END;
  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'commandId', p_command_id,
    'stationKey', p_station_key,
    'run', v3.run_snapshot(p_facility_id, p_run_id)
  );
  INSERT INTO v3.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (p_facility_id, p_run_id, v_revision, p_actor_id, v_event_type, v_now, v_response);
  INSERT INTO v3.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (gen_random_uuid(), p_facility_id, p_run_id, v_revision, v_event_type, v_response, v_now);
  INSERT INTO v3.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;
REVOKE ALL ON FUNCTION v3.default_stop_reasons() FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_stop_reason_settings(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.save_stop_reason_settings(uuid, uuid, text, text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_run_operation_command(uuid, uuid, uuid, text, text, text, jsonb, bigint) FROM PUBLIC;


-- Versioned list variants: the API role has no direct table access, so the
-- outbox-position read must run inside a security definer function. One round
-- trip returns the version and the payload from the same snapshot.
CREATE FUNCTION v3.run_list_version(p_facility_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT COALESCE((SELECT MAX(sequence) FROM v3.outbox_events WHERE facility_id = p_facility_id), 0);
$$;

CREATE FUNCTION v3.list_runs_with_version(p_facility_id uuid, p_limit integer)
RETURNS TABLE(version bigint, result jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT
    COALESCE((SELECT MAX(sequence) FROM v3.outbox_events WHERE facility_id = p_facility_id), 0) AS version,
    v3.list_runs(p_facility_id, p_limit) AS result;
$$;

CREATE FUNCTION v3.list_active_runs_with_version(p_facility_id uuid, p_limit integer)
RETURNS TABLE(version bigint, result jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT
    COALESCE((SELECT MAX(sequence) FROM v3.outbox_events WHERE facility_id = p_facility_id), 0) AS version,
    v3.list_active_runs(p_facility_id, p_limit) AS result;
$$;



REVOKE ALL ON FUNCTION v3.list_active_runs(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.run_list_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_runs_with_version(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_active_runs_with_version(uuid, integer) FROM PUBLIC;

COMMENT ON FUNCTION v3.list_active_runs(uuid, integer)
  IS 'Facility-scoped active run list (excludes completed runs) for fast floor-tablet sync; same canonical snapshot shape as v3.list_runs.';
COMMENT ON FUNCTION v3.run_list_version(uuid)
  IS 'Returns the facility outbox position for conditional GET sync; security definer because the API role has no direct table access.';
COMMENT ON FUNCTION v3.list_runs_with_version(uuid, integer)
  IS 'Versioned run list for conditional GET sync: returns the outbox position and payload in one security-definer round trip.';
COMMENT ON FUNCTION v3.list_active_runs_with_version(uuid, integer)
  IS 'Versioned active-only run list for conditional GET sync; same snapshot semantics as v3.list_active_runs.';
COMMENT ON FUNCTION v3.apply_station_command(uuid, uuid, uuid, text, text, bigint, text, text, jsonb, jsonb, text)
  IS 'Debounced auto-track scheduling: station writes occur at most every three seconds because progress derives from wall-clock elapsed time.';

COMMIT;
