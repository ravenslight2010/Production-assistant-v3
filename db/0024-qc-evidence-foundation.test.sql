BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_manager uuid := '8a000000-0000-4000-8000-000000000001';
  v_recorder uuid := '8a000000-0000-4000-8000-000000000002';
  v_operator uuid := '8a000000-0000-4000-8000-000000000003';
  v_run uuid := '8a000000-0000-4000-8000-000000000010';
  v_result jsonb;
  v_record_id uuid;
  v_target_revision bigint;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.staff_accounts(id, username, password_hash, disabled) VALUES
    (v_manager, 'QC24Manager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
    (v_recorder, 'QC24Recorder', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
    (v_operator, 'QC24Operator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false);
  INSERT INTO v3.roles(name, capabilities) VALUES
    ('qc-manager-24', '["record-qc","manage-qc","review-incidents"]'::jsonb),
    ('qc-recorder-24', '["record-qc"]'::jsonb);
  INSERT INTO v3.user_roles(user_id, role_name) VALUES
    (v_manager, 'manager'), (v_recorder, 'qc-manager-24'), (v_operator, 'operator');
  INSERT INTO v3.staff_accounts(id, username, password_hash, disabled)
    VALUES ('8a000000-0000-4000-8000-000000000004', 'QC24OnlyRecorder', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false);
  INSERT INTO v3.user_roles(user_id, role_name)
    VALUES ('8a000000-0000-4000-8000-000000000004', 'qc-recorder-24');
  INSERT INTO v3.runs(facility_id, id, status, created_at, updated_at, setup_snapshot, production_date)
    VALUES (v_facility, v_run, 'planned', clock_timestamp(), clock_timestamp(),
      '{"label":"QC 24 synthetic run","targetCases":10}'::jsonb, DATE '2032-06-01');

  v_result := v3.get_qc_run_dashboard(v_recorder, v_run);
  IF v_result#>>'{run,id}' <> v_run::text OR v_result->>'highWaterMark' <> '0'
     OR jsonb_array_length(v_result->'records') <> 0 THEN
    RAISE EXCEPTION 'Empty QC dashboard was not canonical.';
  END IF;

  v_result := v3.save_qc_target(v_manager, 'qc24-target-weight', repeat('a',64),
    'DOUGH-BALL', 0, '{"kind":"weight","unit":"g","minimum":"450","maximum":"550","active":true}'::jsonb);
  IF v_result->>'outcome' <> 'accepted' OR v_result#>>'{target,revision}' <> '1'
     OR jsonb_array_length(v_result->'targets') <> 1 THEN
    RAISE EXCEPTION 'Reviewed weight target was not created: %', v_result;
  END IF;
  v_result := v3.save_qc_target(v_manager, 'qc24-target-weight', repeat('a',64),
    'DOUGH-BALL', 0, '{"kind":"weight","unit":"g","minimum":"450","maximum":"550","active":true}'::jsonb);
  IF v_result->>'replayed' <> 'true'
     OR (SELECT count(*) FROM v3.qc_targets WHERE facility_id = v_facility) <> 1
     OR (SELECT count(*) FROM v3.qc_records WHERE kind = 'target-set') <> 1 THEN
    RAISE EXCEPTION 'Exact target retry duplicated state.';
  END IF;

  v_result := v3.record_qc_lot(v_recorder, 'qc24-lot', repeat('b',64), v_run,
    '{"productCode":"FLOUR-01","lotNumber":"  LOT-A-24  ","notes":" Received intact "}'::jsonb);
  IF v_result#>>'{record,details,lotNumber}' <> 'LOT-A-24'
     OR v_result#>>'{record,details,notes}' <> 'Received intact'
     OR jsonb_array_length(v_result->'records') <> 1 THEN
    RAISE EXCEPTION 'QC lot did not persist as separate evidence: %', v_result;
  END IF;

  v_result := v3.record_qc_weight_check(v_recorder, 'qc24-weight-pass', repeat('c',64), v_run,
    '{"phase":"pre-run","value":"500.000","unit":"g","targetKey":"DOUGH-BALL","notes":""}'::jsonb);
  IF v_result#>>'{record,details,outcome}' <> 'pass'
     OR v_result#>>'{record,details,target,revision}' <> '1'
     OR v_result#>>'{record,details,value}' <> '500.000' THEN
    RAISE EXCEPTION 'Weight target did not evaluate and snapshot exactly: %', v_result;
  END IF;
  v_record_id := (v_result#>>'{record,recordId}')::uuid;
  v_result := v3.record_qc_weight_check(v_recorder, 'qc24-weight-pass', repeat('c',64), v_run,
    '{"phase":"pre-run","value":"500.000","unit":"g","targetKey":"DOUGH-BALL","notes":""}'::jsonb);
  IF v_result->>'replayed' <> 'true'
     OR (SELECT count(*) FROM v3.qc_records WHERE facility_id = v_facility AND run_id = v_run) <> 2 THEN
    RAISE EXCEPTION 'Exact weight retry duplicated evidence.';
  END IF;

  v_result := v3.record_qc_weight_check(v_recorder, 'qc24-weight-fail', repeat('d',64), v_run,
    '{"phase":"30-minute","value":"551","unit":"g","targetKey":"DOUGH-BALL","notes":"Above reviewed target"}'::jsonb);
  IF v_result#>>'{record,details,outcome}' <> 'fail'
     OR v_result#>>'{record,details,phase}' <> '30-minute' THEN
    RAISE EXCEPTION 'Weight failure or cadence phase was not retained.';
  END IF;

  v_result := v3.record_qc_brix_check(v_recorder, 'qc24-brix-missing', repeat('e',64), v_run,
    '{"phase":null,"value":"5.25","unit":"brix","targetKey":null,"notes":"No reviewed target"}'::jsonb);
  IF v_result#>>'{record,details,outcome}' <> 'not-evaluated'
     OR v_result#>>'{record,details,notEvaluatedReason}' <> 'no-reviewed-target' THEN
    RAISE EXCEPTION 'Missing Brix target did not remain not-evaluated.';
  END IF;

  v_result := v3.save_qc_target(v_manager, 'qc24-target-weight-update', repeat('f',64),
    'DOUGH-BALL', 1, '{"kind":"weight","unit":"g","minimum":"460","maximum":"525","active":true}'::jsonb);
  IF v_result#>>'{target,revision}' <> '2' THEN RAISE EXCEPTION 'Target revision did not advance.'; END IF;
  IF v3.get_qc_run_dashboard(v_recorder, v_run)#>>'{records,1,details,target,revision}' <> '1' THEN
    RAISE EXCEPTION 'Target update rewrote a prior measurement snapshot.';
  END IF;
  v_result := v3.save_qc_target(v_manager, 'qc24-target-stale', repeat('0',64),
    'DOUGH-BALL', 1, '{"kind":"weight","unit":"g","minimum":"460","maximum":"500","active":true}'::jsonb);
  IF v_result->>'outcome' <> 'conflict' OR v_result#>>'{targets,0,revision}' <> '2'
     OR (SELECT maximum FROM v3.qc_targets WHERE target_key = 'DOUGH-BALL') <> 525 THEN
    RAISE EXCEPTION 'Stale target write did not return canonical conflict.';
  END IF;

  PERFORM v3.save_qc_target(v_manager, 'qc24-target-kg', repeat('1',64),
    'BOX-WEIGHT', 0, '{"kind":"weight","unit":"kg","minimum":"1","maximum":"2","active":true}'::jsonb);
  v_result := v3.record_qc_weight_check(v_recorder, 'qc24-unit-mismatch', repeat('2',64), v_run,
    '{"phase":"pre-run","value":"1500","unit":"g","targetKey":"BOX-WEIGHT","notes":""}'::jsonb);
  IF v_result#>>'{record,details,outcome}' <> 'not-evaluated'
     OR v_result#>>'{record,details,notEvaluatedReason}' <> 'unit-mismatch' THEN
    RAISE EXCEPTION 'Mismatched units were silently converted or evaluated.';
  END IF;

  PERFORM v3.save_qc_target(v_manager, 'qc24-target-brix', repeat('3',64),
    'SAUCE-BRIX', 0, '{"kind":"brix","unit":"brix","minimum":"5","maximum":"6","active":false}'::jsonb);
  v_result := v3.record_qc_brix_check(v_recorder, 'qc24-brix-inactive', repeat('4',64), v_run,
    '{"phase":null,"value":"5.5","unit":"brix","targetKey":"SAUCE-BRIX","notes":""}'::jsonb);
  IF v_result#>>'{record,details,outcome}' <> 'not-evaluated'
     OR v_result#>>'{record,details,notEvaluatedReason}' <> 'target-inactive' THEN
    RAISE EXCEPTION 'Inactive target produced an evaluated result.';
  END IF;

  IF (SELECT count(*) FROM v3.qc_audit_events WHERE facility_id = v_facility)
       <> (SELECT count(*) FROM v3.qc_records WHERE facility_id = v_facility)
     OR (SELECT count(*) FROM v3.qc_outbox_events WHERE facility_id = v_facility)
       <> (SELECT count(*) FROM v3.qc_records WHERE facility_id = v_facility) THEN
    RAISE EXCEPTION 'QC evidence, audit, and outbox were not written one-for-one.';
  END IF;
  IF EXISTS (SELECT 1 FROM v3.qc_audit_events WHERE changed_fields::text ILIKE '%notes%'
    OR changed_fields::text ILIKE '%lotNumber%') THEN
    RAISE EXCEPTION 'QC audit metadata leaked operational details.';
  END IF;

  BEGIN
    PERFORM v3.record_qc_lot(v_operator, 'qc24-denied', repeat('5',64), v_run,
      '{"productCode":"FLOUR-01","lotNumber":"NO","notes":""}'::jsonb);
    RAISE EXCEPTION 'Operator unexpectedly recorded QC.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM v3.save_qc_target('8a000000-0000-4000-8000-000000000004', 'qc24-denied-target', repeat('6',64),
      'DENIED', 0, '{"kind":"weight","unit":"g","minimum":"1","maximum":null,"active":true}'::jsonb);
    RAISE EXCEPTION 'Record-only role unexpectedly managed targets.';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM v3.record_qc_lot(v_recorder, 'qc24-lot', repeat('9',64), v_run,
      '{"productCode":"FLOUR-01","lotNumber":"LOT-A-24","notes":""}'::jsonb);
    RAISE EXCEPTION 'Reused request ID with a different hash was accepted.';
  EXCEPTION WHEN SQLSTATE 'P2002' THEN NULL;
  END;
  BEGIN
    PERFORM v3.record_qc_brix_check(v_recorder, 'qc24-invalid-brix', repeat('7',64), v_run,
      '{"phase":null,"value":"101","unit":"brix","targetKey":null,"notes":""}'::jsonb);
    RAISE EXCEPTION 'Invalid Brix value was accepted.';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    UPDATE v3.qc_records SET details = '{}'::jsonb WHERE record_id = v_record_id;
    RAISE EXCEPTION 'QC evidence was mutable.';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM v3.qc_command_receipts WHERE actor_id = v_recorder;
    RAISE EXCEPTION 'QC receipt was mutable.';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM v3.qc_audit_events WHERE record_id = v_record_id;
    RAISE EXCEPTION 'QC audit was mutable.';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM v3.qc_outbox_events WHERE record_id = v_record_id;
    RAISE EXCEPTION 'QC outbox was deletable.';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  SELECT revision INTO v_target_revision FROM v3.qc_targets WHERE target_key = 'DOUGH-BALL';
  IF v_target_revision <> 2 OR jsonb_array_length(v3.get_qc_targets(v_manager)->'targets') <> 3 THEN
    RAISE EXCEPTION 'Final canonical target state is incorrect.';
  END IF;
END
$$;

ROLLBACK;

SELECT '0024 QC evidence foundation SQL tests passed' AS result;
