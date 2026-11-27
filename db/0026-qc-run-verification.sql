-- Run-scoped component, allergen/staging, cleaning, independent verification, and sign-off evidence.
-- All QC outcomes remain advisory; these functions never mutate production or inventory state.

BEGIN;

ALTER TABLE v3.qc_records DROP CONSTRAINT IF EXISTS qc_records_kind_check;
ALTER TABLE v3.qc_records ADD CONSTRAINT qc_records_kind_check CHECK (kind IN (
  'lot', 'weight-check', 'brix-check', 'target-set',
  'component-check', 'allergen-review', 'cleaning', 'cleaning-verification', 'sign-off'
));

CREATE TABLE IF NOT EXISTS v3.qc_run_signoffs (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  facility_id uuid NOT NULL REFERENCES v3.facility_scope(facility_id),
  run_id uuid NOT NULL,
  record_id uuid NOT NULL UNIQUE REFERENCES v3.qc_records(record_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  high_water_mark bigint NOT NULL CHECK (high_water_mark BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (facility_id, run_id) REFERENCES v3.runs(facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, actor_id, request_id)
    REFERENCES v3.qc_command_receipts(facility_id, actor_id, request_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS qc_run_signoffs_run_sequence_idx
  ON v3.qc_run_signoffs(facility_id, run_id, sequence DESC);

DROP TRIGGER IF EXISTS qc_run_signoffs_append_only ON v3.qc_run_signoffs;
CREATE TRIGGER qc_run_signoffs_append_only
  BEFORE UPDATE OR DELETE ON v3.qc_run_signoffs
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE OR REPLACE FUNCTION v3.lock_qc_run(p_facility_id uuid, p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF p_run_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v3.runs WHERE facility_id = p_facility_id AND id = p_run_id
  ) THEN
    RAISE EXCEPTION 'QC run not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_run_id::text || ':qc-run', 0
  ));
END
$$;

CREATE OR REPLACE FUNCTION v3.qc_run_component_snapshot(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_run v3.runs%ROWTYPE;
  v_completed v3.completed_run_substitutions%ROWTYPE;
  v_plan jsonb;
  v_overlay jsonb;
  v_source text;
  v_overlay_revision bigint := 0;
  v_recipe jsonb;
  v_line jsonb;
  v_components jsonb := '[]'::jsonb;
  v_recipe_index integer;
  v_line_index integer;
  v_component jsonb;
BEGIN
  SELECT * INTO v_run FROM v3.runs WHERE facility_id = p_facility_id AND id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'QC run not found' USING ERRCODE = 'P0002'; END IF;

  IF v_run.status = 'completed' THEN
    SELECT * INTO v_completed FROM v3.completed_run_substitutions
      WHERE facility_id = p_facility_id AND run_id = p_run_id;
    IF FOUND THEN
      v_plan := v_completed.effective_production_plan;
      v_overlay_revision := v_completed.overlay_revision;
    ELSE
      v_plan := v_run.setup_snapshot->'productionPlan';
    END IF;
    v_source := 'completed-run';
  ELSE
    v_plan := v3.effective_production_plan(
      p_facility_id, v_run.production_date, v_run.setup_snapshot->'productionPlan'
    );
    v_overlay := v3.get_substitution_overlay(p_facility_id, v_run.production_date);
    v_overlay_revision := (v_overlay->>'revision')::bigint;
    v_source := 'effective-plan';
  END IF;

  IF v_plan IS NOT NULL AND jsonb_typeof(v_plan->'recipes') = 'array' THEN
    v_recipe_index := 0;
    FOR v_recipe IN SELECT value FROM jsonb_array_elements(v_plan->'recipes') LOOP
      IF jsonb_typeof(v_recipe) = 'object' AND jsonb_typeof(v_recipe->'ingredients') = 'array' THEN
        v_line_index := 0;
        FOR v_line IN SELECT value FROM jsonb_array_elements(v_recipe->'ingredients') LOOP
          IF jsonb_typeof(v_line) = 'object' THEN
            v_component := jsonb_build_object(
              'componentKey', 'recipe:' || v_recipe_index || ':ingredient:' || v_line_index,
              'componentType', 'ingredient',
              'recipeCode', CASE WHEN jsonb_typeof(v_recipe->'code') = 'string' THEN v_recipe->>'code' END,
              'recipeName', CASE WHEN jsonb_typeof(v_recipe->'name') = 'string' THEN v_recipe->>'name' END,
              'stationKey', CASE WHEN jsonb_typeof(v_recipe->'stationKey') = 'string' THEN v_recipe->>'stationKey' END,
              'productId', CASE WHEN jsonb_typeof(v_line->'productId') = 'string' THEN v_line->>'productId' END,
              'productCode', CASE WHEN jsonb_typeof(v_line->'productCode') = 'string' THEN v_line->>'productCode' END,
              'productName', CASE WHEN jsonb_typeof(v_line->'productName') = 'string' THEN v_line->>'productName' ELSE 'Unnamed component' END,
              'quantity', CASE WHEN jsonb_typeof(v_line->'quantity') IN ('string','number') THEN v_line->>'quantity' END,
              'unit', CASE WHEN jsonb_typeof(v_line->'unit') = 'string' THEN v_line->>'unit' END
            );
            v_components := v_components || jsonb_build_array(v_component);
          END IF;
          v_line_index := v_line_index + 1;
        END LOOP;
      END IF;
      v_recipe_index := v_recipe_index + 1;
    END LOOP;
  END IF;

  IF v_plan IS NOT NULL AND jsonb_typeof(v_plan->'packagingPerCase') = 'array' THEN
    v_line_index := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_plan->'packagingPerCase') LOOP
      IF jsonb_typeof(v_line) = 'object' THEN
        v_component := jsonb_build_object(
          'componentKey', 'packaging:' || v_line_index,
          'componentType', 'packaging',
          'recipeCode', NULL, 'recipeName', NULL, 'stationKey', NULL,
          'productId', CASE WHEN jsonb_typeof(v_line->'productId') = 'string' THEN v_line->>'productId' END,
          'productCode', CASE WHEN jsonb_typeof(v_line->'productCode') = 'string' THEN v_line->>'productCode' END,
          'productName', CASE WHEN jsonb_typeof(v_line->'productName') = 'string' THEN v_line->>'productName' ELSE 'Unnamed packaging' END,
          'quantity', CASE WHEN jsonb_typeof(v_line->'quantity') IN ('string','number') THEN v_line->>'quantity' END,
          'unit', CASE WHEN jsonb_typeof(v_line->'unit') = 'string' THEN v_line->>'unit' END
        );
        v_components := v_components || jsonb_build_array(v_component);
      END IF;
      v_line_index := v_line_index + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'components', v_components,
    'componentSnapshot', jsonb_build_object(
      'productionDate', v_run.production_date,
      'source', v_source,
      'overlayRevision', v_overlay_revision,
      'planCode', CASE WHEN jsonb_typeof(v_plan->'code') = 'string' THEN v_plan->>'code' END,
      'planName', CASE WHEN jsonb_typeof(v_plan->'name') = 'string' THEN v_plan->>'name' END
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION v3.qc_allergen_mappings(p_facility_id uuid, p_components jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_component jsonb;
  v_record v3.setup_ingredient_records%ROWTYPE;
  v_allergens jsonb;
  v_status text;
  v_mappings jsonb := '[]'::jsonb;
  v_fixed text[] := ARRAY[
    'milk','eggs','fish','crustacean shellfish','tree nuts','peanuts','wheat','soybeans','sesame'
  ];
BEGIN
  IF jsonb_typeof(p_components) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'QC components must be an array' USING ERRCODE = '22023';
  END IF;
  FOR v_component IN SELECT value FROM jsonb_array_elements(p_components) LOOP
    v_allergens := '[]'::jsonb;
    v_status := 'unavailable';
    v_record := NULL;
    IF v_component->>'componentType' = 'ingredient' AND jsonb_typeof(v_component->'productCode') = 'string' THEN
      SELECT * INTO v_record FROM v3.setup_ingredient_records
        WHERE facility_id = p_facility_id AND lower(code) = lower(v_component->>'productCode');
      IF FOUND THEN
        IF jsonb_typeof(v_record.data->'allergensReviewed') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(v_record.data->'allergens') IS DISTINCT FROM 'array' THEN
          v_status := 'invalid-mapping';
        ELSIF (v_record.data->>'allergensReviewed')::boolean = false THEN
          v_status := 'unreviewed';
        ELSIF EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_record.data->'allergens') AS item(value)
          WHERE jsonb_typeof(item.value) <> 'string' OR NOT (item.value #>> '{}' = ANY(v_fixed))
        ) OR (SELECT count(*) FROM jsonb_array_elements_text(v_record.data->'allergens'))
           <> (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_record.data->'allergens')) THEN
          v_status := 'invalid-mapping';
        ELSE
          v_allergens := v_record.data->'allergens';
          v_status := CASE WHEN jsonb_array_length(v_allergens) = 0 THEN 'reviewed-empty' ELSE 'reviewed' END;
        END IF;
      END IF;
    END IF;
    v_mappings := v_mappings || jsonb_build_array(jsonb_build_object(
      'componentKey', v_component->>'componentKey',
      'productCode', v_component->>'productCode',
      'status', v_status,
      'allergens', v_allergens
    ));
  END LOOP;
  RETURN v_mappings;
END
$$;

CREATE OR REPLACE FUNCTION v3.get_qc_run_dashboard(p_actor_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_run jsonb;
  v_projection jsonb;
  v_signoff v3.qc_run_signoffs%ROWTYPE;
  v_new_evidence boolean := false;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  v_facility := v3.account_facility_id();
  v_run := v3.get_run(v_facility, p_run_id);
  IF v_run IS NULL THEN RAISE EXCEPTION 'QC run not found' USING ERRCODE = 'P0002'; END IF;
  v_projection := v3.qc_run_component_snapshot(v_facility, p_run_id);
  SELECT * INTO v_signoff FROM v3.qc_run_signoffs
    WHERE facility_id = v_facility AND run_id = p_run_id
    ORDER BY sequence DESC LIMIT 1;
  IF FOUND THEN
    SELECT EXISTS (
      SELECT 1 FROM v3.qc_records r
      WHERE r.facility_id = v_facility AND r.run_id = p_run_id
        AND r.sequence > v_signoff.high_water_mark AND r.kind <> 'sign-off'
    ) INTO v_new_evidence;
  END IF;
  RETURN jsonb_build_object(
    'run', v_run,
    'highWaterMark', COALESCE((
      SELECT max(sequence) FROM v3.qc_records
      WHERE facility_id = v_facility AND run_id = p_run_id
    ), 0)::text,
    'records', COALESCE((
      SELECT jsonb_agg(v3.qc_record_json(r) ORDER BY r.sequence)
      FROM v3.qc_records r
      WHERE r.facility_id = v_facility AND r.run_id = p_run_id
    ), '[]'::jsonb),
    'components', v_projection->'components',
    'componentSnapshot', v_projection->'componentSnapshot',
    'allergenMappings', v3.qc_allergen_mappings(v_facility, v_projection->'components'),
    'signOff', CASE WHEN v_signoff.record_id IS NULL THEN NULL ELSE jsonb_build_object(
      'recordId', v_signoff.record_id,
      'actorId', v_signoff.actor_id,
      'highWaterMark', v_signoff.high_water_mark::text,
      'signedAt', to_char(v_signoff.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) END,
    'newEvidenceSinceSignOff', v_new_evidence
  );
END
$$;

CREATE OR REPLACE FUNCTION v3.write_qc_run_verification_record(
  p_actor_id uuid, p_request_id text, p_request_hash text,
  p_run_id uuid, p_kind text, p_details jsonb, p_related_record_id uuid,
  p_capability text, p_signoff_high_water_mark bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_replay jsonb;
  v_record v3.qc_records%ROWTYPE;
  v_response jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, p_capability);
  v_facility := v3.account_facility_id();
  IF p_kind NOT IN ('component-check','allergen-review','cleaning','cleaning-verification','sign-off')
     OR jsonb_typeof(p_details) IS DISTINCT FROM 'object'
     OR (p_kind = 'cleaning-verification') <> (p_related_record_id IS NOT NULL)
     OR (p_kind = 'sign-off') <> (p_signoff_high_water_mark IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid QC run verification request' USING ERRCODE = '22023';
  END IF;
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM v3.lock_qc_run(v_facility, p_run_id);

  INSERT INTO v3.qc_records(facility_id, run_id, kind, actor_id, related_record_id, details)
    VALUES (v_facility, p_run_id, p_kind, p_actor_id, p_related_record_id, p_details)
    RETURNING * INTO v_record;
  IF p_kind = 'sign-off' THEN
    INSERT INTO v3.qc_run_signoffs(
      facility_id, run_id, record_id, actor_id, request_id, high_water_mark, created_at
    ) VALUES (
      v_facility, p_run_id, v_record.record_id, p_actor_id, p_request_id,
      p_signoff_high_water_mark, v_record.recorded_at
    );
  END IF;
  INSERT INTO v3.qc_audit_events(facility_id, actor_id, action, record_id, request_id, changed_fields)
    VALUES (v_facility, p_actor_id, 'record-created', v_record.record_id, p_request_id,
      '["details"]'::jsonb);
  INSERT INTO v3.qc_outbox_events(facility_id, record_id, qc_sequence, event_type, payload)
    VALUES (v_facility, v_record.record_id, v_record.sequence, 'qc.recorded', jsonb_build_object(
      'recordId', v_record.record_id, 'runId', v_record.run_id, 'kind', v_record.kind));
  v_response := jsonb_build_object('outcome', 'accepted', 'replayed', false,
    'record', v3.qc_record_json(v_record))
    || v3.get_qc_run_dashboard(p_actor_id, p_run_id);
  INSERT INTO v3.qc_command_receipts(facility_id, actor_id, request_id, request_hash, response)
    VALUES (v_facility, p_actor_id, p_request_id, p_request_hash, v_response);
  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION v3.record_qc_lot(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_replay jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM v3.lock_qc_run(v3.account_facility_id(), p_run_id);
  RETURN v3.write_qc_record(p_actor_id, p_request_id, p_request_hash, p_run_id, 'lot', p_details);
END
$$;

CREATE OR REPLACE FUNCTION v3.record_qc_weight_check(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_replay jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM v3.lock_qc_run(v3.account_facility_id(), p_run_id);
  RETURN v3.write_qc_record(p_actor_id, p_request_id, p_request_hash, p_run_id, 'weight-check', p_details);
END
$$;

CREATE OR REPLACE FUNCTION v3.record_qc_brix_check(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_replay jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM v3.lock_qc_run(v3.account_facility_id(), p_run_id);
  RETURN v3.write_qc_record(p_actor_id, p_request_id, p_request_hash, p_run_id, 'brix-check', p_details);
END
$$;

CREATE OR REPLACE FUNCTION v3.record_qc_component_check(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_replay jsonb;
  v_projection jsonb;
  v_component jsonb;
  v_details jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR p_details - ARRAY['componentKey','presence','notes'] <> '{}'::jsonb
     OR NOT (p_details ?& ARRAY['componentKey','presence','notes'])
     OR jsonb_typeof(p_details->'componentKey') IS DISTINCT FROM 'string'
     OR p_details->>'componentKey' !~ '^(recipe:(0|[1-9][0-9]{0,5}):ingredient:(0|[1-9][0-9]{0,5})|packaging:(0|[1-9][0-9]{0,5}))$'
     OR p_details->>'presence' NOT IN ('present','absent','unknown')
     OR jsonb_typeof(p_details->'notes') IS DISTINCT FROM 'string'
     OR length(p_details->>'notes') > 1000 OR p_details->>'notes' ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid QC component check' USING ERRCODE = '22023';
  END IF;
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_facility := v3.account_facility_id();
  PERFORM v3.lock_qc_run(v_facility, p_run_id);
  v_projection := v3.qc_run_component_snapshot(v_facility, p_run_id);
  SELECT value INTO v_component FROM jsonb_array_elements(v_projection->'components')
    WHERE value->>'componentKey' = p_details->>'componentKey';
  IF v_component IS NULL THEN
    RAISE EXCEPTION 'Effective QC component is unavailable' USING ERRCODE = '22023';
  END IF;
  v_details := jsonb_build_object(
    'componentKey', p_details->>'componentKey',
    'presence', p_details->>'presence',
    'notes', btrim(p_details->>'notes'),
    'component', v_component,
    'componentSnapshot', v_projection->'componentSnapshot'
  );
  RETURN v3.write_qc_run_verification_record(
    p_actor_id, p_request_id, p_request_hash, p_run_id,
    'component-check', v_details, NULL, 'record-qc', NULL
  );
END
$$;

CREATE OR REPLACE FUNCTION v3.record_qc_allergen_review(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_replay jsonb;
  v_projection jsonb;
  v_component jsonb;
  v_mapping jsonb;
  v_details jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR p_details - ARRAY['componentKey','stagingStatus','notes'] <> '{}'::jsonb
     OR NOT (p_details ?& ARRAY['componentKey','stagingStatus','notes'])
     OR jsonb_typeof(p_details->'componentKey') IS DISTINCT FROM 'string'
     OR p_details->>'componentKey' !~ '^(recipe:(0|[1-9][0-9]{0,5}):ingredient:(0|[1-9][0-9]{0,5})|packaging:(0|[1-9][0-9]{0,5}))$'
     OR p_details->>'stagingStatus' NOT IN ('staged','not-staged','unknown')
     OR jsonb_typeof(p_details->'notes') IS DISTINCT FROM 'string'
     OR length(p_details->>'notes') > 1000 OR p_details->>'notes' ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid QC allergen review' USING ERRCODE = '22023';
  END IF;
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_facility := v3.account_facility_id();
  PERFORM v3.lock_qc_run(v_facility, p_run_id);
  v_projection := v3.qc_run_component_snapshot(v_facility, p_run_id);
  SELECT value INTO v_component FROM jsonb_array_elements(v_projection->'components')
    WHERE value->>'componentKey' = p_details->>'componentKey';
  IF v_component IS NULL OR v_component->>'componentType' <> 'ingredient' THEN
    RAISE EXCEPTION 'Effective allergen component is unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT value INTO v_mapping FROM jsonb_array_elements(
    v3.qc_allergen_mappings(v_facility, v_projection->'components')
  ) WHERE value->>'componentKey' = p_details->>'componentKey';
  IF v_mapping IS NULL THEN
    RAISE EXCEPTION 'QC allergen mapping is unavailable' USING ERRCODE = '22023';
  END IF;
  v_details := jsonb_build_object(
    'componentKey', p_details->>'componentKey',
    'stagingStatus', p_details->>'stagingStatus',
    'notes', btrim(p_details->>'notes'),
    'component', v_component,
    'componentSnapshot', v_projection->'componentSnapshot',
    'allergenMapping', v_mapping
  );
  RETURN v3.write_qc_run_verification_record(
    p_actor_id, p_request_id, p_request_hash, p_run_id,
    'allergen-review', v_details, NULL, 'record-qc', NULL
  );
END
$$;

CREATE OR REPLACE FUNCTION v3.record_qc_cleaning(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_replay jsonb;
  v_details jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'record-qc');
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR p_details - ARRAY['area','status','notes'] <> '{}'::jsonb
     OR NOT (p_details ?& ARRAY['area','status','notes'])
     OR jsonb_typeof(p_details->'area') IS DISTINCT FROM 'string'
     OR length(btrim(p_details->>'area')) NOT BETWEEN 1 AND 120
     OR p_details->>'area' ~ '[[:cntrl:]]'
     OR p_details->>'status' NOT IN ('cleaned','not-cleaned','unknown')
     OR jsonb_typeof(p_details->'notes') IS DISTINCT FROM 'string'
     OR length(p_details->>'notes') > 1000 OR p_details->>'notes' ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid QC cleaning record' USING ERRCODE = '22023';
  END IF;
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM v3.lock_qc_run(v3.account_facility_id(), p_run_id);
  v_details := jsonb_build_object(
    'area', btrim(p_details->>'area'), 'status', p_details->>'status',
    'notes', btrim(p_details->>'notes')
  );
  RETURN v3.write_qc_run_verification_record(
    p_actor_id, p_request_id, p_request_hash, p_run_id,
    'cleaning', v_details, NULL, 'record-qc', NULL
  );
END
$$;

CREATE OR REPLACE FUNCTION v3.verify_qc_cleaning(p_actor_id uuid, p_request_id text, p_request_hash text, p_cleaning_record_id uuid, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_replay jsonb;
  v_cleaning v3.qc_records%ROWTYPE;
  v_details jsonb;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'manage-qc');
  IF p_cleaning_record_id IS NULL OR p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR p_details - ARRAY['status','notes'] <> '{}'::jsonb
     OR NOT (p_details ?& ARRAY['status','notes'])
     OR p_details->>'status' NOT IN ('verified','not-verified')
     OR jsonb_typeof(p_details->'notes') IS DISTINCT FROM 'string'
     OR length(p_details->>'notes') > 1000 OR p_details->>'notes' ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid QC cleaning verification' USING ERRCODE = '22023';
  END IF;
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_facility := v3.account_facility_id();
  SELECT * INTO v_cleaning FROM v3.qc_records
    WHERE facility_id = v_facility AND record_id = p_cleaning_record_id
      AND kind = 'cleaning' AND run_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'QC cleaning record not found' USING ERRCODE = 'P0002'; END IF;
  IF v_cleaning.actor_id = p_actor_id THEN
    RAISE EXCEPTION 'Cleaning requires independent verification' USING ERRCODE = '42501';
  END IF;
  PERFORM v3.lock_qc_run(v_facility, v_cleaning.run_id);
  v_details := jsonb_build_object(
    'status', p_details->>'status', 'notes', btrim(p_details->>'notes')
  );
  RETURN v3.write_qc_run_verification_record(
    p_actor_id, p_request_id, p_request_hash, v_cleaning.run_id,
    'cleaning-verification', v_details, p_cleaning_record_id, 'manage-qc', NULL
  );
END
$$;

CREATE OR REPLACE FUNCTION v3.sign_off_qc_run(p_actor_id uuid, p_request_id text, p_request_hash text, p_run_id uuid, p_expected_high_water_mark bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility uuid;
  v_replay jsonb;
  v_current bigint;
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'manage-qc');
  IF p_expected_high_water_mark IS NULL OR p_expected_high_water_mark < 0
     OR p_expected_high_water_mark > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid QC high-water mark' USING ERRCODE = '22023';
  END IF;
  v_replay := v3.qc_replay(p_actor_id, p_request_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_facility := v3.account_facility_id();
  PERFORM v3.lock_qc_run(v_facility, p_run_id);
  SELECT COALESCE(max(sequence), 0) INTO v_current FROM v3.qc_records
    WHERE facility_id = v_facility AND run_id = p_run_id;
  IF v_current <> p_expected_high_water_mark THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict', 'replayed', false,
      'expectedHighWaterMark', p_expected_high_water_mark::text
    ) || v3.get_qc_run_dashboard(p_actor_id, p_run_id);
  END IF;
  RETURN v3.write_qc_run_verification_record(
    p_actor_id, p_request_id, p_request_hash, p_run_id, 'sign-off',
    jsonb_build_object('highWaterMark', v_current::text),
    NULL, 'manage-qc', v_current
  );
END
$$;

COMMIT;
