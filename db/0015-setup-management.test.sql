BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99000000-0000-4000-8000-000000000098';
  v_result jsonb;
  v_page jsonb;
  v_create uuid;
  v_update uuid;
  v_stale uuid;
  v_record jsonb;
  v_original jsonb;
  v_fingerprint text;
  v_rejected boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;

  v_result := v3.stage_setup_import(
    v_facility, v_actor, 'master-editor-product', repeat('0', 64), 'products',
    '[{"code":"MASTER-PRODUCT","name":"Master editor product","unit":"case"}]'::jsonb
  );
  PERFORM v3.apply_setup_import(v_facility, v_actor, (v_result->>'importId')::uuid);

  v_record := jsonb_build_object(
    'code', 'DOUGH-EDITOR', 'name', 'Editor dough', 'productCode', 'MASTER-PRODUCT',
    'data', jsonb_build_object(
      'sourceFamily', 'dough-procedure', 'sourceKey', repeat('a', 64),
      'fileName', 'dough.xlsx', 'fileSha256', repeat('b', 64),
      'source', jsonb_build_object('sheet', 'Dough', 'row', 4),
      'doughballYield', 700, 'doughballWeightOz', 8, 'doughballsPerTray', 24
    )
  );
  v_original := v_record;
  v_result := v3.stage_setup_master_edit(
    v_facility, v_actor, 'master-editor-create', repeat('1', 64), 'recipes', v_record, NULL
  );
  v_create := (v_result->>'importId')::uuid;
  IF v_result->>'rowCount' <> '1' OR v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'Typed master create was not staged as one reviewed record';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v3.setup_imports
    WHERE id = v_create AND status = 'staged'
      AND result->'editor'->'expectedRecord' = 'null'::jsonb
      AND result->'editor'->>'expectedFingerprint' IS NULL
  ) THEN RAISE EXCEPTION 'Master create editor did not preserve its empty expected base'; END IF;
  IF v3.get_setup_import(v_facility, v_create)->'editorBefore' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Master create review did not expose an explicit empty before state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v3.master_records WHERE facility_id = v_facility AND code = 'DOUGH-EDITOR'
  ) THEN RAISE EXCEPTION 'Staging a master edit changed the canonical record before Apply'; END IF;

  v_result := v3.stage_setup_master_edit(
    v_facility, v_actor, 'master-editor-create', repeat('1', 64), 'recipes', v_record, NULL
  );
  IF v_result->>'replayed' <> 'true' OR (v_result->>'importId')::uuid <> v_create THEN
    RAISE EXCEPTION 'Typed master stage exact retry did not return the original review';
  END IF;
  PERFORM v3.apply_setup_import(v_facility, v_actor, v_create);
  v_result := v3.apply_setup_import(v_facility, v_actor, v_create);
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Typed master Apply retry was not idempotent'; END IF;

  INSERT INTO v3.master_records (facility_id, kind, code, name, product_code, data, source_import_id)
  VALUES (
    v_facility, 'recipes', 'LEGACY-RECIPE', 'Legacy ingredient recipe', 'MASTER-PRODUCT',
    '{"station_key":"dough","ingredients":[{"product_code":"MASTER-PRODUCT","quantity":1,"unit":"case"}]}'::jsonb, v_create
  );
  v_page := v3.list_setup_master_records(v_facility, 'recipes', 100);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_page->'records') AS entry(value)
    WHERE value->>'code' = 'LEGACY-RECIPE' OR value->'data'->>'sourceFamily' IS DISTINCT FROM 'dough-procedure'
  ) THEN RAISE EXCEPTION 'Typed dough editor listed an ineligible legacy ingredient recipe'; END IF;
  SELECT value->>'fingerprint' INTO v_fingerprint
  FROM jsonb_array_elements(v_page->'records') AS entry(value)
  WHERE value->>'code' = 'DOUGH-EDITOR';
  IF v_fingerprint IS NULL OR v_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Applied master record did not receive a canonical server fingerprint';
  END IF;
  IF v3.get_setup_import(v_facility, v_create)->'editorBefore' IS NULL THEN
    RAISE EXCEPTION 'Applied master review lost its original before state';
  END IF;

  v_record := jsonb_set(v_record, '{name}', '"Editor dough revised"'::jsonb);
  v_record := jsonb_set(v_record, '{data,doughballYield}', '720'::jsonb);
  v_result := v3.stage_setup_master_edit(
    v_facility, v_actor, 'master-editor-update', repeat('2', 64), 'recipes', v_record, v_fingerprint
  );
  v_update := (v_result->>'importId')::uuid;
  IF v3.get_setup_import(v_facility, v_update)->'editorBefore'->>'name' <> 'Editor dough'
     OR v3.get_setup_import(v_facility, v_update)->'editorBefore'->'data'->>'fileSha256' <> repeat('b', 64) THEN
    RAISE EXCEPTION 'Master editor review did not retain the loaded record and provenance';
  END IF;
  v_result := v3.stage_setup_master_edit(
    v_facility, v_actor, 'master-editor-stale', repeat('3', 64), 'recipes',
    jsonb_set(v_original, '{name}', '"Conflicting revision"'::jsonb), v_fingerprint
  );
  v_stale := (v_result->>'importId')::uuid;
  PERFORM v3.apply_setup_import(v_facility, v_actor, v_update);
  v_rejected := false;
  BEGIN
    PERFORM v3.apply_setup_import(v_facility, v_actor, v_stale);
  EXCEPTION WHEN SQLSTATE '40001' THEN v_rejected := true;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM v3.master_records
    WHERE facility_id = v_facility AND code = 'DOUGH-EDITOR' AND name = 'Editor dough revised'
      AND data->>'doughballYield' = '720' AND data->>'fileSha256' = repeat('b', 64)
  ) THEN RAISE EXCEPTION 'A stale master edit overwrote newer canonical data or lost provenance'; END IF;

  PERFORM v3.undo_setup_import(v_facility, v_actor, v_update);
  IF NOT EXISTS (
    SELECT 1 FROM v3.master_records
    WHERE facility_id = v_facility AND code = 'DOUGH-EDITOR' AND name = 'Editor dough'
      AND data->>'doughballYield' = '700'
  ) THEN RAISE EXCEPTION 'Undo did not restore the exact prior master record'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM v3.stage_setup_master_edit(
      v_facility, v_actor, 'master-editor-duplicate', repeat('4', 64), 'recipes', v_original, NULL
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Master create editor did not reject an existing code'; END IF;

  v_result := v3.stage_setup_import(
    v_facility, v_actor, 'master-bulk-supported', repeat('5', 64), 'recipes',
    jsonb_build_array(jsonb_set(v_original, '{code}', '"DOUGH-BULK"'::jsonb))
  );
  PERFORM v3.apply_setup_import(v_facility, v_actor, (v_result->>'importId')::uuid);
  IF NOT EXISTS (
    SELECT 1 FROM v3.master_records WHERE facility_id = v_facility AND code = 'DOUGH-BULK'
  ) THEN RAISE EXCEPTION 'Editor fencing changed the existing bulk setup-import lifecycle'; END IF;

  v_page := v3.list_setup_master_records(v_facility, 'recipes', 1);
  IF jsonb_array_length(v_page->'records') <> 1 OR v_page->>'nextCursor' IS NULL THEN
    RAISE EXCEPTION 'Master editor pagination did not return a bounded next cursor';
  END IF;
  v_result := v3.list_setup_master_records(v_facility, 'recipes', 1, v_page->>'nextCursor');
  IF jsonb_array_length(v_result->'records') <> 1
     OR v_result->'records'->0->>'code' = v_page->'records'->0->>'code' THEN
    RAISE EXCEPTION 'Master editor cursor did not advance without duplication';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM v3.stage_setup_catalog_import(
      v_facility, v_actor, 'reviewed-allergen-rejected', repeat('6', 64), 'ingredients',
      '[{"code":"ING-REVIEWED","name":"Reviewed ingredient","data":{"categories":[],"allergens":["legacy uncertain text"],"allergensReviewed":true,"mergedIntoCode":null,"enabled":true}}]'::jsonb,
      NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Reviewed allergen text bypassed the fixed-nine SQL backstop'; END IF;

  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'legacy-allergen-preserved', repeat('7', 64), 'ingredients',
    '[{"code":"ING-LEGACY","name":"Legacy ingredient","data":{"categories":[],"allergens":["legacy uncertain text"],"allergensReviewed":false,"mergedIntoCode":null,"enabled":true}}]'::jsonb,
    NULL
  );
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, (v_result->>'importId')::uuid);
  IF NOT EXISTS (
    SELECT 1 FROM v3.setup_ingredient_records
    WHERE facility_id = v_facility AND code = 'ING-LEGACY'
      AND data->'allergens'->>0 = 'legacy uncertain text'
      AND data->>'allergensReviewed' = 'false'
  ) THEN RAISE EXCEPTION 'Unreviewed legacy allergen text was discarded or interpreted as reviewed'; END IF;

  RAISE NOTICE 'V3 master editor fencing, provenance, pagination, and allergen checks passed';
END
$$;

ROLLBACK;
SELECT 'V3 setup management checks passed.';
