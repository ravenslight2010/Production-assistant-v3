\set QUIET on
\pset footer off

BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_manager uuid := '26000000-0000-4000-8000-000000000001';
  v_verifier uuid := '26000000-0000-4000-8000-000000000002';
  v_recorder uuid := '26000000-0000-4000-8000-000000000003';
  v_operator uuid := '26000000-0000-4000-8000-000000000004';
  v_disabled uuid := '26000000-0000-4000-8000-000000000005';
  v_revoked uuid := '26000000-0000-4000-8000-000000000006';
  v_run uuid := '26000000-0000-4000-8000-000000000010';
  v_other_run uuid := '26000000-0000-4000-8000-000000000011';
  v_semolina uuid := '26000000-0000-4000-8000-000000000020';
  v_plan jsonb;
  v_result jsonb;
  v_component_first jsonb;
  v_cleaning_id uuid;
  v_signoff_id uuid;
  v_high_water bigint;
  v_run_before jsonb;
  v_run_events_before bigint;
  v_inventory_before bigint;
  v_operations_before bigint;
  v_schedules_before bigint;
  v_consumptions_before bigint;
  v_run_outbox_before bigint;
  v_import_id uuid;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  INSERT INTO v3.staff_accounts(id, username, password_hash, disabled) VALUES
    (v_manager, 'QC26Manager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
    (v_verifier, 'QC26Verifier', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
    (v_recorder, 'QC26Recorder', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
    (v_operator, 'QC26Operator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
    (v_disabled, 'QC26Disabled', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false),
    (v_revoked, 'QC26Revoked', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', false);
  INSERT INTO v3.roles(name, capabilities) VALUES
    ('qc-manager-26', '["record-qc","manage-qc","review-incidents"]'::jsonb),
    ('qc-recorder-26', '["record-qc"]'::jsonb);
  INSERT INTO v3.user_roles(user_id, role_name) VALUES
    (v_manager, 'manager'), (v_verifier, 'qc-manager-26'),
    (v_recorder, 'qc-recorder-26'), (v_operator, 'operator'),
    (v_disabled, 'qc-recorder-26'), (v_revoked, 'qc-manager-26');

  v_result := v3.stage_setup_catalog_import(
    v_facility, v_manager, '0026-ingredients', repeat('a',64), 'ingredients',
    '[
      {"code":"QC26-FLOUR","name":"QC26 Flour","data":{"categories":["dough"],"allergens":["wheat"],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}},
      {"code":"QC26-CHEESE","name":"QC26 Cheese","data":{"categories":["topping"],"allergens":[],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}},
      {"code":"QC26-OIL","name":"QC26 Oil","data":{"categories":["dough"],"allergens":[],"allergensReviewed":false,"mergedIntoCode":null,"enabled":true}},
      {"code":"QC26-LEGACY","name":"QC26 Legacy","data":{"categories":[],"allergens":["legacy uncertain text"],"allergensReviewed":false,"mergedIntoCode":null,"enabled":true}},
      {"code":"QC26-SEMOLINA","name":"QC26 Semolina","data":{"categories":["dough"],"allergens":["wheat"],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}}
    ]'::jsonb
  );
  v_import_id := (v_result->>'importId')::uuid;
  PERFORM v3.apply_setup_catalog_import(v_facility, v_manager, v_import_id);
  -- Synthetic corruption proves a reviewed mapping with legacy text is never presented as valid.
  UPDATE v3.setup_ingredient_records
    SET data = jsonb_set(data, '{allergensReviewed}', 'true'::jsonb)
    WHERE facility_id = v_facility AND code = 'QC26-LEGACY';
  INSERT INTO v3.products(facility_id,id,code,name,base_unit,active) VALUES
    (v_facility,v_semolina,'QC26-SEMOLINA','QC26 Semolina','lb',true);

  v_plan := jsonb_build_object(
    'code','QC26-SETUP','name','QC26 setup',
    'warehouse',jsonb_build_object('id',gen_random_uuid(),'name','QC26 warehouse'),
    'recipes',jsonb_build_array(jsonb_build_object(
      'code','QC26-DOUGH','name','QC26 dough','stationKey','dough','ingredients',jsonb_build_array(
        jsonb_build_object('productId',gen_random_uuid(),'productCode','QC26-FLOUR','productName','QC26 Flour','quantity','10','unit','lb'),
        jsonb_build_object('productId',gen_random_uuid(),'productCode','QC26-CHEESE','productName','QC26 Cheese','quantity','2','unit','lb'),
        jsonb_build_object('productId',gen_random_uuid(),'productCode','QC26-OIL','productName','QC26 Oil','quantity','1','unit','lb'),
        jsonb_build_object('productId',gen_random_uuid(),'productCode','QC26-LEGACY','productName','QC26 Legacy','quantity','1','unit','lb')
      ))),
    'packagingPerCase',jsonb_build_array(jsonb_build_object(
      'productId',gen_random_uuid(),'productCode','QC26-LABEL','productName','QC26 Label','quantity','1','unit','each'))
  );
  INSERT INTO v3.runs(facility_id,id,status,created_at,updated_at,setup_snapshot,production_date) VALUES
    (v_facility,v_run,'planned',clock_timestamp(),clock_timestamp(),
      jsonb_build_object('label','QC26 synthetic run','targetCases',10,'productionPlan',v_plan),DATE '2032-06-26'),
    ('26000000-0000-4000-8000-00000000ffff',v_other_run,'planned',clock_timestamp(),clock_timestamp(),
      jsonb_build_object('label','Other facility','targetCases',1,'productionPlan',v_plan),DATE '2032-06-26');

  v_result := v3.get_qc_run_dashboard(v_recorder, v_run);
  ASSERT jsonb_array_length(v_result->'components') = 5, 'Effective ingredients and packaging should be projected';
  ASSERT v_result#>>'{components,0,productCode}' = 'QC26-FLOUR', 'Original component identity missing';
  ASSERT v_result#>>'{components,4,componentKey}' = 'packaging:0', 'Packaging identity missing';
  ASSERT v_result#>>'{componentSnapshot,source}' = 'effective-plan', 'Active run must use effective plan';
  ASSERT v_result#>>'{allergenMappings,0,status}' = 'reviewed', 'Reviewed allergen mapping missing';
  ASSERT v_result#>>'{allergenMappings,1,status}' = 'reviewed-empty', 'Reviewed-empty mapping missing';
  ASSERT v_result#>>'{allergenMappings,2,status}' = 'unreviewed', 'Unreviewed mapping missing';
  ASSERT v_result#>>'{allergenMappings,3,status}' = 'invalid-mapping', 'Invalid reviewed mapping was accepted';
  ASSERT v_result#>>'{allergenMappings,4,status}' = 'unavailable', 'Packaging should not acquire an ingredient mapping';
  ASSERT v_result->'signOff' = 'null'::jsonb AND v_result->>'newEvidenceSinceSignOff' = 'false',
    'Empty sign-off projection is not canonical';

  v_component_first := v3.record_qc_component_check(
    v_recorder, '0026-component-before', repeat('b',64), v_run,
    '{"componentKey":"recipe:0:ingredient:0","presence":"present","notes":" Identity confirmed "}'::jsonb
  );
  ASSERT v_component_first#>>'{record,details,presence}' = 'present', 'Presence was not stored';
  ASSERT v_component_first#>>'{record,details,notes}' = 'Identity confirmed', 'Notes were not normalized';
  ASSERT v_component_first#>>'{record,details,component,productCode}' = 'QC26-FLOUR',
    'Component check did not capture effective identity';

  v_result := v3.apply_substitution_command(
    v_facility, v_manager, DATE '2032-06-26', '0026-substitution', repeat('c',64), 0,
    jsonb_build_object('type','upsert','rule',jsonb_build_object(
      'id',NULL,'ingredient','QC26 Flour','action','swap','substituteProductId',v_semolina,'quantity','12'))
  );
  ASSERT v_result->>'outcome' = 'accepted', 'Substitution fixture was not applied';
  v_result := v3.get_qc_run_dashboard(v_recorder, v_run);
  ASSERT v_result#>>'{components,0,productCode}' = 'QC26-SEMOLINA', 'Dashboard did not resolve substitution';
  ASSERT v_result#>>'{componentSnapshot,overlayRevision}' = '1', 'Snapshot overlay revision missing';
  ASSERT v_result#>>'{records,0,details,component,productCode}' = 'QC26-FLOUR',
    'Later substitution rewrote recorded evidence';

  v_result := v3.record_qc_component_check(
    v_recorder, '0026-component-before', repeat('b',64), v_run,
    '{"componentKey":"recipe:0:ingredient:0","presence":"present","notes":" Identity confirmed "}'::jsonb
  );
  ASSERT v_result = v_component_first || jsonb_build_object('replayed',true),
    'Exact component retry did not return the original pre-substitution response';

  v_result := v3.record_qc_component_check(
    v_recorder, '0026-component-after', repeat('d',64), v_run,
    '{"componentKey":"recipe:0:ingredient:0","presence":"unknown","notes":"Not checked after substitution"}'::jsonb
  );
  ASSERT v_result#>>'{record,details,presence}' = 'unknown', 'Explicit unknown presence missing';
  ASSERT v_result#>>'{record,details,component,productCode}' = 'QC26-SEMOLINA',
    'New check did not capture substituted identity';

  v_result := v3.record_qc_allergen_review(
    v_recorder, '0026-allergen-empty', repeat('e',64), v_run,
    '{"componentKey":"recipe:0:ingredient:1","stagingStatus":"unknown","notes":"Staging not checked"}'::jsonb
  );
  ASSERT v_result#>>'{record,details,stagingStatus}' = 'unknown', 'Unknown staging state missing';
  ASSERT v_result#>>'{record,details,allergenMapping,status}' = 'reviewed-empty',
    'Reviewed-empty mapping was not snapshotted';
  ASSERT v_result#>'{record,details,allergenMapping,allergens}' = '[]'::jsonb,
    'Reviewed-empty allergen list changed';

  v_result := v3.record_qc_allergen_review(
    v_recorder, '0026-allergen-unreviewed', repeat('f',64), v_run,
    '{"componentKey":"recipe:0:ingredient:2","stagingStatus":"not-staged","notes":"Kept separate"}'::jsonb
  );
  ASSERT v_result#>>'{record,details,allergenMapping,status}' = 'unreviewed',
    'Unreviewed mapping was represented as reviewed';

  v_result := v3.record_qc_cleaning(
    v_manager, '0026-cleaning', repeat('0',64), v_run,
    '{"area":" Dough mixer ","status":"cleaned","notes":" Cleaning evidence logged "}'::jsonb
  );
  v_cleaning_id := (v_result#>>'{record,recordId}')::uuid;
  ASSERT v_result#>>'{record,details,area}' = 'Dough mixer', 'Cleaning area was not normalized';
  ASSERT v_result#>>'{record,details,status}' = 'cleaned', 'Cleaning state missing';

  BEGIN
    PERFORM v3.verify_qc_cleaning(v_manager, '0026-self-verification', repeat('1',64), v_cleaning_id,
      '{"status":"verified","notes":"Self review"}'::jsonb);
    RAISE EXCEPTION 'Self-verification was accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM v3.verify_qc_cleaning(v_recorder, '0026-role-verification', repeat('2',64), v_cleaning_id,
      '{"status":"verified","notes":"Record-only role"}'::jsonb);
    RAISE EXCEPTION 'Record-only role verified cleaning';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM v3.verify_qc_cleaning(v_verifier, '0026-missing-cleaning', repeat('3',64),
      (v_component_first#>>'{record,recordId}')::uuid,
      '{"status":"verified","notes":"Wrong target"}'::jsonb);
    RAISE EXCEPTION 'Non-cleaning evidence was verified as cleaning';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  v_result := v3.verify_qc_cleaning(
    v_verifier, '0026-verification', repeat('4',64), v_cleaning_id,
    '{"status":"verified","notes":"Independent review complete"}'::jsonb
  );
  ASSERT v_result#>>'{record,kind}' = 'cleaning-verification', 'Verification kind missing';
  ASSERT v_result#>>'{record,relatedRecordId}' = v_cleaning_id::text, 'Verification link missing';
  ASSERT v_result#>>'{record,actorId}' = v_verifier::text, 'Independent actor missing';

  v_high_water := (v_result->>'highWaterMark')::bigint;
  SELECT to_jsonb(r) INTO v_run_before FROM v3.runs r WHERE facility_id = v_facility AND id = v_run;
  SELECT count(*) INTO v_run_events_before FROM v3.run_events WHERE facility_id = v_facility AND run_id = v_run;
  SELECT count(*) INTO v_inventory_before FROM v3.inventory_movements WHERE facility_id = v_facility;
  SELECT count(*) INTO v_operations_before FROM v3.facility_operation_events WHERE facility_id = v_facility;
  SELECT count(*) INTO v_schedules_before FROM v3.production_schedules WHERE facility_id = v_facility;
  SELECT count(*) INTO v_consumptions_before FROM v3.run_inventory_consumptions WHERE facility_id = v_facility;
  SELECT count(*) INTO v_run_outbox_before FROM v3.outbox_events WHERE facility_id = v_facility;

  v_result := v3.sign_off_qc_run(v_manager, '0026-signoff', repeat('5',64), v_run, v_high_water);
  v_signoff_id := (v_result#>>'{record,recordId}')::uuid;
  ASSERT v_result->>'outcome' = 'accepted' AND v_result#>>'{record,kind}' = 'sign-off',
    'QC sign-off was not accepted';
  ASSERT v_result#>>'{signOff,recordId}' = v_signoff_id::text, 'Latest sign-off missing';
  ASSERT v_result#>>'{signOff,actorId}' = v_manager::text, 'Sign-off actor missing';
  ASSERT v_result#>>'{signOff,highWaterMark}' = v_high_water::text, 'Signed high-water mark changed';
  ASSERT v_result->>'newEvidenceSinceSignOff' = 'false', 'Sign-off made itself stale';
  ASSERT v_result#>>'{record,details,highWaterMark}' = v_high_water::text, 'Sign-off evidence missing fence';
  ASSERT (SELECT to_jsonb(r) FROM v3.runs r WHERE facility_id = v_facility AND id = v_run) = v_run_before,
    'Sign-off mutated run lifecycle, revision, eligibility context, or snapshot';
  ASSERT (SELECT count(*) FROM v3.run_events WHERE facility_id = v_facility AND run_id = v_run) = v_run_events_before,
    'Sign-off wrote run events';
  ASSERT (SELECT count(*) FROM v3.inventory_movements WHERE facility_id = v_facility) = v_inventory_before,
    'Sign-off wrote inventory movements';
  ASSERT (SELECT count(*) FROM v3.facility_operation_events WHERE facility_id = v_facility) = v_operations_before,
    'Sign-off wrote facility operations';
  ASSERT (SELECT count(*) FROM v3.production_schedules WHERE facility_id = v_facility) = v_schedules_before,
    'Sign-off wrote schedules';
  ASSERT (SELECT count(*) FROM v3.run_inventory_consumptions WHERE facility_id = v_facility) = v_consumptions_before,
    'Sign-off wrote inventory consumption';
  ASSERT (SELECT count(*) FROM v3.outbox_events WHERE facility_id = v_facility) = v_run_outbox_before,
    'Sign-off wrote production outbox events';

  PERFORM v3.record_qc_lot(v_recorder, '0026-lot-after-signoff', repeat('6',64), v_run,
    '{"productCode":"QC26-SEMOLINA","lotNumber":"LOT-AFTER-SIGNOFF","notes":""}'::jsonb);
  v_result := v3.get_qc_run_dashboard(v_recorder, v_run);
  ASSERT v_result->>'newEvidenceSinceSignOff' = 'true', 'Later evidence did not make sign-off historical/stale';
  ASSERT v_result#>>'{signOff,recordId}' = v_signoff_id::text, 'Later evidence silently replaced sign-off';

  v_result := v3.sign_off_qc_run(v_manager, '0026-signoff', repeat('5',64), v_run, v_high_water);
  ASSERT v_result#>>'{record,recordId}' = v_signoff_id::text AND v_result->>'replayed' = 'true',
    'Exact sign-off retry did not return original record';
  ASSERT v_result->>'newEvidenceSinceSignOff' = 'false',
    'Exact sign-off retry replaced the original response with current stale state';

  v_result := v3.sign_off_qc_run(v_manager, '0026-stale-signoff', repeat('7',64), v_run, v_high_water);
  ASSERT v_result->>'outcome' = 'conflict' AND v_result->>'replayed' = 'false',
    'Stale sign-off did not conflict';
  ASSERT v_result->>'newEvidenceSinceSignOff' = 'true', 'Conflict did not return canonical stale dashboard';
  ASSERT NOT EXISTS (SELECT 1 FROM v3.qc_command_receipts WHERE request_id = '0026-stale-signoff'),
    'Stale sign-off persisted an accepted receipt';

  v_result := v3.sign_off_qc_run(
    v_manager, '0026-resign', repeat('8',64), v_run, (v_result->>'highWaterMark')::bigint
  );
  ASSERT v_result->>'outcome' = 'accepted' AND v_result->>'newEvidenceSinceSignOff' = 'false',
    'Reviewed current evidence could not be signed again';
  ASSERT (SELECT count(*) FROM v3.qc_run_signoffs WHERE facility_id = v_facility AND run_id = v_run) = 2,
    'Immutable sign-off history was not retained';

  BEGIN
    PERFORM v3.record_qc_component_check(
      v_recorder, '0026-component-after', repeat('9',64), v_run,
      '{"componentKey":"recipe:0:ingredient:0","presence":"absent","notes":"Changed"}'::jsonb
    );
    RAISE EXCEPTION 'Reused component request ID with a different hash was accepted';
  EXCEPTION WHEN SQLSTATE 'P2002' THEN NULL;
  END;
  BEGIN
    PERFORM v3.sign_off_qc_run(v_manager, '0026-signoff', repeat('9',64), v_run, 0);
    RAISE EXCEPTION 'Reused sign-off request ID with a different hash was accepted';
  EXCEPTION WHEN SQLSTATE 'P2002' THEN NULL;
  END;
  BEGIN
    PERFORM v3.record_qc_component_check(
      v_operator, '0026-operator-component', repeat('a',64), v_run,
      '{"componentKey":"recipe:0:ingredient:0","presence":"present","notes":""}'::jsonb
    );
    RAISE EXCEPTION 'Operator recorded component evidence';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM v3.sign_off_qc_run(v_recorder, '0026-recorder-signoff', repeat('b',64), v_run, 0);
    RAISE EXCEPTION 'Record-only role signed off QC';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM v3.record_qc_cleaning(v_recorder, '0026-cross-facility', repeat('c',64), v_other_run,
      '{"area":"Other","status":"cleaned","notes":""}'::jsonb);
    RAISE EXCEPTION 'Cross-facility run evidence was accepted';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  UPDATE v3.staff_accounts SET disabled = true WHERE id = v_disabled;
  BEGIN
    PERFORM v3.record_qc_cleaning(v_disabled, '0026-disabled', repeat('d',64), v_run,
      '{"area":"Mixer","status":"cleaned","notes":""}'::jsonb);
    RAISE EXCEPTION 'Disabled actor recorded QC';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  DELETE FROM v3.user_roles WHERE user_id = v_revoked;
  BEGIN
    PERFORM v3.sign_off_qc_run(v_revoked, '0026-revoked', repeat('e',64), v_run, 0);
    RAISE EXCEPTION 'Revoked actor signed off QC';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE v3.qc_run_signoffs SET high_water_mark = 0 WHERE record_id = v_signoff_id;
    RAISE EXCEPTION 'Sign-off was mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM v3.qc_run_signoffs WHERE record_id = v_signoff_id;
    RAISE EXCEPTION 'Sign-off was deletable';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM v3.record_qc_cleaning(v_recorder, '0026-invalid-cleaning', repeat('f',64), v_run,
      '{"area":"Mixer","status":"possibly","notes":""}'::jsonb);
    RAISE EXCEPTION 'Invalid cleaning state was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  ASSERT (SELECT count(*) FROM v3.qc_audit_events WHERE facility_id = v_facility)
       = (SELECT count(*) FROM v3.qc_records WHERE facility_id = v_facility),
    'QC evidence and audit were not written one-for-one';
  ASSERT (SELECT count(*) FROM v3.qc_outbox_events WHERE facility_id = v_facility)
       = (SELECT count(*) FROM v3.qc_records WHERE facility_id = v_facility),
    'QC evidence and outbox were not written one-for-one';
END
$$;

ROLLBACK;

SELECT '0026 QC run verification SQL tests passed' AS result;
