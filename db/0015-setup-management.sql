-- Typed product capacity editors reuse the reviewed setup-import ledger.
-- Reviewed allergen mappings are limited to the fixed nine visibility aids.
-- Apply only through an explicitly approved database change. Startup never runs SQL.
BEGIN;

CREATE FUNCTION v3.setup_master_record_fingerprint(p_record jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, v3
AS $$
  SELECT CASE WHEN p_record IS NULL OR p_record = 'null'::jsonb THEN NULL
    ELSE encode(sha256(convert_to(jsonb_build_object(
      'code', p_record->>'code', 'name', p_record->>'name',
      'productCode', COALESCE(p_record->>'productCode', p_record->>'product_code'),
      'data', p_record->'data'
    )::text, 'UTF8')), 'hex') END
$$;

CREATE FUNCTION v3.list_setup_master_records(
  p_facility_id uuid,
  p_kind text,
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
  v_rows jsonb;
  v_records jsonb;
  v_next text := NULL;
BEGIN
  IF p_facility_id IS NULL OR p_kind NOT IN ('recipes', 'production-setups')
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_after IS NOT NULL AND p_after !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') THEN
    RAISE EXCEPTION 'Invalid setup record list request' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', code, 'name', name, 'productCode', product_code, 'data', data
  ) ORDER BY lower(code), code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT code, name, product_code, data FROM v3.master_records
    WHERE facility_id = p_facility_id AND kind = p_kind
      AND data->>'sourceFamily' = CASE p_kind
        WHEN 'recipes' THEN 'dough-procedure' ELSE 'shipping-guide' END
      AND (p_after IS NULL OR (lower(code), code) > (lower(p_after), p_after))
    ORDER BY lower(code), code LIMIT p_limit + 1
  ) AS listed;
  IF jsonb_array_length(v_rows) > p_limit THEN
    v_next := v_rows->(p_limit - 1)->>'code';
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb) INTO v_records
    FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS entry(value, ordinality)
    WHERE ordinality <= p_limit;
  ELSE
    v_records := v_rows;
  END IF;
  SELECT COALESCE(jsonb_agg(value || jsonb_build_object(
    'fingerprint', v3.setup_master_record_fingerprint(value)
  ) ORDER BY ordinality), '[]'::jsonb) INTO v_records
  FROM jsonb_array_elements(v_records) WITH ORDINALITY AS entry(value, ordinality);
  RETURN jsonb_build_object('kind', p_kind, 'records', v_records, 'nextCursor', v_next);
END
$$;

CREATE FUNCTION v3.stage_setup_master_edit(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_kind text,
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
  v_current jsonb;
  v_expected_record jsonb;
BEGIN
  IF p_kind NOT IN ('recipes', 'production-setups') OR jsonb_typeof(p_record) <> 'object'
     OR (p_expected_fingerprint IS NOT NULL AND p_expected_fingerprint !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Invalid setup editor request' USING ERRCODE = '22023';
  END IF;
  v_result := v3.stage_setup_import(
    p_facility_id, p_actor_id, p_request_id, p_request_hash,
    p_kind, jsonb_build_array(p_record)
  );
  IF v_result->>'replayed' = 'true' THEN RETURN v_result; END IF;
  v_import_id := (v_result->>'importId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_kind || ':' || lower(p_record->>'code'), 0
  ));
  SELECT to_jsonb(t) INTO v_current FROM v3.master_records AS t
  WHERE t.facility_id = p_facility_id AND t.kind = p_kind AND lower(t.code) = lower(p_record->>'code')
  FOR SHARE;
  IF v3.setup_master_record_fingerprint(v_current) IS DISTINCT FROM p_expected_fingerprint THEN
    RAISE EXCEPTION 'Setup record changed before the edit was staged' USING ERRCODE = '40001';
  END IF;
  v_expected_record := CASE WHEN v_current IS NULL THEN NULL ELSE jsonb_build_object(
    'code', v_current->>'code', 'name', v_current->>'name',
    'productCode', v_current->>'product_code', 'data', v_current->'data'
  ) END;
  UPDATE v3.setup_imports
  SET result = jsonb_build_object('editor', jsonb_build_object(
    'expectedFingerprint', p_expected_fingerprint, 'expectedRecord', v_expected_record
  ))
  WHERE facility_id = p_facility_id AND id = v_import_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v3.apply_setup_import_without_editor_fence(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.setup_imports%ROWTYPE;
  v_row jsonb;
  v_before jsonb;
  v_after jsonb;
  v_before_rows jsonb := '[]'::jsonb;
  v_after_rows jsonb := '[]'::jsonb;
  v_product v3.products%ROWTYPE;
  v_record v3.master_records%ROWTYPE;
  v_code text;
  v_product_code text;
  v_unit text;
  v_name text;
  v_now timestamptz;
  v_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid import scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v3.setup_imports
  WHERE facility_id = p_facility_id AND id = p_import_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'applied' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;
  IF v_import.status <> 'staged' THEN
    RAISE EXCEPTION 'Import cannot be applied in its current state' USING ERRCODE = '55000';
  END IF;
  IF v_import.kind = 'products' THEN
    PERFORM 1 FROM v3.facility_scope
    WHERE singleton AND facility_id = p_facility_id
    FOR UPDATE;
  END IF;
  v_now := clock_timestamp();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_import.records) LOOP
    v_code := v_row->>'code';
    v_name := v_row->>'name';
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_facility_id::text || ':' || v_import.kind || ':' || lower(v_code), 0)
    );
    IF v_import.kind = 'products' THEN
      SELECT * INTO v_product FROM v3.products
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_code)
      FOR UPDATE;
      v_before := CASE WHEN FOUND THEN to_jsonb(v_product) ELSE NULL END;
      v_unit := lower(v_row->>'unit');
      IF FOUND AND v_product.base_unit <> v_unit THEN
        RAISE EXCEPTION 'A product base unit cannot change after creation' USING ERRCODE = '22023';
      END IF;
      IF FOUND THEN
        UPDATE v3.products SET name = v_name, source_import_id = p_import_id, updated_at = v_now
        WHERE facility_id = p_facility_id AND id = v_product.id
        RETURNING * INTO v_product;
      ELSE
        INSERT INTO v3.products (facility_id, code, name, base_unit, source_import_id, created_at, updated_at)
        VALUES (p_facility_id, v_code, v_name, v_unit, p_import_id, v_now, v_now)
        RETURNING * INTO v_product;
      END IF;
      v_after := to_jsonb(v_product);
    ELSE
      v_product_code := v_row->>'productCode';
      SELECT * INTO v_product FROM v3.products
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_product_code) AND active
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Import references an unknown or inactive product' USING ERRCODE = '23503';
      END IF;
      v_product_code := v_product.code;
      SELECT * INTO v_record FROM v3.master_records
      WHERE facility_id = p_facility_id AND kind = v_import.kind AND lower(code) = lower(v_code)
      FOR UPDATE;
      v_before := CASE WHEN FOUND THEN to_jsonb(v_record) ELSE NULL END;
      IF FOUND THEN
        UPDATE v3.master_records
        SET name = v_name, product_code = v_product_code, data = v_row->'data',
            source_import_id = p_import_id, updated_at = v_now
        WHERE facility_id = p_facility_id AND kind = v_import.kind AND id = v_record.id
        RETURNING * INTO v_record;
      ELSE
        INSERT INTO v3.master_records (
          facility_id, kind, code, name, product_code, data, source_import_id, created_at, updated_at
        ) VALUES (
          p_facility_id, v_import.kind, v_code, v_name, v_product_code,
          v_row->'data', p_import_id, v_now, v_now
        ) RETURNING * INTO v_record;
      END IF;
      v_after := to_jsonb(v_record);
    END IF;
    v_before_rows := v_before_rows || jsonb_build_array(jsonb_build_object('code', v_code, 'data', v_before));
    v_after_rows := v_after_rows || jsonb_build_array(jsonb_build_object('code', v_code, 'data', v_after));
  END LOOP;
  v_result := jsonb_build_object(
    'outcome', 'applied',
    'importId', p_import_id,
    'kind', v_import.kind,
    'rowCount', jsonb_array_length(v_import.records),
    'appliedAt', v_now,
    'replayed', false
  );
  UPDATE v3.setup_imports
  SET status = 'applied', before_snapshot = v_before_rows, after_snapshot = v_after_rows,
      result = v_result, applied_at = v_now, applied_by = p_actor_id
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION v3.apply_setup_import(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.setup_imports%ROWTYPE;
  v_editor jsonb;
  v_row jsonb;
  v_current jsonb;
  v_expected text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_import FROM v3.setup_imports
  WHERE facility_id = p_facility_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  v_editor := v_import.result->'editor';
  IF v_import.status = 'staged' AND v_editor IS NOT NULL THEN
    IF v_import.kind NOT IN ('recipes', 'production-setups')
       OR jsonb_array_length(v_import.records) <> 1
       OR v3.setup_catalog_object_size(v_editor) <> 2
       OR NOT (v_editor ?& ARRAY['expectedFingerprint', 'expectedRecord']) THEN
      RAISE EXCEPTION 'Invalid staged setup editor fence' USING ERRCODE = '22023';
    END IF;
    v_row := v_import.records->0;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_facility_id::text || ':' || v_import.kind || ':' || lower(v_row->>'code'), 0
    ));
    SELECT to_jsonb(t) INTO v_current FROM v3.master_records AS t
    WHERE t.facility_id = p_facility_id AND t.kind = v_import.kind AND lower(t.code) = lower(v_row->>'code')
    FOR UPDATE;
    v_expected := v_editor->>'expectedFingerprint';
    IF v3.setup_master_record_fingerprint(v_current) IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'Setup record changed after review; reload and review the edit again' USING ERRCODE = '40001';
    END IF;
  END IF;
  v_result := v3.apply_setup_import_without_editor_fence(p_facility_id, p_actor_id, p_import_id);
  IF v_editor IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('editor', v_editor);
    UPDATE v3.setup_imports SET result = v_result
    WHERE facility_id = p_facility_id AND id = p_import_id;
  END IF;
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION v3.get_setup_import(p_facility_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.setup_imports%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid import scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import
  FROM v3.setup_imports
  WHERE facility_id = p_facility_id AND id = p_import_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_import.id,
    'kind', v_import.kind,
    'status', v_import.status,
    'records', v_import.records,
    'rowCount', jsonb_array_length(v_import.records),
    'createdBy', v_import.actor_id,
    'appliedBy', v_import.applied_by,
    'undoneBy', v_import.undone_by,
    'createdAt', v_import.created_at,
    'appliedAt', v_import.applied_at,
    'undoneAt', v_import.undone_at,
    'editorBefore', v_import.result->'editor'->'expectedRecord',
    'before', v_import.before_snapshot,
    'after', v_import.after_snapshot
  );
END
$$;

-- Recreate the prior internal helper so renamed role grants cannot bypass its fenced wrapper.
DROP FUNCTION v3.apply_setup_catalog_import_without_editor_fence(uuid, uuid, uuid);

CREATE FUNCTION v3.apply_setup_catalog_import_without_editor_fence(p_facility_id uuid, p_actor_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_import v3.setup_catalog_imports%ROWTYPE;
  v_table text;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_now timestamptz;
  v_result jsonb;
  v_component jsonb;
  v_component_index integer;
  v_ingredient_code text;
  v_created_count integer := 0;
  v_updated_count integer := 0;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_import_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_import FROM v3.setup_catalog_imports
  WHERE facility_id = p_facility_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import not found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'applied' THEN
    RETURN COALESCE(v_import.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;
  IF v_import.status <> 'staged' THEN
    RAISE EXCEPTION 'Import cannot be applied in its current state' USING ERRCODE = '55000';
  END IF;
  v_table := v3.setup_catalog_table_name(v_import.family);
  v_now := clock_timestamp();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_import.records) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_facility_id::text || ':' || v_import.family || ':' || lower(v_row->>'code'), 0
    ));
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v3.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2) FOR UPDATE',
      v_table
    ) INTO v_old USING p_facility_id, v_row->>'code';
    IF v_import.family = 'die-line-defaults' AND NOT EXISTS (
      SELECT 1 FROM v3.setup_die_type_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(v_row->>'code')
    ) THEN
      RAISE EXCEPTION 'Import references an unknown die type; import die types first' USING ERRCODE = '23503';
    END IF;
    IF v_import.family = 'mixes' THEN
      DELETE FROM v3.setup_mix_component_links
      WHERE facility_id = p_facility_id AND lower(mix_code) = lower(v_row->>'code');
    END IF;
    IF v_old IS NULL THEN
      v_created_count := v_created_count + 1;
      EXECUTE format(
        'INSERT INTO v3.%I (facility_id, code, name, data, source_import_id, updated_at) ' ||
        'VALUES ($1, $2, $3, $4, $5, $6)',
        v_table
      ) USING p_facility_id, v_row->>'code', v_row->>'name', v_row->'data', p_import_id, v_now;
    ELSE
      v_updated_count := v_updated_count + 1;
      EXECUTE format(
        'UPDATE v3.%I SET name = $1, data = $2, source_import_id = $3, updated_at = $4 ' ||
        'WHERE facility_id = $5 AND lower(code) = lower($6)',
        v_table
      ) USING v_row->>'name', v_row->'data', p_import_id, v_now,
        p_facility_id, v_row->>'code';
    END IF;
    IF v_import.family = 'mixes' THEN
      v_component_index := 0;
      FOR v_component IN SELECT value FROM jsonb_array_elements(v_row->'data'->'components') LOOP
        IF jsonb_typeof(v_component) <> 'object' THEN
          RAISE EXCEPTION 'Mix component has an invalid field map' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_component) AS item(key)
          WHERE item.key <> ALL (ARRAY['ingredientName','ingredientCode','perPizzaOz','perBatchLbs'])
        ) OR jsonb_typeof(v_component->'ingredientName') <> 'string'
          OR length(btrim(v_component->>'ingredientName')) = 0
          OR (v_component->>'perPizzaOz' IS NULL AND v_component->>'perBatchLbs' IS NULL)
          OR (v_component->>'perPizzaOz' IS NOT NULL AND (
            jsonb_typeof(v_component->'perPizzaOz') <> 'number'
            OR (v_component->>'perPizzaOz')::numeric < 0
          ))
          OR (v_component->>'perBatchLbs' IS NOT NULL AND (
            jsonb_typeof(v_component->'perBatchLbs') <> 'number'
            OR (v_component->>'perBatchLbs')::numeric < 0
          )) THEN
          RAISE EXCEPTION 'Mix component has an invalid field map' USING ERRCODE = '22023';
        END IF;
        IF v_component->>'ingredientCode' IS NOT NULL
           AND v_component->'ingredientCode' <> 'null'::jsonb THEN
          SELECT code INTO v_ingredient_code
          FROM v3.setup_ingredient_records
          WHERE facility_id = p_facility_id
            AND lower(code) = lower(v_component->>'ingredientCode');
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Mix references an unknown ingredient identity' USING ERRCODE = '23503';
          END IF;
          INSERT INTO v3.setup_mix_component_links (
            facility_id, mix_code, component_index, ingredient_code, source_import_id
          ) VALUES (
            p_facility_id, v_row->>'code', v_component_index, v_ingredient_code, p_import_id
          );
        END IF;
        v_component_index := v_component_index + 1;
      END LOOP;
    END IF;
    EXECUTE format(
      'SELECT to_jsonb(t) FROM v3.%I AS t WHERE t.facility_id = $1 AND lower(t.code) = lower($2)',
      v_table
    ) INTO v_new USING p_facility_id, v_row->>'code';
    v_before := v_before || jsonb_build_array(jsonb_build_object('code', v_row->>'code', 'data', v_old));
    v_after := v_after || jsonb_build_array(jsonb_build_object('code', v_row->>'code', 'data', v_new));
  END LOOP;
  v_result := jsonb_build_object(
    'outcome', 'applied', 'importId', p_import_id, 'family', v_import.family,
    'rowCount', jsonb_array_length(v_import.records), 'createdCount', v_created_count,
    'updatedCount', v_updated_count, 'appliedAt', v_now, 'replayed', false
  ) || COALESCE(
    CASE WHEN v_import.result ? 'sourceSummary'
      THEN jsonb_build_object('sourceSummary', v_import.result->'sourceSummary')
      ELSE NULL END,
    '{}'::jsonb
  );
  UPDATE v3.setup_catalog_imports
  SET status = 'applied', before_snapshot = v_before, after_snapshot = v_after,
      applied_at = v_now, result = v_result
  WHERE facility_id = p_facility_id AND id = p_import_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v3.enforce_reviewed_allergen_options()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF NEW.family = 'ingredients' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.records) AS record(value)
    CROSS JOIN LATERAL jsonb_array_elements(record.value->'data'->'allergens') AS allergen(value)
    WHERE (record.value->'data'->>'allergensReviewed')::boolean
      AND (jsonb_typeof(allergen.value) <> 'string' OR allergen.value #>> '{}' NOT IN (
        'milk', 'eggs', 'fish', 'crustacean shellfish', 'tree nuts',
        'peanuts', 'wheat', 'soybeans', 'sesame'
      ))
  ) THEN
    RAISE EXCEPTION 'A reviewed allergen mapping may contain only the fixed nine allergen options'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER setup_catalog_reviewed_allergens
BEFORE INSERT OR UPDATE OF records ON v3.setup_catalog_imports
FOR EACH ROW EXECUTE FUNCTION v3.enforce_reviewed_allergen_options();

REVOKE ALL ON FUNCTION v3.setup_master_record_fingerprint(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_setup_master_records(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.stage_setup_master_edit(uuid, uuid, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_setup_import(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_setup_import_without_editor_fence(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_setup_import(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_setup_catalog_import_without_editor_fence(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.enforce_reviewed_allergen_options() FROM PUBLIC;

COMMIT;
