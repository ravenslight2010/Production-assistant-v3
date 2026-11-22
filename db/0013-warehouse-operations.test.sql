BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '93000000-0000-4000-8000-000000000001';
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  v_onsite uuid := '93000000-0000-4000-8000-000000000011';
  v_offsite uuid := '93000000-0000-4000-8000-000000000012';
  v_flour uuid;
  v_label uuid;
  v_pizza uuid;
  v_run uuid := '93000000-0000-4000-8000-000000000021';
  v_schedule_run uuid := '93000000-0000-4000-8000-000000000022';
  v_lot uuid := '93000000-0000-4000-8000-000000000023';
  v_guidance jsonb;
  v_result jsonb;
  v_item jsonb;
  v_stock_before jsonb;
  v_movements_before bigint;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.inventory_warehouses(facility_id,id,name,is_production,created_by,active) VALUES
    (v_facility,v_onsite,'Operations onsite',true,v_actor,true),
    (v_facility,v_offsite,'Operations reserve',false,v_actor,true);
  INSERT INTO v3.products(facility_id,code,name,base_unit,active) VALUES
    (v_facility,'OPS-PIZZA','Operations Pizza','case',true),
    (v_facility,'OPS-FLOUR','Operations Flour','lb',true),
    (v_facility,'OPS-LABEL','Operations Label','each',true);
  SELECT id INTO v_flour FROM v3.products WHERE facility_id=v_facility AND code='OPS-FLOUR';
  SELECT id INTO v_label FROM v3.products WHERE facility_id=v_facility AND code='OPS-LABEL';
  SELECT id INTO v_pizza FROM v3.products WHERE facility_id=v_facility AND code='OPS-PIZZA';
  INSERT INTO v3.inventory_balances(facility_id,warehouse_id,product_id,quantity,revision) VALUES
    (v_facility,v_onsite,v_flour,5,1),(v_facility,v_offsite,v_flour,50,1),
    (v_facility,v_onsite,v_label,100,1);
  INSERT INTO v3.inventory_lots(facility_id,id,warehouse_id,product_id,lot_number,received_on,expires_on,quantity) VALUES
    (v_facility,'93000000-0000-4000-8000-000000000031',v_onsite,v_flour,'ONSITE-SOON',v_today-4,v_today+1,5),
    (v_facility,'93000000-0000-4000-8000-000000000032',v_offsite,v_flour,'RESERVE-EXPIRED',v_today-5,v_today-1,50),
    (v_facility,'93000000-0000-4000-8000-000000000033',v_offsite,v_label,'NO-EXPIRY',v_today-5,NULL,100);
  INSERT INTO v3.master_records(facility_id,kind,code,name,product_code,data) VALUES
    (v_facility,'recipes','OPS-DOUGH','Operations dough','OPS-PIZZA',
      '{"station_key":"dough","ingredients":[{"product_code":"OPS-FLOUR","quantity":10,"unit":"lb"}]}'),
    (v_facility,'production-setups','OPS-SETUP','Operations setup','OPS-PIZZA',
      jsonb_build_object('recipe_codes',jsonb_build_array('OPS-DOUGH'),
        'packaging_per_case',jsonb_build_array(jsonb_build_object('product_code','OPS-LABEL','quantity',1,'unit','each'))));
  v_result := v3.stage_setup_catalog_import(v_facility,v_actor,'ops-template',repeat('1',64),'run-templates',
    '[{"code":"OPS-TEMPLATE","name":"Operations template","data":{"brand":"Ops","flavor":"Test","values":{"crustsPerCase":2,"doughBatchYield":4}}}]');
  PERFORM v3.apply_setup_catalog_import(v_facility,v_actor,(v_result->>'importId')::uuid);
  v_result := v3.stage_setup_catalog_import(v_facility,v_actor,'ops-freezer',repeat('4',64),'freezer-pull-items',
    jsonb_build_array(jsonb_build_object('code','OPS-FREEZER-FLOUR','name','Operations Flour','data',jsonb_build_object(
      'ingredientName','Operations Flour','ingredientCode',NULL,'daysEarly',2,'enabled',true))));
  PERFORM v3.apply_setup_catalog_import(v_facility,v_actor,(v_result->>'importId')::uuid);
  INSERT INTO v3.production_schedules(facility_id,production_date,revision,plan,updated_by) VALUES
    (v_facility,v_today,1,jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(
      jsonb_build_object('id',v_schedule_run,'productCode','OPS-PIZZA','productionSetupCode','OPS-SETUP',
        'runTemplateCode','OPS-TEMPLATE','targetCases',10,'notes',''))),v_actor),
    (v_facility,v_today+1,1,jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(
      jsonb_build_object('id','93000000-0000-4000-8000-000000000024','productCode','OPS-PIZZA','productionSetupCode','OPS-SETUP',
        'runTemplateCode','OPS-TEMPLATE','targetCases',4,'notes',''))),v_actor),
    (v_facility,v_today-1,1,jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(
      jsonb_build_object('id','93000000-0000-4000-8000-000000000025','productCode','OPS-PIZZA','productionSetupCode','OPS-SETUP',
        'runTemplateCode','OPS-TEMPLATE','targetCases',100,'notes',''))),v_actor);
  INSERT INTO v3.freezer_surplus_lots(facility_id,id,product_code,production_date,total_cases,remaining_cases,created_by)
    VALUES(v_facility,v_lot,'OPS-PIZZA',v_today-1,10,6,v_actor);
  INSERT INTO v3.freezer_surplus_allocations(facility_id,lot_id,production_date,schedule_run_id,cases,actor_id)
    VALUES(v_facility,v_lot,v_today,v_schedule_run,4,v_actor);

  v_result := v3.save_warehouse_guidance_settings(v_facility,v_actor,'ops-settings-1',repeat('2',64),7,
    jsonb_build_array(jsonb_build_object('productId',v_flour,'threshold','10'),
      jsonb_build_object('productId',v_label,'threshold','0')),0);
  IF v_result->>'outcome'<>'saved' OR v_result->>'revision'<>'1' THEN RAISE EXCEPTION 'Guidance settings were not saved'; END IF;
  v_result := v3.save_warehouse_guidance_settings(v_facility,v_actor,'ops-settings-1',repeat('2',64),7,
    jsonb_build_array(jsonb_build_object('productId',v_flour,'threshold','10'),
      jsonb_build_object('productId',v_label,'threshold','0')),0);
  IF v_result->>'replayed'<>'true' OR (SELECT count(*) FROM v3.warehouse_guidance_settings WHERE facility_id=v_facility)<>1 THEN
    RAISE EXCEPTION 'Exact settings retry was not idempotent';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('warehouse_id',warehouse_id,'product_id',product_id,'quantity',quantity,'revision',revision) ORDER BY warehouse_id,product_id)
    INTO v_stock_before FROM v3.inventory_balances WHERE facility_id=v_facility;
  SELECT count(*) INTO v_movements_before FROM v3.inventory_movements WHERE facility_id=v_facility;
  v_guidance := v3.warehouse_guidance(v_facility);
  IF v_guidance#>>'{settings,expirySoonDays}'<>'7' OR v_guidance#>>'{settings,revision}'<>'1'
     OR jsonb_array_length(v_guidance#>'{settings,reorderPoints}')<>1 THEN RAISE EXCEPTION 'Guidance settings snapshot is wrong: %',v_guidance; END IF;
  IF v_guidance#>>'{reorder,0,productCode}'<>'OPS-FLOUR' OR v_guidance#>>'{reorder,0,onHand}'<>'55'
     OR v_guidance#>>'{reorder,0,scheduledDemand}'<>'50' OR v_guidance#>>'{reorder,0,projectedOnHand}'<>'5'
     OR v_guidance#>>'{reorder,0,suggestedQuantity}'<>'5' OR jsonb_array_length(v_guidance->'reorder')<>1 THEN
    RAISE EXCEPTION 'Reorder did not use all upcoming effective demand and exact threshold math: %',v_guidance->'reorder';
  END IF;
  SELECT value INTO v_item FROM jsonb_array_elements(v_guidance#>'{warehouseNeeds,groups}') WHERE value->>'area'='Dough';
  IF v_item#>>'{items,0,quantity}'<>'50' OR v_item#>>'{items,0,runs,0,quantity}'<>'30'
     OR v_item#>>'{items,0,runs,1,quantity}'<>'20' THEN RAISE EXCEPTION 'Warehouse needs ignored carry-in or future runs: %',v_item; END IF;
  IF jsonb_typeof(v_guidance#>'{freezerPull,groups,0,targetCases}')<>'number'
     OR jsonb_typeof(v_guidance#>'{freezerPull,groups,0,effectiveTargetCases}')<>'number'
     OR v_guidance#>>'{freezerPull,groups,0,effectiveTargetCases}'<>'6'
     OR v_guidance#>>'{freezerPull,groups,0,items,0,quantity}'<>'30' THEN
    RAISE EXCEPTION 'Freezer pull double-counted carried-in ingredient demand: %',v_guidance->'freezerPull';
  END IF;
  IF jsonb_array_length(v_guidance->'useFirst')<>2 OR v_guidance#>>'{useFirst,0,lotNumber}'<>'RESERVE-EXPIRED'
     OR v_guidance#>>'{useFirst,0,demandedToday}'<>'true' OR v_guidance#>>'{useFirst,1,lotNumber}'<>'ONSITE-SOON' THEN
    RAISE EXCEPTION 'Use-first did not preserve positive-lot FEFO and today priority: %',v_guidance->'useFirst';
  END IF;
  IF v_guidance#>>'{transferGuidance,0,productCode}'<>'OPS-FLOUR' OR v_guidance#>>'{transferGuidance,0,needed}'<>'30'
     OR v_guidance#>>'{transferGuidance,0,onSite}'<>'5' OR v_guidance#>>'{transferGuidance,0,offSite}'<>'50'
     OR v_guidance#>>'{transferGuidance,0,suggestedQuantity}'<>'25' THEN
    RAISE EXCEPTION 'Transfer guidance used the wrong stock or demand: %',v_guidance->'transferGuidance';
  END IF;
  IF (SELECT jsonb_agg(jsonb_build_object('warehouse_id',warehouse_id,'product_id',product_id,'quantity',quantity,'revision',revision) ORDER BY warehouse_id,product_id)
      FROM v3.inventory_balances WHERE facility_id=v_facility) IS NOT DISTINCT FROM v_stock_before
     AND (SELECT count(*) FROM v3.inventory_movements WHERE facility_id=v_facility)=v_movements_before THEN NULL;
    ELSE RAISE EXCEPTION 'Read-only guidance changed stock or movement history'; END IF;

  INSERT INTO v3.runs(facility_id,id,status,revision,created_at,updated_at,started_at,setup_snapshot) VALUES
    (v_facility,v_run,'running',1,clock_timestamp()-interval '1 minute',clock_timestamp(),clock_timestamp()-interval '1 minute',
      jsonb_build_object('label','Live operations run','targetCases',10,'productCode','OPS-PIZZA','productionSetupCode','OPS-SETUP',
        'dieSetup',jsonb_build_object('lineSettings',jsonb_build_object('pizzasPerCase',12,'freezerTime',10))));
  INSERT INTO v3.run_station_progress(facility_id,run_id,station_key,status,revision,inputs,progress,started_at,updated_at) VALUES
    (v_facility,v_run,'line','running',1,'{"autoTrackRatePerMinute":120,"casesPerSkid":5}',
      '{"casesProduced":8,"casesOnLine":0,"casesInFreezer":0}',clock_timestamp()-interval '1 minute',clock_timestamp());
  v_guidance := v3.warehouse_guidance(v_facility);
  IF jsonb_array_length(v_guidance->'switchovers')<>1 OR v_guidance#>>'{switchovers,0,runId}'<>v_run::text
     OR v_guidance#>>'{switchovers,0,pressCasesLeft}'<>'2' OR v_guidance#>>'{switchovers,0,packagingStage}'<>'true'
     OR v_guidance#>>'{switchovers,0,shortRun}'<>'false' OR v_guidance#>>'{switchovers,0,skidsLeft}'<>'0.40' THEN
    RAISE EXCEPTION 'Eligible live switchover was not derived from server station state: %',v_guidance->'switchovers';
  END IF;
  UPDATE v3.run_station_progress SET progress=jsonb_set(progress,'{casesProduced}','0'),inputs=jsonb_set(inputs,'{casesPerSkid}','4') WHERE facility_id=v_facility AND run_id=v_run AND station_key='line';
  v_guidance := v3.warehouse_guidance(v_facility);
  IF jsonb_array_length(v_guidance->'switchovers')<>0 THEN RAISE EXCEPTION 'Switchover remained visible beyond two skids'; END IF;
  UPDATE v3.run_station_progress SET progress=jsonb_set(progress,'{casesProduced}','8'),inputs=jsonb_set(inputs,'{autoTrackRatePerMinute}','0')
    WHERE facility_id=v_facility AND run_id=v_run AND station_key='line';
  v_guidance := v3.warehouse_guidance(v_facility);
  IF jsonb_array_length(v_guidance->'switchovers')<>0 THEN RAISE EXCEPTION 'Switchover ignored an unavailable live rate'; END IF;
  BEGIN
    PERFORM v3.save_warehouse_guidance_settings(v_facility,v_actor,'ops-settings-stale',repeat('3',64),7,'[]'::jsonb,0);
    RAISE EXCEPTION 'Stale settings revision was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$$;

ROLLBACK;
