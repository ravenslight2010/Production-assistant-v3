\set QUIET on
\pset footer off

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '29000000-0000-4000-8000-000000000002';
  v_bad_actor uuid := '29000000-0000-4000-8000-000000000099';
  v_rows jsonb;
  v_result jsonb;
  v_failed text;
BEGIN
  SELECT facility_id INTO v_facility FROM v3.facility_scope WHERE singleton;
  ASSERT v_facility IS NOT NULL, 'test facility scope must exist';

  INSERT INTO v3.staff_accounts (id, username, password_hash) VALUES
    (v_actor, 'FillMissingManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==')
  ON CONFLICT (id) DO NOTHING;

  -- Empty list for a fresh scope.
  DELETE FROM v3.fill_missing_learned_values WHERE facility_id = v_facility;
  v_rows := v3.list_fill_missing_values(v_facility);
  ASSERT jsonb_array_length(v_rows) = 0, 'fresh scope must have no learned values';

  -- Happy path: two rows, then an upsert that replaces one value.
  v_result := v3.save_fill_missing_values(v_facility, v_actor, jsonb_build_array(
    jsonb_build_object('productCode', 'CHEESE-16', 'fieldKey', 'cheese.batchLbs', 'value', '40'),
    jsonb_build_object('productCode', 'cheese-16', 'fieldKey', 'cheese.ozPerPizza', 'value', '6')));
  ASSERT (v_result->>'saved')::integer = 2, 'both rows must report saved';
  ASSERT (SELECT count(*) FROM v3.fill_missing_learned_values
    WHERE facility_id = v_facility) = 2, 'both rows must be stored';

  v_result := v3.save_fill_missing_values(v_facility, v_actor, jsonb_build_array(
    jsonb_build_object('productCode', 'CHEESE-16', 'fieldKey', 'cheese.batchLbs', 'value', '42')));
  ASSERT (v_result->>'saved')::integer = 1, 'upsert must report one saved row';
  ASSERT (SELECT count(*) FROM v3.fill_missing_learned_values
    WHERE facility_id = v_facility) = 2, 're-confirm must upsert, not append';
  ASSERT (SELECT value FROM v3.fill_missing_learned_values
    WHERE facility_id = v_facility AND product_code = 'CHEESE-16'
      AND field_key = 'cheese.batchLbs') = '42', 'upsert must replace the value';

  v_rows := v3.list_fill_missing_values(v_facility);
  ASSERT jsonb_array_length(v_rows) = 2, 'list must return both rows';

  -- Validation errors.
  BEGIN
    PERFORM v3.save_fill_missing_values(v_facility, v_actor, '[]'::jsonb);
    RAISE EXCEPTION 'empty array must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_failed = RETURNED_SQLSTATE;
    ASSERT v_failed = '22023', 'empty array must raise 22023';
  END;

  BEGIN
    PERFORM v3.save_fill_missing_values(v_facility, v_actor,
      jsonb_build_array(jsonb_build_object('productCode', 'P', 'fieldKey', 'Bad Key', 'value', '1')));
    RAISE EXCEPTION 'non-namespaced field key must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_failed = RETURNED_SQLSTATE;
    ASSERT v_failed = '22023', 'bad field key must raise 22023';
  END;

  BEGIN
    PERFORM v3.save_fill_missing_values(v_facility, v_actor,
      jsonb_build_array(jsonb_build_object('productCode', 'P', 'fieldKey', 'sauce.barrelLbs', 'value', repeat('x', 201))));
    RAISE EXCEPTION 'oversized value must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_failed = RETURNED_SQLSTATE;
    ASSERT v_failed = '22023', 'oversized value must raise 22023';
  END;

  -- Unknown staff actor must be rejected.
  BEGIN
    PERFORM v3.save_fill_missing_values(v_facility, v_bad_actor,
      jsonb_build_array(jsonb_build_object('productCode', 'P', 'fieldKey', 'sauce.barrelLbs', 'value', '450')));
    RAISE EXCEPTION 'unknown actor must be rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_failed = RETURNED_SQLSTATE;
    ASSERT v_failed = '42501', 'unknown actor must raise 42501';
  END;

  -- Foreign facility must be rejected on both entry points.
  BEGIN
    PERFORM v3.list_fill_missing_values('29000000-0000-4000-8000-0000000000ff');
    RAISE EXCEPTION 'foreign facility must be rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_failed = RETURNED_SQLSTATE;
    ASSERT v_failed = '42501', 'invalid facility scope must raise 42501';
  END;

  DELETE FROM v3.fill_missing_learned_values WHERE facility_id = v_facility;
  DELETE FROM v3.staff_accounts WHERE id = v_actor;
END $$;
