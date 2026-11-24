-- Canonical schedule workbook reviews, independent date Apply, and guarded created-run Undo.
-- Reviewed rows and citations are retained; workbook bytes are never persisted.

BEGIN;

CREATE TABLE v3.schedule_imports (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope(facility_id),
  import_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  source jsonb NOT NULL,
  runs jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, import_id),
  UNIQUE (facility_id, actor_id, request_id),
  CONSTRAINT schedule_imports_request_id_valid CHECK (length(request_id) BETWEEN 1 AND 200),
  CONSTRAINT schedule_imports_request_hash_valid CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT schedule_imports_source_object CHECK (jsonb_typeof(source) = 'object'),
  CONSTRAINT schedule_imports_runs_array CHECK (jsonb_typeof(runs) = 'array')
);

CREATE TABLE v3.schedule_import_dates (
  facility_id uuid NOT NULL,
  import_id uuid NOT NULL,
  production_date date NOT NULL,
  status text NOT NULL DEFAULT 'staged',
  created_runs jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  apply_actor_id uuid,
  apply_request_id text,
  applied_at timestamptz,
  undo_actor_id uuid,
  undo_request_id text,
  undone_at timestamptz,
  PRIMARY KEY (facility_id, import_id, production_date),
  FOREIGN KEY (facility_id, import_id) REFERENCES v3.schedule_imports(facility_id, import_id),
  CONSTRAINT schedule_import_dates_status_valid CHECK (status IN ('staged','applied','undone')),
  CONSTRAINT schedule_import_dates_created_runs_array CHECK (jsonb_typeof(created_runs) = 'array'),
  CONSTRAINT schedule_import_dates_updated_ids_array CHECK (jsonb_typeof(updated_run_ids) = 'array')
);

CREATE TABLE v3.schedule_import_action_receipts (
  facility_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  import_id uuid NOT NULL,
  production_date date NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, actor_id, request_id),
  FOREIGN KEY (facility_id, import_id, production_date)
    REFERENCES v3.schedule_import_dates(facility_id, import_id, production_date),
  CONSTRAINT schedule_import_action_hash_valid CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT schedule_import_action_valid CHECK (action IN ('apply','undo'))
);

CREATE INDEX schedule_imports_created_idx
  ON v3.schedule_imports(facility_id, created_at DESC, import_id DESC);

CREATE FUNCTION v3.schedule_import_date_json(p_date v3.schedule_import_dates)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'productionDate', p_date.production_date,
    'status', p_date.status,
    'createdRunCount', jsonb_array_length(p_date.created_runs),
    'updatedRunCount', jsonb_array_length(p_date.updated_run_ids),
    'appliedAt', p_date.applied_at,
    'undoneAt', p_date.undone_at,
    'undoAvailable', p_date.status = 'applied' AND jsonb_array_length(p_date.created_runs) > 0
  )
$$;

CREATE FUNCTION v3.schedule_import_summary_json(p_import v3.schedule_imports)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, v3
AS $$
  SELECT jsonb_build_object(
    'importId', p_import.import_id,
    'createdAt', p_import.created_at,
    'source', p_import.source,
    'rowCount', jsonb_array_length(p_import.runs),
    'dates', COALESCE((
      SELECT jsonb_agg(v3.schedule_import_date_json(d) ORDER BY d.production_date)
      FROM v3.schedule_import_dates d
      WHERE d.facility_id = p_import.facility_id AND d.import_id = p_import.import_id
    ), '[]'::jsonb)
  )
$$;

CREATE FUNCTION v3.get_schedule_import(p_facility_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.schedule_imports%ROWTYPE;
BEGIN
  SELECT * INTO v_import FROM v3.schedule_imports
    WHERE facility_id = p_facility_id AND import_id = p_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule import not found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'import', v3.schedule_import_summary_json(v_import) || jsonb_build_object('runs', v_import.runs)
  );
END
$$;

CREATE FUNCTION v3.list_schedule_imports(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Schedule import history limit is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('imports', COALESCE((
    SELECT jsonb_agg(v3.schedule_import_summary_json(i) ORDER BY i.created_at DESC, i.import_id DESC)
    FROM (
      SELECT * FROM v3.schedule_imports
      WHERE facility_id = p_facility_id
      ORDER BY created_at DESC, import_id DESC
      LIMIT p_limit
    ) i
  ), '[]'::jsonb));
END
$$;

CREATE FUNCTION v3.stage_schedule_import(
  p_facility_id uuid, p_actor_id uuid, p_import_id uuid,
  p_request_id text, p_request_hash text, p_source jsonb, p_runs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing v3.schedule_imports%ROWTYPE;
  v_row jsonb;
  v_runs jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid schedule import scope' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_source) IS DISTINCT FROM 'object'
     OR p_source - ARRAY['fileName','sha256','parserVersion'] <> '{}'::jsonb
     OR NOT (p_source ?& ARRAY['fileName','sha256','parserVersion'])
     OR jsonb_typeof(p_source->'fileName') IS DISTINCT FROM 'string'
     OR length(btrim(p_source->>'fileName')) NOT BETWEEN 1 AND 160
     OR jsonb_typeof(p_source->'sha256') IS DISTINCT FROM 'string'
     OR p_source->>'sha256' !~ '^[0-9a-f]{64}$'
     OR p_source->>'parserVersion' <> 'v1-schedule-import/1'
     OR jsonb_typeof(p_runs) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_runs) NOT BETWEEN 1 AND 2000
     OR pg_column_size(p_source) > 65536 OR pg_column_size(p_runs) > 4194304 THEN
    RAISE EXCEPTION 'Invalid canonical schedule import' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM v3.schedule_imports
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.import_id <> p_import_id THEN
      RAISE EXCEPTION 'Schedule import request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('outcome','staged','replayed',true)
      || v3.get_schedule_import(p_facility_id, p_import_id);
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_runs) LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object'
       OR v_row - ARRAY['date','id','productCode','productionSetupCode','runTemplateCode','targetCases','notes','source'] <> '{}'::jsonb
       OR NOT (v_row ?& ARRAY['date','id','productCode','productionSetupCode','runTemplateCode','targetCases','notes','source'])
       OR jsonb_typeof(v_row->'date') IS DISTINCT FROM 'string'
       OR v_row->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR jsonb_typeof(v_row->'source') IS DISTINCT FROM 'object'
       OR (v_row->'source') - ARRAY['workbook','sheet','row','cells'] <> '{}'::jsonb
       OR NOT ((v_row->'source') ?& ARRAY['workbook','sheet','row','cells'])
       OR v_row->'source'->>'workbook' <> p_source->>'fileName'
       OR jsonb_typeof(v_row->'source'->'sheet') IS DISTINCT FROM 'string'
       OR length(btrim(v_row->'source'->>'sheet')) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(v_row->'source'->'row') IS DISTINCT FROM 'number'
       OR (v_row->'source'->>'row') !~ '^[1-9][0-9]{0,4}$'
       OR (v_row->'source'->>'row')::integer > 20000
       OR jsonb_typeof(v_row->'source'->'cells') IS DISTINCT FROM 'object'
       OR NOT ((v_row->'source'->'cells') ?& ARRAY['brand','flavor','targetCases'])
       OR (v_row->'source'->'cells') - ARRAY['brand','flavor','targetCases','date'] <> '{}'::jsonb
       OR EXISTS (
         SELECT 1 FROM jsonb_each(v_row->'source'->'cells') cell
         WHERE jsonb_typeof(cell.value) IS DISTINCT FROM 'string'
            OR (cell.value #>> '{}') !~ '^[A-Za-z]{1,3}[1-9][0-9]{0,4}$'
       ) THEN
      RAISE EXCEPTION 'Schedule import row or citation has an invalid shape' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_runs) item(value)
    GROUP BY item.value->>'date', item.value->>'id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Schedule import contains duplicate run IDs for a date' USING ERRCODE = '22023';
  END IF;
  FOR v_runs IN
    SELECT jsonb_agg(value - 'source' - 'date' ORDER BY value->>'id')
    FROM jsonb_array_elements(p_runs) GROUP BY value->>'date'
  LOOP
    IF NOT v3.validate_production_schedule_runs(p_facility_id, v_runs) THEN
      RAISE EXCEPTION 'Schedule import references or values are invalid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO v3.schedule_imports(
    facility_id, import_id, actor_id, request_id, request_hash, source, runs, created_at
  ) VALUES (
    p_facility_id, p_import_id, p_actor_id, p_request_id, p_request_hash, p_source, p_runs, v_now
  );
  INSERT INTO v3.schedule_import_dates(facility_id, import_id, production_date)
    SELECT p_facility_id, p_import_id, (value->>'date')::date
    FROM jsonb_array_elements(p_runs) GROUP BY value->>'date';
  RETURN jsonb_build_object('outcome','staged','replayed',false)
    || v3.get_schedule_import(p_facility_id, p_import_id);
END
$$;

CREATE FUNCTION v3.apply_schedule_import(
  p_facility_id uuid, p_actor_id uuid, p_import_id uuid, p_date date,
  p_request_id text, p_request_hash text, p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.schedule_imports%ROWTYPE;
  v_state v3.schedule_import_dates%ROWTYPE;
  v_receipt v3.schedule_import_action_receipts%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_after_runs jsonb;
  v_runs jsonb;
  v_created jsonb;
  v_updated jsonb;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL OR p_date IS NULL
     OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid schedule import Apply request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':schedule-import:' || p_import_id::text, 0));
  SELECT * INTO v_receipt FROM v3.schedule_import_action_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> p_request_hash OR v_receipt.import_id <> p_import_id
       OR v_receipt.production_date <> p_date OR v_receipt.action <> 'apply' THEN
      RAISE EXCEPTION 'Schedule import request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('outcome','accepted','replayed',true,'productionDate',p_date)
      || jsonb_build_object('schedule',v3.get_production_schedule(p_facility_id,p_date))
      || v3.get_schedule_import(p_facility_id,p_import_id);
  END IF;
  SELECT * INTO v_import FROM v3.schedule_imports
    WHERE facility_id = p_facility_id AND import_id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule import not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_state FROM v3.schedule_import_dates
    WHERE facility_id = p_facility_id AND import_id = p_import_id AND production_date = p_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule import date not found' USING ERRCODE = 'P0002'; END IF;
  IF v_state.status = 'applied' THEN
    RAISE EXCEPTION 'Schedule import date is already applied' USING ERRCODE = '55000';
  END IF;
  v_before := v3.get_production_schedule(p_facility_id, p_date);
  SELECT jsonb_agg(value - 'source' - 'date' ORDER BY ordinality) INTO v_runs
    FROM jsonb_array_elements(v_import.runs) WITH ORDINALITY AS item(value,ordinality)
    WHERE value->>'date' = p_date::text;
  v_result := v3.apply_production_schedule_command(
    p_facility_id, p_actor_id, p_date, p_request_id, p_request_hash,
    p_expected_revision, jsonb_build_object('type','merge-import','runs',v_runs)
  );
  IF v_result->>'outcome' <> 'accepted' THEN
    RETURN v_result || jsonb_build_object('productionDate',p_date)
      || v3.get_schedule_import(p_facility_id,p_import_id);
  END IF;
  v_after := v3.get_production_schedule(p_facility_id, p_date);
  SELECT plan->'runs' INTO v_after_runs FROM v3.production_schedules
    WHERE facility_id = p_facility_id AND production_date = p_date;
  SELECT COALESCE(jsonb_agg(run.value ORDER BY run.ordinality), '[]'::jsonb) INTO v_created
    FROM jsonb_array_elements(v_after_runs) WITH ORDINALITY AS run(value,ordinality)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) incoming WHERE incoming.value->>'id' = run.value->>'id')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_before->'runs') previous WHERE previous.value->>'id' = run.value->>'id');
  SELECT COALESCE(jsonb_agg(run.value->>'id' ORDER BY run.ordinality), '[]'::jsonb) INTO v_updated
    FROM jsonb_array_elements(v_after->'runs') WITH ORDINALITY AS run(value,ordinality)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_runs) incoming WHERE incoming.value->>'id' = run.value->>'id')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_before->'runs') previous WHERE previous.value->>'id' = run.value->>'id');
  UPDATE v3.schedule_import_dates SET
    status = 'applied', created_runs = v_created, updated_run_ids = v_updated,
    apply_actor_id = p_actor_id, apply_request_id = p_request_id, applied_at = v_now,
    undo_actor_id = NULL, undo_request_id = NULL, undone_at = NULL
    WHERE facility_id = p_facility_id AND import_id = p_import_id AND production_date = p_date;
  INSERT INTO v3.schedule_import_action_receipts(
    facility_id,actor_id,request_id,request_hash,import_id,production_date,action,created_at
  ) VALUES (p_facility_id,p_actor_id,p_request_id,p_request_hash,p_import_id,p_date,'apply',v_now);
  RETURN jsonb_build_object(
    'outcome','accepted','replayed',false,'productionDate',p_date,
    'schedule',v_after,'createdRunCount',jsonb_array_length(v_created),
    'updatedRunCount',jsonb_array_length(v_updated)
  ) || v3.get_schedule_import(p_facility_id,p_import_id);
END
$$;

CREATE FUNCTION v3.undo_schedule_import(
  p_facility_id uuid, p_actor_id uuid, p_import_id uuid, p_date date,
  p_request_id text, p_request_hash text, p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_state v3.schedule_import_dates%ROWTYPE;
  v_receipt v3.schedule_import_action_receipts%ROWTYPE;
  v_schedule v3.production_schedules%ROWTYPE;
  v_snapshot jsonb;
  v_current jsonb;
  v_runs jsonb;
  v_breaks jsonb;
  v_after jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL OR p_date IS NULL
     OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid schedule import Undo request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':schedule-import:' || p_import_id::text, 0));
  SELECT * INTO v_receipt FROM v3.schedule_import_action_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> p_request_hash OR v_receipt.import_id <> p_import_id
       OR v_receipt.production_date <> p_date OR v_receipt.action <> 'undo' THEN
      RAISE EXCEPTION 'Schedule import request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('outcome','accepted','replayed',true,'productionDate',p_date)
      || jsonb_build_object('schedule',v3.get_production_schedule(p_facility_id,p_date))
      || v3.get_schedule_import(p_facility_id,p_import_id);
  END IF;
  SELECT * INTO v_state FROM v3.schedule_import_dates
    WHERE facility_id = p_facility_id AND import_id = p_import_id AND production_date = p_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule import date not found' USING ERRCODE = 'P0002'; END IF;
  IF v_state.status <> 'applied' THEN
    RAISE EXCEPTION 'Schedule import date is not applied' USING ERRCODE = '55000';
  END IF;
  IF jsonb_array_length(v_state.created_runs) = 0 THEN
    RETURN jsonb_build_object(
      'outcome','conflict','reason','no-created-runs','replayed',false,'productionDate',p_date,
      'schedule',v3.get_production_schedule(p_facility_id,p_date)
    ) || v3.get_schedule_import(p_facility_id,p_import_id);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_date::text, 0));
  SELECT * INTO v_schedule FROM v3.production_schedules
    WHERE facility_id = p_facility_id AND production_date = p_date FOR UPDATE;
  IF NOT FOUND OR v_schedule.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome','conflict','reason','stale-schedule','replayed',false,'productionDate',p_date,
      'schedule',v3.get_production_schedule(p_facility_id,p_date)
    ) || v3.get_schedule_import(p_facility_id,p_import_id);
  END IF;
  v_runs := v_schedule.plan->'runs';
  v_breaks := v_schedule.plan->'breaks';
  FOR v_snapshot IN SELECT value FROM jsonb_array_elements(v_state.created_runs) LOOP
    SELECT value INTO v_current FROM jsonb_array_elements(v_runs)
      WHERE value->>'id' = v_snapshot->>'id';
    IF NOT FOUND OR v_current IS DISTINCT FROM v_snapshot THEN
      RETURN jsonb_build_object(
        'outcome','conflict','reason','created-runs-changed','replayed',false,'productionDate',p_date,
        'schedule',v3.get_production_schedule(p_facility_id,p_date)
      ) || v3.get_schedule_import(p_facility_id,p_import_id);
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb) INTO v_runs
    FROM jsonb_array_elements(v_runs) WITH ORDINALITY AS item(value,ordinality)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_state.created_runs) created
      WHERE created.value->>'id' = item.value->>'id'
    );
  SELECT COALESCE(jsonb_agg(
    CASE WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_state.created_runs) created
      WHERE created.value->>'id' = item.value->>'runId'
    ) THEN jsonb_set(item.value,'{runId}','null'::jsonb,false) ELSE item.value END ORDER BY ordinality
  ), '[]'::jsonb) INTO v_breaks
    FROM jsonb_array_elements(v_breaks) WITH ORDINALITY AS item(value,ordinality);
  UPDATE v3.production_schedules SET
    revision = revision + 1,
    plan = jsonb_build_object('productionStartTime',v_schedule.plan->>'productionStartTime','runs',v_runs,'breaks',v_breaks),
    updated_by = p_actor_id, updated_at = v_now
    WHERE facility_id = p_facility_id AND production_date = p_date;
  v_after := v3.get_production_schedule(p_facility_id,p_date);
  INSERT INTO v3.production_schedule_receipts(
    facility_id,actor_id,request_id,request_hash,response,created_at
  ) VALUES (
    p_facility_id,p_actor_id,p_request_id,p_request_hash,jsonb_build_object('outcome','accepted'),v_now
  );
  UPDATE v3.schedule_import_dates SET
    status = 'undone', undo_actor_id = p_actor_id, undo_request_id = p_request_id, undone_at = v_now
    WHERE facility_id = p_facility_id AND import_id = p_import_id AND production_date = p_date;
  INSERT INTO v3.schedule_import_action_receipts(
    facility_id,actor_id,request_id,request_hash,import_id,production_date,action,created_at
  ) VALUES (p_facility_id,p_actor_id,p_request_id,p_request_hash,p_import_id,p_date,'undo',v_now);
  RETURN jsonb_build_object(
    'outcome','accepted','replayed',false,'productionDate',p_date,
    'schedule',v_after,'createdRunCount',jsonb_array_length(v_state.created_runs),'updatedRunCount',0
  ) || v3.get_schedule_import(p_facility_id,p_import_id);
END
$$;

REVOKE ALL ON FUNCTION v3.schedule_import_date_json(v3.schedule_import_dates) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.schedule_import_summary_json(v3.schedule_imports) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_schedule_import(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_schedule_imports(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.stage_schedule_import(uuid,uuid,uuid,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_schedule_import(uuid,uuid,uuid,date,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.undo_schedule_import(uuid,uuid,uuid,date,text,text,bigint) FROM PUBLIC;

COMMENT ON TABLE v3.schedule_imports IS
  'Immutable canonical schedule reviews with source hash/parser pins and row citations; no workbook bytes.';
COMMENT ON TABLE v3.schedule_import_dates IS
  'Independent per-date Apply/Undo state and created-run snapshots; updated pre-existing runs are never reverted.';
COMMENT ON TABLE v3.schedule_import_action_receipts IS
  'Minimal exact-retry metadata for schedule import Apply and Undo; schedule payloads and notes are not duplicated.';

COMMIT;
