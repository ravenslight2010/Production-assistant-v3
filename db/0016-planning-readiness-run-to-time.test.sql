BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99160000-0000-4000-8000-000000000001';
  v_run_id uuid := '99160000-0000-4000-8000-000000000002';
  v_schedule_run_id uuid := '99160000-0000-4000-8000-000000000003';
  v_template_import uuid;
  v_result jsonb;
  v_run jsonb;
  v_warnings jsonb;
  v_failed boolean;
  v_revision bigint;
  v_now timestamptz;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;

  INSERT INTO v3.runs (
    facility_id, id, status, revision, created_at, updated_at, setup_snapshot
  ) VALUES (
    v_facility, v_run_id, 'planned', 0,
    clock_timestamp() - interval '1 second', clock_timestamp() - interval '1 second',
    '{"label":"Run to Time SQL regression","targetCases":10}'::jsonb
  );
  v_run := v3.get_run(v_facility, v_run_id);
  IF v_run->>'runToTime' <> '19:15' THEN
    RAISE EXCEPTION 'A planned run did not receive the 19:15 default: %', v_run;
  END IF;

  v_result := v3.apply_run_to_time_command(
    v_facility, v_run_id, v_actor, 'run-to-time-sql-1', repeat('a', 64), TIME '18:45', 0
  );
  IF v_result->>'outcome' <> 'accepted' OR v_result->'run'->>'runToTime' <> '18:45'
     OR v_result#>>'{run,revision}' <> '1'
     OR (SELECT updated_at = created_at FROM v3.runs WHERE facility_id=v_facility AND id=v_run_id) THEN
    RAISE EXCEPTION 'A planned Run to Time update was not canonical: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v3.run_events
    WHERE facility_id=v_facility AND run_id=v_run_id AND revision=1
      AND event_type='run.run_to_time_updated'
  ) OR NOT EXISTS (
    SELECT 1 FROM v3.outbox_events
    WHERE facility_id=v_facility AND run_id=v_run_id AND revision=1
      AND event_type='run.run_to_time_updated'
  ) THEN
    RAISE EXCEPTION 'Run to Time did not write transactional run and outbox events.';
  END IF;

  SELECT revision INTO v_revision FROM v3.runs WHERE facility_id=v_facility AND id=v_run_id;
  v_result := v3.apply_run_to_time_command(
    v_facility, v_run_id, v_actor, 'run-to-time-sql-1', repeat('a', 64), TIME '18:45', 0
  );
  IF v_result->>'replayed' <> 'true'
     OR (SELECT revision FROM v3.runs WHERE facility_id=v_facility AND id=v_run_id) <> v_revision THEN
    RAISE EXCEPTION 'An exact Run to Time retry changed the run twice.';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v3.apply_run_to_time_command(
      v_facility, v_run_id, v_actor, 'run-to-time-sql-1', repeat('b', 64), TIME '18:45', 0
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'A reused command ID with another hash was accepted.'; END IF;

  v_result := v3.apply_run_to_time_command(
    v_facility, v_run_id, v_actor, 'run-to-time-sql-stale', repeat('c', 64), TIME '20:00', 0
  );
  IF v_result->>'outcome' <> 'conflict' OR v_result#>'{currentRun,runToTime}' <> '"18:45"'::jsonb THEN
    RAISE EXCEPTION 'A stale Run to Time edit did not return canonical state: %', v_result;
  END IF;

  v_now := clock_timestamp();
  UPDATE v3.runs
    SET status='completed', started_at=created_at, completed_at=v_now,
        updated_at=v_now, revision=revision+1
    WHERE facility_id=v_facility AND id=v_run_id;
  v_result := v3.apply_run_to_time_command(
    v_facility, v_run_id, v_actor, 'run-to-time-sql-completed', repeat('d', 64), TIME '20:00', 2
  );
  IF v_result->>'outcome' <> 'invalid_transition' OR v_result->>'currentStatus' <> 'completed' THEN
    RAISE EXCEPTION 'A completed run accepted a Run to Time edit: %', v_result;
  END IF;

  INSERT INTO v3.products(facility_id, code, name, base_unit, active)
  VALUES
    (v_facility, 'P16-PRODUCT', 'Planning 1 Product', 'case', true),
    (v_facility, 'P16-FLOUR', 'Planning 1 Flour', 'lb', true),
    (v_facility, 'P16-CARTON', 'Planning 1 Carton', 'each', true);
  INSERT INTO v3.master_records(facility_id, kind, code, name, product_code, data)
  VALUES
    (v_facility, 'recipes', 'P16-RECIPE', 'Planning 1 Recipe', 'P16-PRODUCT',
      '{"station_key":"dough","ingredients":[{"product_code":"P16-FLOUR","quantity":1,"unit":"lb"}]}'::jsonb),
    (v_facility, 'recipes', 'P16-DOUGH', 'Planning 1 Dough Yield', 'P16-PRODUCT',
      '{"sourceFamily":"dough-procedure","doughballYield":600}'::jsonb),
    (v_facility, 'production-setups', 'P16-SHIPPING', 'Planning 1 Shipping', 'P16-PRODUCT',
      '{"sourceFamily":"shipping-guide","pizzasPerCase":12}'::jsonb),
    (v_facility, 'production-setups', 'P16-SETUP', 'Planning 1 Setup', 'P16-PRODUCT',
      '{"recipe_codes":["P16-RECIPE"],"packaging_per_case":[{"product_code":"P16-CARTON","quantity":1,"unit":"each"}]}'::jsonb);
  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'p16-template-test', repeat('f', 64), 'run-templates',
    '[{"code":"P16-TEMPLATE","name":"Planning 1 Template","data":{"brand":"Planning","flavor":"Test","values":{"pizzasPerCase":12,"crustsPerCycle":4,"cycleSpeed":2,"freezerTime":0}}}]'::jsonb
  );
  v_template_import := (v_result->>'importId')::uuid;
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, v_template_import);

  v_warnings := v3.schedule_run_readiness(v_facility, jsonb_build_object(
    'productCode','P16-PRODUCT','productionSetupCode','P16-SETUP','runTemplateCode','P16-TEMPLATE'
  ));
  IF v_warnings <> '[]'::jsonb THEN
    RAISE EXCEPTION 'A fully configured run produced readiness warnings: %', v_warnings;
  END IF;

  v_result := v3.apply_production_schedule_command(
    v_facility, v_actor, DATE '2032-03-08', 'p16-schedule', repeat('e',64), 0,
    jsonb_build_object('type','add','run',jsonb_build_object(
      'id',v_schedule_run_id,'productCode','P16-PRODUCT','productionSetupCode','P16-SETUP',
      'runTemplateCode','P16-TEMPLATE','targetCases',10,'notes',''
    ))
  );
  DELETE FROM v3.master_records
    WHERE facility_id=v_facility AND kind='recipes' AND code='P16-RECIPE';
  v_run := v3.get_production_schedule(v_facility, DATE '2032-03-08')->'runs'->0;
  IF NOT (v_run->'readinessWarnings' @> '[{"code":"recipe_rows_missing"}]'::jsonb) THEN
    RAISE EXCEPTION 'Confirmed schedule reads did not derive missing recipe diagnostics: %', v_run;
  END IF;

  DELETE FROM v3.master_records
    WHERE facility_id=v_facility AND kind='recipes' AND code='P16-DOUGH';
  DELETE FROM v3.master_records
    WHERE facility_id=v_facility AND kind='production-setups' AND code='P16-SHIPPING';
  DELETE FROM v3.setup_run_template_records
    WHERE facility_id=v_facility AND code='P16-TEMPLATE';
  DELETE FROM v3.master_records
    WHERE facility_id=v_facility AND kind='production-setups' AND code='P16-SETUP';
  UPDATE v3.products SET active=false WHERE facility_id=v_facility AND code='P16-PRODUCT';
  v_warnings := v3.schedule_run_readiness(v_facility, jsonb_build_object(
    'productCode','P16-PRODUCT','productionSetupCode','P16-SETUP','runTemplateCode','P16-TEMPLATE'
  ));
  IF NOT (v_warnings @> '[{"code":"product_unavailable"},{"code":"production_setup_unavailable"},{"code":"run_template_unavailable"}]'::jsonb) THEN
    RAISE EXCEPTION 'Missing or inactive setup inputs were not explicit: %', v_warnings;
  END IF;
END
$$;

DO $$
DECLARE
  v_facility uuid;
  v_dough jsonb := '{"productCode":"P16-DOUGH-ONLY","productionSetupCode":"NONE","runTemplateCode":"NONE"}'::jsonb;
  v_case jsonb := '{"productCode":"P16-CASE-ONLY","productionSetupCode":"NONE","runTemplateCode":"NONE"}'::jsonb;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.products(facility_id, code, name, base_unit, active) VALUES
    (v_facility,'P16-DOUGH-ONLY','Dough warning','case',true),
    (v_facility,'P16-CASE-ONLY','Case warning','case',true);
  INSERT INTO v3.master_records(facility_id, kind, code, name, product_code, data) VALUES
    (v_facility,'recipes','P16-DOUGH-ONLY-ROW','Dough warning','P16-DOUGH-ONLY',
      '{"sourceFamily":"dough-procedure","doughballYield":600}'::jsonb),
    (v_facility,'production-setups','P16-CASE-ONLY-ROW','Case warning','P16-CASE-ONLY',
      '{"sourceFamily":"shipping-guide","pizzasPerCase":12}'::jsonb);
  IF NOT (v3.schedule_run_readiness(v_facility,v_dough) @> '[{"code":"case_capacity_unavailable"}]'::jsonb) THEN
    RAISE EXCEPTION 'Missing case capacity was not diagnosed.';
  END IF;
  IF NOT (v3.schedule_run_readiness(v_facility,v_case) @> '[{"code":"dough_yield_unavailable"}]'::jsonb) THEN
    RAISE EXCEPTION 'Missing dough yield was not diagnosed.';
  END IF;
END
$$;

ROLLBACK;
