BEGIN;

ALTER TABLE v3.runs
  ADD COLUMN operational_notes text NOT NULL DEFAULT '' CHECK (length(operational_notes) <= 4000);

ALTER TABLE v3.run_pause_intervals
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  ADD COLUMN notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  ADD COLUMN stop_tunnel boolean NOT NULL DEFAULT true;

ALTER TABLE v3.run_pause_intervals
  ADD CONSTRAINT run_pause_intervals_facility_run_id_unique UNIQUE (facility_id, run_id, id);

CREATE TABLE v3.run_stoppages (
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('stop', 'manual')),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, run_id, id),
  FOREIGN KEY (facility_id, run_id) REFERENCES v3.runs (facility_id, id) ON DELETE RESTRICT,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (updated_at >= created_at),
  CHECK (voided_at IS NULL OR voided_at >= created_at)
);

CREATE UNIQUE INDEX run_stoppages_one_open_per_run
  ON v3.run_stoppages (facility_id, run_id)
  WHERE ended_at IS NULL AND voided_at IS NULL;
CREATE INDEX run_stoppages_visible_history
  ON v3.run_stoppages (facility_id, run_id, started_at, id)
  WHERE voided_at IS NULL;

CREATE TABLE v3.facility_stop_reason_settings (
  facility_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  updated_at timestamptz NOT NULL
);

CREATE TABLE v3.facility_operation_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  facility_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  actor_id uuid NOT NULL,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE FUNCTION v3.default_stop_reasons()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT jsonb_build_array(
    'Equipment jam', 'Changeover', 'Break', 'Maintenance',
    'Quality hold', 'Staffing', 'Waiting on dough'
  )
$$;

CREATE FUNCTION v3.get_stop_reason_settings(p_facility_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT CASE WHEN s.facility_id IS NULL THEN jsonb_build_object(
    'revision', 0,
    'reasons', v3.default_stop_reasons(),
    'updatedAt', NULL
  ) ELSE jsonb_build_object(
    'revision', s.revision,
    'reasons', s.reasons,
    'updatedAt', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) END
  FROM (SELECT p_facility_id AS facility_id) AS scope
  LEFT JOIN v3.facility_stop_reason_settings AS s ON s.facility_id = scope.facility_id
  WHERE p_facility_id IS NOT NULL
$$;

CREATE FUNCTION v3.save_stop_reason_settings(
  p_facility_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_reasons jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_existing_response jsonb;
  v_settings v3.facility_stop_reason_settings%ROWTYPE;
  v_now timestamptz;
  v_response jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0 OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_reasons IS NULL OR jsonb_typeof(p_reasons) <> 'array'
     OR jsonb_array_length(p_reasons) NOT BETWEEN 1 AND 30
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(p_reasons) AS item(value)
       WHERE length(btrim(value)) NOT BETWEEN 1 AND 80
     )
     OR (SELECT count(DISTINCT lower(btrim(value))) FROM jsonb_array_elements_text(p_reasons) AS item(value))
        <> jsonb_array_length(p_reasons) THEN
    RAISE EXCEPTION 'Invalid stop reason settings' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_existing_response
    FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was reused with a different request' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':stop-reasons', 0));
  SELECT * INTO v_settings FROM v3.facility_stop_reason_settings
    WHERE facility_id = p_facility_id FOR UPDATE;
  IF COALESCE(v_settings.revision, 0) <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'expectedRevision', p_expected_revision,
      'currentSettings', v3.get_stop_reason_settings(p_facility_id)
    );
  END IF;
  IF p_expected_revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Stop reason revision is exhausted' USING ERRCODE = '22003';
  END IF;

  v_now := clock_timestamp();
  INSERT INTO v3.facility_stop_reason_settings (facility_id, revision, reasons, updated_at)
    VALUES (p_facility_id, 1, p_reasons, v_now)
  ON CONFLICT (facility_id) DO UPDATE
    SET revision = v3.facility_stop_reason_settings.revision + 1,
        reasons = EXCLUDED.reasons,
        updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_settings;

  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'commandId', p_command_id,
    'settings', v3.get_stop_reason_settings(p_facility_id)
  );
  INSERT INTO v3.facility_operation_events (
    facility_id, revision, actor_id, event_type, payload, occurred_at
  ) VALUES (
    p_facility_id, v_settings.revision, p_actor_id,
    'facility.stop_reasons_updated', v_response, v_now
  );
  INSERT INTO v3.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.apply_run_operation_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_operation text,
  p_details jsonb,
  p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_run v3.runs%ROWTYPE;
  v_pause v3.run_pause_intervals%ROWTYPE;
  v_stoppage v3.run_stoppages%ROWTYPE;
  v_existing_hash text;
  v_existing_response jsonb;
  v_now timestamptz;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_rows integer;
  v_response jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0 OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_operation IS NULL OR p_operation NOT IN (
       'start_stop', 'end_stop', 'add_past_stop', 'update_stoppage',
       'delete_stoppage', 'set_notes', 'set_pause_tunnel'
     )
     OR p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid run operation command' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_existing_response
    FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was reused with a different request' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_run FROM v3.runs
    WHERE facility_id = p_facility_id AND id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run not found' USING ERRCODE = 'P0002'; END IF;
  IF v_run.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict', 'expectedRevision', p_expected_revision,
      'currentRun', v3.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;
  IF v_run.status = 'completed' THEN
    RETURN jsonb_build_object(
      'outcome', 'invalid_transition', 'currentStatus', v_run.status,
      'currentRun', v3.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;
  IF v_run.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Run revision is exhausted' USING ERRCODE = '22003';
  END IF;
  v_now := clock_timestamp();
  IF v_now < v_run.updated_at THEN
    RAISE EXCEPTION 'Database clock precedes the current run state' USING ERRCODE = '22008';
  END IF;

  CASE p_operation
    WHEN 'start_stop' THEN
      IF v_run.status <> 'running'
         OR (p_details - ARRAY['reason', 'notes']) <> '{}'::jsonb
         OR length(btrim(p_details->>'reason')) > 200 OR length(p_details->>'notes') > 2000 THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status,
          'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
      END IF;
      INSERT INTO v3.run_stoppages (
        facility_id, run_id, id, type, reason, notes, started_at, created_at, updated_at
      ) VALUES (
        p_facility_id, p_run_id, gen_random_uuid(), 'stop',
        COALESCE(p_details->>'reason', ''), COALESCE(p_details->>'notes', ''), v_now, v_now, v_now
      );

    WHEN 'end_stop' THEN
      IF (p_details - ARRAY['stoppageId']) <> '{}'::jsonb
         OR v_run.status NOT IN ('running', 'paused') THEN
        RAISE EXCEPTION 'Invalid stop completion details' USING ERRCODE = '22023';
      END IF;
      UPDATE v3.run_stoppages SET ended_at = v_now, updated_at = v_now
        WHERE facility_id = p_facility_id AND run_id = p_run_id
          AND id = (p_details->>'stoppageId')::uuid
          AND ended_at IS NULL AND voided_at IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status,
          'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
      END IF;

    WHEN 'add_past_stop' THEN
      IF v_run.status NOT IN ('running', 'paused') OR v_run.started_at IS NULL
         OR (p_details - ARRAY['reason', 'notes', 'startedAt', 'endedAt']) <> '{}'::jsonb
         OR p_details->>'startedAt' IS NULL OR p_details->>'endedAt' IS NULL
         OR length(btrim(p_details->>'reason')) > 200 OR length(p_details->>'notes') > 2000 THEN
        RAISE EXCEPTION 'Invalid past stoppage details' USING ERRCODE = '22023';
      END IF;
      v_started_at := (p_details->>'startedAt')::timestamptz;
      v_ended_at := (p_details->>'endedAt')::timestamptz;
      IF v_started_at < v_run.started_at OR v_started_at > v_now
         OR v_ended_at < v_started_at OR v_ended_at > v_now THEN
        RAISE EXCEPTION 'Past stoppage times are outside the active run' USING ERRCODE = '22023';
      END IF;
      INSERT INTO v3.run_stoppages (
        facility_id, run_id, id, type, reason, notes, started_at, ended_at, created_at, updated_at
      ) VALUES (
        p_facility_id, p_run_id, gen_random_uuid(), 'manual',
        COALESCE(p_details->>'reason', ''), COALESCE(p_details->>'notes', ''),
        v_started_at, v_ended_at, v_now, v_now
      );

    WHEN 'update_stoppage' THEN
      IF (p_details - ARRAY['stoppageId', 'reason', 'notes', 'startedAt', 'endedAt']) <> '{}'::jsonb
         OR p_details->>'stoppageId' IS NULL
         OR length(btrim(p_details->>'reason')) > 200 OR length(p_details->>'notes') > 2000 THEN
        RAISE EXCEPTION 'Invalid stoppage edit' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_pause FROM v3.run_pause_intervals
        WHERE facility_id = p_facility_id AND run_id = p_run_id
          AND id = (p_details->>'stoppageId')::uuid;
      IF FOUND THEN
        IF p_details ? 'startedAt' OR p_details ? 'endedAt' THEN
          RAISE EXCEPTION 'Lifecycle pause times are server-owned' USING ERRCODE = '22023';
        END IF;
        UPDATE v3.run_pause_intervals
          SET reason = COALESCE(p_details->>'reason', ''), notes = COALESCE(p_details->>'notes', '')
          WHERE facility_id = p_facility_id AND run_id = p_run_id AND id = v_pause.id;
      ELSE
        IF NOT (p_details ? 'startedAt') OR NOT (p_details ? 'endedAt')
           OR p_details->>'startedAt' IS NULL OR p_details->>'endedAt' IS NULL THEN
          RAISE EXCEPTION 'Manual stoppage edits require confirmed times' USING ERRCODE = '22023';
        END IF;
        v_started_at := (p_details->>'startedAt')::timestamptz;
        v_ended_at := (p_details->>'endedAt')::timestamptz;
        IF v_run.started_at IS NULL OR v_started_at < v_run.started_at OR v_started_at > v_now
           OR v_ended_at < v_started_at OR v_ended_at > v_now THEN
          RAISE EXCEPTION 'Stoppage times are outside the active run' USING ERRCODE = '22023';
        END IF;
        UPDATE v3.run_stoppages
          SET reason = COALESCE(p_details->>'reason', ''), notes = COALESCE(p_details->>'notes', ''),
              started_at = v_started_at, ended_at = v_ended_at, updated_at = v_now
          WHERE facility_id = p_facility_id AND run_id = p_run_id
            AND id = (p_details->>'stoppageId')::uuid AND voided_at IS NULL;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status,
            'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
        END IF;
      END IF;

    WHEN 'delete_stoppage' THEN
      IF (p_details - ARRAY['stoppageId']) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Invalid stoppage deletion' USING ERRCODE = '22023';
      END IF;
      UPDATE v3.run_stoppages SET voided_at = v_now, ended_at = COALESCE(ended_at, v_now), updated_at = v_now
        WHERE facility_id = p_facility_id AND run_id = p_run_id
          AND id = (p_details->>'stoppageId')::uuid AND voided_at IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status,
          'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
      END IF;

    WHEN 'set_notes' THEN
      IF (p_details - ARRAY['operationalNotes']) <> '{}'::jsonb
         OR jsonb_typeof(p_details->'operationalNotes') IS DISTINCT FROM 'string'
         OR length(p_details->>'operationalNotes') > 4000 THEN
        RAISE EXCEPTION 'Invalid operational notes' USING ERRCODE = '22023';
      END IF;
      UPDATE v3.runs SET operational_notes = p_details->>'operationalNotes'
        WHERE facility_id = p_facility_id AND id = p_run_id;

    WHEN 'set_pause_tunnel' THEN
      IF v_run.status <> 'paused'
         OR (p_details - ARRAY['stoppageId', 'stopTunnel']) <> '{}'::jsonb
         OR jsonb_typeof(p_details->'stopTunnel') IS DISTINCT FROM 'boolean'
         OR (p_details->>'stopTunnel')::boolean <> false THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status,
          'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
      END IF;
      UPDATE v3.run_pause_intervals SET stop_tunnel = false
        WHERE facility_id = p_facility_id AND run_id = p_run_id
          AND id = (p_details->>'stoppageId')::uuid
          AND resumed_at IS NULL AND v_now <= paused_at + interval '10 seconds';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status,
          'currentRun', v3.run_snapshot(p_facility_id, p_run_id));
      END IF;
  END CASE;

  UPDATE v3.runs SET revision = revision + 1, updated_at = v_now
    WHERE facility_id = p_facility_id AND id = p_run_id
    RETURNING * INTO v_run;
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'commandId', p_command_id,
    'operation', p_operation, 'run', v3.run_snapshot(p_facility_id, p_run_id)
  );
  INSERT INTO v3.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, p_run_id, v_run.revision, p_actor_id,
    'run.operation.' || p_operation, v_now, v_response
  );
  INSERT INTO v3.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, p_run_id, v_run.revision,
    'run.operation.' || p_operation, v_response, v_now
  );
  INSERT INTO v3.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION v3.apply_run_lifecycle_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_command_type text,
  p_expected_revision bigint
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
  v_next_revision bigint;
  v_event_type text;
  v_response jsonb;
  v_pause_number integer;
  v_open_pause_count integer;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0
     OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_command_type IS NULL OR p_command_type NOT IN ('start', 'pause', 'resume', 'complete')
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid run command'
      USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Run not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_run.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'expectedRevision', p_expected_revision,
      'currentRun', v3.run_snapshot(p_facility_id, p_run_id)
    );
  END IF;

  IF v_run.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Run revision is exhausted'
      USING ERRCODE = '22003';
  END IF;

  v_now := clock_timestamp();
  IF v_now < v_run.updated_at THEN
    RAISE EXCEPTION 'Database clock precedes the current run state'
      USING ERRCODE = '22008';
  END IF;

  CASE p_command_type
    WHEN 'start' THEN
      IF v_run.status <> 'planned' THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      UPDATE v3.runs
        SET status = 'running', started_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;

    WHEN 'pause' THEN
      IF v_run.status <> 'running' THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      SELECT COALESCE(MAX(pause_number), 0) + 1
        INTO v_pause_number
        FROM v3.run_pause_intervals
        WHERE facility_id = p_facility_id AND run_id = p_run_id;
      INSERT INTO v3.run_pause_intervals (
        facility_id, run_id, pause_number, paused_at
      ) VALUES (p_facility_id, p_run_id, v_pause_number, v_now);
      UPDATE v3.runs
        SET status = 'paused', paused_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;

    WHEN 'resume' THEN
      IF v_run.status <> 'paused' THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      UPDATE v3.run_pause_intervals
        SET resumed_at = v_now
        WHERE facility_id = p_facility_id
          AND run_id = p_run_id
          AND resumed_at IS NULL;
      GET DIAGNOSTICS v_open_pause_count = ROW_COUNT;
      IF v_open_pause_count <> 1 THEN
        RAISE EXCEPTION 'Paused run does not have exactly one open pause interval'
          USING ERRCODE = '23514';
      END IF;
      UPDATE v3.runs
        SET status = 'running', paused_at = NULL, resumed_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;

    WHEN 'complete' THEN
      IF v_run.status NOT IN ('running', 'paused') THEN
        RETURN jsonb_build_object('outcome', 'invalid_transition', 'currentStatus', v_run.status);
      END IF;
      IF v_run.status = 'paused' THEN
        UPDATE v3.run_pause_intervals
          SET resumed_at = v_now
          WHERE facility_id = p_facility_id
            AND run_id = p_run_id
            AND resumed_at IS NULL;
        GET DIAGNOSTICS v_open_pause_count = ROW_COUNT;
        IF v_open_pause_count <> 1 THEN
          RAISE EXCEPTION 'Paused run does not have exactly one open pause interval'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      UPDATE v3.run_stoppages
        SET ended_at = v_now, updated_at = v_now
        WHERE facility_id = p_facility_id AND run_id = p_run_id
          AND ended_at IS NULL AND voided_at IS NULL;
      UPDATE v3.runs
        SET status = 'completed', paused_at = NULL, completed_at = v_now,
            updated_at = v_now, revision = revision + 1
        WHERE facility_id = p_facility_id AND id = p_run_id
        RETURNING * INTO v_run;
  END CASE;

  v_next_revision := v_run.revision;
  v_event_type := 'run.' || CASE p_command_type
    WHEN 'start' THEN 'started'
    WHEN 'pause' THEN 'paused'
    WHEN 'resume' THEN 'resumed'
    WHEN 'complete' THEN 'completed'
  END;

  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'commandId', p_command_id,
    'run', v3.run_snapshot(p_facility_id, p_run_id)
  );

  INSERT INTO v3.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, p_run_id, v_next_revision, p_actor_id, v_event_type, v_now, v_response
  );

  INSERT INTO v3.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, p_run_id, v_next_revision,
    v_event_type, v_response, v_now
  );

  INSERT INTO v3.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now
  );

  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION v3.run_snapshot_without_rules(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'revision', r.revision,
    'createdAt', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'serverNow', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startedAt', CASE WHEN r.started_at IS NULL THEN NULL
      ELSE to_char(r.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'pausedAt', CASE WHEN r.paused_at IS NULL THEN NULL
      ELSE to_char(r.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'resumedAt', CASE WHEN r.resumed_at IS NULL THEN NULL
      ELSE to_char(r.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'completedAt', CASE WHEN r.completed_at IS NULL THEN NULL
      ELSE to_char(r.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'runToTime', to_char(r.run_to_time, 'HH24:MI'),
    'operationalNotes', r.operational_notes,
    'setupSnapshot', r.setup_snapshot,
    'stoppages', COALESCE((
      SELECT jsonb_agg(stoppage.value ORDER BY stoppage.value->>'startedAt', stoppage.value->>'id')
      FROM (
        SELECT jsonb_build_object(
          'id', p.id, 'type', 'pause', 'reason', p.reason, 'notes', p.notes,
          'startedAt', to_char(p.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endedAt', CASE WHEN p.resumed_at IS NULL THEN NULL
            ELSE to_char(p.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'stopTunnel', p.stop_tunnel
        ) AS value
        FROM v3.run_pause_intervals AS p
        WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
        UNION ALL
        SELECT jsonb_build_object(
          'id', s.id, 'type', s.type, 'reason', s.reason, 'notes', s.notes,
          'startedAt', to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endedAt', CASE WHEN s.ended_at IS NULL THEN NULL
            ELSE to_char(s.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
        ) AS value
        FROM v3.run_stoppages AS s
        WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id AND s.voided_at IS NULL
      ) AS stoppage
    ), '[]'::jsonb),
    'doughCapacity', v3.dough_capacity_snapshot(p_facility_id, r.setup_snapshot->>'productCode'),
    'inventoryConsumption', (
      SELECT c.details FROM v3.run_inventory_consumptions AS c
      WHERE c.facility_id = p_facility_id AND c.run_id = p_run_id
    ),
    'pauseIntervals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'startedAt', to_char(p.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endedAt', CASE WHEN p.resumed_at IS NULL THEN NULL
          ELSE to_char(p.resumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
      ) ORDER BY p.pause_number)
      FROM v3.run_pause_intervals AS p
      WHERE p.facility_id = p_facility_id AND p.run_id = p_run_id
    ), '[]'::jsonb),
    'stationProgress', COALESCE((
      SELECT jsonb_object_agg(
        s.station_key,
        jsonb_build_object(
          'status', s.status,
          'revision', s.revision,
          'inputs', s.inputs,
          'progress', s.progress,
          'startedAt', CASE WHEN s.started_at IS NULL THEN NULL
            ELSE to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'pausedAt', CASE WHEN s.paused_at IS NULL THEN NULL
            ELSE to_char(s.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'completedAt', CASE WHEN s.completed_at IS NULL THEN NULL
            ELSE to_char(s.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'nextDueAt', CASE WHEN s.next_due_at IS NULL THEN NULL
            ELSE to_char(s.next_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'updatedAt', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) ORDER BY s.station_key
      )
      FROM v3.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ), '{}'::jsonb)
  )
  FROM v3.runs AS r
  WHERE r.facility_id = p_facility_id AND r.id = p_run_id
$$;

CREATE OR REPLACE FUNCTION v3.list_due_station_auto_track(p_limit integer)
RETURNS TABLE (
  facility_id uuid,
  run_id uuid,
  expected_revision bigint,
  station_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid station worker batch size' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    SELECT r.facility_id, r.id, r.revision, s.station_key
    FROM v3.runs AS r
    JOIN v3.run_station_progress AS s
      ON s.facility_id = r.facility_id AND s.run_id = r.id
    WHERE (
        r.status = 'running'
        OR (
          r.status = 'paused' AND s.station_key IN ('line', 'packaging')
          AND EXISTS (
            SELECT 1 FROM v3.run_pause_intervals AS open_pause
            WHERE open_pause.facility_id = r.facility_id AND open_pause.run_id = r.id
              AND open_pause.resumed_at IS NULL AND open_pause.stop_tunnel = false
          )
        )
      )
      AND s.next_due_at IS NOT NULL
      AND s.next_due_at <= clock_timestamp()
      AND COALESCE((s.inputs->>'autoTrackRatePerMinute')::numeric, 0) > 0
    ORDER BY s.next_due_at, r.facility_id, r.id, s.station_key
    LIMIT p_limit;
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
      v_station.next_due_at := v_now + make_interval(secs => 60.0 / v_rate);
    ELSE
      v_station.next_due_at := NULL;
    END IF;
  ELSIF p_mode = 'auto_track' THEN
    v_rate := COALESCE((v_inputs->>'autoTrackRatePerMinute')::numeric, 0);
    v_current := COALESCE((v_progress->>p_auto_track_field)::numeric, 0);
    v_station.next_due_at := CASE WHEN v_current >= v_target THEN NULL
      ELSE v_now + make_interval(secs => 60.0 / v_rate) END;
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

COMMENT ON FUNCTION v3.apply_run_operation_command(uuid, uuid, uuid, text, text, text, jsonb, bigint)
  IS 'Backend-only transactional stoppage, operational-note, and pause tunnel-policy command boundary with exact receipt replay, revision fencing, events, and outbox.';
COMMENT ON FUNCTION v3.save_stop_reason_settings(uuid, uuid, text, text, bigint, jsonb)
  IS 'Manager-authorized facility stop-reason catalog command with exact receipt replay, expected-revision fencing, and append-only operational audit events.';

COMMIT;
