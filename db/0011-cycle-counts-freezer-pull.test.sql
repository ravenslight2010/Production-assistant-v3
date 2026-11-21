BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '91000000-0000-4000-8000-000000000001';
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  v_result jsonb;
  v_guidance jsonb;
  v_item jsonb;
  v_import jsonb;
  v_stock_rows bigint;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  SELECT count(*) INTO v_stock_rows FROM v3.inventory_balances;

  v_result := v3.save_cycle_count_schedule(
    v_facility, v_actor, 'cycle-create-dry', repeat('1',64), 'Dry storage', 7, true, 0
  );
  IF v_result->>'outcome' <> 'created' OR v_result#>>'{schedule,revision}' <> '1' THEN
    RAISE EXCEPTION 'Cycle count schedule was not created';
  END IF;
  v_guidance := v3.warehouse_guidance(v_facility);
  IF v_guidance#>>'{cycleCounts,0,section}' <> 'Dry storage'
     OR v_guidance#>>'{cycleCounts,0,due}' <> 'true'
     OR v_guidance#>>'{cycleCounts,0,lastCountedOn}' IS NOT NULL THEN
    RAISE EXCEPTION 'Never-counted enabled section was not due first';
  END IF;

  v_result := v3.mark_cycle_counted(v_facility, v_actor, 'cycle-mark-dry', repeat('2',64), 'Dry storage');
  IF v_result->>'outcome' <> 'accepted' OR v_result->>'countedOn' <> v_today::text THEN
    RAISE EXCEPTION 'Staff confirmation did not use the factory date';
  END IF;
  v_result := v3.mark_cycle_counted(v_facility, v_actor, 'cycle-mark-dry', repeat('2',64), 'Dry storage');
  IF v_result->>'replayed' <> 'true' OR (SELECT count(*) FROM v3.cycle_count_confirmations
    WHERE facility_id = v_facility AND section = 'Dry storage') <> 1 THEN
    RAISE EXCEPTION 'Exact count retry duplicated a confirmation';
  END IF;
  IF (SELECT count(*) FROM v3.inventory_balances) <> v_stock_rows THEN
    RAISE EXCEPTION 'Cycle count confirmation changed physical stock';
  END IF;
  v_guidance := v3.warehouse_guidance(v_facility);
  IF v_guidance#>>'{cycleCounts,0,due}' <> 'false'
     OR v_guidance#>>'{cycleCounts,0,lastCountedOn}' <> v_today::text THEN
    RAISE EXCEPTION 'Count confirmation did not clear the reminder';
  END IF;

  v_result := v3.save_cycle_count_schedule(
    v_facility, v_actor, 'cycle-disable-dry', repeat('3',64), 'Dry storage', 7, false, 2
  );
  IF v_result->>'outcome' <> 'retired' OR v_guidance->>'factoryDate' <> v_today::text THEN
    RAISE EXCEPTION 'Manager schedule retirement failed';
  END IF;
  v_guidance := v3.warehouse_guidance(v_facility);
  IF v_guidance#>>'{cycleCounts,0,due}' <> 'false' OR v_guidance#>>'{cycleCounts,0,enabled}' <> 'false' THEN
    RAISE EXCEPTION 'Disabled schedule still produced a reminder';
  END IF;

  INSERT INTO v3.products(facility_id, code, name, base_unit, active) VALUES
    (v_facility, 'GUIDE-PIZZA', 'Guidance Pizza', 'case', true),
    (v_facility, 'GUIDE-FLOUR', 'Guidance Flour', 'lb', true),
    (v_facility, 'GUIDE-SAUCE', 'Guidance Sauce', 'lb', true),
    (v_facility, 'GUIDE-LABEL', 'Guidance Label', 'each', true);
  INSERT INTO v3.master_records(facility_id, kind, code, name, product_code, data) VALUES
    (v_facility, 'recipes', 'GUIDE-DOUGH', 'Guidance dough', 'GUIDE-PIZZA',
      '{"station_key":"dough","ingredients":[{"product_code":"GUIDE-FLOUR","quantity":10,"unit":"lb"}]}'),
    (v_facility, 'recipes', 'GUIDE-SAUCE-R', 'Guidance sauce', 'GUIDE-PIZZA',
      '{"station_key":"sauce","ingredients":[{"product_code":"GUIDE-SAUCE","quantity":5,"unit":"lb"}]}'),
    (v_facility, 'production-setups', 'GUIDE-SETUP', 'Guidance setup', 'GUIDE-PIZZA',
      '{"recipe_codes":["GUIDE-DOUGH","GUIDE-SAUCE-R"],"packaging_per_case":[{"product_code":"GUIDE-LABEL","quantity":1,"unit":"each"}]}');

  v_import := v3.stage_setup_catalog_import(v_facility, v_actor, 'guide-template', repeat('4',64), 'run-templates',
    '[{"code":"GUIDE-TEMPLATE","name":"Guidance template","data":{"brand":"Guide","flavor":"Test","values":{"crustsPerCase":2,"doughBatchYield":4}}}]');
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, (v_import->>'importId')::uuid);
  v_import := v3.stage_setup_catalog_import(v_facility, v_actor, 'guide-freezer', repeat('5',64), 'freezer-pull-items', jsonb_build_array(
    jsonb_build_object('code','GUIDE-FREEZER-FLOUR','name','Guidance Flour','data',jsonb_build_object(
      'ingredientName','Guidance Flour','ingredientCode',NULL,'daysEarly',3,'enabled',true)),
    jsonb_build_object('code','GUIDE-FREEZER-SAUCE','name','Guidance Sauce','data',jsonb_build_object(
      'ingredientName','guidance sauce','ingredientCode',NULL,'daysEarly',3,'enabled',true)),
    jsonb_build_object('code','GUIDE-FREEZER-LABEL','name','Guidance Label','data',jsonb_build_object(
      'ingredientName','Guidance Label','ingredientCode',NULL,'daysEarly',1,'enabled',true)),
    jsonb_build_object('code','GUIDE-FREEZER-DISABLED','name','Disabled Flour','data',jsonb_build_object(
      'ingredientName','GUIDE-FLOUR','ingredientCode',NULL,'daysEarly',3,'enabled',false))
  ));
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, (v_import->>'importId')::uuid);

  INSERT INTO v3.production_schedules(facility_id, production_date, revision, plan, updated_by) VALUES
    (v_facility, v_today + 2, 1, jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(
      jsonb_build_object('id','91000000-0000-4000-8000-000000000011','productCode','GUIDE-PIZZA',
        'productionSetupCode','GUIDE-SETUP','runTemplateCode','GUIDE-TEMPLATE','targetCases',3,'notes','')
    )), v_actor),
    (v_facility, v_today - 1, 1, jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(
      jsonb_build_object('id','91000000-0000-4000-8000-000000000012','productCode','GUIDE-PIZZA',
        'productionSetupCode','GUIDE-SETUP','runTemplateCode','GUIDE-TEMPLATE','targetCases',3,'notes','')
    )), v_actor);

  v_guidance := v3.warehouse_guidance(v_facility);
  IF jsonb_array_length(v_guidance#>'{freezerPull,groups}') <> 1
     OR v_guidance#>>'{freezerPull,groups,0,productionDate}' <> (v_today + 2)::text
     OR jsonb_array_length(v_guidance#>'{freezerPull,groups,0,items}') <> 2 THEN
    RAISE EXCEPTION 'Freezer pull did not filter past runs, lead times, and disabled items: %', v_guidance;
  END IF;
  SELECT value INTO v_item FROM jsonb_array_elements(v_guidance#>'{freezerPull,groups,0,items}')
    WHERE value->>'productCode' = 'GUIDE-FLOUR';
  IF v_item->>'quantity' <> '20' OR v_item->>'unit' <> 'lb' OR v_item->>'resolved' <> 'true' THEN
    RAISE EXCEPTION 'Dough demand did not reuse recipe quantity and template capacity: %', v_item;
  END IF;
  SELECT value INTO v_item FROM jsonb_array_elements(v_guidance#>'{freezerPull,groups,0,items}')
    WHERE value->>'productCode' = 'GUIDE-SAUCE';
  IF v_item->>'quantity' IS NOT NULL OR v_item->>'resolved' <> 'false' OR v_item->>'warning' IS NULL THEN
    RAISE EXCEPTION 'Missing sauce capacity was guessed instead of warned: %', v_item;
  END IF;

  BEGIN
    PERFORM v3.save_cycle_count_schedule(v_facility, v_actor, 'cycle-stale', repeat('6',64), 'Dry storage', 7, true, 1);
    RAISE EXCEPTION 'Stale schedule revision was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE v3.cycle_count_confirmations SET counted_on = v_today - 1
      WHERE facility_id = v_facility AND section = 'Dry storage';
    RAISE EXCEPTION 'Count confirmation was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$$;

ROLLBACK;
