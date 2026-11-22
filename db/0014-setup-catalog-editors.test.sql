BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99000000-0000-4000-8000-000000000097';
  v_result jsonb;
  v_page jsonb;
  v_create uuid;
  v_update uuid;
  v_stale uuid;
  v_record jsonb;
  v_fingerprint text;
  v_rejected boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;

  v_record := '{"code":"DIE-EDITOR","name":"Editor die","data":{}}'::jsonb;
  v_result := v3.stage_setup_catalog_edit(
    v_facility, v_actor, 'editor-create', repeat('a', 64), 'die-types', v_record, NULL
  );
  v_create := (v_result->>'importId')::uuid;
  IF v_result->>'rowCount' <> '1' OR v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'Typed create was not staged as one reviewed record';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v3.setup_catalog_imports
    WHERE id = v_create AND status = 'staged'
      AND result->'editor'->'expectedRecord' = 'null'::jsonb
      AND result->'editor'->>'expectedFingerprint' IS NULL
  ) THEN RAISE EXCEPTION 'Create editor did not preserve its empty expected base'; END IF;
  IF (v3.get_setup_catalog_import(v_facility, v_create)->'editorBefore') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'Create review did not expose an explicit empty before state';
  END IF;
  IF EXISTS (SELECT 1 FROM v3.setup_die_type_records WHERE facility_id = v_facility AND code = 'DIE-EDITOR') THEN
    RAISE EXCEPTION 'Staging an editor record changed the catalog before Apply';
  END IF;

  v_result := v3.stage_setup_catalog_edit(
    v_facility, v_actor, 'editor-create', repeat('a', 64), 'die-types', v_record, NULL
  );
  IF v_result->>'replayed' <> 'true' OR (v_result->>'importId')::uuid <> v_create THEN
    RAISE EXCEPTION 'Typed stage exact retry did not return the original review';
  END IF;
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, v_create);
  v_result := v3.apply_setup_catalog_import(v_facility, v_actor, v_create);
  IF v_result->>'replayed' <> 'true' THEN RAISE EXCEPTION 'Typed Apply retry was not idempotent'; END IF;

  v_page := v3.list_setup_catalog_records(v_facility, 'die-types', 100);
  SELECT value->>'fingerprint' INTO v_fingerprint
  FROM jsonb_array_elements(v_page->'records') AS entry(value)
  WHERE value->>'code' = 'DIE-EDITOR';
  IF v_fingerprint IS NULL OR v_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Applied editor record did not receive a canonical server fingerprint';
  END IF;
  IF v3.get_setup_catalog_import(v_facility, v_create)->'editorBefore' IS NULL THEN
    RAISE EXCEPTION 'Applied editor review lost its original before state';
  END IF;

  v_record := '{"code":"die-editor","name":"Editor die revised","data":{}}'::jsonb;
  v_result := v3.stage_setup_catalog_edit(
    v_facility, v_actor, 'editor-update', repeat('b', 64), 'die-types', v_record, v_fingerprint
  );
  v_update := (v_result->>'importId')::uuid;
  IF v3.get_setup_catalog_import(v_facility, v_update)->'editorBefore'->>'name' <> 'Editor die' THEN
    RAISE EXCEPTION 'Editor review did not retain the exact record loaded by the manager';
  END IF;
  v_result := v3.stage_setup_catalog_edit(
    v_facility, v_actor, 'editor-stale', repeat('c', 64), 'die-types',
    '{"code":"DIE-EDITOR","name":"Conflicting revision","data":{}}'::jsonb, v_fingerprint
  );
  v_stale := (v_result->>'importId')::uuid;
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, v_update);
  v_rejected := false;
  BEGIN
    PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, v_stale);
  EXCEPTION WHEN SQLSTATE '40001' THEN v_rejected := true;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM v3.setup_die_type_records
    WHERE facility_id = v_facility AND code = 'DIE-EDITOR' AND name = 'Editor die revised'
  ) THEN RAISE EXCEPTION 'A stale reviewed edit overwrote a newer canonical record'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM v3.stage_setup_catalog_edit(
      v_facility, v_actor, 'editor-duplicate', repeat('d', 64), 'die-types',
      '{"code":"DIE-EDITOR","name":"Duplicate create","data":{}}'::jsonb, NULL
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Create editor did not reject an already existing code'; END IF;

  v_result := v3.stage_setup_catalog_edit(
    v_facility, v_actor, 'editor-page', repeat('e', 64), 'die-types',
    '{"code":"DIE-EDITOR-2","name":"Second editor die","data":{}}'::jsonb, NULL
  );
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, (v_result->>'importId')::uuid);
  v_page := v3.list_setup_catalog_records(v_facility, 'die-types', 1);
  IF jsonb_array_length(v_page->'records') <> 1 OR v_page->>'nextCursor' IS NULL THEN
    RAISE EXCEPTION 'Catalog editor pagination did not return a bounded next cursor';
  END IF;
  v_result := v3.list_setup_catalog_records(v_facility, 'die-types', 1, v_page->>'nextCursor');
  IF jsonb_array_length(v_result->'records') <> 1
     OR v_result->'records'->0->>'code' = v_page->'records'->0->>'code' THEN
    RAISE EXCEPTION 'Catalog editor cursor did not advance without duplication';
  END IF;

  v_result := v3.stage_setup_catalog_import(
    v_facility, v_actor, 'bulk-still-supported', repeat('f', 64), 'die-types',
    '[{"code":"DIE-BULK","name":"Bulk import remains compatible","data":{}}]'::jsonb, NULL
  );
  PERFORM v3.apply_setup_catalog_import(v_facility, v_actor, (v_result->>'importId')::uuid);
  IF NOT EXISTS (SELECT 1 FROM v3.setup_die_type_records WHERE facility_id = v_facility AND code = 'DIE-BULK') THEN
    RAISE EXCEPTION 'Editor fencing changed the existing bulk import lifecycle';
  END IF;

  RAISE NOTICE 'V3 typed setup editor fencing and pagination checks passed';
END
$$;

ROLLBACK;
SELECT 'V3 typed setup editor checks passed.';
