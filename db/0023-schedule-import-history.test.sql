BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '89000000-0000-4000-8000-000000000001';
  v_date_a date := DATE '2032-05-10';
  v_date_b date := DATE '2032-05-11';
  v_existing uuid := '89000000-0000-4000-8000-000000000002';
  v_new_a uuid := '89000000-0000-4000-8000-000000000003';
  v_new_b uuid := '89000000-0000-4000-8000-000000000004';
  v_new_c uuid := '89000000-0000-4000-8000-000000000005';
  v_import uuid := '89000000-0000-4000-8000-000000000006';
  v_update_only uuid := '89000000-0000-4000-8000-000000000007';
  v_template_import uuid;
  v_result jsonb;
  v_runs jsonb;
  v_live_count integer;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.products(facility_id,code,name,base_unit,active)
    VALUES (v_facility,'IMP23-PRODUCT','Import 23 Product','case',true);
  INSERT INTO v3.products(facility_id,code,name,base_unit,active)
    VALUES (v_facility,'IMP23-CARTON','Import 23 Carton','each',true);
  INSERT INTO v3.products(facility_id,code,name,base_unit,active)
    VALUES (v_facility,'IMP23-FLOUR','Import 23 Flour','lb',true);
  INSERT INTO v3.master_records(facility_id,kind,code,name,product_code,data) VALUES (
    v_facility,'recipes','IMP23-RECIPE','Import 23 Recipe','IMP23-PRODUCT',
    '{"station_key":"dough","ingredients":[{"product_code":"IMP23-FLOUR","quantity":1,"unit":"lb"}]}'::jsonb
  );
  INSERT INTO v3.master_records(facility_id,kind,code,name,product_code,data) VALUES (
    v_facility,'production-setups','IMP23-SETUP','Import 23 Setup','IMP23-PRODUCT',
    '{"recipe_codes":["IMP23-RECIPE"],"packaging_per_case":[{"product_code":"IMP23-CARTON","quantity":1,"unit":"each"}]}'::jsonb
  );
  v_result := v3.stage_setup_catalog_import(
    v_facility,v_actor,'imp23-template',repeat('a',64),'run-templates',
    '[{"code":"IMP23-TEMPLATE","name":"Import 23 Template","data":{"brand":"Import","flavor":"23","values":{"pizzasPerCase":12}}}]'::jsonb
  );
  v_template_import := (v_result->>'importId')::uuid;
  PERFORM v3.apply_setup_catalog_import(v_facility,v_actor,v_template_import);
  SELECT count(*) INTO v_live_count FROM v3.runs WHERE facility_id = v_facility;

  v_result := v3.apply_production_schedule_command(
    v_facility,v_actor,v_date_a,'imp23-existing',repeat('b',64),0,
    jsonb_build_object('type','add','run',jsonb_build_object(
      'id',v_existing,'productCode','IMP23-PRODUCT','productionSetupCode','IMP23-SETUP',
      'runTemplateCode','IMP23-TEMPLATE','targetCases',10,'notes','Original'
    ))
  );
  IF v_result#>>'{schedule,revision}' <> '1' THEN RAISE EXCEPTION 'IMP-5 fixture schedule was not created.'; END IF;

  v_runs := jsonb_build_array(
    jsonb_build_object(
      'date',v_date_a,'id',v_existing,'productCode','IMP23-PRODUCT','productionSetupCode','IMP23-SETUP',
      'runTemplateCode','IMP23-TEMPLATE','targetCases',11,'notes','Reviewed existing',
      'source',jsonb_build_object('workbook','synthetic-schedule.xlsx','sheet','Day A','row',2,
        'cells',jsonb_build_object('brand','A2','flavor','B2','targetCases','C2','date','D1'))
    ),
    jsonb_build_object(
      'date',v_date_a,'id',v_new_a,'productCode','IMP23-PRODUCT','productionSetupCode','IMP23-SETUP',
      'runTemplateCode','IMP23-TEMPLATE','targetCases',20,'notes','Created A',
      'source',jsonb_build_object('workbook','synthetic-schedule.xlsx','sheet','Day A','row',3,
        'cells',jsonb_build_object('brand','A3','flavor','B3','targetCases','C3','date','D1'))
    ),
    jsonb_build_object(
      'date',v_date_a,'id',v_new_b,'productCode','IMP23-PRODUCT','productionSetupCode','IMP23-SETUP',
      'runTemplateCode','IMP23-TEMPLATE','targetCases',30,'notes','Created B',
      'source',jsonb_build_object('workbook','synthetic-schedule.xlsx','sheet','Day A','row',4,
        'cells',jsonb_build_object('brand','A4','flavor','B4','targetCases','C4','date','D1'))
    ),
    jsonb_build_object(
      'date',v_date_b,'id',v_new_c,'productCode','IMP23-PRODUCT','productionSetupCode','IMP23-SETUP',
      'runTemplateCode','IMP23-TEMPLATE','targetCases',40,'notes','Created C',
      'source',jsonb_build_object('workbook','synthetic-schedule.xlsx','sheet','Day B','row',2,
        'cells',jsonb_build_object('brand','A2','flavor','B2','targetCases','C2','date','D1'))
    )
  );
  v_result := v3.stage_schedule_import(
    v_facility,v_actor,v_import,'imp23-stage',repeat('c',64),
    jsonb_build_object('fileName','synthetic-schedule.xlsx','sha256',repeat('1',64),'parserVersion','v1-schedule-import/1'),
    v_runs
  );
  IF v_result->>'outcome' <> 'staged' OR v_result->>'replayed' <> 'false'
     OR v_result#>>'{import,source,sha256}' <> repeat('1',64)
     OR v_result#>>'{import,source,parserVersion}' <> 'v1-schedule-import/1'
     OR v_result#>>'{import,runs,0,source,cells,targetCases}' <> 'C2'
     OR jsonb_array_length(v_result#>'{import,dates}') <> 2 THEN
    RAISE EXCEPTION 'Canonical schedule staging did not retain exact source pins and citations.';
  END IF;
  IF (SELECT revision FROM v3.production_schedules WHERE facility_id = v_facility AND production_date = v_date_a) <> 1
     OR EXISTS (SELECT 1 FROM v3.production_schedules WHERE facility_id = v_facility AND production_date = v_date_b) THEN
    RAISE EXCEPTION 'Staging a schedule import mutated a production schedule.';
  END IF;

  v_result := v3.stage_schedule_import(
    v_facility,v_actor,v_import,'imp23-stage',repeat('c',64),
    jsonb_build_object('fileName','synthetic-schedule.xlsx','sha256',repeat('1',64),'parserVersion','v1-schedule-import/1'),v_runs
  );
  IF v_result->>'replayed' <> 'true' OR (SELECT count(*) FROM v3.schedule_imports WHERE facility_id = v_facility) <> 1 THEN
    RAISE EXCEPTION 'Exact schedule staging retry was not idempotent.';
  END IF;
  IF jsonb_array_length(v3.list_schedule_imports(v_facility,50)->'imports') <> 1
     OR v3.get_schedule_import(v_facility,v_import)#>>'{import,runs,1,source,sheet}' <> 'Day A' THEN
    RAISE EXCEPTION 'Canonical schedule history did not reopen the staged rows.';
  END IF;

  v_result := v3.apply_schedule_import(v_facility,v_actor,v_import,v_date_a,'imp23-apply-a',repeat('d',64),1);
  IF v_result->>'outcome' <> 'accepted' OR v_result#>>'{schedule,revision}' <> '2'
     OR v_result->>'createdRunCount' <> '2' OR v_result->>'updatedRunCount' <> '1'
     OR v_result#>>'{import,dates,0,status}' <> 'applied'
     OR v_result#>>'{import,dates,1,status}' <> 'staged' THEN
    RAISE EXCEPTION 'Per-date Apply did not preserve independent status and created/updated accounting.';
  END IF;
  v_result := v3.apply_schedule_import(v_facility,v_actor,v_import,v_date_a,'imp23-apply-a',repeat('d',64),1);
  IF v_result->>'replayed' <> 'true'
     OR (SELECT revision FROM v3.production_schedules WHERE facility_id = v_facility AND production_date = v_date_a) <> 2 THEN
    RAISE EXCEPTION 'Exact Apply retry changed the schedule twice.';
  END IF;
  v_result := v3.apply_schedule_import(v_facility,v_actor,v_import,v_date_b,'imp23-apply-b',repeat('e',64),0);
  IF v_result#>>'{schedule,revision}' <> '1' OR v_result#>>'{import,dates,1,status}' <> 'applied' THEN
    RAISE EXCEPTION 'The second production date did not Apply independently.';
  END IF;

  v_result := v3.undo_schedule_import(v_facility,v_actor,v_import,v_date_b,'imp23-undo-b',repeat('f',64),1);
  IF v_result->>'outcome' <> 'accepted' OR v_result#>>'{schedule,revision}' <> '2'
     OR jsonb_array_length(v_result#>'{schedule,runs}') <> 0
     OR v_result#>>'{import,dates,1,status}' <> 'undone' THEN
    RAISE EXCEPTION 'Unchanged created-run Undo did not clear only its date: %', v_result;
  END IF;
  v_result := v3.undo_schedule_import(v_facility,v_actor,v_import,v_date_b,'imp23-undo-b',repeat('f',64),1);
  IF v_result->>'replayed' <> 'true'
     OR (SELECT revision FROM v3.production_schedules WHERE facility_id = v_facility AND production_date = v_date_b) <> 2 THEN
    RAISE EXCEPTION 'Exact Undo retry changed the schedule twice.';
  END IF;

  v_result := v3.apply_production_schedule_command(
    v_facility,v_actor,v_date_a,'imp23-change-created',repeat('0',64),2,
    jsonb_build_object('type','update','runId',v_new_a,'changes',jsonb_build_object('targetCases',21))
  );
  v_result := v3.undo_schedule_import(v_facility,v_actor,v_import,v_date_a,'imp23-changed-undo',repeat('2',64),3);
  IF v_result->>'outcome' <> 'conflict' OR v_result->>'reason' <> 'created-runs-changed'
     OR jsonb_array_length(v_result#>'{schedule,runs}') <> 3
     OR (SELECT revision FROM v3.production_schedules WHERE facility_id = v_facility AND production_date = v_date_a) <> 3 THEN
    RAISE EXCEPTION 'Changed created runs did not block Undo without partial removal.';
  END IF;
  PERFORM v3.apply_production_schedule_command(
    v_facility,v_actor,v_date_a,'imp23-restore-created',repeat('3',64),3,
    jsonb_build_object('type','update','runId',v_new_a,'changes',jsonb_build_object('targetCases',20))
  );
  PERFORM v3.apply_production_schedule_command(
    v_facility,v_actor,v_date_a,'imp23-break-created',repeat('4',64),4,
    jsonb_build_object('type','breaks','breaks',jsonb_build_array(
      jsonb_build_object('slot',1,'enabled',true,'runId',v_new_a),
      jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',3,'enabled',false,'runId',NULL)
    ))
  );
  v_result := v3.undo_schedule_import(v_facility,v_actor,v_import,v_date_a,'imp23-undo-a',repeat('5',64),5);
  IF v_result->>'outcome' <> 'accepted' OR jsonb_array_length(v_result#>'{schedule,runs}') <> 1
     OR v_result#>>'{schedule,runs,0,id}' <> v_existing::text
     OR v_result#>>'{schedule,runs,0,targetCases}' <> '11'
     OR v_result#>>'{schedule,breaks,0,runId}' IS NOT NULL THEN
    RAISE EXCEPTION 'Guarded Undo did not remove created runs, clear breaks, and preserve the updated pre-existing run: %', v_result;
  END IF;

  v_result := v3.apply_schedule_import(v_facility,v_actor,v_import,v_date_a,'imp23-reapply-a',repeat('6',64),6);
  IF v_result->>'outcome' <> 'accepted' OR v_result#>>'{schedule,revision}' <> '7'
     OR v_result->>'createdRunCount' <> '2' OR v_result#>>'{import,dates,0,status}' <> 'applied' THEN
    RAISE EXCEPTION 'Canonical staged rows did not support reapply after Undo.';
  END IF;
  PERFORM v3.apply_production_schedule_command(
    v_facility,v_actor,v_date_a,'imp23-remove-created',repeat('7',64),7,
    jsonb_build_object('type','remove','runId',v_new_b)
  );
  v_result := v3.undo_schedule_import(v_facility,v_actor,v_import,v_date_a,'imp23-missing-undo',repeat('8',64),8);
  IF v_result->>'outcome' <> 'conflict' OR v_result->>'reason' <> 'created-runs-changed'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result#>'{schedule,runs}') item(value) WHERE value->>'id' = v_new_a::text) THEN
    RAISE EXCEPTION 'A missing created run did not block Undo without removing its sibling.';
  END IF;

  v_runs := jsonb_build_array(jsonb_build_object(
    'date',v_date_a,'id',v_existing,'productCode','IMP23-PRODUCT','productionSetupCode','IMP23-SETUP',
    'runTemplateCode','IMP23-TEMPLATE','targetCases',12,'notes','Update only',
    'source',jsonb_build_object('workbook','synthetic-update.xlsx','sheet','Day A','row',2,
      'cells',jsonb_build_object('brand','A2','flavor','B2','targetCases','C2'))
  ));
  PERFORM v3.stage_schedule_import(
    v_facility,v_actor,v_update_only,'imp23-stage-update',repeat('9',64),
    jsonb_build_object('fileName','synthetic-update.xlsx','sha256',repeat('2',64),'parserVersion','v1-schedule-import/1'),v_runs
  );
  v_result := v3.apply_schedule_import(v_facility,v_actor,v_update_only,v_date_a,'imp23-apply-update',repeat('a',64),8);
  IF v_result->>'createdRunCount' <> '0' OR v_result->>'updatedRunCount' <> '1'
     OR v_result#>>'{import,dates,0,undoAvailable}' <> 'false' THEN
    RAISE EXCEPTION 'An update-only Apply misleadingly exposed created-run Undo.';
  END IF;
  v_result := v3.undo_schedule_import(v_facility,v_actor,v_update_only,v_date_a,'imp23-undo-update',repeat('b',64),9);
  IF v_result->>'outcome' <> 'conflict' OR v_result->>'reason' <> 'no-created-runs'
     OR v_result#>>'{schedule,runs,0,targetCases}' <> '12'
     OR (SELECT revision FROM v3.production_schedules WHERE facility_id = v_facility AND production_date = v_date_a) <> 9 THEN
    RAISE EXCEPTION 'Update-only Undo reverted or changed a pre-existing run.';
  END IF;

  IF (SELECT count(*) FROM v3.runs WHERE facility_id = v_facility) <> v_live_count THEN
    RAISE EXCEPTION 'Schedule import Apply/Undo created or modified live runs.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'v3' AND p.proname = 'undo_opening_count') THEN
    RAISE EXCEPTION 'Schedule history introduced generic opening-count Undo.';
  END IF;
END
$$;

ROLLBACK;
