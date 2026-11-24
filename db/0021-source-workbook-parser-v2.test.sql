BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99000000-0000-4000-8000-000000000098';
  v_legacy_id uuid := '21000000-0000-4000-8000-000000000001';
  v_legacy_summary jsonb;
  v_summary jsonb;
  v_records jsonb;
  v_staged_records jsonb;
  v_result jsonb;
  v_failed boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;

  v_legacy_summary := jsonb_build_object(
    'sourceFamily', 'sauce-guides', 'sourceSha256', repeat('a', 64),
    'parserVersion', 'v1-source-import/1', 'sourceRows', 1,
    'importedRows', 1, 'skippedRows', 0, 'unresolvedRows', 0
  );
  v_records := '[{"code":"LEGACY-SAUCE","name":"Legacy Sauce","data":{"brand":"Legacy","flavor":"Classic","values":{"frontlineRecipeName":"House Red","sauceOzPerPizza":3.5}}}]'::jsonb;
  INSERT INTO v3.setup_catalog_imports(
    facility_id, id, actor_id, request_id, request_hash, family, records, result
  ) VALUES (
    v_facility, v_legacy_id, v_actor, 'legacy-source-history', repeat('1', 64),
    'run-templates', v_records, jsonb_build_object('sourceSummary', v_legacy_summary)
  );
  v_result := v3.get_setup_catalog_import(v_facility, v_legacy_id);
  IF v_result->'sourceSummary' <> v_legacy_summary
     OR v_result->'records' <> v_records THEN
    RAISE EXCEPTION 'Parser /1 canonical history is no longer readable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v3.list_setup_catalog_imports(v_facility, 100)) AS entry(value)
    WHERE entry.value->>'id' = v_legacy_id::text
      AND entry.value->'sourceSummary' = v_legacy_summary
  ) THEN RAISE EXCEPTION 'Parser /1 summary disappeared from canonical import history'; END IF;

  v_failed := false;
  BEGIN
    PERFORM v3.stage_setup_catalog_import(
      v_facility, v_actor, 'legacy-source-new-stage', repeat('2', 64),
      'run-templates', v_records, v_legacy_summary
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'New staging accepted parser /1 evidence'; END IF;

  v_summary := jsonb_set(v_legacy_summary, '{parserVersion}', to_jsonb('v1-source-import/2'::text));
  v_staged_records := jsonb_set(v_records, '{0,source}', jsonb_build_object(
    'workbook', 'legacy-sauce.xlsx', 'cell', 'Sheet1!A1'
  ));
  v_staged_records := jsonb_set(v_staged_records, '{0,sourceDetails}', '{"batch":1}'::jsonb);
  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'source-parser-v2', repeat('3', 64),
    'run-templates', v_staged_records, v_summary
  );
  IF v_result->>'replayed' <> 'false' OR v_result->'sourceSummary' <> v_summary THEN
    RAISE EXCEPTION 'Parser /2 source evidence was not staged exactly';
  END IF;
  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'source-parser-v2', repeat('3', 64),
    'run-templates', v_staged_records, v_summary
  );
  IF v_result->>'replayed' <> 'true' OR v_result->'sourceSummary' <> v_summary THEN
    RAISE EXCEPTION 'Parser /2 exact staging retry was not idempotent';
  END IF;

  RAISE NOTICE 'V3 source workbook parser version checks passed';
END
$$;

ROLLBACK;

SELECT 'V3 source workbook parser version checks passed.';
