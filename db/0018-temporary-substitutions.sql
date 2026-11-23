BEGIN;

ALTER TABLE v3.runs
  ADD COLUMN production_date date;

UPDATE v3.runs
SET production_date = (created_at AT TIME ZONE 'America/Chicago')::date
WHERE production_date IS NULL;

ALTER TABLE v3.runs
  ALTER COLUMN production_date SET DEFAULT COALESCE(
    NULLIF(current_setting('v3.create_production_date', true), '')::date,
    (clock_timestamp() AT TIME ZONE 'America/Chicago')::date
  ),
  ALTER COLUMN production_date SET NOT NULL;

CREATE TABLE v3.substitution_overlays (
  facility_id uuid NOT NULL,
  production_date date NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, production_date)
);

CREATE TABLE v3.substitution_rules (
  facility_id uuid NOT NULL,
  production_date date NOT NULL,
  id uuid NOT NULL,
  ingredient text NOT NULL CHECK (
    length(btrim(ingredient)) BETWEEN 1 AND 120
    AND ingredient = btrim(ingredient)
    AND ingredient !~ '[[:cntrl:]]'
  ),
  ingredient_key text NOT NULL CHECK (ingredient_key = lower(btrim(ingredient))),
  action text NOT NULL CHECK (action IN ('swap', 'add', 'remove')),
  substitute_product_id uuid,
  substitute_product_code text,
  substitute_product_name text,
  substitute_quantity numeric(20,6) CHECK (substitute_quantity > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, production_date, id),
  UNIQUE (facility_id, production_date, ingredient_key),
  FOREIGN KEY (facility_id, production_date)
    REFERENCES v3.substitution_overlays (facility_id, production_date) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, substitute_product_id)
    REFERENCES v3.products (facility_id, id) ON DELETE RESTRICT,
  CHECK (
    (action = 'remove' AND substitute_product_id IS NULL AND substitute_product_code IS NULL
      AND substitute_product_name IS NULL AND substitute_quantity IS NULL)
    OR
    (action IN ('swap', 'add') AND substitute_product_id IS NOT NULL
      AND substitute_product_code IS NOT NULL AND substitute_product_name IS NOT NULL)
  ),
  CHECK (action <> 'add' OR substitute_quantity IS NOT NULL),
  CHECK (updated_at >= created_at)
);

CREATE TABLE v3.substitution_rule_history (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  facility_id uuid NOT NULL,
  production_date date NOT NULL,
  overlay_revision bigint NOT NULL CHECK (overlay_revision BETWEEN 1 AND 9007199254740991),
  rule_id uuid,
  operation text NOT NULL CHECK (operation IN ('upsert', 'remove', 'clear')),
  rule_snapshot jsonb,
  actor_id uuid NOT NULL,
  command_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX substitution_rule_history_date
  ON v3.substitution_rule_history (facility_id, production_date, sequence);

CREATE TABLE v3.completed_run_substitutions (
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  production_date date NOT NULL,
  overlay_revision bigint NOT NULL CHECK (overlay_revision BETWEEN 0 AND 9007199254740991),
  overlay jsonb NOT NULL CHECK (jsonb_typeof(overlay) = 'object'),
  effective_production_plan jsonb NOT NULL CHECK (jsonb_typeof(effective_production_plan) = 'object'),
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (facility_id, run_id),
  FOREIGN KEY (facility_id, run_id) REFERENCES v3.runs (facility_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION v3.guard_run_production_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.production_date IS DISTINCT FROM OLD.production_date THEN
    RAISE EXCEPTION 'Run production date is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER run_production_date_immutable
  BEFORE UPDATE OF production_date ON v3.runs
  FOR EACH ROW EXECUTE FUNCTION v3.guard_run_production_date();

CREATE TRIGGER substitution_rule_history_append_only
  BEFORE UPDATE OR DELETE ON v3.substitution_rule_history
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE TRIGGER completed_run_substitutions_append_only
  BEFORE UPDATE OR DELETE ON v3.completed_run_substitutions
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE FUNCTION v3.substitution_rule_json(p_rule v3.substitution_rules)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', p_rule.id,
    'ingredient', p_rule.ingredient,
    'action', p_rule.action,
    'substituteProductId', p_rule.substitute_product_id,
    'substituteProductCode', p_rule.substitute_product_code,
    'substituteProductName', p_rule.substitute_product_name,
    'quantity', CASE WHEN p_rule.substitute_quantity IS NULL THEN NULL
      ELSE v3.inventory_quantity_text(p_rule.substitute_quantity) END
  ))
$$;

CREATE FUNCTION v3.get_substitution_overlay(p_facility_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_overlay v3.substitution_overlays%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_date IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid substitution scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_overlay FROM v3.substitution_overlays
    WHERE facility_id = p_facility_id AND production_date = p_date;
  RETURN jsonb_build_object(
    'productionDate', p_date,
    'revision', COALESCE(v_overlay.revision, 0),
    'rules', COALESCE((
      SELECT jsonb_agg(v3.substitution_rule_json(r) ORDER BY lower(r.ingredient), r.id)
      FROM v3.substitution_rules AS r
      WHERE r.facility_id = p_facility_id AND r.production_date = p_date
    ), '[]'::jsonb),
    'updatedAt', CASE WHEN v_overlay.facility_id IS NULL THEN NULL ELSE
      to_char(v_overlay.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
  );
END
$$;

CREATE FUNCTION v3.effective_ingredient_lines(p_facility_id uuid, p_date date, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_line jsonb;
  v_rule v3.substitution_rules%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
  v_substitute jsonb;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Ingredient rows must be an array' USING ERRCODE = '22023';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_line->'productName') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Ingredient row is invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_rule FROM v3.substitution_rules AS r
      WHERE r.facility_id = p_facility_id AND r.production_date = p_date
        AND r.ingredient_key = lower(btrim(v_line->>'productName'));
    IF NOT FOUND THEN
      v_result := v_result || jsonb_build_array(v_line);
      CONTINUE;
    END IF;
    IF v_rule.action = 'remove' THEN
      CONTINUE;
    END IF;
    v_substitute := v_line || jsonb_build_object(
      'productId', v_rule.substitute_product_id,
      'productCode', v_rule.substitute_product_code,
      'productName', v_rule.substitute_product_name,
      'quantity', COALESCE(v3.inventory_quantity_text(v_rule.substitute_quantity), v_line->>'quantity')
    );
    IF v_rule.action = 'add' THEN
      v_result := v_result || jsonb_build_array(v_line) || jsonb_build_array(v_substitute);
    ELSE
      v_result := v_result || jsonb_build_array(v_substitute);
    END IF;
  END LOOP;
  RETURN v_result;
END
$$;

CREATE FUNCTION v3.effective_production_plan(p_facility_id uuid, p_date date, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_recipe jsonb;
  v_recipes jsonb := '[]'::jsonb;
BEGIN
  IF p_plan IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_plan->'recipes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Production plan is invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_recipe IN SELECT value FROM jsonb_array_elements(p_plan->'recipes') LOOP
    IF jsonb_typeof(v_recipe) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_recipe->'ingredients') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Production recipe is invalid' USING ERRCODE = '22023';
    END IF;
    v_recipes := v_recipes || jsonb_build_array(jsonb_set(
      v_recipe, '{ingredients}',
      v3.effective_ingredient_lines(p_facility_id, p_date, v_recipe->'ingredients'), false
    ));
  END LOOP;
  RETURN jsonb_set(p_plan, '{recipes}', v_recipes, false);
END
$$;

CREATE FUNCTION v3.create_planned_run(
  p_facility_id uuid,
  p_actor_id uuid,
  p_request_id text,
  p_request_hash text,
  p_production_date date,
  p_setup_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_response jsonb;
BEGIN
  IF p_production_date IS NULL THEN
    RAISE EXCEPTION 'Production date is required' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('v3.create_production_date', p_production_date::text, true);
  v_response := v3.create_planned_run(
    p_facility_id, p_actor_id, p_request_id, p_request_hash, p_setup_snapshot
  );
  PERFORM set_config('v3.create_production_date', '', true);
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('v3.create_production_date', '', true);
  RAISE;
END
$$;

CREATE FUNCTION v3.list_substitution_products(p_facility_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', p.id, 'productCode', p.code, 'productName', p.name, 'baseUnit', p.base_unit
  ) ORDER BY lower(p.name), p.code), '[]'::jsonb)
  FROM v3.products AS p
  WHERE p.facility_id = p_facility_id AND p.active
    AND EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id)
$$;

CREATE FUNCTION v3.apply_substitution_command(
  p_facility_id uuid,
  p_actor_id uuid,
  p_date date,
  p_command_id text,
  p_request_hash text,
  p_expected_revision bigint,
  p_command jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_existing_response jsonb;
  v_overlay v3.substitution_overlays%ROWTYPE;
  v_rule v3.substitution_rules%ROWTYPE;
  v_input jsonb;
  v_rule_id uuid;
  v_ingredient text;
  v_ingredient_key text;
  v_action text;
  v_product v3.products%ROWTYPE;
  v_quantity numeric;
  v_now timestamptz;
  v_revision bigint;
  v_response jsonb;
  v_type text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_date IS NULL
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_revision > 9007199254740991
     OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid substitution command' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_existing_response
    FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was reused with a different request' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing_response || jsonb_build_object('replayed', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_date::text || ':substitutions', 0));
  SELECT * INTO v_overlay FROM v3.substitution_overlays
    WHERE facility_id = p_facility_id AND production_date = p_date FOR UPDATE;
  IF COALESCE(v_overlay.revision, 0) <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict', 'replayed', false,
      'expectedRevision', p_expected_revision,
      'currentOverlay', v3.get_substitution_overlay(p_facility_id, p_date)
    );
  END IF;
  IF p_expected_revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Substitution revision is exhausted' USING ERRCODE = '22003';
  END IF;

  v_type := p_command->>'type';
  v_now := clock_timestamp();
  v_revision := p_expected_revision + 1;

  IF v_type = 'upsert' THEN
    IF (p_command - ARRAY['type','rule']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','rule'])
       OR jsonb_typeof(p_command->'rule') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid substitution upsert' USING ERRCODE = '22023';
    END IF;
    v_input := p_command->'rule';
    IF (v_input - ARRAY['id','ingredient','action','substituteProductId','quantity']) <> '{}'::jsonb
       OR NOT (v_input ?& ARRAY['id','ingredient','action','substituteProductId','quantity'])
       OR jsonb_typeof(v_input->'ingredient') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_input->'action') IS DISTINCT FROM 'string'
       OR length(btrim(v_input->>'ingredient')) NOT BETWEEN 1 AND 120
       OR v_input->>'ingredient' ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Invalid substitution rule' USING ERRCODE = '22023';
    END IF;
    v_ingredient := btrim(v_input->>'ingredient');
    v_ingredient_key := lower(v_ingredient);
    v_action := v_input->>'action';
    IF v_action NOT IN ('swap','add','remove') THEN
      RAISE EXCEPTION 'Unsupported substitution action' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_input->'id') = 'string' THEN v_rule_id := (v_input->>'id')::uuid; END IF;
    IF jsonb_typeof(v_input->'quantity') = 'string' THEN v_quantity := (v_input->>'quantity')::numeric; END IF;
    IF v_quantity IS NOT NULL AND (v_quantity <= 0 OR v_quantity > 999999999999.999999) THEN
      RAISE EXCEPTION 'Substitution quantity is invalid' USING ERRCODE = '22023';
    END IF;
    IF v_action = 'remove' AND (
      v_input->'substituteProductId' <> 'null'::jsonb OR v_input->'quantity' <> 'null'::jsonb
    ) THEN
      RAISE EXCEPTION 'Remove rules cannot include a substitute' USING ERRCODE = '22023';
    END IF;
    IF v_action = 'add' AND v_quantity IS NULL THEN
      RAISE EXCEPTION 'Add rules require a quantity' USING ERRCODE = '22023';
    END IF;

    IF v_action IN ('swap','add') THEN
      IF jsonb_typeof(v_input->'substituteProductId') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Choose a substitute product' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_product FROM v3.products
        WHERE facility_id = p_facility_id AND id = (v_input->>'substituteProductId')::uuid AND active;
      IF NOT FOUND THEN RAISE EXCEPTION 'Substitute product is unavailable' USING ERRCODE = 'P0002'; END IF;
    ELSIF v_input->'substituteProductId' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'Remove rules cannot include a substitute' USING ERRCODE = '22023';
    END IF;

    IF v_rule_id IS NOT NULL THEN
      SELECT * INTO v_rule FROM v3.substitution_rules
        WHERE facility_id = p_facility_id AND production_date = p_date AND id = v_rule_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Substitution rule no longer exists' USING ERRCODE = 'P0002'; END IF;
    ELSE
      SELECT * INTO v_rule FROM v3.substitution_rules
        WHERE facility_id = p_facility_id AND production_date = p_date AND ingredient_key = v_ingredient_key FOR UPDATE;
      IF FOUND THEN v_rule_id := v_rule.id; ELSE v_rule_id := gen_random_uuid(); END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM v3.substitution_rules
      WHERE facility_id = p_facility_id AND production_date = p_date
        AND ingredient_key = v_ingredient_key AND id <> v_rule_id
    ) THEN
      RAISE EXCEPTION 'An active rule already exists for this ingredient' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM v3.substitution_rules
      WHERE facility_id = p_facility_id AND production_date = p_date AND id = v_rule_id
    ) AND (SELECT count(*) FROM v3.substitution_rules
      WHERE facility_id = p_facility_id AND production_date = p_date) >= 100 THEN
      RAISE EXCEPTION 'A production date cannot contain more than 100 substitution rules' USING ERRCODE = '22023';
    END IF;

    INSERT INTO v3.substitution_overlays (facility_id,production_date,revision,updated_by,updated_at)
      VALUES (p_facility_id,p_date,v_revision,p_actor_id,v_now)
      ON CONFLICT (facility_id,production_date) DO UPDATE
      SET revision = EXCLUDED.revision,updated_by = EXCLUDED.updated_by,updated_at = EXCLUDED.updated_at;
    INSERT INTO v3.substitution_rules (
      facility_id,production_date,id,ingredient,ingredient_key,action,
      substitute_product_id,substitute_product_code,substitute_product_name,substitute_quantity,
      created_by,updated_by,created_at,updated_at
    ) VALUES (
      p_facility_id,p_date,v_rule_id,v_ingredient,v_ingredient_key,v_action,
      v_product.id,v_product.code,v_product.name,v_quantity,
      p_actor_id,p_actor_id,v_now,v_now
    )
    ON CONFLICT (facility_id,production_date,id) DO UPDATE SET
      ingredient = EXCLUDED.ingredient,ingredient_key = EXCLUDED.ingredient_key,action = EXCLUDED.action,
      substitute_product_id = EXCLUDED.substitute_product_id,
      substitute_product_code = EXCLUDED.substitute_product_code,
      substitute_product_name = EXCLUDED.substitute_product_name,
      substitute_quantity = EXCLUDED.substitute_quantity,
      updated_by = EXCLUDED.updated_by,updated_at = EXCLUDED.updated_at;
    SELECT * INTO v_rule FROM v3.substitution_rules
      WHERE facility_id = p_facility_id AND production_date = p_date AND id = v_rule_id;
    INSERT INTO v3.substitution_rule_history (
      facility_id,production_date,overlay_revision,rule_id,operation,rule_snapshot,actor_id,command_id,occurred_at
    ) VALUES (
      p_facility_id,p_date,v_revision,v_rule_id,'upsert',v3.substitution_rule_json(v_rule),p_actor_id,p_command_id,v_now
    );

  ELSIF v_type = 'remove' THEN
    IF (p_command - ARRAY['type','ruleId']) <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','ruleId'])
       OR jsonb_typeof(p_command->'ruleId') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid substitution removal' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_rule FROM v3.substitution_rules
      WHERE facility_id = p_facility_id AND production_date = p_date
        AND id = (p_command->>'ruleId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Substitution rule no longer exists' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO v3.substitution_overlays (facility_id,production_date,revision,updated_by,updated_at)
      VALUES (p_facility_id,p_date,v_revision,p_actor_id,v_now)
      ON CONFLICT (facility_id,production_date) DO UPDATE
      SET revision = EXCLUDED.revision,updated_by = EXCLUDED.updated_by,updated_at = EXCLUDED.updated_at;
    INSERT INTO v3.substitution_rule_history (
      facility_id,production_date,overlay_revision,rule_id,operation,rule_snapshot,actor_id,command_id,occurred_at
    ) VALUES (
      p_facility_id,p_date,v_revision,v_rule.id,'remove',v3.substitution_rule_json(v_rule),p_actor_id,p_command_id,v_now
    );
    DELETE FROM v3.substitution_rules
      WHERE facility_id = p_facility_id AND production_date = p_date AND id = v_rule.id;

  ELSIF v_type = 'clear' THEN
    IF p_command <> jsonb_build_object('type','clear') THEN
      RAISE EXCEPTION 'Invalid substitution clear' USING ERRCODE = '22023';
    END IF;
    INSERT INTO v3.substitution_overlays (facility_id,production_date,revision,updated_by,updated_at)
      VALUES (p_facility_id,p_date,v_revision,p_actor_id,v_now)
      ON CONFLICT (facility_id,production_date) DO UPDATE
      SET revision = EXCLUDED.revision,updated_by = EXCLUDED.updated_by,updated_at = EXCLUDED.updated_at;
    INSERT INTO v3.substitution_rule_history (
      facility_id,production_date,overlay_revision,rule_id,operation,rule_snapshot,actor_id,command_id,occurred_at
    )
    SELECT p_facility_id,p_date,v_revision,r.id,'clear',v3.substitution_rule_json(r),p_actor_id,p_command_id,v_now
      FROM v3.substitution_rules AS r
      WHERE r.facility_id = p_facility_id AND r.production_date = p_date;
    DELETE FROM v3.substitution_rules
      WHERE facility_id = p_facility_id AND production_date = p_date;
  ELSE
    RAISE EXCEPTION 'Unsupported substitution command' USING ERRCODE = '22023';
  END IF;

  v_response := jsonb_build_object(
    'outcome','accepted','replayed',false,'commandId',p_command_id,
    'overlay',v3.get_substitution_overlay(p_facility_id,p_date)
  );
  INSERT INTO v3.facility_operation_events (
    facility_id,revision,actor_id,event_type,payload,occurred_at
  ) VALUES (
    p_facility_id,v_revision,p_actor_id,'planning.substitution.' || v_type,v_response,v_now
  );
  INSERT INTO v3.command_receipts (
    facility_id,actor_id,command_id,request_hash,response,created_at
  ) VALUES (p_facility_id,p_actor_id,p_command_id,p_request_hash,v_response,v_now);
  RETURN v_response;
END
$$;

ALTER FUNCTION v3.run_snapshot_without_rules(uuid, uuid)
  RENAME TO run_snapshot_without_substitutions;

CREATE FUNCTION v3.run_snapshot_without_rules(p_facility_id uuid, p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_base jsonb;
  v_run v3.runs%ROWTYPE;
  v_completed v3.completed_run_substitutions%ROWTYPE;
  v_overlay jsonb;
  v_effective jsonb;
BEGIN
  v_base := v3.run_snapshot_without_substitutions(p_facility_id, p_run_id);
  IF v_base IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_run FROM v3.runs WHERE facility_id = p_facility_id AND id = p_run_id;
  IF v_run.status = 'completed' THEN
    SELECT * INTO v_completed FROM v3.completed_run_substitutions
      WHERE facility_id = p_facility_id AND run_id = p_run_id;
    IF FOUND THEN
      v_overlay := v_completed.overlay;
      v_effective := v_completed.effective_production_plan;
    ELSE
      v_overlay := NULL;
      v_effective := v_run.setup_snapshot->'productionPlan';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN
    v_overlay := v3.get_substitution_overlay(p_facility_id, v_run.production_date);
    v_effective := v3.effective_production_plan(
      p_facility_id, v_run.production_date, v_run.setup_snapshot->'productionPlan'
    );
  ELSE
    v_overlay := NULL;
    v_effective := v_run.setup_snapshot->'productionPlan';
  END IF;
  RETURN v_base || jsonb_build_object(
    'productionDate', v_run.production_date,
    'substitutionOverlay', v_overlay,
    'effectiveProductionPlan', v_effective
  );
END
$$;

ALTER FUNCTION v3.get_production_schedule(uuid, date)
  RENAME TO get_production_schedule_without_substitutions;

CREATE FUNCTION v3.get_production_schedule(p_facility_id uuid, p_date date)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT v3.get_production_schedule_without_substitutions(p_facility_id, p_date)
    || jsonb_build_object('substitutionOverlay', v3.get_substitution_overlay(p_facility_id, p_date))
$$;

CREATE OR REPLACE FUNCTION v3.consume_run_inventory_before_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_id uuid;
  v_overlay jsonb;
  v_effective jsonb;
BEGIN
  IF OLD.status <> 'completed' AND NEW.status = 'completed'
     AND NEW.setup_snapshot ? 'productionPlan' THEN
    BEGIN
      v_actor_id := current_setting('v3.run_completion_actor_id', true)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_actor_id := NULL;
    END;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'Use the authorized run completion command' USING ERRCODE = '42501';
    END IF;
    v_overlay := v3.get_substitution_overlay(NEW.facility_id, NEW.production_date);
    v_effective := v3.effective_production_plan(
      NEW.facility_id, NEW.production_date, NEW.setup_snapshot->'productionPlan'
    );
    INSERT INTO v3.completed_run_substitutions (
      facility_id,run_id,production_date,overlay_revision,overlay,effective_production_plan,applied_at
    ) VALUES (
      NEW.facility_id,NEW.id,NEW.production_date,(v_overlay->>'revision')::bigint,
      v_overlay,v_effective,clock_timestamp()
    );
    PERFORM v3.apply_run_inventory_consumption(NEW.facility_id, NEW.id, v_actor_id, v_effective);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION v3.scheduled_run_demand(
  p_facility_id uuid, p_production_date date, p_run jsonb, p_run_index integer
) RETURNS TABLE(
  schedule_run_id uuid, production_date date, run_label text,
  warehouse_id uuid, warehouse_name text, area text,
  product_id uuid, product_code text, product_name text, unit text,
  quantity numeric, resolved boolean, warning text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,v3
AS $$
DECLARE
  v_target numeric;
  v_carried numeric;
  v_setup v3.master_records%ROWTYPE;
  v_template v3.setup_run_template_records%ROWTYPE;
  v_warehouse v3.inventory_warehouses%ROWTYPE;
  v_recipe v3.master_records%ROWTYPE;
  v_requested record;
  v_line record;
  v_product v3.products%ROWTYPE;
  v_quantity numeric;
  v_station text;
  v_effective jsonb;
BEGIN
  v_target := CASE WHEN p_run->>'targetCases' ~ '^[0-9]+$' THEN (p_run->>'targetCases')::numeric ELSE NULL END;
  schedule_run_id := CASE WHEN p_run->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (p_run->>'id')::uuid ELSE NULL END;
  production_date := p_production_date;
  run_label := 'Run ' || p_run_index || ' — ' || COALESCE(NULLIF(p_run->>'productionSetupCode',''),'Unresolved setup');
  IF v_target IS NULL OR schedule_run_id IS NULL THEN
    warning := 'The scheduled run has an invalid identity or target; its demand is excluded.';
    resolved := false;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT COALESCE(sum(a.cases),0) INTO v_carried FROM v3.freezer_surplus_allocations a
    WHERE a.facility_id=p_facility_id AND a.production_date=p_production_date AND a.schedule_run_id=(p_run->>'id')::uuid;
  v_target := GREATEST(v_target-v_carried,0);
  IF v_target = 0 THEN RETURN; END IF;
  SELECT * INTO v_setup FROM v3.master_records s
    WHERE s.facility_id=p_facility_id AND s.kind='production-setups'
      AND lower(s.code)=lower(p_run->>'productionSetupCode') AND lower(s.product_code)=lower(p_run->>'productCode');
  IF NOT FOUND THEN
    warning := 'The scheduled production setup is unavailable; its ingredient and packaging demand is unresolved.';
    resolved := false;
    RETURN NEXT;
    RETURN;
  END IF;
  run_label := 'Run ' || p_run_index || ' — ' || v_setup.name;
  SELECT * INTO v_template FROM v3.setup_run_template_records t
    WHERE t.facility_id=p_facility_id AND lower(t.code)=lower(p_run->>'runTemplateCode');
  SELECT * INTO v_warehouse FROM v3.inventory_warehouses w
    WHERE w.facility_id=p_facility_id AND w.active AND w.is_production;
  IF FOUND THEN warehouse_id := v_warehouse.id; warehouse_name := v_warehouse.name; END IF;
  FOR v_requested IN SELECT requested.code,requested.ordinality FROM jsonb_array_elements_text(v_setup.data->'recipe_codes') WITH ORDINALITY requested(code,ordinality) LOOP
    SELECT * INTO v_recipe FROM v3.master_records r
      WHERE r.facility_id=p_facility_id AND r.kind='recipes' AND lower(r.code)=lower(v_requested.code)
        AND lower(r.product_code)=lower(v_setup.product_code);
    IF NOT FOUND THEN
      product_id := NULL; product_code := NULL; product_name := NULL; unit := NULL; quantity := NULL;
      warning := 'Recipe ' || v_requested.code || ' is unavailable; its demand is unresolved.';
      resolved := false;
      RETURN NEXT;
      CONTINUE;
    END IF;
    v_station := v_recipe.data->>'station_key';
    area := CASE WHEN v_station='dough' THEN 'Dough' WHEN v_station='sauce' THEN 'Sauce' ELSE 'Frontline' END;
    FOR v_line IN SELECT line.value,line.ordinality FROM jsonb_array_elements(v_recipe.data->'ingredients') WITH ORDINALITY line(value,ordinality) LOOP
      SELECT * INTO v_product FROM v3.products p WHERE p.facility_id=p_facility_id AND p.active
        AND lower(p.code)=lower(v_line.value->>'product_code');
      IF NOT FOUND THEN
        product_id := NULL; product_code := NULL; product_name := NULL; unit := NULL; quantity := NULL;
        warning := 'An ingredient product in ' || v_recipe.code || ' is unavailable; its demand is unresolved.';
        resolved := false;
        RETURN NEXT;
      END IF;
    END LOOP;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'productId',source.id,'productCode',source.code,'productName',source.name,
      'quantity',source.quantity,'unit',source.unit
    ) ORDER BY source.ordinality),'[]'::jsonb) INTO v_effective
    FROM (
      SELECT p.id,p.code,p.name,raw.value->>'quantity' quantity,raw.value->>'unit' unit,raw.ordinality
      FROM jsonb_array_elements(v_recipe.data->'ingredients') WITH ORDINALITY raw(value,ordinality)
      JOIN v3.products p ON p.facility_id=p_facility_id AND lower(p.code)=lower(raw.value->>'product_code') AND p.active
    ) source;
    v_effective := v3.effective_ingredient_lines(p_facility_id,p_production_date,v_effective);

    FOR v_line IN SELECT line.value,line.ordinality FROM jsonb_array_elements(v_effective) WITH ORDINALITY line(value,ordinality) LOOP
      product_id := (v_line.value->>'productId')::uuid;
      product_code := v_line.value->>'productCode';
      product_name := v_line.value->>'productName';
      unit := v_line.value->>'unit';
      v_quantity := v3.scheduled_station_quantity(v_station,v_target,COALESCE(v_template.data->'values','{}'::jsonb));
      quantity := CASE WHEN v_quantity IS NULL OR v_line.value->>'quantity' !~ '^[0-9]+(\.[0-9]+)?$' THEN NULL
        ELSE round(v_quantity*(v_line.value->>'quantity')::numeric,6) END;
      resolved := quantity IS NOT NULL;
      warning := CASE WHEN resolved THEN NULL ELSE 'Scheduled quantity is unresolved; check run-template station capacity and demand units.' END;
      RETURN NEXT;
    END LOOP;
  END LOOP;
  area := 'Packaging';
  FOR v_line IN SELECT line.value,line.ordinality FROM jsonb_array_elements(v_setup.data->'packaging_per_case') WITH ORDINALITY line(value,ordinality) LOOP
    product_id := NULL; product_code := NULL; product_name := NULL; unit := NULL; quantity := NULL;
    SELECT * INTO v_product FROM v3.products p WHERE p.facility_id=p_facility_id AND p.active
      AND lower(p.code)=lower(v_line.value->>'product_code');
    IF NOT FOUND THEN
      warning := 'A packaging product is unavailable; its demand is unresolved.';
      resolved := false;
      RETURN NEXT;
      CONTINUE;
    END IF;
    product_id := v_product.id; product_code := v_product.code; product_name := v_product.name;
    unit := v_line.value->>'unit';
    quantity := CASE WHEN v_line.value->>'quantity' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN round(v_target*(v_line.value->>'quantity')::numeric,6) ELSE NULL END;
    resolved := quantity IS NOT NULL;
    warning := CASE WHEN resolved THEN NULL ELSE 'Packaging demand has an invalid quantity or unit.' END;
    RETURN NEXT;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION v3.scheduled_freezer_pull_lines(
  p_facility_id uuid, p_production_date date, p_run jsonb, p_today date
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
  WITH configs AS (
    SELECT DISTINCT ON (lower(f.data->>'ingredientName')) f.code, f.data->>'ingredientName' AS ingredient_name, f.data->>'ingredientCode' AS ingredient_code, (f.data->>'daysEarly')::integer AS days_early
    FROM v3.setup_freezer_pull_records f
    WHERE f.facility_id = p_facility_id AND f.data->>'enabled' = 'true'
      AND p_production_date - p_today BETWEEN 0 AND (f.data->>'daysEarly')::integer
    ORDER BY lower(f.data->>'ingredientName'), f.code
  ), demand AS (
    SELECT c.code, c.ingredient_name, p.name AS product_name, p.code AS product_code,
      i.value->>'unit' AS unit,
      (i.value->>'quantity')::numeric * v3.scheduled_station_quantity(
        r.data->>'station_key', v3.scheduled_effective_target(p_facility_id,p_production_date,p_run), COALESCE(t.data->'values', '{}'::jsonb)
      ) AS quantity
    FROM v3.master_records s
    CROSS JOIN jsonb_array_elements_text(s.data->'recipe_codes') AS requested(code)
    JOIN v3.master_records r ON r.facility_id = s.facility_id AND r.kind = 'recipes'
      AND lower(r.code) = lower(requested.code) AND lower(r.product_code) = lower(s.product_code)
    CROSS JOIN LATERAL jsonb_array_elements(v3.effective_ingredient_lines(
      p_facility_id,p_production_date,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'productId',source.id,'productCode',source.code,'productName',source.name,
          'quantity',source.quantity,'unit',source.unit
        ) ORDER BY source.ordinality)
        FROM (
          SELECT p0.id,p0.code,p0.name,raw.value->>'quantity' quantity,raw.value->>'unit' unit,raw.ordinality
          FROM jsonb_array_elements(r.data->'ingredients') WITH ORDINALITY raw(value,ordinality)
          JOIN v3.products p0 ON p0.facility_id=s.facility_id AND lower(p0.code)=lower(raw.value->>'product_code') AND p0.active
        ) source
      ),'[]'::jsonb)
    )) i(value)
    JOIN v3.products p ON p.facility_id=s.facility_id AND p.id=(i.value->>'productId')::uuid
    LEFT JOIN v3.setup_run_template_records t ON t.facility_id = s.facility_id
      AND lower(t.code) = lower(p_run->>'runTemplateCode')
    JOIN configs c ON lower(c.ingredient_name) IN (lower(p.name), lower(p.code))
      OR lower(c.ingredient_code) = lower(p.code)
    WHERE s.facility_id = p_facility_id AND s.kind = 'production-setups'
      AND lower(s.code) = lower(p_run->>'productionSetupCode')
      AND lower(s.product_code) = lower(p_run->>'productCode')
    UNION ALL
    SELECT c.code, c.ingredient_name, p.name, p.code, line.value->>'unit',
      (line.value->>'quantity')::numeric * v3.scheduled_effective_target(p_facility_id,p_production_date,p_run)
    FROM v3.master_records s
    CROSS JOIN jsonb_array_elements(s.data->'packaging_per_case') AS line(value)
    JOIN v3.products p ON p.facility_id = s.facility_id AND lower(p.code) = lower(line.value->>'product_code') AND p.active
    JOIN configs c ON lower(c.ingredient_name) IN (lower(p.name), lower(p.code))
      OR lower(c.ingredient_code) = lower(p.code)
    WHERE s.facility_id = p_facility_id AND s.kind = 'production-setups'
      AND lower(s.code) = lower(p_run->>'productionSetupCode')
      AND lower(s.product_code) = lower(p_run->>'productCode')
  ), aggregated AS (
    SELECT code, ingredient_name, min(product_name) AS product_name, min(product_code) AS product_code,
      CASE WHEN count(DISTINCT unit) = 1 THEN min(unit) ELSE NULL END AS unit,
      CASE WHEN count(*) > 0 AND count(quantity) = count(*) AND count(DISTINCT unit) = 1
        THEN v3.inventory_quantity_text(sum(quantity)) ELSE NULL END AS quantity,
      count(quantity) = count(*) AND count(DISTINCT unit) = 1 AS resolved
    FROM demand GROUP BY code, ingredient_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', code, 'ingredientName', ingredient_name, 'productCode', product_code,
    'quantity', quantity, 'unit', unit, 'resolved', resolved,
    'warning', CASE WHEN resolved THEN NULL ELSE 'Scheduled quantity is unresolved; check the run template station capacity and demand units.' END
  ) ORDER BY lower(ingredient_name), code), '[]'::jsonb)
  FROM aggregated
$$;

REVOKE ALL ON FUNCTION v3.scheduled_freezer_pull_lines(uuid,date,jsonb,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.guard_run_production_date() FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.substitution_rule_json(v3.substitution_rules) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_substitution_overlay(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.effective_ingredient_lines(uuid,date,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.effective_production_plan(uuid,date,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.create_planned_run(uuid,uuid,text,text,date,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_substitution_products(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_substitution_command(uuid,uuid,date,text,text,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.run_snapshot_without_substitutions(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.run_snapshot_without_rules(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_production_schedule_without_substitutions(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_production_schedule(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.consume_run_inventory_before_completion() FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.scheduled_run_demand(uuid,date,jsonb,integer) FROM PUBLIC;

COMMENT ON TABLE v3.substitution_overlays IS
  'Server-owned facility and production-date substitution revisions; no rule carries forward automatically.';
COMMENT ON TABLE v3.substitution_rules IS
  'Structured temporary ingredient swap, add, and remove rules. Master recipes and run setup snapshots remain unchanged.';
COMMENT ON TABLE v3.substitution_rule_history IS
  'Append-only before/after rule snapshots for every accepted substitution mutation.';
COMMENT ON TABLE v3.completed_run_substitutions IS
  'Immutable effective plan and exact overlay retained before exactly-once completion consumption.';
COMMENT ON COLUMN v3.runs.production_date IS
  'Immutable facility production date. Existing rows backfill from creation time in America/Chicago.';

COMMIT;
