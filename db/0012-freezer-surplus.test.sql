BEGIN;
DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '92000000-0000-4000-8000-000000000001';
  v_run uuid := '92000000-0000-4000-8000-000000000002';
  v_zero_run uuid := '92000000-0000-4000-8000-000000000003';
  v_schedule_run uuid := '92000000-0000-4000-8000-000000000004';
  v_lot uuid;
  v_event uuid;
  v_result jsonb;
  v_ledger jsonb;
  v_movements bigint;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  SELECT count(*) INTO v_movements FROM v3.inventory_movements;
  INSERT INTO v3.products(facility_id,code,name,base_unit,active)
  VALUES(v_facility,'SURPLUS-PIZZA','Surplus Pizza','case',true);
  INSERT INTO v3.runs(facility_id,id,status,revision,setup_snapshot,created_at,updated_at,started_at,completed_at) VALUES
    (v_facility,v_run,'completed',2,'{"label":"Surplus source","productCode":"SURPLUS-PIZZA","targetCases":10}'::jsonb,v_now,v_now,v_now,v_now),
    (v_facility,v_zero_run,'completed',2,'{"label":"No extra","productCode":"SURPLUS-PIZZA","targetCases":5}'::jsonb,v_now,v_now,v_now,v_now);

  v_result := v3.confirm_freezer_surplus(v_facility,v_actor,'surplus-none',repeat('1',64),v_zero_run,0);
  IF v_result->>'decision' <> 'none' OR v_result->>'lotId' IS NOT NULL THEN RAISE EXCEPTION 'Explicit zero was not saved as none'; END IF;
  v_result := v3.confirm_freezer_surplus(v_facility,v_actor,'surplus-create',repeat('2',64),v_run,8);
  IF v_result->>'decision' <> 'stored' OR v_result->>'cases' <> '8' THEN RAISE EXCEPTION 'Positive surplus was not stored'; END IF;
  v_lot := (v_result->>'lotId')::uuid;
  v_result := v3.confirm_freezer_surplus(v_facility,v_actor,'surplus-create',repeat('2',64),v_run,8);
  IF v_result->>'replayed' <> 'true' OR (SELECT count(*) FROM v3.freezer_surplus_lots WHERE facility_id=v_facility AND id=v_lot) <> 1
     OR (SELECT count(*) FROM v3.freezer_surplus_confirmations WHERE facility_id=v_facility) <> 2 THEN
    RAISE EXCEPTION 'Exact surplus retry duplicated its decision or lot';
  END IF;
  IF (SELECT count(*) FROM v3.inventory_movements) <> v_movements THEN RAISE EXCEPTION 'Surplus receipt deducted ingredients'; END IF;

  INSERT INTO v3.production_schedules(facility_id,production_date,revision,plan,updated_by) VALUES(
    v_facility,(clock_timestamp() AT TIME ZONE 'America/Chicago')::date+1,1,
    jsonb_build_object('productionStartTime','06:00','breaks','[]'::jsonb,'runs',jsonb_build_array(jsonb_build_object(
      'id',v_schedule_run,'productCode','SURPLUS-PIZZA','productionSetupCode','SURPLUS-SETUP',
      'runTemplateCode','SURPLUS-TEMPLATE','targetCases',10,'notes',''))),v_actor);
  v_result := v3.allocate_freezer_surplus(v_facility,v_actor,'surplus-allocate',repeat('3',64),v_lot,
    (clock_timestamp() AT TIME ZONE 'America/Chicago')::date+1,v_schedule_run,4,1);
  IF v_result->>'remainingCases' <> '4' OR v_result->>'effectiveTargetCases' <> '6' THEN RAISE EXCEPTION 'Allocation did not reduce effective production'; END IF;
  v_result := v3.allocate_freezer_surplus(v_facility,v_actor,'surplus-allocate',repeat('3',64),v_lot,
    (clock_timestamp() AT TIME ZONE 'America/Chicago')::date+1,v_schedule_run,4,1);
  IF v_result->>'replayed' <> 'true' OR (SELECT remaining_cases FROM v3.freezer_surplus_lots WHERE facility_id=v_facility AND id=v_lot) <> 4 THEN
    RAISE EXCEPTION 'Allocation retry consumed surplus twice';
  END IF;
  IF (SELECT count(*) FROM v3.inventory_movements) <> v_movements THEN RAISE EXCEPTION 'Allocation deducted ingredients'; END IF;
  v_ledger := v3.get_production_schedule(v_facility,(clock_timestamp() AT TIME ZONE 'America/Chicago')::date+1);
  IF v_ledger#>>'{runs,0,carriedInCases}' <> '4' OR v_ledger#>>'{runs,0,effectiveTargetCases}' <> '6' THEN
    RAISE EXCEPTION 'Canonical schedule did not project carry-in and effective target';
  END IF;

  SELECT id INTO v_event FROM v3.freezer_surplus_events WHERE facility_id=v_facility AND lot_id=v_lot AND event_type='receipt';
  v_result := v3.adjust_freezer_surplus(v_facility,v_actor,'surplus-damage',repeat('4',64),v_lot,'damage',2,'Freezer damage',2,NULL);
  IF v_result->>'remainingCases' <> '2' THEN RAISE EXCEPTION 'Damage did not reduce only remaining cases'; END IF;
  v_result := v3.adjust_freezer_surplus(v_facility,v_actor,'surplus-return',repeat('5',64),v_lot,'return',1,'Verified undamaged return',3,NULL);
  IF v_result->>'remainingCases' <> '3' THEN RAISE EXCEPTION 'Return was not appended'; END IF;
  v_result := v3.adjust_freezer_surplus(v_facility,v_actor,'surplus-correct',repeat('6',64),v_lot,'correction',-1,'Correcting receipt count',4,v_event);
  IF v_result->>'remainingCases' <> '2' OR NOT EXISTS(SELECT 1 FROM v3.freezer_surplus_events
    WHERE facility_id=v_facility AND lot_id=v_lot AND event_type='correction' AND corrects_event_id=v_event) THEN
    RAISE EXCEPTION 'Linked correction was not preserved';
  END IF;

  BEGIN
    PERFORM v3.allocate_freezer_surplus(v_facility,v_actor,'surplus-too-much',repeat('7',64),v_lot,
      (clock_timestamp() AT TIME ZONE 'America/Chicago')::date+1,v_schedule_run,7,5);
    RAISE EXCEPTION 'Allocation exceeded scheduled target';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE v3.freezer_surplus_confirmations SET decision='stored' WHERE facility_id=v_facility AND run_id=v_zero_run;
    RAISE EXCEPTION 'Surplus confirmation was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM v3.freezer_surplus_events WHERE facility_id=v_facility AND lot_id=v_lot;
    RAISE EXCEPTION 'Surplus events were mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  v_ledger := v3.list_freezer_surplus(v_facility);
  IF jsonb_array_length(v_ledger->'lots') <> 1 OR jsonb_array_length(v_ledger->'runs') <> 2
     OR jsonb_array_length(v_ledger->'allocations') <> 1 OR jsonb_array_length(v_ledger->'events') <> 5 THEN
    RAISE EXCEPTION 'Surplus ledger readback is incomplete: %',v_ledger;
  END IF;
END
$$;
ROLLBACK;
