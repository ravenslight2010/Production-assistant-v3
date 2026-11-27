-- Fill-in-missing-data learned values (slice: FillMissing port).
--
-- v1's FillMissing panel remembered factory-wide: when a manager confirmed a
-- value for a blank run field, it saved (brand, flavor, fieldKey, value) so
-- future scans of the same product proposed that value first ("learned"
-- source, ahead of profile/spec/default). This table is that memory for v3,
-- keyed by the run snapshot's product code plus a namespaced field key
-- (e.g. "sauce.barrelLbs"). Rows are upserted on re-confirm; there is no
-- deletion path — a wrong memory is corrected by confirming a new value,
-- exactly as v1 behaved (saveFillMissingValues upserts by product+field).

BEGIN;

CREATE TABLE IF NOT EXISTS v3.fill_missing_learned_values (
  facility_id  uuid NOT NULL,
  product_code text NOT NULL,
  field_key    text NOT NULL,
  value        text NOT NULL,
  updated_by   uuid NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, product_code, field_key)
);

CREATE INDEX IF NOT EXISTS fill_missing_learned_values_facility_idx
  ON v3.fill_missing_learned_values (facility_id, updated_at DESC);

-- Factory-wide read: any signed-in staff member may list learned values so the
-- scan can propose them (v1 parity: fetchFillMissingValues had no role gate).
CREATE OR REPLACE FUNCTION v3.list_fill_missing_values(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'productCode', row.product_code,
      'fieldKey', row.field_key,
      'value', row.value,
      'updatedBy', row.updated_by,
      'updatedAt', row.updated_at
    ) ORDER BY row.product_code, row.field_key)
    FROM v3.fill_missing_learned_values AS row
    WHERE row.facility_id = p_facility_id
  ), '[]'::jsonb);
END
$$;

-- Manager-confirmed upsert. The API layer gates this behind the
-- manage-profiles capability (v1 parity: saving learned values required
-- manage-profiles); the function itself only requires a real, enabled staff
-- actor and trusts its security-definer caller for the role decision.
CREATE OR REPLACE FUNCTION v3.save_fill_missing_values(p_facility_id uuid, p_actor_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_row jsonb;
  v_count integer := 0;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v3.staff_accounts WHERE id = p_actor_id AND NOT disabled
  ) THEN
    RAISE EXCEPTION 'Invalid staff actor' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 1
    OR jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'Send between one and one hundred learned values.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_row IN ARRAY (SELECT array_agg(value) FROM jsonb_array_elements(p_rows) AS value) LOOP
    IF jsonb_typeof(v_row) <> 'object'
      OR NOT (v_row ? 'productCode') OR NOT (v_row ? 'fieldKey') OR NOT (v_row ? 'value')
      OR jsonb_typeof(v_row->'productCode') <> 'string'
      OR jsonb_typeof(v_row->'fieldKey') <> 'string'
      OR jsonb_typeof(v_row->'value') <> 'string'
      OR v_row->>'productCode' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
      OR v_row->>'fieldKey' !~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,2}$'
      OR char_length(v_row->>'value') < 1
      OR char_length(v_row->>'value') > 200 THEN
      RAISE EXCEPTION 'Each learned value needs a product code, a namespaced field key, and a value up to 200 characters.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO v3.fill_missing_learned_values (
      facility_id, product_code, field_key, value, updated_by, updated_at
    ) VALUES (
      p_facility_id, v_row->>'productCode', v_row->>'fieldKey', v_row->>'value',
      p_actor_id, clock_timestamp()
    )
    ON CONFLICT (facility_id, product_code, field_key)
    DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('saved', v_count);
END
$$;

REVOKE ALL ON FUNCTION v3.list_fill_missing_values(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.save_fill_missing_values(uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION v3.list_fill_missing_values(uuid) TO v3;
GRANT EXECUTE ON FUNCTION v3.save_fill_missing_values(uuid, uuid, jsonb) TO v3;

COMMIT;
