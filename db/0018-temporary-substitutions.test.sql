\set QUIET on
\pset footer off

BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '18000000-0000-4000-8000-000000000001';
  v_date date := '2026-12-01';
  v_semolina uuid := '18000000-0000-4000-8000-000000000011';
  v_mozzarella uuid := '18000000-0000-4000-8000-000000000012';
  v_rule uuid;
  v_base jsonb;
  v_effective jsonb;
  v_first jsonb;
  v_result jsonb;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.products(facility_id,id,code,name,base_unit,active) VALUES
    (v_facility,v_semolina,'SUB-SEMOLINA','Sub Semolina','lb',true),
    (v_facility,v_mozzarella,'SUB-MOZZ','Sub Mozzarella','lb',true);
  v_base := jsonb_build_object(
    'code','BASE','name','Base plan','warehouse',jsonb_build_object('id',gen_random_uuid(),'name','Test'),
    'recipes',jsonb_build_array(jsonb_build_object(
      'code','DOUGH','name','Dough','stationKey','dough','ingredients',jsonb_build_array(
        jsonb_build_object('productId',gen_random_uuid(),'productCode','FLOUR','productName','Flour','quantity','10','unit','lb'),
        jsonb_build_object('productId',gen_random_uuid(),'productCode','CHEESE','productName','Cheese','quantity','2','unit','lb'),
        jsonb_build_object('productId',gen_random_uuid(),'productCode','CHEESE-2','productName','Cheese','quantity','3','unit','lb'),
        jsonb_build_object('productId',gen_random_uuid(),'productCode','OIL','productName','Oil','quantity','1','unit','lb')
      ))),
    'packagingPerCase','[]'::jsonb
  );
  v_first := v3.apply_substitution_command(
    v_facility,v_actor,v_date,'0018-swap',repeat('a',64),0,
    jsonb_build_object('type','upsert','rule',jsonb_build_object(
      'id',NULL,'ingredient','Flour','action','swap','substituteProductId',v_semolina,'quantity',NULL))
  );
  ASSERT v_first->'overlay'->>'revision'='1', 'first upsert should advance revision';
  ASSERT jsonb_array_length(v_first->'overlay'->'rules')=1, 'first rule should be visible';
  v_rule := (v_first->'overlay'->'rules'->0->>'id')::uuid;

  v_result := v3.apply_substitution_command(
    v_facility,v_actor,v_date,'0018-add',repeat('b',64),1,
    jsonb_build_object('type','upsert','rule',jsonb_build_object(
      'id',NULL,'ingredient','Cheese','action','add','substituteProductId',v_mozzarella,'quantity','0.5'))
  );
  ASSERT v_result->>'outcome'='accepted', 'add should be accepted';
  v_result := v3.apply_substitution_command(
    v_facility,v_actor,v_date,'0018-remove',repeat('c',64),2,
    jsonb_build_object('type','upsert','rule',jsonb_build_object(
      'id',NULL,'ingredient','Oil','action','remove','substituteProductId',NULL,'quantity',NULL))
  );
  ASSERT v_result->>'outcome'='accepted', 'remove should be accepted';

  v_effective := v3.effective_production_plan(v_facility,v_date,v_base);
  ASSERT jsonb_array_length(v_effective#>'{recipes,0,ingredients}')=5,
    'add should retain each original row and append one substitute per match';
  ASSERT v_effective#>>'{recipes,0,ingredients,0,productName}'='Sub Semolina', 'swap should replace identity';
  ASSERT v_effective#>>'{recipes,0,ingredients,0,quantity}'='10', 'swap without quantity should preserve amount';
  ASSERT v_effective#>>'{recipes,0,ingredients,1,productName}'='Cheese', 'add should preserve original row';
  ASSERT v_effective#>>'{recipes,0,ingredients,2,productName}'='Sub Mozzarella', 'add should append substitute';
  ASSERT v_effective#>>'{recipes,0,ingredients,4,productName}'='Sub Mozzarella', 'repeated ingredients should transform per row';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_effective#>'{recipes,0,ingredients}') line(value)
    WHERE value->>'productName'='Oil'), 'remove should drop matching rows';
  ASSERT v3.effective_production_plan(v_facility,v_date,v_base)->'packagingPerCase'=v_base->'packagingPerCase',
    'packaging must remain unchanged';
  ASSERT v_base#>>'{recipes,0,ingredients,0,productName}'='Flour', 'base plan must remain immutable';

  v_result := v3.apply_substitution_command(
    v_facility,v_actor,v_date,'0018-case-upsert',repeat('d',64),3,
    jsonb_build_object('type','upsert','rule',jsonb_build_object(
      'id',NULL,'ingredient',' fLoUr ','action','swap','substituteProductId',v_semolina,'quantity','12'))
  );
  ASSERT jsonb_array_length(v_result->'overlay'->'rules')=3, 'case-insensitive upsert must not duplicate a rule';
  ASSERT EXISTS (SELECT 1 FROM v3.substitution_rules WHERE facility_id=v_facility AND production_date=v_date
    AND id=v_rule AND ingredient='fLoUr' AND substitute_quantity=12), 'upsert should retain rule identity and update amount';

  v_result := v3.apply_substitution_command(
    v_facility,v_actor,v_date,'0018-swap',repeat('a',64),0,
    jsonb_build_object('type','upsert','rule',jsonb_build_object(
      'id',NULL,'ingredient','Flour','action','swap','substituteProductId',v_semolina,'quantity',NULL))
  );
  ASSERT v_result->>'replayed'='true', 'exact retry should be marked replayed';
  ASSERT v_result=v_first||jsonb_build_object('replayed',true), 'exact retry must return original response';
  ASSERT v_result->'overlay'->>'revision'='1', 'replay must not return later overlay state';

  v_result := v3.apply_substitution_command(
    v_facility,v_actor,v_date,'0018-stale',repeat('e',64),0,jsonb_build_object('type','clear')
  );
  ASSERT v_result->>'outcome'='conflict', 'stale revision should conflict';
  ASSERT v_result->'currentOverlay'->>'revision'='4', 'conflict should include canonical current overlay';
  ASSERT v3.get_production_schedule(v_facility,v_date)->'substitutionOverlay'->>'revision'='4',
    'schedule response should include the dated overlay';

  v_result := v3.apply_substitution_command(
    v_facility,v_actor,v_date,'0018-clear',repeat('f',64),4,jsonb_build_object('type','clear')
  );
  ASSERT jsonb_array_length(v_result->'overlay'->'rules')=0, 'clear should remove active rules';
  ASSERT (SELECT count(*) FROM v3.substitution_rule_history WHERE facility_id=v_facility AND production_date=v_date)=7,
    'all upserts and cleared rules should retain audit history';
  ASSERT v3.get_substitution_overlay(v_facility,v_date+1)->>'revision'='0',
    'overlay must not carry into the next production date';
END
$$;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '18100000-0000-4000-8000-000000000001';
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  v_warehouse uuid := '18100000-0000-4000-8000-000000000015';
  v_pizza uuid := '18100000-0000-4000-8000-000000000011';
  v_flour uuid := '18100000-0000-4000-8000-000000000012';
  v_semolina uuid := '18100000-0000-4000-8000-000000000013';
  v_schedule_run uuid := '18100000-0000-4000-8000-000000000014';
  v_label uuid := '18100000-0000-4000-8000-000000000016';
  v_count uuid;
  v_run jsonb;
  v_result jsonb;
  v_item jsonb;
  v_movements bigint;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.inventory_warehouses(facility_id,id,name,is_production,created_by,active)
    VALUES (v_facility,v_warehouse,'Substitution demand production',true,v_actor,true);
  INSERT INTO v3.products(facility_id,id,code,name,base_unit,active) VALUES
    (v_facility,v_pizza,'SUB-DEMAND-PIZZA','Substitution demand pizza','case',true),
    (v_facility,v_flour,'SUB-DEMAND-FLOUR','Demand Flour','lb',true),
    (v_facility,v_semolina,'SUB-DEMAND-SEMOLINA','Demand Semolina','lb',true),
    (v_facility,v_label,'SUB-DEMAND-LABEL','Demand Label','each',true);
  v_count := (v3.stage_opening_count(
    v_facility,v_actor,'0018-demand-opening',repeat('0',64),v_warehouse,
    (SELECT jsonb_agg(jsonb_build_object('productCode',p.code,'quantity','0') ORDER BY p.code)
      FROM v3.products p WHERE p.facility_id=v_facility AND p.active)
  )->>'countId')::uuid;
  PERFORM v3.review_opening_count(v_facility,v_actor,v_count);
  PERFORM v3.apply_opening_count(v_facility,v_actor,v_count);
  INSERT INTO v3.master_records(facility_id,kind,code,name,product_code,data) VALUES
    (v_facility,'recipes','SUB-DEMAND-DOUGH','Demand dough','SUB-DEMAND-PIZZA',
      '{"station_key":"dough","dough_yield_crusts":4,"ingredients":[{"product_code":"SUB-DEMAND-FLOUR","quantity":2,"unit":"lb"}]}'),
    (v_facility,'production-setups','SUB-DEMAND-SETUP','Demand setup','SUB-DEMAND-PIZZA',
      '{"recipe_codes":["SUB-DEMAND-DOUGH"],"packaging_per_case":[{"product_code":"SUB-DEMAND-LABEL","quantity":1,"unit":"each"}]}');
  v_result := v3.stage_setup_catalog_import(v_facility,v_actor,'0018-template',repeat('1',64),'run-templates',
    '[{"code":"SUB-DEMAND-TEMPLATE","name":"Demand template","data":{"brand":"Substitution","flavor":"Demand","values":{"crustsPerCase":2,"doughBatchYield":4}}}]');
  PERFORM v3.apply_setup_catalog_import(v_facility,v_actor,(v_result->>'importId')::uuid);
  v_result := v3.stage_setup_catalog_import(v_facility,v_actor,'0018-freezer',repeat('2',64),'freezer-pull-items',
    jsonb_build_array(jsonb_build_object('code','SUB-DEMAND-FREEZER','name','Demand Semolina','data',jsonb_build_object(
      'ingredientName','Demand Semolina','ingredientCode',NULL,'daysEarly',2,'enabled',true))));
  PERFORM v3.apply_setup_catalog_import(v_facility,v_actor,(v_result->>'importId')::uuid);
  v_run := jsonb_build_object('id',v_schedule_run,'productCode','SUB-DEMAND-PIZZA','productionSetupCode','SUB-DEMAND-SETUP',
    'runTemplateCode','SUB-DEMAND-TEMPLATE','targetCases',10,'notes','');
  INSERT INTO v3.production_schedules(facility_id,production_date,revision,plan,updated_by) VALUES
    (v_facility,v_today,1,jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(v_run)),v_actor);
  v_result := v3.apply_substitution_command(v_facility,v_actor,v_today,'0018-demand',repeat('3',64),0,
    jsonb_build_object('type','upsert','rule',jsonb_build_object('id',NULL,'ingredient','Demand Flour','action','swap',
      'substituteProductId',v_semolina,'quantity',NULL)));
  ASSERT v_result->>'outcome'='accepted', 'demand overlay should save';

  SELECT jsonb_build_object('productId',product_id,'quantity',quantity) INTO v_item
    FROM v3.scheduled_run_demand(v_facility,v_today,v_run,1);
  ASSERT v_item->>'productId'=v_semolina::text AND (v_item->>'quantity')::numeric=10,
    'scheduled warehouse demand should use effective product identity and per-batch quantity';
  v_item := v3.scheduled_freezer_pull_lines(v_facility,v_today,v_run,v_today);
  ASSERT jsonb_array_length(v_item)=1 AND v_item->0->>'productCode'='SUB-DEMAND-SEMOLINA'
    AND v_item->0->>'quantity'='10', 'freezer pull should use the same effective ingredient rows';

  SELECT count(*) INTO v_movements FROM v3.inventory_movements WHERE facility_id=v_facility;
  v_result := v3.warehouse_guidance(v_facility);
  SELECT item.value INTO v_item FROM jsonb_array_elements(v_result#>'{warehouseNeeds,groups}') grp(value)
    CROSS JOIN jsonb_array_elements(grp.value->'items') item(value)
    WHERE item.value->>'productCode'='SUB-DEMAND-SEMOLINA';
  ASSERT v_item->>'quantity'='10', 'warehouse guidance should expose substituted scheduled demand';
  ASSERT (SELECT count(*) FROM v3.inventory_movements WHERE facility_id=v_facility)=v_movements,
    'effective demand reads must not post inventory movements';

  SELECT jsonb_build_object('productId',product_id,'quantity',quantity) INTO v_item
    FROM v3.scheduled_run_demand(v_facility,v_today+1,v_run,1);
  ASSERT v_item->>'productId'=v_flour::text, 'next-date demand should use original ingredient';
END
$$;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '18200000-0000-4000-8000-000000000001';
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date + 1;
  v_warehouse uuid;
  v_flour uuid := '18200000-0000-4000-8000-000000000011';
  v_semolina uuid := '18200000-0000-4000-8000-000000000012';
  v_run uuid := '18200000-0000-4000-8000-000000000013';
  v_other_run uuid := '18200000-0000-4000-8000-000000000014';
  v_plan jsonb;
  v_result jsonb;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  SELECT w.id INTO STRICT v_warehouse FROM v3.inventory_warehouses w
    WHERE w.facility_id=v_facility AND w.active AND w.is_production;
  INSERT INTO v3.products(facility_id,id,code,name,base_unit,active) VALUES
    (v_facility,v_flour,'SUB-COMPLETE-FLOUR','Completion Flour','lb',true),
    (v_facility,v_semolina,'SUB-COMPLETE-SEMOLINA','Completion Semolina','lb',true);
  INSERT INTO v3.inventory_balances(facility_id,warehouse_id,product_id,quantity) VALUES
    (v_facility,v_warehouse,v_flour,100),(v_facility,v_warehouse,v_semolina,100);
  INSERT INTO v3.inventory_lots(facility_id,id,warehouse_id,product_id,lot_number,received_on,quantity) VALUES
    (v_facility,'18200000-0000-4000-8000-000000000016',v_warehouse,v_flour,'SUB-COMPLETE-FLOUR-LOT',v_today,100),
    (v_facility,'18200000-0000-4000-8000-000000000017',v_warehouse,v_semolina,'SUB-COMPLETE-SEMOLINA-LOT',v_today,100);
  v_plan := jsonb_build_object('code','COMPLETE','name','Completion plan',
    'warehouse',jsonb_build_object('id',v_warehouse,'name','Production'),
    'recipes',jsonb_build_array(jsonb_build_object('code','DOUGH','name','Dough','stationKey','dough','ingredients',
      jsonb_build_array(jsonb_build_object('productId',v_flour,'productCode','SUB-COMPLETE-FLOUR',
        'productName','Completion Flour','quantity','10','unit','lb')))),
    'packagingPerCase','[]'::jsonb);
  INSERT INTO v3.runs(facility_id,id,status,revision,created_at,updated_at,production_date,setup_snapshot) VALUES
    (v_facility,v_run,'planned',0,clock_timestamp(),clock_timestamp(),v_today,
      jsonb_build_object('label','Completion substitution','targetCases',2,'productCode','SUB-COMPLETE-PIZZA','productionPlan',v_plan));
  v_result := v3.apply_substitution_command(v_facility,v_actor,v_today,'0018-complete-rule',repeat('4',64),0,
    jsonb_build_object('type','upsert','rule',jsonb_build_object('id',NULL,'ingredient','Completion Flour','action','swap',
      'substituteProductId',v_semolina,'quantity','3')));
  v_result := v3.apply_run_lifecycle_command(v_facility,v_run,v_actor,'0018-complete-start',repeat('5',64),'start',0);
  ASSERT v_result->>'outcome'='accepted', 'completion fixture should start';
  INSERT INTO v3.run_station_progress(facility_id,run_id,station_key,status,progress,updated_at)
    VALUES (v_facility,v_run,'dough','not_started','{"batchesMade":2}'::jsonb,clock_timestamp());
  v_result := v3.complete_run_with_inventory(v_facility,v_run,v_actor,'0018-complete-finish',repeat('6',64),'complete',1);
  ASSERT v_result->>'outcome'='accepted', 'run should complete with effective plan';
  ASSERT v_result->'run'->'effectiveProductionPlan'#>>'{recipes,0,ingredients,0,productName}'='Completion Semolina',
    'completion response should retain effective product';
  ASSERT v_result->'run'->'substitutionOverlay'->>'revision'='1', 'completion should retain applied overlay revision';
  ASSERT v_result->'run'->'inventoryConsumption'->'lines'->0->>'required'='6',
    'completion should consume substitute quantity times station count';
  ASSERT v_result->'run'->'inventoryConsumption'->'lines'->0->>'productId'=v_semolina::text,
    'consumption should be redirected to substitute product';
  ASSERT NOT EXISTS (SELECT 1 FROM v3.inventory_movements WHERE facility_id=v_facility AND run_id=v_run AND product_id=v_flour),
    'original product must not be consumed after swap';

  v_result := v3.apply_substitution_command(v_facility,v_actor,v_today,'0018-after-complete',repeat('7',64),1,
    jsonb_build_object('type','upsert','rule',jsonb_build_object('id',NULL,'ingredient','Completion Flour','action','swap',
      'substituteProductId',v_semolina,'quantity','4')));
  v_result := v3.get_run(v_facility,v_run);
  ASSERT v_result->'substitutionOverlay'->>'revision'='1', 'later edits must not change completed overlay';
  ASSERT v_result->'effectiveProductionPlan'#>>'{recipes,0,ingredients,0,quantity}'='3',
    'later edits must not change completed effective plan';
  ASSERT v_result->'inventoryConsumption'->'lines'->0->>'required'='6', 'posted history must remain unchanged';
  ASSERT (SELECT count(*) FROM v3.completed_run_substitutions WHERE facility_id=v_facility AND run_id=v_run)=1,
    'completion should retain exactly one substitution snapshot';

  INSERT INTO v3.runs(facility_id,id,status,revision,created_at,updated_at,production_date,setup_snapshot) VALUES
    (v_facility,v_other_run,'planned',0,clock_timestamp(),clock_timestamp(),v_today,
      jsonb_build_object('label','Later active run','targetCases',2,'productionPlan',v_plan));
  ASSERT v3.get_run(v_facility,v_other_run)->'effectiveProductionPlan'#>>'{recipes,0,ingredients,0,quantity}'='4',
    'active runs should use the current dated overlay';
  BEGIN
    UPDATE v3.runs SET production_date=v_today+1 WHERE facility_id=v_facility AND id=v_other_run;
    RAISE EXCEPTION 'production date mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$$;

\echo '0018 temporary substitution SQL tests passed'

ROLLBACK;
