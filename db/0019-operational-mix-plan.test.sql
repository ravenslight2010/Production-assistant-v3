\set QUIET on
\pset footer off

BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid:='19000000-0000-4000-8000-000000000001';
  v_date date:='2026-12-01';
  v_pizza uuid:='19000000-0000-4000-8000-000000000011';
  v_mozz uuid:='19000000-0000-4000-8000-000000000012';
  v_prov uuid:='19000000-0000-4000-8000-000000000013';
  v_label uuid:='19000000-0000-4000-8000-000000000015';
  v_schedule uuid:='19000000-0000-4000-8000-000000000014';
  v_product_mix uuid;
  v_prep_mix uuid;
  v_prep_record v3.mix_recipes;
  v_result jsonb;
  v_first jsonb;
  v_plan jsonb;
  v_entry jsonb;
  v_lot uuid;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.products(facility_id,id,code,name,base_unit,active) VALUES
    (v_facility,v_pizza,'MIX-PIZZA','Mix Pizza','case',true),
    (v_facility,v_mozz,'MIX-MOZZ','Mozzarella','lb',true),
    (v_facility,v_prov,'MIX-PROV','Provolone','lb',true),
    (v_facility,v_label,'MIX-LABEL','Mix Label','each',true);
  v_result:=v3.stage_setup_catalog_import(v_facility,v_actor,'0019-template',repeat('1',64),'run-templates',
    '[{"code":"MIX-TEMPLATE","name":"Mix template","data":{"brand":"Mix","flavor":"Pizza","values":{"pizzasPerCase":12,"casesPerLayer":2,"app1Type":"Mozzarella","app1OzPerPizza":2}}}]');
  PERFORM v3.apply_setup_catalog_import(v_facility,v_actor,(v_result->>'importId')::uuid);
  INSERT INTO v3.master_records(facility_id,kind,code,name,product_code,data) VALUES
    (v_facility,'recipes','MIX-RECIPE','Mix recipe','MIX-PIZZA','{"station_key":"sauce","ingredients":[{"product_code":"MIX-MOZZ","quantity":2,"unit":"lb"}]}'),
    (v_facility,'production-setups','MIX-SETUP','Mix setup','MIX-PIZZA','{"recipe_codes":["MIX-RECIPE"],"packaging_per_case":[{"product_code":"MIX-LABEL","quantity":1,"unit":"each"}]}');
  INSERT INTO v3.production_schedules(facility_id,production_date,revision,plan,updated_by) VALUES
    (v_facility,v_date,1,jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(
      jsonb_build_object('id',v_schedule,'productCode','MIX-PIZZA','productionSetupCode','MIX-SETUP','runTemplateCode','MIX-TEMPLATE','targetCases',10,'notes',''))),v_actor);

  v_first:=v3.apply_mix_recipe_command(v_facility,v_actor,'0019-product-recipe',repeat('2',64),0,
    jsonb_build_object('type','upsert','recipe',jsonb_build_object('id',NULL,'kind','product','productId',v_pizza,
      'name','Product Cheese','notes','','batchSizeLbs','20','daysEarly',2,'enabled',true,'components',jsonb_build_array(
        jsonb_build_object('ingredientProductId',v_mozz,'ouncesPerPizza','2','referencePoundsPerBatch',NULL)))));
  ASSERT v_first->>'outcome'='accepted','product recipe should save';
  v_product_mix:=(v_first->'recipe'->>'id')::uuid;
  v_result:=v3.apply_mix_recipe_command(v_facility,v_actor,'0019-prep-recipe',repeat('3',64),0,
    jsonb_build_object('type','upsert','recipe',jsonb_build_object('id',NULL,'kind','prep','productId',NULL,
      'name','Prep Cheese','notes','','batchSizeLbs','25','daysEarly',2,'enabled',true,'components',jsonb_build_array(
        jsonb_build_object('ingredientProductId',v_prov,'ouncesPerPizza','1','referencePoundsPerBatch',NULL)))));
  v_prep_mix:=(v_result->'recipe'->>'id')::uuid;
  PERFORM v3.apply_substitution_command(v_facility,v_actor,v_date,'0019-swap',repeat('4',64),0,
    jsonb_build_object('type','upsert','rule',jsonb_build_object('id',NULL,'ingredient','Mozzarella','action','swap',
      'substituteProductId',v_prov,'quantity','4')));

  v_plan:=v3.get_mix_plan(v_facility,v_date);
  SELECT entry.value INTO v_entry FROM jsonb_array_elements(v_plan#>'{groups,0,entries}') entry(value)
    WHERE entry.value->>'mixId'=v_product_mix::text;
  ASSERT (v_entry->>'componentLbs')::numeric=18,'product component pounds should use 144 pizzas';
  ASSERT (v_entry->>'totalLbs')::numeric=40.7,'product total should include 15 percent waste and 20 pounds';
  ASSERT (v_entry->>'remainingLbs')::numeric=40.7,'initial remaining should equal total';
  SELECT entry.value INTO v_entry FROM jsonb_array_elements(v_plan#>'{groups,0,entries}') entry(value)
    WHERE entry.value->>'mixId'=v_prep_mix::text;
  ASSERT (v_entry->>'componentLbs')::numeric=36,'prep should use substitution-aware per-pizza amount';
  ASSERT v_entry#>>'{contributions,0,ingredients,0,productId}'=v_prov::text,'prep should expose effective ingredient identity';
  SELECT * INTO STRICT v_prep_record FROM v3.mix_recipes WHERE facility_id=v_facility AND id=v_prep_mix;
  v_entry:=v3.mix_plan_entry(v_prep_record,v_date,NULL,NULL,jsonb_build_array(jsonb_build_object(
    'key','missing-prep','pizzas',100,'ingredients',jsonb_build_array(jsonb_build_object(
      'productId',v_prov,'name','Provolone','ouncesPerPizza',NULL)),'warnings','[]'::jsonb)),0,0,0);
  ASSERT (v_entry->>'componentLbs')::numeric=6.25,'missing prep amount should use the recipe fallback';
  ASSERT v_entry#>'{components,0,missingRuns}'=jsonb_build_array('missing-prep'),'missing prep amount should identify the run';

  v_first:=v3.apply_mix_plan_command(v_facility,v_actor,'0019-amount',repeat('5',64),0,
    jsonb_build_object('type','set-amount','productionDate',v_date,'mixId',v_product_mix,'productId',v_pizza,
      'alreadyMadeLbs','5','actualMadeLbs','0'));
  ASSERT v_first->>'outcome'='accepted','dated amount should save';
  SELECT entry.value INTO v_entry FROM jsonb_array_elements(v_first->'plan'#>'{groups,0,entries}') entry(value)
    WHERE entry.value->>'mixId'=v_product_mix::text;
  ASSERT (v_entry->>'remainingLbs')::numeric=35.7,'already made should reduce aggregate once';
  ASSERT (v_entry->>'batches')::numeric=1.785,'batch counts should remain fractional';
  v_result:=v3.apply_mix_plan_command(v_facility,v_actor,'0019-amount',repeat('5',64),0,
    jsonb_build_object('type','set-amount','productionDate',v_date,'mixId',v_product_mix,'productId',v_pizza,
      'alreadyMadeLbs','5','actualMadeLbs','0'));
  ASSERT v_result=v_first||jsonb_build_object('replayed',true),'dated amount retry should return original response';
  v_result:=v3.apply_mix_plan_command(v_facility,v_actor,'0019-stale',repeat('6',64),0,
    jsonb_build_object('type','set-amount','productionDate',v_date,'mixId',v_product_mix,'productId',v_pizza,
      'alreadyMadeLbs','6','actualMadeLbs','0'));
  ASSERT v_result->>'outcome'='conflict','stale dated revision should conflict';

  v_result:=v3.apply_mix_surplus_command(v_facility,v_actor,'0019-surplus',repeat('7',64),0,
    jsonb_build_object('type','record','mixId',v_product_mix,'productId',v_pizza,'productionDate',v_date,
      'quantityLbs','12','location','Rack A'));
  v_lot:=(v_result->'surplus'->'lots'->0->>'id')::uuid;
  ASSERT v_result->'surplus'->'lots'->0->>'remainingLbs'='12','manual lot should be available';
  v_result:=v3.apply_mix_surplus_command(v_facility,v_actor,'0019-allocate',repeat('8',64),1,
    jsonb_build_object('type','allocate','lotId',v_lot,'targetDate',v_date+1,'quantityLbs','5'));
  ASSERT v_result->'surplus'->'lots'->0->>'remainingLbs'='7','allocation should reduce available balance';
  v_result:=v3.apply_mix_surplus_command(v_facility,v_actor,'0019-over',repeat('9',64),2,
    jsonb_build_object('type','allocate','lotId',v_lot,'targetDate',v_date+2,'quantityLbs','8'));
  ASSERT v_result->>'outcome'='conflict' AND v_result->>'reason'='over_allocation','over allocation should conflict';
  v_result:=v3.apply_mix_surplus_command(v_facility,v_actor,'0019-void',repeat('a',64),2,
    jsonb_build_object('type','void','lotId',v_lot));
  ASSERT v_result->'surplus'->'lots'->0->>'remainingLbs'='12','void should release allocations';
  ASSERT jsonb_array_length(v_result->'surplus'->'lots'->0->'allocations')=0,'void should remove active allocations';
  ASSERT (SELECT count(*) FROM v3.mix_surplus_history WHERE facility_id=v_facility AND lot_id=v_lot)=3,'surplus history should be retained';
END
$$;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid:='19100000-0000-4000-8000-000000000001';
  v_date date:='2026-12-10';
  v_warehouse uuid:='19100000-0000-4000-8000-000000000010';
  v_pizza uuid:='19100000-0000-4000-8000-000000000011';
  v_flour uuid:='19100000-0000-4000-8000-000000000012';
  v_mozz uuid:='19100000-0000-4000-8000-000000000013';
  v_run uuid:='19100000-0000-4000-8000-000000000014';
  v_mix uuid;
  v_count uuid;
  v_plan jsonb;
  v_result jsonb;
  v_finalization jsonb;
  v_balance numeric;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.inventory_warehouses(facility_id,id,name,is_production,created_by,active)
    VALUES(v_facility,v_warehouse,'Mix completion production',true,v_actor,true);
  INSERT INTO v3.products(facility_id,id,code,name,base_unit,active) VALUES
    (v_facility,v_pizza,'MIX-COMPLETE-PIZZA','Completion Mix Pizza','case',true),
    (v_facility,v_flour,'MIX-COMPLETE-FLOUR','Completion Mix Flour','lb',true),
    (v_facility,v_mozz,'MIX-COMPLETE-MOZZ','Completion Mix Mozzarella','lb',true);
  v_count:=(v3.stage_opening_count(v_facility,v_actor,'0019-opening',repeat('b',64),v_warehouse,
    (SELECT jsonb_agg(jsonb_build_object('productCode',p.code,'quantity','0') ORDER BY p.code)
      FROM v3.products p WHERE p.facility_id=v_facility AND p.active))->>'countId')::uuid;
  PERFORM v3.review_opening_count(v_facility,v_actor,v_count);
  PERFORM v3.apply_opening_count(v_facility,v_actor,v_count);
  UPDATE v3.inventory_balances SET quantity=1000 WHERE facility_id=v_facility AND warehouse_id=v_warehouse
    AND product_id IN (v_flour,v_mozz);
  INSERT INTO v3.inventory_lots(facility_id,id,warehouse_id,product_id,lot_number,received_on,quantity) VALUES
    (v_facility,'19100000-0000-4000-8000-000000000015',v_warehouse,v_flour,'MIX-FLOUR-LOT',v_date,1000),
    (v_facility,'19100000-0000-4000-8000-000000000016',v_warehouse,v_mozz,'MIX-MOZZ-LOT',v_date,1000);
  v_result:=v3.apply_mix_recipe_command(v_facility,v_actor,'0019-complete-recipe',repeat('c',64),0,
    jsonb_build_object('type','upsert','recipe',jsonb_build_object('id',NULL,'kind','product','productId',v_pizza,
      'name','Completion Cheese','notes','','batchSizeLbs','20','daysEarly',0,'enabled',true,'components',jsonb_build_array(
        jsonb_build_object('ingredientProductId',v_mozz,'ouncesPerPizza','2','referencePoundsPerBatch',NULL)))));
  v_mix:=(v_result->'recipe'->>'id')::uuid;
  v_plan:=jsonb_build_object('code','MIX-COMPLETE','name','Mix completion plan',
    'warehouse',jsonb_build_object('id',v_warehouse,'name','Production'),
    'recipes',jsonb_build_array(jsonb_build_object('code','DOUGH','name','Dough','stationKey','dough','ingredients',
      jsonb_build_array(jsonb_build_object('productId',v_flour,'productCode','MIX-COMPLETE-FLOUR','productName','Completion Mix Flour','quantity','10','unit','lb')))),
    'packagingPerCase','[]'::jsonb);
  INSERT INTO v3.runs(facility_id,id,status,revision,created_at,updated_at,production_date,setup_snapshot) VALUES
    (v_facility,v_run,'planned',0,clock_timestamp(),clock_timestamp(),v_date,jsonb_build_object(
      'label','Mix completion','targetCases',10,'productCode','MIX-COMPLETE-PIZZA','productionPlan',v_plan,
      'dieSetup',jsonb_build_object('lineSettings',jsonb_build_object('casesPerLayer',2))));
  v_result:=v3.apply_run_lifecycle_command(v_facility,v_run,v_actor,'0019-complete-start',repeat('d',64),'start',0);
  ASSERT v_result->>'outcome'='accepted','mix completion run should start';
  INSERT INTO v3.run_station_progress(facility_id,run_id,station_key,status,inputs,progress,updated_at) VALUES
    (v_facility,v_run,'dough','not_started','{"pizzasPerCase":12}'::jsonb,'{"batchesMade":2}'::jsonb,clock_timestamp());
  v_result:=v3.apply_mix_plan_command(v_facility,v_actor,'0019-complete-amount',repeat('e',64),0,
    jsonb_build_object('type','set-amount','productionDate',v_date,'mixId',v_mix,'productId',v_pizza,
      'alreadyMadeLbs','5','actualMadeLbs','50'));
  ASSERT v_result->>'outcome'='accepted','actual made should save before completion';
  v_result:=v3.complete_run_with_inventory(v_facility,v_run,v_actor,'0019-complete-finish',repeat('f',64),'complete',1);
  ASSERT v_result->>'outcome'='accepted','run and mix finalization should commit together';
  ASSERT (SELECT count(*) FROM v3.mix_finalizations WHERE facility_id=v_facility AND first_run_id=v_run)=1,'aggregate should finalize once';
  SELECT row_to_json(f) INTO v_finalization FROM v3.mix_finalizations f WHERE f.facility_id=v_facility AND f.first_run_id=v_run;
  ASSERT (v_finalization->>'surplus_lbs')::numeric=14.3,'overproduction should create exact surplus';
  ASSERT (v_finalization->>'fresh_lbs')::numeric=50,'actual made should scale fresh consumption';
  ASSERT (SELECT count(*) FROM v3.inventory_movements WHERE facility_id=v_facility AND movement_group_id=(v_finalization->>'id')::uuid)=1,
    'mix finalization should write one component movement';
  ASSERT (SELECT count(*) FROM v3.mix_surplus_lots WHERE facility_id=v_facility AND source_finalization_run_id=v_run AND surplus_lbs=14.3)=1,
    'automatic surplus lot should be retained';
  ASSERT (SELECT count(*) FROM v3.run_inventory_consumptions WHERE facility_id=v_facility AND run_id=v_run)=1,
    'base recipe and packaging consumption should remain exactly once';
  v_result:=v3.apply_mix_plan_command(v_facility,v_actor,'0019-finalized-edit',repeat('0',64),1,
    jsonb_build_object('type','set-amount','productionDate',v_date,'mixId',v_mix,'productId',v_pizza,
      'alreadyMadeLbs','7','actualMadeLbs','60'));
  ASSERT v_result->>'outcome'='conflict' AND v_result->>'reason'='finalized','finalized basis should be read-only';
  v_result:=v3.complete_run_with_inventory(v_facility,v_run,v_actor,'0019-complete-finish',repeat('f',64),'complete',1);
  ASSERT v_result->>'replayed'='true','completion retry should replay';
  ASSERT (SELECT count(*) FROM v3.mix_finalizations WHERE facility_id=v_facility AND first_run_id=v_run)=1,'replay must not finalize again';
END
$$;

\echo '0019 operational Mix Plan SQL tests passed'

ROLLBACK;
