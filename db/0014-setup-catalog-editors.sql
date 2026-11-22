-- Typed setup editors reuse the reviewed import ledger with optimistic base fencing.
-- Apply only through an explicitly approved database change. Startup never runs SQL.
BEGIN;

CREATE FUNCTION v3.setup_catalog_record_fingerprint(p_record jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, v3
AS $$
  SELECT CASE WHEN p_record IS NULL OR p_record = 'null'::jsonb THEN NULL
    ELSE encode(sha256(convert_to(jsonb_build_object(
      'code', p_record->>'code', 'name', p_record->>'name', 'data', p_record->'data'
    )::text, 'UTF8')), 'hex') END
$$;

CREATE FUNCTION v3.list_setup_catalog_records(
  p_facility_id uuid,
  p_family text,
  p_limit integer,
  p_after text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_table text := v3.setup_catalog_table_name(p_family);
  v_rows jsonb;
  v_records jsonb;
  v_next text := NULL;
BEGIN
  IF p_facility_id IS NULL OR v_table IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_after IS NOT NULL AND p_after !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') THEN
    RAISE EXCEPTION 'Invalid setup catalog list request' USING ERRCODE = '22023';
  END IF;
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(''code'', code, ''name'', name, ''data'', data) ' ||
    'ORDER BY lower(code), code), ''[]''::jsonb) FROM (' ||
    'SELECT code, name, data FROM v3.%I WHERE facility_id = $1 ' ||
    'AND ($2::text IS NULL OR (lower(code), code) > (lower($2), $2)) ' ||
    'ORDER BY lower(code), code LIMIT $3) AS listed',
    v_table
  ) INTO v_rows USING p_facility_id, p_after, p_limit + 1;
  IF jsonb_array_length(v_rows) > p_limit THEN
    v_next := v_rows->(p_limit - 1)->>'code';
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb) INTO v_records
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS entry(value, ordinality)
    WHERE ordinality <= p_limit;
  ELSE
    v_records := v_rows;
  END IF;
  SELECT COALESCE(jsonb_agg(value || jsonb_build_object(
    'fingerprint', v3.setup_catalog_record_fingerprint(value)
  ) ORDER BY ordinality), '[]'::jsonb) INTO v_records
  FROM jsonb_array_elements(v_records) WITH ORDINALITY AS entry(value, ordinality);
  RETURN jsonb_build_object('family', p_family, 'records', v_records, 'nextCursor', v_next);
END
$$;

CREATE FUNCTION v3.stage_setup_catalog_edit(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_family text,
  p_record jsonb,
  p_expected_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_result jsonb;
  v_import_id uuid;
  v_table text := v3.setup_catalog_table_name(p_family);
  v_current jsonb;
  v_expected_record jsonb;
BEGIN
  IF v_table IS NULL OR jsonb_typeof(p_record) <> 'object'
     OR (p_expected_fingerprint IS NOT NULL AND p_expected_fingerprint !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Invalid setup editor request' USING ERRCODE = '22023';
  END IF;
  v_result := v3.stage_setup_catalog_import(
    p_facility_id, p_actor_id, p_request_id, p_request_hash,
    p_family, jsonb_build_array(p_record), NULL
  );
  IF v_result->>'replayed' = 'true' THEN RETURN v_result; END IF;
  v_import_id := (v_result->>'importId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_family || ':' || lower(p_record->>'code'), 0
  ));
  EXECUTE format(
    'SELECT to_jsonb(t) FROM v3.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2) FOR SHARE',
    v_table
  ) INTO v_current USING p_facility_id, p_record->>'code';
  IF v3.setup_catalog_record_fingerprint(v_current) IS DISTINCT FROM p_expected_fingerprint THEN
    RAISE EXCEPTION 'Setup record changed before the edit was staged' USING ERRCODE = '40001';
  END IF;
  v_expected_record := CASE WHEN v_current IS NULL THEN NULL ELSE jsonb_build_object(
    'code', v_current->>'code', 'name', v_current->>'name', 'data', v_current->'data'
  ) END;
  UPDATE v3.setup_catalog_imports
  SET result = jsonb_build_object('editor', jsonb_build_object(
    'expectedFingerprint', p_expected_fingerprint, 'expectedRecord', v_expected_record
  ))
  WHERE facility_id = p_facility_id AND id = v_import_id;
  RETURN v_result;
END
$$;

ALTER FUNCTION v3.apply_setup_catalog_import(uuid, uuid, uuid)
  RENAME TO apply_setup_catalog_import_without_editor_fence;

CREATE FUNCTION v3.apply_setup_catalog_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.setup_catalog_imports%ROWTYPE;
  v_editor jsonb;
  v_row jsonb;
  v_table text;
  v_current jsonb;
  v_expected text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_import FROM v3.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  v_editor := v_import.result->'editor';
  IF v_import.status = 'staged' AND v_editor IS NOT NULL THEN
    IF jsonb_array_length(v_import.records) <> 1
       OR v3.setup_catalog_object_size(v_editor) <> 2
       OR NOT (v_editor ?& ARRAY['expectedFingerprint', 'expectedRecord']) THEN
      RAISE EXCEPTION 'Invalid staged setup editor fence' USING ERRCODE = '22023';
    END IF;
    v_row := v_import.records->0;
    v_table := v3.setup_catalog_table_name(v_import.family);
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_facility_id::text || ':' || v_import.family || ':' || lower(v_row->>'code'), 0
    ));
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v3.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2) FOR UPDATE',
      v_table
    ) INTO v_current USING p_facility_id, v_row->>'code';
    v_expected := v_editor->>'expectedFingerprint';
    IF v3.setup_catalog_record_fingerprint(v_current) IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'Setup record changed after review; reload and review the edit again' USING ERRCODE = '40001';
    END IF;
  END IF;
  v_result := v3.apply_setup_catalog_import_without_editor_fence(p_facility_id, p_actor_id, p_import_id);
  IF v_editor IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('editor', v_editor);
    UPDATE v3.setup_catalog_imports SET result = v_result
    WHERE facility_id = p_facility_id AND id = p_import_id;
  END IF;
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION v3.get_setup_catalog_import(p_facility_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.setup_catalog_imports%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v3.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_import.id, 'family', v_import.family, 'status', v_import.status, 'records', v_import.records,
    'rowCount', jsonb_array_length(v_import.records),
    'createdBy', v_import.actor_id, 'createdAt', v_import.created_at,
    'appliedAt', v_import.applied_at, 'undoneAt', v_import.undone_at,
    'sourceSummary', v_import.result->'sourceSummary',
    'createdCount', (v_import.result->>'createdCount')::integer,
    'updatedCount', (v_import.result->>'updatedCount')::integer,
    'editorBefore', v_import.result->'editor'->'expectedRecord',
    'before', v_import.before_snapshot, 'after', v_import.after_snapshot
  );
END
$$;

REVOKE ALL ON FUNCTION v3.setup_catalog_record_fingerprint(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_setup_catalog_records(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.stage_setup_catalog_edit(uuid, uuid, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_setup_catalog_import(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_setup_catalog_import_without_editor_fence(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_setup_catalog_import(uuid, uuid) FROM PUBLIC;

COMMIT;
