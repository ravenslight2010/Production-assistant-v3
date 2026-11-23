BEGIN;

CREATE TABLE v3.mix_recipes (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('product','prep')),
  product_id uuid,
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  batch_size_lbs numeric(20,6) NOT NULL CHECK (batch_size_lbs >= 0),
  days_early integer NOT NULL DEFAULT 0 CHECK (days_early BETWEEN 0 AND 365),
  enabled boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, product_id) REFERENCES v3.products (facility_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'product') = (product_id IS NOT NULL))
);
CREATE UNIQUE INDEX mix_recipes_product_name_folded ON v3.mix_recipes(facility_id, kind, product_id, lower(name));
CREATE UNIQUE INDEX mix_recipes_prep_name_folded ON v3.mix_recipes(facility_id, lower(name)) WHERE kind = 'prep';

CREATE TABLE v3.mix_recipe_components (
  facility_id uuid NOT NULL,
  mix_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  ingredient_product_id uuid NOT NULL,
  ingredient_name text NOT NULL CHECK (ingredient_name = btrim(ingredient_name) AND length(ingredient_name) BETWEEN 1 AND 120),
  ounces_per_pizza numeric(20,6) NOT NULL CHECK (ounces_per_pizza >= 0),
  reference_pounds_per_batch numeric(20,6) CHECK (reference_pounds_per_batch >= 0),
  PRIMARY KEY (facility_id, mix_id, position),
  FOREIGN KEY (facility_id, mix_id) REFERENCES v3.mix_recipes (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, ingredient_product_id) REFERENCES v3.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v3.mix_recipe_history (
  facility_id uuid NOT NULL,
  mix_id uuid NOT NULL,
  revision bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','disable')),
  recipe_snapshot jsonb NOT NULL CHECK (jsonb_typeof(recipe_snapshot) = 'object'),
  actor_id uuid NOT NULL,
  command_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, mix_id, revision),
  FOREIGN KEY (facility_id, mix_id) REFERENCES v3.mix_recipes (facility_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER mix_recipe_history_append_only BEFORE UPDATE OR DELETE ON v3.mix_recipe_history
FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE TABLE v3.mix_plan_days (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  production_date date NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, production_date)
);

CREATE TABLE v3.mix_plan_amounts (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  production_date date NOT NULL,
  mix_id uuid NOT NULL,
  product_id uuid,
  already_made_lbs numeric(20,6) NOT NULL DEFAULT 0 CHECK (already_made_lbs >= 0),
  actual_made_lbs numeric(20,6) NOT NULL DEFAULT 0 CHECK (actual_made_lbs >= 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE NULLS NOT DISTINCT (facility_id, production_date, mix_id, product_id),
  FOREIGN KEY (facility_id, mix_id) REFERENCES v3.mix_recipes (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, product_id) REFERENCES v3.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v3.mix_finalizations (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  production_date date NOT NULL,
  mix_id uuid NOT NULL,
  product_id uuid,
  recipe_snapshot jsonb NOT NULL CHECK (jsonb_typeof(recipe_snapshot) = 'object'),
  plan_snapshot jsonb NOT NULL CHECK (jsonb_typeof(plan_snapshot) = 'object'),
  actual_made_lbs numeric(20,6) NOT NULL CHECK (actual_made_lbs >= 0),
  fresh_lbs numeric(20,6) NOT NULL CHECK (fresh_lbs >= 0),
  surplus_lbs numeric(20,6) NOT NULL CHECK (surplus_lbs >= 0),
  contributing_run_ids jsonb NOT NULL CHECK (jsonb_typeof(contributing_run_ids) = 'array'),
  contributing_schedule_run_ids jsonb NOT NULL CHECK (jsonb_typeof(contributing_schedule_run_ids) = 'array'),
  first_run_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE NULLS NOT DISTINCT (facility_id, production_date, mix_id, product_id),
  FOREIGN KEY (facility_id, mix_id) REFERENCES v3.mix_recipes (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, first_run_id) REFERENCES v3.runs (facility_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER mix_finalizations_append_only BEFORE UPDATE OR DELETE ON v3.mix_finalizations
FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE TABLE v3.mix_surplus_state (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id)
);

CREATE TABLE v3.mix_surplus_lots (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mix_id uuid NOT NULL,
  product_id uuid,
  mix_name text NOT NULL,
  product_name text,
  production_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('automatic','manual')),
  amount_made_lbs numeric(20,6) NOT NULL CHECK (amount_made_lbs > 0),
  surplus_lbs numeric(20,6) NOT NULL CHECK (surplus_lbs > 0),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 120),
  source_finalization_run_id uuid,
  voided boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, mix_id) REFERENCES v3.mix_recipes (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, product_id) REFERENCES v3.products (facility_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX mix_surplus_manual_identity ON v3.mix_surplus_lots(facility_id, mix_id, product_id, production_date)
  WHERE source = 'manual' AND NOT voided;
CREATE UNIQUE INDEX mix_surplus_finalization_identity ON v3.mix_surplus_lots(facility_id, production_date, mix_id, product_id)
  WHERE source = 'automatic';

CREATE TABLE v3.mix_surplus_allocations (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL,
  target_date date NOT NULL,
  quantity_lbs numeric(20,6) NOT NULL CHECK (quantity_lbs > 0),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, lot_id, target_date),
  FOREIGN KEY (facility_id, lot_id) REFERENCES v3.mix_surplus_lots (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v3.mix_surplus_history (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('record','allocate','void','finalize')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid NOT NULL,
  command_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, lot_id) REFERENCES v3.mix_surplus_lots (facility_id, id) ON DELETE RESTRICT
);
CREATE TRIGGER mix_surplus_history_append_only BEFORE UPDATE OR DELETE ON v3.mix_surplus_history
FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE FUNCTION v3.mix_recipe_json(p_recipe v3.mix_recipes)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
  SELECT jsonb_build_object(
    'id', p_recipe.id, 'kind', p_recipe.kind, 'productId', p_recipe.product_id,
    'productName', p.name, 'name', p_recipe.name, 'notes', p_recipe.notes,
    'batchSizeLbs', v3.inventory_quantity_text(p_recipe.batch_size_lbs),
    'daysEarly', p_recipe.days_early, 'enabled', p_recipe.enabled,
    'revision', p_recipe.revision,
    'updatedAt', to_char(p_recipe.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'components', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ingredientProductId', c.ingredient_product_id,
        'ingredientName', c.ingredient_name,
        'ouncesPerPizza', v3.inventory_quantity_text(c.ounces_per_pizza),
        'referencePoundsPerBatch', CASE WHEN c.reference_pounds_per_batch IS NULL THEN NULL
          ELSE v3.inventory_quantity_text(c.reference_pounds_per_batch) END
      ) ORDER BY c.position)
      FROM v3.mix_recipe_components c
      WHERE c.facility_id = p_recipe.facility_id AND c.mix_id = p_recipe.id
    ), '[]'::jsonb)
  )
  FROM v3.products p
  WHERE p.facility_id = p_recipe.facility_id AND p.id = p_recipe.product_id
  UNION ALL
  SELECT jsonb_build_object(
    'id', p_recipe.id, 'kind', p_recipe.kind, 'productId', NULL,
    'productName', NULL, 'name', p_recipe.name, 'notes', p_recipe.notes,
    'batchSizeLbs', v3.inventory_quantity_text(p_recipe.batch_size_lbs),
    'daysEarly', p_recipe.days_early, 'enabled', p_recipe.enabled,
    'revision', p_recipe.revision,
    'updatedAt', to_char(p_recipe.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'components', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ingredientProductId', c.ingredient_product_id,
        'ingredientName', c.ingredient_name,
        'ouncesPerPizza', v3.inventory_quantity_text(c.ounces_per_pizza),
        'referencePoundsPerBatch', CASE WHEN c.reference_pounds_per_batch IS NULL THEN NULL
          ELSE v3.inventory_quantity_text(c.reference_pounds_per_batch) END
      ) ORDER BY c.position)
      FROM v3.mix_recipe_components c
      WHERE c.facility_id = p_recipe.facility_id AND c.mix_id = p_recipe.id
    ), '[]'::jsonb)
  )
  WHERE p_recipe.kind = 'prep'
  LIMIT 1
$$;

CREATE FUNCTION v3.list_mix_recipes(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'recipes', COALESCE((SELECT jsonb_agg(v3.mix_recipe_json(r) ORDER BY lower(r.name), r.id)
      FROM v3.mix_recipes r WHERE r.facility_id = p_facility_id), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id, 'productCode', p.code, 'productName', p.name, 'baseUnit', p.base_unit
    ) ORDER BY lower(p.name), p.id) FROM v3.products p WHERE p.facility_id = p_facility_id AND p.active), '[]'::jsonb)
  );
END
$$;

CREATE FUNCTION v3.get_mix_surplus(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE v_revision bigint;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  SELECT revision INTO v_revision FROM v3.mix_surplus_state WHERE facility_id = p_facility_id;
  RETURN jsonb_build_object(
    'revision', COALESCE(v_revision, 0),
    'lots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'mixId', l.mix_id, 'productId', l.product_id,
        'mixName', l.mix_name, 'productName', l.product_name,
        'productionDate', l.production_date, 'source', l.source,
        'amountMadeLbs', v3.inventory_quantity_text(l.amount_made_lbs),
        'surplusLbs', v3.inventory_quantity_text(l.surplus_lbs),
        'allocatedLbs', v3.inventory_quantity_text(COALESCE(a.allocated, 0)),
        'remainingLbs', v3.inventory_quantity_text(l.surplus_lbs - COALESCE(a.allocated, 0)),
        'location', l.location, 'sourceFinalizationRunId', l.source_finalization_run_id,
        'voided', l.voided, 'createdAt', to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'allocations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'targetDate', x.target_date, 'quantityLbs', v3.inventory_quantity_text(x.quantity_lbs),
          'createdAt', to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) ORDER BY x.target_date) FROM v3.mix_surplus_allocations x
          WHERE x.facility_id = l.facility_id AND x.lot_id = l.id), '[]'::jsonb)
      ) ORDER BY l.production_date DESC, lower(l.mix_name), l.id)
      FROM v3.mix_surplus_lots l
      LEFT JOIN LATERAL (SELECT sum(x.quantity_lbs) allocated FROM v3.mix_surplus_allocations x
        WHERE x.facility_id = l.facility_id AND x.lot_id = l.id) a ON true
      WHERE l.facility_id = p_facility_id
    ), '[]'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION v3.mix_recipe_json(v3.mix_recipes) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_mix_recipes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_mix_surplus(uuid) FROM PUBLIC;

CREATE FUNCTION v3.apply_mix_recipe_command(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_expected_revision bigint, p_command jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_type text;
  v_input jsonb;
  v_recipe v3.mix_recipes%ROWTYPE;
  v_mix_id uuid;
  v_product_id uuid;
  v_kind text;
  v_name text;
  v_notes text;
  v_batch numeric;
  v_days integer;
  v_enabled boolean;
  v_component jsonb;
  v_position integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_request_id IS NULL
     OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
     OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid mix recipe request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT request_hash, response INTO v_existing_hash, v_response FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  v_type := p_command->>'type';
  IF v_type = 'disable' THEN
    IF p_command - ARRAY['type','mixId'] <> '{}'::jsonb OR p_command->>'mixId' IS NULL THEN
      RAISE EXCEPTION 'Invalid mix disable command' USING ERRCODE = '22023';
    END IF;
    v_mix_id := (p_command->>'mixId')::uuid;
    SELECT * INTO v_recipe FROM v3.mix_recipes WHERE facility_id = p_facility_id AND id = v_mix_id FOR UPDATE;
    IF NOT FOUND OR v_recipe.revision <> p_expected_revision THEN
      RETURN jsonb_build_object('outcome','conflict','replayed',false,'catalog',v3.list_mix_recipes(p_facility_id));
    END IF;
    UPDATE v3.mix_recipes SET enabled = false, revision = revision + 1, updated_by = p_actor_id, updated_at = v_now
      WHERE facility_id = p_facility_id AND id = v_mix_id RETURNING * INTO v_recipe;
    INSERT INTO v3.mix_recipe_history(facility_id,mix_id,revision,operation,recipe_snapshot,actor_id,command_id,occurred_at)
      VALUES(p_facility_id,v_mix_id,v_recipe.revision,'disable',v3.mix_recipe_json(v_recipe),p_actor_id,p_request_id,v_now);
  ELSIF v_type = 'upsert' THEN
    IF p_command - ARRAY['type','recipe'] <> '{}'::jsonb OR NOT (p_command ? 'recipe') THEN
      RAISE EXCEPTION 'Invalid mix recipe command' USING ERRCODE = '22023';
    END IF;
    v_input := p_command->'recipe';
    IF jsonb_typeof(v_input) IS DISTINCT FROM 'object'
       OR v_input - ARRAY['id','kind','productId','name','notes','batchSizeLbs','daysEarly','enabled','components'] <> '{}'::jsonb
       OR NOT (v_input ?& ARRAY['id','kind','productId','name','notes','batchSizeLbs','daysEarly','enabled','components'])
       OR jsonb_typeof(v_input->'components') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_input->'components') NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'Mix recipe fields are invalid' USING ERRCODE = '22023';
    END IF;
    v_kind := v_input->>'kind';
    v_name := btrim(v_input->>'name');
    v_notes := COALESCE(v_input->>'notes','');
    v_batch := (v_input->>'batchSizeLbs')::numeric;
    v_days := (v_input->>'daysEarly')::integer;
    v_enabled := (v_input->>'enabled')::boolean;
    IF v_kind NOT IN ('product','prep') OR length(v_name) NOT BETWEEN 1 AND 120 OR v_name ~ '[[:cntrl:]]'
       OR length(v_notes) > 2000 OR v_batch < 0 OR v_batch > 999999999999.999999
       OR v_days NOT BETWEEN 0 AND 365 OR v_enabled IS NULL THEN
      RAISE EXCEPTION 'Mix recipe values are invalid' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'product' THEN
      v_product_id := (v_input->>'productId')::uuid;
      IF NOT EXISTS (SELECT 1 FROM v3.products WHERE facility_id = p_facility_id AND id = v_product_id AND active) THEN
        RAISE EXCEPTION 'Mix product is unavailable' USING ERRCODE = 'P0002';
      END IF;
    ELSIF v_input->'productId' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'Prep mixes cannot reference one product' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_input->'id') = 'string' THEN v_mix_id := (v_input->>'id')::uuid; END IF;
    IF v_mix_id IS NOT NULL THEN
      SELECT * INTO v_recipe FROM v3.mix_recipes WHERE facility_id = p_facility_id AND id = v_mix_id FOR UPDATE;
      IF NOT FOUND OR v_recipe.revision <> p_expected_revision THEN
        RETURN jsonb_build_object('outcome','conflict','replayed',false,'catalog',v3.list_mix_recipes(p_facility_id));
      END IF;
    ELSIF p_expected_revision <> 0 THEN
      RETURN jsonb_build_object('outcome','conflict','replayed',false,'catalog',v3.list_mix_recipes(p_facility_id));
    ELSE
      v_mix_id := gen_random_uuid();
    END IF;
    FOR v_component IN SELECT value FROM jsonb_array_elements(v_input->'components') LOOP
      IF jsonb_typeof(v_component) IS DISTINCT FROM 'object'
         OR v_component - ARRAY['ingredientProductId','ouncesPerPizza','referencePoundsPerBatch'] <> '{}'::jsonb
         OR NOT (v_component ?& ARRAY['ingredientProductId','ouncesPerPizza','referencePoundsPerBatch'])
         OR (v_component->>'ouncesPerPizza')::numeric < 0
         OR (v_component->>'ouncesPerPizza')::numeric > 999999999999.999999
         OR (v_component->>'referencePoundsPerBatch' IS NOT NULL
             AND (v_component->>'referencePoundsPerBatch')::numeric < 0)
         OR NOT EXISTS (SELECT 1 FROM v3.products p WHERE p.facility_id = p_facility_id
           AND p.id = (v_component->>'ingredientProductId')::uuid AND p.active) THEN
        RAISE EXCEPTION 'Mix component is invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    INSERT INTO v3.mix_recipes(facility_id,id,kind,product_id,name,notes,batch_size_lbs,days_early,enabled,revision,updated_by,created_at,updated_at)
      VALUES(p_facility_id,v_mix_id,v_kind,v_product_id,v_name,v_notes,v_batch,v_days,v_enabled,1,p_actor_id,v_now,v_now)
    ON CONFLICT (facility_id,id) DO UPDATE SET kind=EXCLUDED.kind,product_id=EXCLUDED.product_id,name=EXCLUDED.name,
      notes=EXCLUDED.notes,batch_size_lbs=EXCLUDED.batch_size_lbs,days_early=EXCLUDED.days_early,
      enabled=EXCLUDED.enabled,revision=v3.mix_recipes.revision+1,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at
    RETURNING * INTO v_recipe;
    DELETE FROM v3.mix_recipe_components WHERE facility_id = p_facility_id AND mix_id = v_mix_id;
    FOR v_component IN SELECT value FROM jsonb_array_elements(v_input->'components') LOOP
      INSERT INTO v3.mix_recipe_components(facility_id,mix_id,position,ingredient_product_id,ingredient_name,ounces_per_pizza,reference_pounds_per_batch)
      SELECT p_facility_id,v_mix_id,v_position,p.id,p.name,
        (v_component->>'ouncesPerPizza')::numeric,
        CASE WHEN v_component->>'referencePoundsPerBatch' IS NULL THEN NULL ELSE (v_component->>'referencePoundsPerBatch')::numeric END
      FROM v3.products p WHERE p.facility_id=p_facility_id AND p.id=(v_component->>'ingredientProductId')::uuid;
      v_position := v_position + 1;
    END LOOP;
    INSERT INTO v3.mix_recipe_history(facility_id,mix_id,revision,operation,recipe_snapshot,actor_id,command_id,occurred_at)
      VALUES(p_facility_id,v_mix_id,v_recipe.revision,'upsert',v3.mix_recipe_json(v_recipe),p_actor_id,p_request_id,v_now);
  ELSE
    RAISE EXCEPTION 'Unsupported mix recipe command' USING ERRCODE = '22023';
  END IF;
  v_response := jsonb_build_object('outcome','accepted','replayed',false,'requestId',p_request_id,
    'recipe',v3.mix_recipe_json(v_recipe),'catalog',v3.list_mix_recipes(p_facility_id));
  INSERT INTO v3.facility_operation_events(facility_id,revision,actor_id,event_type,payload,occurred_at)
    VALUES(p_facility_id,v_recipe.revision,p_actor_id,'mix.recipe.' || v_type,v_response,v_now);
  INSERT INTO v3.command_receipts(facility_id,actor_id,command_id,request_hash,response,created_at)
    VALUES(p_facility_id,p_actor_id,p_request_id,p_request_hash,v_response,v_now);
  RETURN v_response;
END
$$;

REVOKE ALL ON FUNCTION v3.apply_mix_recipe_command(uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC;

CREATE FUNCTION v3.apply_mix_surplus_command(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_expected_revision bigint, p_command jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_state v3.mix_surplus_state%ROWTYPE;
  v_lot v3.mix_surplus_lots%ROWTYPE;
  v_recipe v3.mix_recipes%ROWTYPE;
  v_type text;
  v_lot_id uuid;
  v_target date;
  v_quantity numeric;
  v_available numeric;
  v_now timestamptz := clock_timestamp();
  v_snapshot jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_request_id IS NULL
     OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
     OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid mix surplus request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT request_hash,response INTO v_existing_hash,v_response FROM v3.command_receipts
    WHERE facility_id=p_facility_id AND actor_id=p_actor_id AND command_id=p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE='22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed',true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':mix-surplus',0));
  SELECT * INTO v_state FROM v3.mix_surplus_state WHERE facility_id=p_facility_id FOR UPDATE;
  IF COALESCE(v_state.revision,0) <> p_expected_revision THEN
    RETURN jsonb_build_object('outcome','conflict','replayed',false,'surplus',v3.get_mix_surplus(p_facility_id));
  END IF;
  IF COALESCE(v_state.revision,0) = 9007199254740991 THEN RAISE EXCEPTION 'Surplus revision exhausted' USING ERRCODE='22003'; END IF;
  v_type := p_command->>'type';
  IF v_type = 'record' THEN
    IF p_command - ARRAY['type','mixId','productId','productionDate','quantityLbs','location'] <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','mixId','productId','productionDate','quantityLbs','location']) THEN
      RAISE EXCEPTION 'Invalid surplus record command' USING ERRCODE='22023';
    END IF;
    v_quantity := (p_command->>'quantityLbs')::numeric;
    IF v_quantity <= 0 OR v_quantity > 999999999999.999999 OR length(p_command->>'location') > 120 THEN
      RAISE EXCEPTION 'Surplus amount or location is invalid' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_recipe FROM v3.mix_recipes WHERE facility_id=p_facility_id AND id=(p_command->>'mixId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mix recipe not found' USING ERRCODE='P0002'; END IF;
    IF (v_recipe.kind='product' AND v_recipe.product_id IS DISTINCT FROM (p_command->>'productId')::uuid)
       OR (v_recipe.kind='prep' AND p_command->'productId' <> 'null'::jsonb) THEN
      RAISE EXCEPTION 'Surplus product does not match the mix' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_lot FROM v3.mix_surplus_lots
      WHERE facility_id=p_facility_id AND mix_id=v_recipe.id AND product_id IS NOT DISTINCT FROM v_recipe.product_id
        AND production_date=(p_command->>'productionDate')::date AND source='manual' AND NOT voided FOR UPDATE;
    IF FOUND THEN
      UPDATE v3.mix_surplus_lots SET amount_made_lbs=amount_made_lbs+v_quantity,surplus_lbs=surplus_lbs+v_quantity,
        location=p_command->>'location',updated_at=v_now WHERE facility_id=p_facility_id AND id=v_lot.id RETURNING * INTO v_lot;
    ELSE
      INSERT INTO v3.mix_surplus_lots(facility_id,mix_id,product_id,mix_name,product_name,production_date,source,
        amount_made_lbs,surplus_lbs,location,created_by,created_at,updated_at)
      SELECT p_facility_id,v_recipe.id,v_recipe.product_id,v_recipe.name,p.name,(p_command->>'productionDate')::date,'manual',
        v_quantity,v_quantity,p_command->>'location',p_actor_id,v_now,v_now
      FROM (SELECT 1) seed LEFT JOIN v3.products p ON p.facility_id=p_facility_id AND p.id=v_recipe.product_id
      RETURNING * INTO v_lot;
    END IF;
  ELSIF v_type = 'allocate' THEN
    IF p_command - ARRAY['type','lotId','targetDate','quantityLbs'] <> '{}'::jsonb
       OR NOT (p_command ?& ARRAY['type','lotId','targetDate','quantityLbs']) THEN
      RAISE EXCEPTION 'Invalid surplus allocation command' USING ERRCODE='22023';
    END IF;
    v_lot_id := (p_command->>'lotId')::uuid;
    v_target := (p_command->>'targetDate')::date;
    v_quantity := (p_command->>'quantityLbs')::numeric;
    IF v_quantity < 0 OR v_quantity > 999999999999.999999 THEN RAISE EXCEPTION 'Allocation amount is invalid' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_lot FROM v3.mix_surplus_lots WHERE facility_id=p_facility_id AND id=v_lot_id FOR UPDATE;
    IF NOT FOUND OR v_lot.voided OR v_target <= v_lot.production_date THEN
      RAISE EXCEPTION 'Surplus lot cannot be allocated to that date' USING ERRCODE='55000';
    END IF;
    SELECT COALESCE(sum(quantity_lbs),0) INTO v_available FROM v3.mix_surplus_allocations
      WHERE facility_id=p_facility_id AND lot_id=v_lot_id AND target_date<>v_target;
    v_available := v_lot.surplus_lbs - v_available;
    IF v_quantity > v_available THEN
      RETURN jsonb_build_object('outcome','conflict','replayed',false,'reason','over_allocation','surplus',v3.get_mix_surplus(p_facility_id));
    END IF;
    DELETE FROM v3.mix_surplus_allocations WHERE facility_id=p_facility_id AND lot_id=v_lot_id AND target_date=v_target;
    IF v_quantity > 0 THEN
      INSERT INTO v3.mix_surplus_allocations(facility_id,lot_id,target_date,quantity_lbs,actor_id,created_at)
        VALUES(p_facility_id,v_lot_id,v_target,v_quantity,p_actor_id,v_now);
    END IF;
  ELSIF v_type = 'void' THEN
    IF p_command - ARRAY['type','lotId'] <> '{}'::jsonb OR p_command->>'lotId' IS NULL THEN
      RAISE EXCEPTION 'Invalid surplus void command' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_lot FROM v3.mix_surplus_lots WHERE facility_id=p_facility_id AND id=(p_command->>'lotId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Surplus lot not found' USING ERRCODE='P0002'; END IF;
    UPDATE v3.mix_surplus_lots SET voided=true,updated_at=v_now WHERE facility_id=p_facility_id AND id=v_lot.id RETURNING * INTO v_lot;
    DELETE FROM v3.mix_surplus_allocations WHERE facility_id=p_facility_id AND lot_id=v_lot.id;
  ELSE
    RAISE EXCEPTION 'Unsupported mix surplus command' USING ERRCODE='22023';
  END IF;
  INSERT INTO v3.mix_surplus_state(facility_id,revision,updated_by,updated_at)
    VALUES(p_facility_id,1,p_actor_id,v_now)
  ON CONFLICT(facility_id) DO UPDATE SET revision=v3.mix_surplus_state.revision+1,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at
  RETURNING * INTO v_state;
  v_snapshot := jsonb_build_object('lotId',v_lot.id,'mixId',v_lot.mix_id,'productId',v_lot.product_id,
    'productionDate',v_lot.production_date,'surplusLbs',v3.inventory_quantity_text(v_lot.surplus_lbs),'voided',v_lot.voided);
  INSERT INTO v3.mix_surplus_history(facility_id,lot_id,operation,snapshot,actor_id,command_id,occurred_at)
    VALUES(p_facility_id,v_lot.id,v_type,v_snapshot,p_actor_id,p_request_id,v_now);
  v_response := jsonb_build_object('outcome','accepted','replayed',false,'requestId',p_request_id,
    'surplus',v3.get_mix_surplus(p_facility_id));
  INSERT INTO v3.facility_operation_events(facility_id,revision,actor_id,event_type,payload,occurred_at)
    VALUES(p_facility_id,v_state.revision,p_actor_id,'mix.surplus.' || v_type,v_response,v_now);
  INSERT INTO v3.command_receipts(facility_id,actor_id,command_id,request_hash,response,created_at)
    VALUES(p_facility_id,p_actor_id,p_request_id,p_request_hash,v_response,v_now);
  RETURN v_response;
END
$$;

REVOKE ALL ON FUNCTION v3.apply_mix_surplus_command(uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC;

CREATE FUNCTION v3.mix_ingredient_names_match(p_left text, p_right text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
AS $$
DECLARE a text := lower(btrim(COALESCE(p_left,''))); b text := lower(btrim(COALESCE(p_right,''))); longer text; shorter text; next_char text;
BEGIN
  IF a='' OR b='' THEN RETURN false; END IF;
  IF a=b THEN RETURN true; END IF;
  IF length(a)>=length(b) THEN longer:=a; shorter:=b; ELSE longer:=b; shorter:=a; END IF;
  IF left(longer,length(shorter))<>shorter THEN RETURN false; END IF;
  next_char:=substr(longer,length(shorter)+1,1);
  RETURN next_char IN (' ','-',',','(','/');
END
$$;

CREATE FUNCTION v3.mix_template_ingredients(p_facility_id uuid, p_date date, p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_raw jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_slot integer;
  v_prefix text;
  v_recipe jsonb;
  v_row jsonb;
  v_total numeric;
  v_oz numeric;
  v_name text;
  v_suffix text;
  v_product_id uuid;
  v_product_count integer;
BEGIN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN p_values := '{}'::jsonb; END IF;
  FOR v_slot IN 1..4 LOOP
    v_prefix := 'app' || v_slot;
    v_oz := CASE WHEN p_values->>(v_prefix || 'OzPerPizza') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (p_values->>(v_prefix || 'OzPerPizza'))::numeric ELSE 0 END;
    v_recipe := p_values->(v_prefix || 'CheeseRecipe');
    IF v_oz>0 AND jsonb_typeof(v_recipe)='array' AND jsonb_array_length(v_recipe)>0 THEN
      SELECT COALESCE(sum(CASE WHEN value->>'lbs' ~ '^[0-9]+(\.[0-9]+)?$' THEN (value->>'lbs')::numeric ELSE 0 END),0)
        INTO v_total FROM jsonb_array_elements(v_recipe);
      IF v_total>0 THEN
        FOR v_row IN SELECT value FROM jsonb_array_elements(v_recipe) LOOP
          v_name := btrim(COALESCE(v_row->>'ingredient',''));
          IF v_name<>'' AND (v_row->>'lbs')::numeric>0 THEN
            v_raw := v_raw || jsonb_build_array(jsonb_build_object('name',v_name,'ounces',v_oz*(v_row->>'lbs')::numeric/v_total));
          END IF;
        END LOOP;
      END IF;
    ELSIF v_oz>0 THEN
      v_name := btrim(COALESCE(p_values->>(v_prefix || 'Type'),''));
      IF v_name<>'' THEN v_raw := v_raw || jsonb_build_array(jsonb_build_object('name',v_name,'ounces',v_oz)); END IF;
    END IF;
  END LOOP;
  FOR v_slot IN 1..2 LOOP
    FOREACH v_suffix IN ARRAY ARRAY['','B'] LOOP
      v_name := COALESCE(p_values->>('pep' || v_slot || 'Type' || v_suffix),'');
      v_prefix := 'pep' || v_slot || 'OzPerPizza' || v_suffix;
      v_oz := CASE WHEN p_values->>v_prefix ~ '^[0-9]+(\.[0-9]+)?$' THEN (p_values->>v_prefix)::numeric ELSE 0 END;
      IF btrim(v_name)<>'' AND v_oz>0 THEN v_raw := v_raw || jsonb_build_array(jsonb_build_object('name',btrim(v_name),'ounces',v_oz)); END IF;
    END LOOP;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_raw) LOOP
    SELECT count(*),min(id::text)::uuid INTO v_product_count,v_product_id FROM v3.products p
      WHERE p.facility_id=p_facility_id AND p.active AND lower(p.name)=lower(v_row->>'name');
    IF v_product_count<>1 THEN v_product_id:=NULL; END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'productId',v_product_id,'productCode',NULL,'productName',v_row->>'name',
      'quantity',v_row->>'ounces','unit','oz'
    ));
  END LOOP;
  v_result := v3.effective_ingredient_lines(p_facility_id,p_date,v_result);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'productId',value->>'productId','name',value->>'productName',
    'ouncesPerPizza',CASE WHEN value->>'quantity' ~ '^[0-9]+(\.[0-9]+)?$' THEN (value->>'quantity')::numeric ELSE NULL END
  )) FROM jsonb_array_elements(v_result)),'[]'::jsonb);
END
$$;

CREATE FUNCTION v3.mix_plan_demand(p_facility_id uuid, p_make_date date)
RETURNS TABLE(production_date date,key text,run_id uuid,schedule_run_id uuid,source text,label text,
  product_id uuid,product_name text,cases numeric,pizzas numeric,ingredients jsonb,warnings jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_schedule v3.production_schedules%ROWTYPE;
  v_run_json jsonb;
  v_run v3.runs%ROWTYPE;
  v_product v3.products%ROWTYPE;
  v_template v3.setup_run_template_records%ROWTYPE;
  v_target numeric;
  v_ppc numeric;
  v_cpl numeric;
  v_warning jsonb;
  v_ordinal integer;
BEGIN
  IF p_facility_id IS NULL OR p_make_date IS NULL OR NOT EXISTS(SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid Mix Plan scope' USING ERRCODE='42501';
  END IF;
  FOR v_schedule IN SELECT * FROM v3.production_schedules s
    WHERE s.facility_id=p_facility_id AND s.production_date BETWEEN p_make_date AND p_make_date+365 LOOP
    v_ordinal:=0;
    FOR v_run_json IN SELECT value FROM jsonb_array_elements(v_schedule.plan->'runs') LOOP
      v_ordinal:=v_ordinal+1;
      SELECT * INTO v_product FROM v3.products p WHERE p.facility_id=p_facility_id AND lower(p.code)=lower(v_run_json->>'productCode') AND p.active;
      SELECT * INTO v_template FROM v3.setup_run_template_records t WHERE t.facility_id=p_facility_id AND lower(t.code)=lower(v_run_json->>'runTemplateCode');
      v_target:=CASE WHEN v_run_json->>'targetCases' ~ '^[0-9]+$' THEN (v_run_json->>'targetCases')::numeric ELSE 0 END;
      SELECT v_target-COALESCE(sum(a.cases),0) INTO v_target FROM v3.freezer_surplus_allocations a
        WHERE a.facility_id=p_facility_id AND a.production_date=v_schedule.production_date
          AND a.schedule_run_id=(v_run_json->>'id')::uuid;
      v_target:=GREATEST(COALESCE(v_target,0),0);
      v_ppc:=CASE WHEN v_template.data->'values'->>'pizzasPerCase' ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (v_template.data->'values'->>'pizzasPerCase')::numeric ELSE NULL END;
      v_cpl:=CASE WHEN v_template.data->'values'->>'casesPerLayer' ~ '^[0-9]+(\.[0-9]+)?$'
        THEN (v_template.data->'values'->>'casesPerLayer')::numeric ELSE NULL END;
      v_warning:='[]'::jsonb;
      IF v_product.id IS NULL OR v_template.code IS NULL OR v_ppc IS NULL OR v_ppc<=0 OR v_cpl IS NULL THEN
        v_warning:=jsonb_build_array('Scheduled setup values are missing or ambiguous; pizza demand is shown as zero until setup is repaired.');
      END IF;
      production_date:=v_schedule.production_date; key:='schedule:' || (v_run_json->>'id'); run_id:=NULL;
      schedule_run_id:=(v_run_json->>'id')::uuid; source:='schedule';
      label:='Scheduled run ' || v_ordinal || ' — ' || COALESCE(v_run_json->>'productionSetupCode','Unresolved setup');
      product_id:=v_product.id; product_name:=COALESCE(v_product.name,v_run_json->>'productCode'); cases:=v_target;
      pizzas:=CASE WHEN v_ppc>0 AND v_cpl IS NOT NULL THEN (v_target+v_cpl)*v_ppc ELSE 0 END;
      ingredients:=CASE WHEN v_template.code IS NULL THEN '[]'::jsonb ELSE v3.mix_template_ingredients(p_facility_id,v_schedule.production_date,v_template.data->'values') END;
      warnings:=v_warning;
      IF v_target>0 THEN RETURN NEXT; END IF;
    END LOOP;
  END LOOP;
  FOR v_run IN SELECT * FROM v3.runs r WHERE r.facility_id=p_facility_id AND r.status IN ('planned','running','paused')
    AND r.production_date BETWEEN p_make_date AND p_make_date+365 LOOP
    SELECT * INTO v_product FROM v3.products p WHERE p.facility_id=p_facility_id AND lower(p.code)=lower(v_run.setup_snapshot->>'productCode');
    v_target:=CASE WHEN v_run.setup_snapshot->>'targetCases' ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_run.setup_snapshot->>'targetCases')::numeric ELSE 0 END;
    SELECT CASE WHEN min(value) IS NOT NULL AND min(value)=max(value) THEN min(value) ELSE NULL END INTO v_ppc FROM (
      SELECT DISTINCT (sp.inputs->>'pizzasPerCase')::numeric value FROM v3.run_station_progress sp
      WHERE sp.facility_id=v_run.facility_id AND sp.run_id=v_run.id AND sp.inputs->>'pizzasPerCase' ~ '^[0-9]+(\.[0-9]+)?$'
        AND (sp.inputs->>'pizzasPerCase')::numeric>0
    ) values_found;
    v_cpl:=CASE WHEN v_run.setup_snapshot#>>'{dieSetup,lineSettings,casesPerLayer}' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (v_run.setup_snapshot#>>'{dieSetup,lineSettings,casesPerLayer}')::numeric ELSE NULL END;
    v_warning:='[]'::jsonb;
    IF v_product.id IS NULL OR v_ppc IS NULL OR v_cpl IS NULL THEN
      v_warning:=jsonb_build_array('Live run lacks a single frozen pizzas-per-case or cases-per-layer value; recipe fallback is used where possible and pizza demand is not invented.');
    END IF;
    production_date:=v_run.production_date; key:='run:' || v_run.id; run_id:=v_run.id; schedule_run_id:=NULL;
    source:='live'; label:=COALESCE(NULLIF(v_run.setup_snapshot->>'label',''),'Live run ' || left(v_run.id::text,8));
    product_id:=v_product.id; product_name:=COALESCE(v_product.name,v_run.setup_snapshot->>'productCode'); cases:=v_target;
    pizzas:=CASE WHEN v_ppc>0 AND v_cpl IS NOT NULL THEN (v_target+v_cpl)*v_ppc ELSE 0 END;
    ingredients:=COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
      'productId',line.value->>'productId','name',line.value->>'productName','ouncesPerPizza',NULL
    )) FROM v3.effective_production_plan(p_facility_id,v_run.production_date,v_run.setup_snapshot->'productionPlan') p
      CROSS JOIN jsonb_array_elements(p->'recipes') recipe
      CROSS JOIN jsonb_array_elements(recipe->'ingredients') line),'[]'::jsonb);
    warnings:=v_warning;
    IF v_target>0 THEN RETURN NEXT; END IF;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION v3.mix_ingredient_names_match(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.mix_template_ingredients(uuid,date,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.mix_plan_demand(uuid,date) FROM PUBLIC;

CREATE FUNCTION v3.mix_plan_entry(
  p_recipe v3.mix_recipes, p_production_date date, p_product_id uuid, p_product_name text,
  p_contributions jsonb, p_manual_already numeric, p_actual_made numeric, p_allocated_surplus numeric
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_component record;
  v_run jsonb;
  v_line jsonb;
  v_ounces numeric;
  v_amount_missing boolean;
  v_planned numeric;
  v_run_total numeric;
  v_components jsonb := '[]'::jsonb;
  v_contributions jsonb := '[]'::jsonb;
  v_missing jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_component_lbs numeric := 0;
  v_waste numeric;
  v_total numeric;
  v_already numeric := GREATEST(COALESCE(p_manual_already,0),0)+GREATEST(COALESCE(p_allocated_surplus,0),0);
  v_remaining numeric;
BEGIN
  FOR v_component IN SELECT * FROM v3.mix_recipe_components c
    WHERE c.facility_id=p_recipe.facility_id AND c.mix_id=p_recipe.id ORDER BY c.position LOOP
    v_planned:=0; v_missing:='[]'::jsonb;
    FOR v_run IN SELECT value FROM jsonb_array_elements(p_contributions) LOOP
      v_ounces:=NULL;
      v_amount_missing:=false;
      IF p_recipe.kind='product' THEN
        v_ounces:=v_component.ounces_per_pizza;
      ELSE
        v_amount_missing:=true;
        SELECT value INTO v_line FROM jsonb_array_elements(v_run->'ingredients') line
          WHERE (line.value->>'productId' IS NOT NULL AND line.value->>'productId'=v_component.ingredient_product_id::text)
             OR v3.mix_ingredient_names_match(line.value->>'name',v_component.ingredient_name)
          LIMIT 1;
        IF FOUND THEN
          v_amount_missing:=jsonb_typeof(v_line->'ouncesPerPizza')<>'number';
          v_ounces:=CASE WHEN jsonb_typeof(v_line->'ouncesPerPizza')='number' THEN (v_line->>'ouncesPerPizza')::numeric
            ELSE v_component.ounces_per_pizza END;
        END IF;
      END IF;
      IF p_recipe.kind='product' OR v_line IS NOT NULL THEN
        v_planned:=v_planned+COALESCE(v_ounces,0)*(v_run->>'pizzas')::numeric/16;
      END IF;
      IF v_amount_missing OR v_ounces IS NULL OR v_ounces<=0 THEN v_missing:=v_missing||jsonb_build_array(v_run->>'key'); END IF;
      v_line:=NULL;
    END LOOP;
    v_component_lbs:=v_component_lbs+v_planned;
    IF jsonb_array_length(v_missing)>0 THEN
      v_warnings:=v_warnings||jsonb_build_array(v_component.ingredient_name || ': missing or zero ounces per pizza for ' ||
        (SELECT string_agg(value,', ') FROM jsonb_array_elements_text(v_missing)) || '.');
    END IF;
    v_components:=v_components||jsonb_build_array(jsonb_build_object(
      'ingredientProductId',v_component.ingredient_product_id,'ingredientName',v_component.ingredient_name,
      'referencePoundsPerBatch',v_component.reference_pounds_per_batch,'plannedLbs',v_planned,'missingRuns',v_missing
    ));
  END LOOP;
  FOR v_run IN SELECT value FROM jsonb_array_elements(p_contributions) LOOP
    v_run_total:=0;
    FOR v_component IN SELECT * FROM v3.mix_recipe_components c
      WHERE c.facility_id=p_recipe.facility_id AND c.mix_id=p_recipe.id ORDER BY c.position LOOP
      IF p_recipe.kind='product' THEN
        v_run_total:=v_run_total+v_component.ounces_per_pizza*(v_run->>'pizzas')::numeric/16;
      ELSE
        SELECT value INTO v_line FROM jsonb_array_elements(v_run->'ingredients') line
          WHERE (line.value->>'productId' IS NOT NULL AND line.value->>'productId'=v_component.ingredient_product_id::text)
             OR v3.mix_ingredient_names_match(line.value->>'name',v_component.ingredient_name) LIMIT 1;
        IF FOUND THEN
          v_ounces:=CASE WHEN jsonb_typeof(v_line->'ouncesPerPizza')='number' THEN (v_line->>'ouncesPerPizza')::numeric
            ELSE v_component.ounces_per_pizza END;
          v_run_total:=v_run_total+COALESCE(v_ounces,0)*(v_run->>'pizzas')::numeric/16;
        END IF;
        v_line:=NULL;
      END IF;
    END LOOP;
    v_contributions:=v_contributions||jsonb_build_array(v_run||jsonb_build_object('componentLbs',v_run_total));
    v_warnings:=v_warnings||COALESCE((SELECT jsonb_agg(v_run->>'key' || ': ' || value) FROM jsonb_array_elements_text(v_run->'warnings')),'[]'::jsonb);
  END LOOP;
  IF p_recipe.batch_size_lbs<=0 THEN v_warnings:=v_warnings||jsonb_build_array('Batch size is zero; no batch count is available.'); END IF;
  v_waste:=v_component_lbs*0.15;
  v_total:=v_component_lbs+v_waste+20;
  v_remaining:=GREATEST(0,v_total-v_already);
  RETURN jsonb_build_object(
    'key',p_production_date::text || ':' || p_recipe.id::text || ':' || COALESCE(p_product_id::text,'prep'),
    'productionDate',p_production_date,'mixId',p_recipe.id,'kind',p_recipe.kind,
    'productId',p_product_id,'productName',p_product_name,'name',p_recipe.name,'notes',p_recipe.notes,
    'batchSizeLbs',p_recipe.batch_size_lbs,'daysEarly',p_recipe.days_early,
    'componentLbs',v_component_lbs,'wasteLbs',v_waste,'startupLbs',20,'totalLbs',v_total,
    'manualAlreadyMadeLbs',GREATEST(COALESCE(p_manual_already,0),0),
    'allocatedSurplusLbs',GREATEST(COALESCE(p_allocated_surplus,0),0),'alreadyMadeLbs',v_already,
    'remainingLbs',v_remaining,'batches',CASE WHEN p_recipe.batch_size_lbs>0 THEN v_remaining/p_recipe.batch_size_lbs ELSE NULL END,
    'actualMadeLbs',GREATEST(COALESCE(p_actual_made,0),0),
    'components',(SELECT COALESCE(jsonb_agg(component||jsonb_build_object('pullLbs',
      CASE WHEN v_total>0 THEN (component->>'plannedLbs')::numeric*v_remaining/v_total ELSE 0 END)),'[]'::jsonb)
      FROM jsonb_array_elements(v_components) component),
    'contributions',v_contributions,'warnings',v_warnings,'finalized',false,'finalization',NULL
  );
END
$$;

REVOKE ALL ON FUNCTION v3.mix_plan_entry(v3.mix_recipes,date,uuid,text,jsonb,numeric,numeric,numeric) FROM PUBLIC;

CREATE FUNCTION v3.get_mix_plan(p_facility_id uuid, p_make_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_recipe v3.mix_recipes%ROWTYPE;
  v_finalization v3.mix_finalizations%ROWTYPE;
  v_amount v3.mix_plan_amounts%ROWTYPE;
  v_date date;
  v_product_id uuid;
  v_product_name text;
  v_contributions jsonb;
  v_entry jsonb;
  v_allocated numeric;
  v_entries jsonb := '{}'::jsonb;
  v_revision bigint;
  v_group record;
  v_groups jsonb := '[]'::jsonb;
BEGIN
  PERFORM 1 FROM v3.mix_plan_demand(p_facility_id,p_make_date) LIMIT 1;
  FOR v_recipe IN SELECT * FROM v3.mix_recipes r WHERE r.facility_id=p_facility_id AND r.enabled ORDER BY lower(r.name),r.id LOOP
    FOR v_date IN SELECT DISTINCT d.production_date FROM v3.mix_plan_demand(p_facility_id,p_make_date) d
      WHERE d.production_date-p_make_date BETWEEN 0 AND v_recipe.days_early ORDER BY d.production_date LOOP
      FOR v_product_id,v_product_name IN
        SELECT DISTINCT CASE WHEN v_recipe.kind='prep' THEN NULL ELSE d.product_id END,
          CASE WHEN v_recipe.kind='prep' THEN NULL ELSE d.product_name END
        FROM v3.mix_plan_demand(p_facility_id,p_make_date) d
        WHERE d.production_date=v_date AND ((v_recipe.kind='product' AND d.product_id=v_recipe.product_id) OR v_recipe.kind='prep')
      LOOP
        SELECT * INTO v_finalization FROM v3.mix_finalizations f WHERE f.facility_id=p_facility_id
          AND f.production_date=v_date AND f.mix_id=v_recipe.id AND f.product_id IS NOT DISTINCT FROM v_product_id;
        SELECT COALESCE(sum(a.quantity_lbs),0) INTO v_allocated FROM v3.mix_surplus_allocations a
          JOIN v3.mix_surplus_lots l ON l.facility_id=a.facility_id AND l.id=a.lot_id
          WHERE a.facility_id=p_facility_id AND a.target_date=v_date AND l.mix_id=v_recipe.id
            AND l.product_id IS NOT DISTINCT FROM v_product_id AND NOT l.voided;
        SELECT revision INTO v_revision FROM v3.mix_plan_days d WHERE d.facility_id=p_facility_id AND d.production_date=v_date;
        IF v_finalization.id IS NOT NULL THEN
          v_entry:=v_finalization.plan_snapshot||jsonb_build_object('daysUntil',v_date-p_make_date,'revision',COALESCE(v_revision,0),
            'finalized',true,'finalization',jsonb_build_object('actualMadeLbs',v_finalization.actual_made_lbs,
              'freshLbs',v_finalization.fresh_lbs,'surplusLbs',v_finalization.surplus_lbs,
              'firstRunId',v_finalization.first_run_id,'createdAt',to_char(v_finalization.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'contributions',v_finalization.plan_snapshot->'contributions'));
          v_entries:=jsonb_set(v_entries,ARRAY[v_date::text],COALESCE(v_entries->(v_date::text),'[]'::jsonb)||jsonb_build_array(v_entry));
        END IF;
        SELECT jsonb_agg(jsonb_build_object(
          'key',d.key,'runId',d.run_id,'scheduleRunId',d.schedule_run_id,'source',d.source,'label',d.label,
          'productId',d.product_id,'productName',d.product_name,'cases',d.cases,'pizzas',d.pizzas,
          'ingredients',d.ingredients,'warnings',d.warnings
        )) INTO v_contributions
        FROM v3.mix_plan_demand(p_facility_id,p_make_date) d
        WHERE d.production_date=v_date
          AND (v_recipe.kind='prep' OR d.product_id=v_recipe.product_id)
          AND (v_recipe.kind='product' OR EXISTS (
            SELECT 1 FROM v3.mix_recipe_components c
            CROSS JOIN jsonb_array_elements(d.ingredients) ingredient
            WHERE c.facility_id=v_recipe.facility_id AND c.mix_id=v_recipe.id
              AND ((ingredient.value->>'productId' IS NOT NULL AND ingredient.value->>'productId'=c.ingredient_product_id::text)
                OR v3.mix_ingredient_names_match(ingredient.value->>'name',c.ingredient_name))
          ))
          AND (v_finalization.id IS NULL OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_finalization.plan_snapshot->'contributions') old
            WHERE old.value->>'key'=d.key
          ));
        IF v_contributions IS NULL THEN CONTINUE; END IF;
        v_amount:=NULL;
        IF v_finalization.id IS NULL THEN
          SELECT * INTO v_amount FROM v3.mix_plan_amounts a WHERE a.facility_id=p_facility_id
            AND a.production_date=v_date AND a.mix_id=v_recipe.id AND a.product_id IS NOT DISTINCT FROM v_product_id;
        END IF;
        v_entry:=v3.mix_plan_entry(v_recipe,v_date,v_product_id,v_product_name,v_contributions,
          COALESCE(v_amount.already_made_lbs,0),COALESCE(v_amount.actual_made_lbs,0),v_allocated)
          ||jsonb_build_object('daysUntil',v_date-p_make_date,'revision',COALESCE(v_revision,0));
        v_entries:=jsonb_set(v_entries,ARRAY[v_date::text],COALESCE(v_entries->(v_date::text),'[]'::jsonb)||jsonb_build_array(v_entry));
      END LOOP;
    END LOOP;
  END LOOP;
  FOR v_group IN SELECT key,value FROM jsonb_each(v_entries) ORDER BY key LOOP
    v_groups:=v_groups||jsonb_build_array(jsonb_build_object('productionDate',v_group.key,
      'daysUntil',v_group.key::date-p_make_date,'entries',v_group.value));
  END LOOP;
  RETURN jsonb_build_object('makeDate',p_make_date,'derivedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'groups',v_groups);
END
$$;

CREATE FUNCTION v3.apply_mix_plan_command(
  p_facility_id uuid,p_actor_id uuid,p_request_id text,p_request_hash text,
  p_expected_revision bigint,p_command jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_day v3.mix_plan_days%ROWTYPE;
  v_recipe v3.mix_recipes%ROWTYPE;
  v_date date;
  v_product_id uuid;
  v_already numeric;
  v_actual numeric;
  v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_request_id IS NULL
     OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200 OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
     OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
     OR p_command - ARRAY['type','productionDate','mixId','productId','alreadyMadeLbs','actualMadeLbs'] <> '{}'::jsonb
     OR NOT (p_command ?& ARRAY['type','productionDate','mixId','productId','alreadyMadeLbs','actualMadeLbs'])
     OR p_command->>'type' <> 'set-amount'
     OR NOT EXISTS(SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid Mix Plan command' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||':'||p_actor_id::text||':'||p_request_id,0));
  SELECT request_hash,response INTO v_existing_hash,v_response FROM v3.command_receipts
    WHERE facility_id=p_facility_id AND actor_id=p_actor_id AND command_id=p_request_id;
  IF FOUND THEN
    IF v_existing_hash<>p_request_hash THEN RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE='22023'; END IF;
    RETURN v_response||jsonb_build_object('replayed',true);
  END IF;
  v_date:=(p_command->>'productionDate')::date;
  SELECT * INTO v_recipe FROM v3.mix_recipes WHERE facility_id=p_facility_id AND id=(p_command->>'mixId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mix recipe not found' USING ERRCODE='P0002'; END IF;
  v_product_id:=CASE WHEN v_recipe.kind='product' THEN v_recipe.product_id ELSE NULL END;
  IF (v_recipe.kind='product' AND v_product_id IS DISTINCT FROM (p_command->>'productId')::uuid)
     OR (v_recipe.kind='prep' AND p_command->'productId'<>'null'::jsonb) THEN
    RAISE EXCEPTION 'Mix Plan product does not match the recipe' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM v3.mix_finalizations f WHERE f.facility_id=p_facility_id AND f.production_date=v_date
    AND f.mix_id=v_recipe.id AND f.product_id IS NOT DISTINCT FROM v_product_id) THEN
    RETURN jsonb_build_object('outcome','conflict','replayed',false,'reason','finalized','plan',v3.get_mix_plan(p_facility_id,v_date));
  END IF;
  v_already:=(p_command->>'alreadyMadeLbs')::numeric;
  v_actual:=(p_command->>'actualMadeLbs')::numeric;
  IF v_already<0 OR v_actual<0 OR v_already>999999999999.999999 OR v_actual>999999999999.999999 THEN
    RAISE EXCEPTION 'Mix Plan quantities are invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||':mix-plan:'||v_date::text,0));
  SELECT * INTO v_day FROM v3.mix_plan_days WHERE facility_id=p_facility_id AND production_date=v_date FOR UPDATE;
  IF COALESCE(v_day.revision,0)<>p_expected_revision THEN
    RETURN jsonb_build_object('outcome','conflict','replayed',false,'plan',v3.get_mix_plan(p_facility_id,v_date));
  END IF;
  INSERT INTO v3.mix_plan_days(facility_id,production_date,revision,updated_by,updated_at)
    VALUES(p_facility_id,v_date,1,p_actor_id,v_now)
  ON CONFLICT(facility_id,production_date) DO UPDATE SET revision=v3.mix_plan_days.revision+1,
    updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at RETURNING * INTO v_day;
  INSERT INTO v3.mix_plan_amounts(facility_id,production_date,mix_id,product_id,already_made_lbs,actual_made_lbs,updated_by,updated_at)
    VALUES(p_facility_id,v_date,v_recipe.id,v_product_id,v_already,v_actual,p_actor_id,v_now)
  ON CONFLICT(facility_id,production_date,mix_id,product_id) DO UPDATE SET already_made_lbs=EXCLUDED.already_made_lbs,
    actual_made_lbs=EXCLUDED.actual_made_lbs,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
  v_response:=jsonb_build_object('outcome','accepted','replayed',false,'requestId',p_request_id,
    'plan',v3.get_mix_plan(p_facility_id,v_date));
  INSERT INTO v3.facility_operation_events(facility_id,revision,actor_id,event_type,payload,occurred_at)
    VALUES(p_facility_id,v_day.revision,p_actor_id,'mix.plan.set-amount',v_response,v_now);
  INSERT INTO v3.command_receipts(facility_id,actor_id,command_id,request_hash,response,created_at)
    VALUES(p_facility_id,p_actor_id,p_request_id,p_request_hash,v_response,v_now);
  RETURN v_response;
END
$$;

REVOKE ALL ON FUNCTION v3.get_mix_plan(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.apply_mix_plan_command(uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC;

CREATE FUNCTION v3.finalize_run_mixes(p_facility_id uuid,p_run_id uuid,p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_run v3.runs%ROWTYPE;
  v_plan jsonb;
  v_entry jsonb;
  v_component jsonb;
  v_recipe v3.mix_recipes%ROWTYPE;
  v_warehouse_id uuid;
  v_claim_id uuid;
  v_actual numeric;
  v_fresh numeric;
  v_surplus numeric;
  v_quantity numeric;
  v_consumption jsonb;
  v_movement_id uuid;
  v_now timestamptz:=clock_timestamp();
  v_lot v3.mix_surplus_lots%ROWTYPE;
  v_state_revision bigint;
BEGIN
  SELECT * INTO v_run FROM v3.runs WHERE facility_id=p_facility_id AND id=p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run not found for Mix Plan finalization' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||':mix-plan:'||v_run.production_date::text,0));
  v_plan:=v3.get_mix_plan(p_facility_id,v_run.production_date);
  SELECT id INTO v_warehouse_id FROM v3.inventory_warehouses
    WHERE facility_id=p_facility_id AND active AND is_production;
  FOR v_entry IN SELECT entry.value FROM jsonb_array_elements(v_plan->'groups') plan_group
    CROSS JOIN jsonb_array_elements(plan_group.value->'entries') entry
    WHERE COALESCE((entry.value->>'finalized')::boolean,false)=false
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(entry.value->'contributions') contribution
        WHERE contribution.value->>'runId'=p_run_id::text)
  LOOP
    v_claim_id:=gen_random_uuid();
    v_actual:=(v_entry->>'actualMadeLbs')::numeric;
    v_fresh:=CASE WHEN v_actual>0 THEN v_actual ELSE (v_entry->>'remainingLbs')::numeric END;
    v_surplus:=GREATEST(0,v_actual-(v_entry->>'remainingLbs')::numeric);
    v_consumption:='[]'::jsonb;
    FOR v_component IN SELECT value FROM jsonb_array_elements(v_entry->'components') LOOP
      v_quantity:=round(CASE WHEN (v_entry->>'totalLbs')::numeric>0
        THEN (v_component->>'plannedLbs')::numeric*v_fresh/(v_entry->>'totalLbs')::numeric ELSE 0 END,6);
      IF v_quantity<=0 THEN CONTINUE; END IF;
      IF v_warehouse_id IS NULL THEN RAISE EXCEPTION 'Production warehouse is required for Mix Plan finalization' USING ERRCODE='55000'; END IF;
      v_movement_id:=gen_random_uuid();
      INSERT INTO v3.inventory_movements(facility_id,id,warehouse_id,product_id,movement_group_id,movement_type,
        quantity_delta,reason,actor_id,command_id,occurred_at)
      VALUES(p_facility_id,v_movement_id,v_warehouse_id,(v_component->>'ingredientProductId')::uuid,v_claim_id,'run_consumption',
        -v_quantity,'Mix Plan finalization for run ' || p_run_id::text,p_actor_id,'mix-finalization:' || v_claim_id::text,v_now);
      UPDATE v3.inventory_balances SET quantity=quantity-v_quantity,revision=revision+1,updated_at=v_now
        WHERE facility_id=p_facility_id AND warehouse_id=v_warehouse_id
          AND product_id=(v_component->>'ingredientProductId')::uuid AND quantity>=v_quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for Mix Plan component finalization' USING ERRCODE='22003'; END IF;
      PERFORM v3.consume_inventory_lots(p_facility_id,v_warehouse_id,(v_component->>'ingredientProductId')::uuid,v_movement_id,v_quantity,v_now);
      v_consumption:=v_consumption||jsonb_build_array(v_component||jsonb_build_object('quantityLbs',v_quantity,'movementId',v_movement_id));
    END LOOP;
    SELECT * INTO v_recipe FROM v3.mix_recipes WHERE facility_id=p_facility_id AND id=(v_entry->>'mixId')::uuid;
    INSERT INTO v3.mix_finalizations(facility_id,id,production_date,mix_id,product_id,recipe_snapshot,plan_snapshot,
      actual_made_lbs,fresh_lbs,surplus_lbs,contributing_run_ids,contributing_schedule_run_ids,first_run_id,actor_id,created_at)
    VALUES(p_facility_id,v_claim_id,v_run.production_date,v_recipe.id,NULLIF(v_entry->>'productId','')::uuid,
      v3.mix_recipe_json(v_recipe),v_entry||jsonb_build_object('inventoryConsumption',v_consumption),v_actual,v_fresh,v_surplus,
      COALESCE((SELECT jsonb_agg(value->>'runId') FROM jsonb_array_elements(v_entry->'contributions') contribution(value)
        WHERE contribution.value->>'runId' IS NOT NULL),'[]'::jsonb),
      COALESCE((SELECT jsonb_agg(value->>'scheduleRunId') FROM jsonb_array_elements(v_entry->'contributions') contribution(value)
        WHERE contribution.value->>'scheduleRunId' IS NOT NULL),'[]'::jsonb),
      p_run_id,p_actor_id,v_now);
    INSERT INTO v3.facility_operation_events(facility_id,revision,actor_id,event_type,payload,occurred_at)
      VALUES(p_facility_id,v_run.revision+1,p_actor_id,'mix.plan.finalized',
        jsonb_build_object('finalizationId',v_claim_id,'runId',p_run_id,'plan',v_entry,'consumption',v_consumption),v_now);
    IF v_surplus>0 THEN
      INSERT INTO v3.mix_surplus_lots(facility_id,mix_id,product_id,mix_name,product_name,production_date,source,
        amount_made_lbs,surplus_lbs,location,source_finalization_run_id,created_by,created_at,updated_at)
      VALUES(p_facility_id,v_recipe.id,NULLIF(v_entry->>'productId','')::uuid,v_recipe.name,v_entry->>'productName',v_run.production_date,
        'automatic',v_actual,v_surplus,'',p_run_id,p_actor_id,v_now,v_now) RETURNING * INTO v_lot;
      INSERT INTO v3.mix_surplus_history(facility_id,lot_id,operation,snapshot,actor_id,command_id,occurred_at)
        VALUES(p_facility_id,v_lot.id,'finalize',jsonb_build_object('finalizationId',v_claim_id,'surplusLbs',v_surplus),p_actor_id,
          'mix-finalization:' || v_claim_id::text,v_now);
      INSERT INTO v3.mix_surplus_state(facility_id,revision,updated_by,updated_at) VALUES(p_facility_id,1,p_actor_id,v_now)
      ON CONFLICT(facility_id) DO UPDATE SET revision=v3.mix_surplus_state.revision+1,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at
      RETURNING revision INTO v_state_revision;
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION v3.consume_run_inventory_before_completion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
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
    IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Use the authorized run completion command' USING ERRCODE='42501'; END IF;
    v_overlay:=v3.get_substitution_overlay(NEW.facility_id,NEW.production_date);
    v_effective:=v3.effective_production_plan(NEW.facility_id,NEW.production_date,NEW.setup_snapshot->'productionPlan');
    INSERT INTO v3.completed_run_substitutions(facility_id,run_id,production_date,overlay_revision,overlay,effective_production_plan,applied_at)
      VALUES(NEW.facility_id,NEW.id,NEW.production_date,(v_overlay->>'revision')::bigint,v_overlay,v_effective,clock_timestamp());
    PERFORM v3.finalize_run_mixes(NEW.facility_id,NEW.id,v_actor_id);
    PERFORM v3.apply_run_inventory_consumption(NEW.facility_id,NEW.id,v_actor_id,v_effective);
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION v3.finalize_run_mixes(uuid,uuid,uuid) FROM PUBLIC;

COMMENT ON TABLE v3.mix_finalizations IS 'Retained exactly-once Mix Plan aggregate claims. Completion snapshots the recipe, original plan, actual amount, contributions, and component movements; later demand remains a separate increment.';
COMMENT ON FUNCTION v3.finalize_run_mixes(uuid,uuid,uuid) IS 'Internal completion-only Mix Plan inventory writer. Mix Plan commands never call this function or post inventory movements.';

COMMIT;
