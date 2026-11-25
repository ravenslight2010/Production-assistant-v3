-- Append-only QC evidence, reviewed measurement targets, receipts, audit, and outbox.
-- QC observations are advisory and never mutate run lifecycle, inventory, or schedules.

BEGIN;

CREATE TABLE v3.qc_records (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  facility_id uuid NOT NULL REFERENCES v3.facility_scope(facility_id),
  run_id uuid,
  kind text NOT NULL CHECK (kind IN ('lot', 'weight-check', 'brix-check', 'target-set')),
  actor_id uuid NOT NULL,
  related_record_id uuid,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (facility_id, run_id) REFERENCES v3.runs(facility_id, id) ON DELETE RESTRICT,
  CONSTRAINT qc_records_related_record_valid CHECK (
    related_record_id IS NULL OR related_record_id <> record_id
  )
);

CREATE INDEX qc_records_run_sequence_idx
  ON v3.qc_records(facility_id, run_id, sequence)
  WHERE run_id IS NOT NULL;

CREATE TABLE v3.qc_command_receipts (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope(facility_id),
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, actor_id, request_id)
);

CREATE TABLE v3.qc_audit_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  facility_id uuid NOT NULL REFERENCES v3.facility_scope(facility_id),
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('record-created', 'target-saved')),
  record_id uuid NOT NULL REFERENCES v3.qc_records(record_id) ON DELETE RESTRICT,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  changed_fields jsonb NOT NULL CHECK (jsonb_typeof(changed_fields) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE v3.qc_targets (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope(facility_id),
  target_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('weight', 'brix')),
  unit text NOT NULL,
  minimum numeric(20,6),
  maximum numeric(20,6),
  active boolean NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, target_key),
  CONSTRAINT qc_targets_key_valid CHECK (
    target_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ),
  CONSTRAINT qc_targets_unit_valid CHECK (
    (kind = 'weight' AND unit IN ('g', 'kg', 'oz', 'lb'))
    OR (kind = 'brix' AND unit = 'brix')
  ),
  CONSTRAINT qc_targets_bounds_valid CHECK (
    (minimum IS NOT NULL OR maximum IS NOT NULL)
    AND (minimum IS NULL OR minimum >= 0)
    AND (maximum IS NULL OR maximum >= 0)
    AND (minimum IS NULL OR maximum IS NULL OR maximum >= minimum)
    AND (kind <> 'brix' OR (minimum IS NULL OR minimum <= 100))
    AND (kind <> 'brix' OR (maximum IS NULL OR maximum <= 100))
  )
);

CREATE TABLE v3.qc_outbox_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  facility_id uuid NOT NULL REFERENCES v3.facility_scope(facility_id),
  record_id uuid NOT NULL REFERENCES v3.qc_records(record_id) ON DELETE RESTRICT,
  qc_sequence bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('qc.recorded', 'qc.target_saved')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  UNIQUE (facility_id, record_id),
  CHECK (delivered_at IS NULL OR delivered_at >= created_at)
);

CREATE INDEX qc_outbox_events_pending_sequence_idx
  ON v3.qc_outbox_events(sequence)
  WHERE delivered_at IS NULL;

CREATE TRIGGER qc_records_append_only
  BEFORE UPDATE OR DELETE ON v3.qc_records
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();
CREATE TRIGGER qc_command_receipts_append_only
  BEFORE UPDATE OR DELETE ON v3.qc_command_receipts
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();
CREATE TRIGGER qc_audit_events_append_only
  BEFORE UPDATE OR DELETE ON v3.qc_audit_events
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE FUNCTION v3.guard_qc_outbox_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'QC outbox events cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW.event_id, NEW.facility_id, NEW.record_id, NEW.qc_sequence,
         NEW.event_type, NEW.payload, NEW.created_at) IS DISTINCT FROM
     ROW(OLD.event_id, OLD.facility_id, OLD.record_id, OLD.qc_sequence,
         OLD.event_type, OLD.payload, OLD.created_at) THEN
    RAISE EXCEPTION 'QC outbox event content is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
    RAISE EXCEPTION 'QC outbox delivery cannot be reset or rewritten' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER qc_outbox_events_guard
  BEFORE UPDATE OR DELETE ON v3.qc_outbox_events
  FOR EACH ROW EXECUTE FUNCTION v3.guard_qc_outbox_event_mutation();

CREATE FUNCTION v3.qc_target_json(p_target v3.qc_targets)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'targetKey', p_target.target_key,
    'kind', p_target.kind,
    'unit', p_target.unit,
    'minimum', p_target.minimum::text,
    'maximum', p_target.maximum::text,
    'active', p_target.active,
    'revision', p_target.revision,
    'updatedBy', p_target.updated_by,
    'updatedAt', to_char(p_target.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

CREATE FUNCTION v3.qc_record_json(p_record v3.qc_records)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'recordId', p_record.record_id,
    'sequence', p_record.sequence::text,
    'runId', p_record.run_id,
    'kind', p_record.kind,
    'actorId', p_record.actor_id,
    'relatedRecordId', p_record.related_record_id,
    'details', p_record.details,
    'recordedAt', to_char(p_record.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

CREATE FUNCTION v3.get_qc_targets(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  v_facility := v3.account_facility_id();
  RETURN jsonb_build_object('targets', COALESCE((
    SELECT jsonb_agg(v3.qc_target_json(t) ORDER BY t.target_key)
    FROM v3.qc_targets t WHERE t.facility_id = v_facility
  ), '[]'::jsonb));
END
$$;

CREATE FUNCTION v3.get_qc_run_dashboard(p_actor_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_run jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  v_facility := v3.account_facility_id();
  v_run := v3.get_run(v_facility, p_run_id);
  IF v_run IS NULL THEN RAISE EXCEPTION 'QC run not found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'run', v_run,
    'highWaterMark', COALESCE((
      SELECT max(sequence) FROM v3.qc_records
      WHERE facility_id = v_facility AND run_id = p_run_id
    ), 0)::text,
    'records', COALESCE((
      SELECT jsonb_agg(v3.qc_record_json(r) ORDER BY r.sequence)
      FROM v3.qc_records r
      WHERE r.facility_id = v_facility AND r.run_id = p_run_id
    ), '[]'::jsonb)
  );
END
$$;

CREATE FUNCTION v3.qc_replay(p_actor_id uuid, p_request_id text, p_request_hash text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_receipt v3.qc_command_receipts%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid QC command envelope' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':qc:' || p_request_id, 0));
  SELECT * INTO v_receipt FROM v3.qc_command_receipts
    WHERE facility_id = v3.account_facility_id()
      AND actor_id = p_actor_id AND request_id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_receipt.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'QC request ID was reused with different details' USING ERRCODE = 'P2002';
  END IF;
  RETURN v_receipt.response || '{"replayed":true}'::jsonb;
END
$$;

CREATE FUNCTION v3.qc_evaluate_measurement(
  p_facility uuid, p_kind text, p_target_key text, p_value numeric, p_unit text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_target v3.qc_targets%ROWTYPE;
  v_outcome text;
  v_reason text;
BEGIN
  IF p_target_key IS NULL THEN
    RETURN jsonb_build_object('targetKey', NULL, 'target', NULL,
      'outcome', 'not-evaluated', 'notEvaluatedReason', 'no-reviewed-target');
  END IF;
  SELECT * INTO v_target FROM v3.qc_targets
    WHERE facility_id = p_facility AND target_key = p_target_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('targetKey', p_target_key, 'target', NULL,
      'outcome', 'not-evaluated', 'notEvaluatedReason', 'target-unavailable');
  END IF;
  IF v_target.kind <> p_kind THEN
    RETURN jsonb_build_object('targetKey', p_target_key, 'target', v3.qc_target_json(v_target),
      'outcome', 'not-evaluated', 'notEvaluatedReason', 'target-kind-mismatch');
  END IF;
  IF NOT v_target.active THEN
    RETURN jsonb_build_object('targetKey', p_target_key, 'target', v3.qc_target_json(v_target),
      'outcome', 'not-evaluated', 'notEvaluatedReason', 'target-inactive');
  END IF;
  IF v_target.unit <> p_unit THEN
    RETURN jsonb_build_object('targetKey', p_target_key, 'target', v3.qc_target_json(v_target),
      'outcome', 'not-evaluated', 'notEvaluatedReason', 'unit-mismatch');
  END IF;
  v_outcome := CASE WHEN (v_target.minimum IS NULL OR p_value >= v_target.minimum)
                       AND (v_target.maximum IS NULL OR p_value <= v_target.maximum)
                    THEN 'pass' ELSE 'fail' END;
  RETURN jsonb_build_object('targetKey', p_target_key, 'target', v3.qc_target_json(v_target),
    'outcome', v_outcome, 'notEvaluatedReason', NULL);
END
$$;

CREATE FUNCTION v3.write_qc_record(
  p_actor_id uuid, p_request_id text, p_request_hash text,
  p_run_id uuid, p_kind text, p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_replay jsonb;
  v_record v3.qc_records%ROWTYPE;
  v_details jsonb;
  v_response jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  v_facility := v3.account_facility_id();
  IF p_run_id IS NULL OR p_kind NOT IN ('lot', 'weight-check', 'brix-check')
     OR jsonb_typeof(p_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid QC record request' USING ERRCODE = '22023';
  END IF;
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF NOT EXISTS (SELECT 1 FROM v3.runs WHERE facility_id = v_facility AND id = p_run_id) THEN
    RAISE EXCEPTION 'QC run not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_kind = 'lot' THEN
    IF p_details - ARRAY['productCode','lotNumber','notes'] <> '{}'::jsonb
       OR NOT (p_details ?& ARRAY['productCode','lotNumber','notes'])
       OR jsonb_typeof(p_details->'productCode') IS DISTINCT FROM 'string'
       OR p_details->>'productCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
       OR jsonb_typeof(p_details->'lotNumber') IS DISTINCT FROM 'string'
       OR length(btrim(p_details->>'lotNumber')) NOT BETWEEN 1 AND 120
       OR p_details->>'lotNumber' ~ '[[:cntrl:]]'
       OR jsonb_typeof(p_details->'notes') IS DISTINCT FROM 'string'
       OR length(p_details->>'notes') > 1000
       OR p_details->>'notes' ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Invalid QC lot record' USING ERRCODE = '22023';
    END IF;
    v_details := jsonb_build_object(
      'productCode', p_details->>'productCode',
      'lotNumber', btrim(p_details->>'lotNumber'),
      'notes', btrim(p_details->>'notes')
    );
  ELSE
    IF p_details - ARRAY['phase','value','unit','targetKey','notes'] <> '{}'::jsonb
       OR NOT (p_details ?& ARRAY['phase','value','unit','targetKey','notes'])
       OR jsonb_typeof(p_details->'value') IS DISTINCT FROM 'string'
       OR p_details->>'value' !~ '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$'
       OR (p_details->>'value')::numeric <= 0
       OR (p_kind = 'brix-check' AND (p_details->>'value')::numeric > 100)
       OR jsonb_typeof(p_details->'unit') IS DISTINCT FROM 'string'
       OR (p_kind = 'weight-check' AND p_details->>'unit' NOT IN ('g','kg','oz','lb'))
       OR (p_kind = 'brix-check' AND p_details->>'unit' <> 'brix')
       OR (p_kind = 'weight-check' AND (
            jsonb_typeof(p_details->'phase') IS DISTINCT FROM 'string'
            OR p_details->>'phase' NOT IN ('pre-run','30-minute')))
       OR (p_kind = 'brix-check' AND p_details->'phase' <> 'null'::jsonb)
       OR (p_details->'targetKey' <> 'null'::jsonb AND (
            jsonb_typeof(p_details->'targetKey') IS DISTINCT FROM 'string'
            OR p_details->>'targetKey' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'))
       OR jsonb_typeof(p_details->'notes') IS DISTINCT FROM 'string'
       OR length(p_details->>'notes') > 1000
       OR p_details->>'notes' ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Invalid QC measurement record' USING ERRCODE = '22023';
    END IF;
    v_details := p_details || v3.qc_evaluate_measurement(
      v_facility, CASE p_kind WHEN 'weight-check' THEN 'weight' ELSE 'brix' END,
      p_details->>'targetKey', (p_details->>'value')::numeric, p_details->>'unit'
    );
    v_details := v_details || jsonb_build_object('notes', btrim(p_details->>'notes'));
  END IF;

  INSERT INTO v3.qc_records(facility_id, run_id, kind, actor_id, details)
    VALUES (v_facility, p_run_id, p_kind, p_actor_id, v_details)
    RETURNING * INTO v_record;
  INSERT INTO v3.qc_audit_events(facility_id, actor_id, action, record_id, request_id, changed_fields)
    VALUES (v_facility, p_actor_id, 'record-created', v_record.record_id, p_request_id,
      '["details"]'::jsonb);
  INSERT INTO v3.qc_outbox_events(facility_id, record_id, qc_sequence, event_type, payload)
    VALUES (v_facility, v_record.record_id, v_record.sequence, 'qc.recorded', jsonb_build_object(
      'recordId', v_record.record_id, 'runId', v_record.run_id, 'kind', v_record.kind));
  v_response := jsonb_build_object('outcome', 'accepted', 'replayed', false,
    'record', v3.qc_record_json(v_record))
    || v3.get_qc_run_dashboard(p_actor_id, p_run_id);
  INSERT INTO v3.qc_command_receipts(facility_id, actor_id, request_id, request_hash, response)
    VALUES (v_facility, p_actor_id, p_request_id, p_request_hash, v_response);
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.record_qc_lot(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, v3 AS $$
  SELECT v3.write_qc_record(p_actor_id, p_request_id, p_request_hash, p_run_id, 'lot', p_details)
$$;

CREATE FUNCTION v3.record_qc_weight_check(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, v3 AS $$
  SELECT v3.write_qc_record(p_actor_id, p_request_id, p_request_hash, p_run_id, 'weight-check', p_details)
$$;

CREATE FUNCTION v3.record_qc_brix_check(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, v3 AS $$
  SELECT v3.write_qc_record(p_actor_id, p_request_id, p_request_hash, p_run_id, 'brix-check', p_details)
$$;

CREATE FUNCTION v3.save_qc_target(
  p_actor_id uuid, p_request_id text, p_request_hash text,
  p_target_key text, p_expected_revision bigint, p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_replay jsonb;
  v_existing v3.qc_targets%ROWTYPE;
  v_target v3.qc_targets%ROWTYPE;
  v_record v3.qc_records%ROWTYPE;
  v_details jsonb;
  v_response jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'manage-qc');
  v_facility := v3.account_facility_id();
  IF p_target_key IS NULL OR p_target_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_revision > 9007199254740991
     OR jsonb_typeof(p_details) IS DISTINCT FROM 'object'
     OR p_details - ARRAY['kind','unit','minimum','maximum','active'] <> '{}'::jsonb
     OR NOT (p_details ?& ARRAY['kind','unit','minimum','maximum','active'])
     OR p_details->>'kind' NOT IN ('weight','brix')
     OR (p_details->>'kind' = 'weight' AND p_details->>'unit' NOT IN ('g','kg','oz','lb'))
     OR (p_details->>'kind' = 'brix' AND p_details->>'unit' <> 'brix')
     OR jsonb_typeof(p_details->'active') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Invalid QC target request' USING ERRCODE = '22023';
  END IF;
  FOR v_details IN SELECT value FROM jsonb_each(p_details) WHERE key IN ('minimum','maximum') LOOP
    IF v_details <> 'null'::jsonb AND (jsonb_typeof(v_details) IS DISTINCT FROM 'string'
       OR v_details #>> '{}' !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$') THEN
      RAISE EXCEPTION 'Invalid QC target bound' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_details->'minimum' = 'null'::jsonb AND p_details->'maximum' = 'null'::jsonb THEN
    RAISE EXCEPTION 'QC target requires a bound' USING ERRCODE = '22023';
  END IF;
  IF (p_details->'minimum' <> 'null'::jsonb AND p_details->'maximum' <> 'null'::jsonb
      AND (p_details->>'minimum')::numeric > (p_details->>'maximum')::numeric)
     OR (p_details->>'kind' = 'brix' AND (
       (p_details->'minimum' <> 'null'::jsonb AND (p_details->>'minimum')::numeric > 100)
       OR (p_details->'maximum' <> 'null'::jsonb AND (p_details->>'maximum')::numeric > 100))) THEN
    RAISE EXCEPTION 'QC target bounds are inconsistent' USING ERRCODE = '22023';
  END IF;

  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_existing FROM v3.qc_targets
    WHERE facility_id = v_facility AND target_key = p_target_key FOR UPDATE;
  IF (NOT FOUND AND p_expected_revision <> 0)
     OR (FOUND AND v_existing.revision <> p_expected_revision) THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'replayed', false)
      || v3.get_qc_targets(p_actor_id);
  END IF;

  INSERT INTO v3.qc_targets(
    facility_id, target_key, kind, unit, minimum, maximum, active,
    revision, updated_by, updated_at
  ) VALUES (
    v_facility, p_target_key, p_details->>'kind', p_details->>'unit',
    NULLIF(p_details->>'minimum', '')::numeric, NULLIF(p_details->>'maximum', '')::numeric,
    (p_details->>'active')::boolean, 1, p_actor_id, clock_timestamp()
  ) ON CONFLICT (facility_id, target_key) DO UPDATE SET
    kind = EXCLUDED.kind, unit = EXCLUDED.unit,
    minimum = EXCLUDED.minimum, maximum = EXCLUDED.maximum,
    active = EXCLUDED.active, revision = v3.qc_targets.revision + 1,
    updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_target;

  v_details := jsonb_build_object(
    'targetKey', v_target.target_key, 'kind', v_target.kind, 'unit', v_target.unit,
    'minimum', v_target.minimum::text, 'maximum', v_target.maximum::text,
    'active', v_target.active, 'revision', v_target.revision);
  INSERT INTO v3.qc_records(facility_id, run_id, kind, actor_id, details)
    VALUES (v_facility, NULL, 'target-set', p_actor_id, v_details)
    RETURNING * INTO v_record;
  INSERT INTO v3.qc_audit_events(facility_id, actor_id, action, record_id, request_id, changed_fields)
    VALUES (v_facility, p_actor_id, 'target-saved', v_record.record_id, p_request_id,
      '["kind","unit","minimum","maximum","active"]'::jsonb);
  INSERT INTO v3.qc_outbox_events(facility_id, record_id, qc_sequence, event_type, payload)
    VALUES (v_facility, v_record.record_id, v_record.sequence, 'qc.target_saved', jsonb_build_object(
      'recordId', v_record.record_id, 'targetKey', v_target.target_key,
      'revision', v_target.revision));
  v_response := jsonb_build_object('outcome', 'accepted', 'replayed', false,
    'target', v3.qc_target_json(v_target)) || v3.get_qc_targets(p_actor_id);
  INSERT INTO v3.qc_command_receipts(facility_id, actor_id, request_id, request_hash, response)
    VALUES (v_facility, p_actor_id, p_request_id, p_request_hash, v_response);
  RETURN v_response;
END
$$;

COMMIT;
