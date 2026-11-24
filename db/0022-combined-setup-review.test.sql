BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99000000-0000-4000-8000-000000000097';
  v_spec_id uuid;
  v_mix_id uuid;
  v_review_id uuid;
  v_summary jsonb;
  v_record jsonb;
  v_result jsonb;
  v_failed boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;

  v_summary := jsonb_build_object(
    'sourceFamily', 'spec-sheets', 'sourceSha256', repeat('b', 64),
    'parserVersion', 'v1-source-import/2', 'sourceRows', 1,
    'importedRows', 1, 'skippedRows', 0, 'unresolvedRows', 0
  );
  v_record := jsonb_build_object(
    'code', 'COMBINED-RUN', 'name', 'Combined Run',
    'data', jsonb_build_object('brand', 'Example', 'flavor', 'House',
      'values', jsonb_build_object('sauceOzPerPizza', 3.5, 'frontlineRecipeName', 'House Red')),
    'source', jsonb_build_object('workbook', 'synthetic-spec.xlsx', 'cell', 'Spec!B4'),
    'sourceDetails', jsonb_build_object('header', 'House')
  );

  v_failed := false;
  BEGIN
    PERFORM v3.stage_setup_catalog_import(
      v_facility, v_actor, 'combined-missing-citation', repeat('4', 64),
      'run-templates', jsonb_build_array(v_record - 'source' - 'sourceDetails'), v_summary
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Source staging accepted a record without canonical citations'; END IF;

  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'combined-spec', repeat('5', 64),
    'run-templates', jsonb_build_array(v_record), v_summary
  );
  v_spec_id := (v_result->>'importId')::uuid;
  IF v_result->'revision' <> '1'::jsonb THEN RAISE EXCEPTION 'New source import did not receive revision 1'; END IF;

  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'combined-spec', repeat('5', 64),
    'run-templates', jsonb_build_array(v_record), v_summary
  );
  IF v_result->>'replayed' <> 'true' OR (v_result->>'importId')::uuid <> v_spec_id THEN
    RAISE EXCEPTION 'Cited source import exact retry was not idempotent';
  END IF;

  v_result := v3.get_setup_catalog_import(v_facility, v_spec_id);
  IF v_result->'records' <> jsonb_build_array(v_record - 'source' - 'sourceDetails')
     OR v_result->'sourceRecords'->0->'source' <> v_record->'source'
     OR v_result->'sourceRecords'->0->'sourceDetails' <> v_record->'sourceDetails'
     OR v_result->'revision' <> '1'::jsonb THEN
    RAISE EXCEPTION 'Canonical detail did not separate setup records from source evidence';
  END IF;

  v_summary := jsonb_build_object(
    'sourceFamily', 'premix-sheets', 'sourceSha256', repeat('c', 64),
    'parserVersion', 'v1-source-import/2', 'sourceRows', 1,
    'importedRows', 1, 'skippedRows', 0, 'unresolvedRows', 0
  );
  v_record := jsonb_build_object(
    'code', 'HOUSE-RED', 'name', 'House Red',
    'data', jsonb_build_object(
      'brand', 'Example', 'flavor', 'House', 'batchSizeLbs', 40, 'daysEarly', 1,
      'notes', '', 'isPrep', true, 'enabled', true, 'components', '[]'::jsonb
    ),
    'source', jsonb_build_object('workbook', 'synthetic-sauce.xlsx', 'cell', 'Sauce!A2'),
    'sourceDetails', 'null'::jsonb
  );
  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'combined-mix', repeat('6', 64),
    'mixes', jsonb_build_array(v_record), v_summary
  );
  v_mix_id := (v_result->>'importId')::uuid;

  v_result := v3.create_combined_setup_review(
    v_facility, v_actor, 'combined-review', repeat('7', 64),
    jsonb_build_array(v_mix_id, v_spec_id)
  );
  v_review_id := (v_result->>'id')::uuid;
  IF v_result->>'replayed' <> 'false'
     OR v_result->'imports'->0->>'importId' <> v_spec_id::text
     OR v_result->'imports'->1->>'importId' <> v_mix_id::text THEN
    RAISE EXCEPTION 'Combined review did not persist deterministic dependency ordering';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v3.combined_setup_review_imports
    WHERE facility_id = v_facility AND review_id = v_review_id AND import_id = v_spec_id
      AND revision = 1 AND source_sha256 = repeat('b', 64) AND parser_version = 'v1-source-import/2'
  ) THEN RAISE EXCEPTION 'Combined review did not retain the exact source revision pin'; END IF;

  v_result := v3.apply_setup_catalog_import(v_facility, v_actor, v_spec_id);
  IF v_result->>'outcome' <> 'applied' THEN RAISE EXCEPTION 'Individual source Apply changed under combined review'; END IF;
  v_result := v3.get_combined_setup_review(v_facility, v_review_id);
  IF v_result->'imports'->0->>'status' <> 'applied'
     OR v_result->'imports'->0->>'revision' <> '1'
     OR v_result->'currentRecords'->0->>'code' <> 'COMBINED-RUN' THEN
    RAISE EXCEPTION 'Combined projection did not read current canonical setup after independent Apply';
  END IF;

  v_result := v3.create_combined_setup_review(
    v_facility, v_actor, 'combined-review', repeat('7', 64),
    jsonb_build_array(v_mix_id, v_spec_id)
  );
  IF v_result->>'replayed' <> 'true' OR (v_result->>'id')::uuid <> v_review_id THEN
    RAISE EXCEPTION 'Combined review exact retry was not idempotent';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM v3.create_combined_setup_review(
      v_facility, v_actor, 'combined-review', repeat('8', 64), jsonb_build_array(v_spec_id)
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Combined review request ID accepted different content'; END IF;

  v_result := v3.list_combined_setup_reviews(v_facility, 100);
  IF jsonb_array_length(v_result) <> 1 OR v_result->0->>'importCount' <> '2'
     OR v_result->0->>'recordCount' <> '2' THEN
    RAISE EXCEPTION 'Combined review reopening history is incomplete';
  END IF;

  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, v_mix_id);
  IF (v3.get_setup_catalog_import(v_facility, v_spec_id)->>'revision')::integer <> 1
     OR (v3.get_setup_catalog_import(v_facility, v_mix_id)->>'revision')::integer <> 1 THEN
    RAISE EXCEPTION 'Independent Apply changed immutable source revisions';
  END IF;

  RAISE NOTICE 'V3 combined setup review persistence checks passed';
END
$$;

ROLLBACK;

SELECT 'V3 combined setup review persistence checks passed.';
