BEGIN;

ALTER TABLE v3.runs
  ADD COLUMN run_to_time time without time zone NOT NULL DEFAULT TIME '19:15';

DO $$
DECLARE
  v_constraint record;
  v_count integer := 0;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'v3.runs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status <> ''planned''%'
      AND pg_get_constraintdef(oid) LIKE '%updated_at = created_at%'
  LOOP
    EXECUTE format('ALTER TABLE v3.runs DROP CONSTRAINT %I', v_constraint.conname);
    v_count := v_count + 1;
  END LOOP;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one obsolete planned-run timestamp constraint, found %', v_count;
  END IF;
END
$$;

ALTER TABLE v3.runs
  ADD CONSTRAINT runs_planned_updated_at_valid
  CHECK (status <> 'planned' OR updated_at >= created_at);

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
    'setupSnapshot', r.setup_snapshot,
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

CREATE FUNCTION v3.apply_run_to_time_command(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_run_to_time time without time zone,
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
  v_response jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) = 0
     OR length(p_command_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_run_to_time IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'Invalid Run to Time command' USING ERRCODE = '22023';
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

  SELECT * INTO v_run
    FROM v3.runs
    WHERE facility_id = p_facility_id AND id = p_run_id
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

  IF v_run.status = 'completed' THEN
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
    RAISE EXCEPTION 'Database clock precedes the current run state' USING ERRCODE = '22008';
  END IF;

  UPDATE v3.runs
    SET run_to_time = p_run_to_time, updated_at = v_now, revision = revision + 1
    WHERE facility_id = p_facility_id AND id = p_run_id
    RETURNING * INTO v_run;

  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'commandId', p_command_id,
    'run', v3.run_snapshot(p_facility_id, p_run_id)
  );
  INSERT INTO v3.run_events (
    facility_id, run_id, revision, actor_id, event_type, occurred_at, payload
  ) VALUES (
    p_facility_id, p_run_id, v_run.revision, p_actor_id,
    'run.run_to_time_updated', v_now, v_response
  );
  INSERT INTO v3.outbox_events (
    event_id, facility_id, run_id, revision, event_type, payload, created_at
  ) VALUES (
    gen_random_uuid(), p_facility_id, p_run_id, v_run.revision,
    'run.run_to_time_updated', v_response, v_now
  );
  INSERT INTO v3.command_receipts (
    facility_id, actor_id, command_id, request_hash, response, created_at
  ) VALUES (
    p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now
  );
  RETURN v_response;
END
$$;

COMMENT ON FUNCTION v3.apply_run_to_time_command(uuid, uuid, uuid, text, text, time, bigint)
  IS 'Backend-only transactional Run to Time command. Uses verified server identity, a server-computed request hash, exact receipt replay, run revision fencing, run events, and outbox events.';

CREATE FUNCTION v3.schedule_run_readiness(p_facility_id uuid, p_run jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_product_available boolean;
  v_setup jsonb;
  v_template_available boolean;
  v_recipe_reference_count integer := 0;
  v_recipe_match_count integer := 0;
  v_capacity jsonb;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM v3.products AS p
    WHERE p.facility_id = p_facility_id
      AND lower(p.code) = lower(p_run->>'productCode')
      AND p.active
  ) INTO v_product_available;
  IF NOT v_product_available THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'product_unavailable',
      'message', 'Product is missing or inactive. Review Products in Setup.',
      'setupSection', 'products'
    ));
  END IF;

  SELECT s.data INTO v_setup
    FROM v3.master_records AS s
    WHERE s.facility_id = p_facility_id
      AND s.kind = 'production-setups'
      AND lower(s.code) = lower(p_run->>'productionSetupCode')
      AND lower(s.product_code) = lower(p_run->>'productCode')
      AND s.data->>'sourceFamily' IS NULL
      AND jsonb_typeof(s.data->'recipe_codes') = 'array'
      AND jsonb_typeof(s.data->'packaging_per_case') = 'array'
    ORDER BY s.updated_at DESC, s.id
    LIMIT 1;
  IF v_setup IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'production_setup_unavailable',
      'message', 'Production setup is missing or does not match the product. Review Production setups in Setup.',
      'setupSection', 'production-setups'
    ));
  ELSE
    SELECT count(*) INTO v_recipe_reference_count
      FROM jsonb_array_elements_text(v_setup->'recipe_codes');
    SELECT count(*) INTO v_recipe_match_count
      FROM jsonb_array_elements_text(v_setup->'recipe_codes') AS reference(code)
      JOIN v3.master_records AS r
        ON r.facility_id = p_facility_id
       AND r.kind = 'recipes'
       AND lower(r.code) = lower(reference.code)
       AND lower(r.product_code) = lower(p_run->>'productCode');
    IF v_recipe_reference_count = 0 OR v_recipe_match_count <> v_recipe_reference_count THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'recipe_rows_missing',
        'message', 'One or more recipe rows are missing. Review the production setup and recipe catalog in Setup.',
        'setupSection', 'production-setups'
      ));
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM v3.setup_run_template_records AS t
    WHERE t.facility_id = p_facility_id
      AND lower(t.code) = lower(p_run->>'runTemplateCode')
  ) INTO v_template_available;
  IF NOT v_template_available THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'run_template_unavailable',
      'message', 'Run template is missing. Review Run templates in Setup.',
      'setupSection', 'run-templates'
    ));
  END IF;

  IF v_product_available THEN
    v_capacity := v3.dough_capacity_snapshot(p_facility_id, p_run->>'productCode');
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_capacity->'reasons') AS reason(code)
      WHERE reason.code LIKE 'dough_%'
    ) THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'dough_yield_unavailable',
        'message', 'Dough yield is unavailable. Review Product dough yield in Setup.',
        'setupSection', 'recipes'
      ));
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_capacity->'reasons') AS reason(code)
      WHERE reason.code LIKE 'shipping_%' OR reason.code = 'pizzas_per_case_invalid'
    ) THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'code', 'case_capacity_unavailable',
        'message', 'Case capacity is unavailable. Review Shipping case capacity in Setup.',
        'setupSection', 'production-setups'
      ));
    END IF;
  END IF;

  RETURN v_warnings;
END
$$;

CREATE OR REPLACE FUNCTION v3.get_production_schedule(p_facility_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE v_schedule v3.production_schedules%ROWTYPE; v_runs jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_date IS NULL OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule scope' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_schedule FROM v3.production_schedules WHERE facility_id=p_facility_id AND production_date=p_date;
  IF NOT FOUND THEN RETURN jsonb_build_object('date',p_date,'revision',0,'timeZone','America/Chicago',
    'productionStartTime',v3.schedule_default_start_time(p_facility_id),'runs','[]'::jsonb,'breaks',jsonb_build_array(
      jsonb_build_object('slot',1,'enabled',false,'runId',NULL),jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',3,'enabled',false,'runId',NULL)),'updatedAt',NULL);
  END IF;
  SELECT COALESCE(jsonb_agg(run.value || jsonb_build_object('carriedInCases',COALESCE((SELECT sum(a.cases)
    FROM v3.freezer_surplus_allocations a WHERE a.facility_id=p_facility_id AND a.production_date=p_date
    AND a.schedule_run_id=(run.value->>'id')::uuid),0),'effectiveTargetCases',GREATEST((run.value->>'targetCases')::integer-COALESCE((
    SELECT sum(a.cases) FROM v3.freezer_surplus_allocations a WHERE a.facility_id=p_facility_id AND a.production_date=p_date
    AND a.schedule_run_id=(run.value->>'id')::uuid),0),0),'readinessWarnings',v3.schedule_run_readiness(p_facility_id,run.value))
    ORDER BY run.ordinality),'[]'::jsonb)
    INTO v_runs FROM jsonb_array_elements(v_schedule.plan->'runs') WITH ORDINALITY run(value,ordinality);
  RETURN jsonb_build_object('date',v_schedule.production_date,'revision',v_schedule.revision,'timeZone',v_schedule.time_zone,
    'productionStartTime',v_schedule.plan->'productionStartTime','runs',v_runs,'breaks',v_schedule.plan->'breaks','updatedAt',v_schedule.updated_at);
END
$$;

COMMENT ON FUNCTION v3.schedule_run_readiness(uuid, jsonb)
  IS 'Server-derived advisory setup diagnostics for confirmed schedule runs. Warnings never block scheduling or production and are not accepted as schedule command input.';

REVOKE ALL ON FUNCTION v3.apply_run_to_time_command(uuid, uuid, uuid, text, text, time, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.schedule_run_readiness(uuid, jsonb) FROM PUBLIC;

COMMIT;
