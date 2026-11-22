BEGIN;

CREATE TABLE v3.warehouse_guidance_settings (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  expiry_soon_days integer NOT NULL DEFAULT 7 CHECK (expiry_soon_days BETWEEN 0 AND 365),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id)
);

CREATE TABLE v3.inventory_reorder_points (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  threshold numeric NOT NULL CHECK (threshold >= 0 AND threshold <= 1000000000000),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, product_id),
  FOREIGN KEY (facility_id, product_id) REFERENCES v3.products (facility_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION v3.save_warehouse_guidance_settings(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_expiry_soon_days integer, p_reorder_points jsonb, p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_revision bigint;
  v_point record;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_count integer;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_expiry_soon_days NOT BETWEEN 0 AND 365
     OR p_reorder_points IS NULL OR jsonb_typeof(p_reorder_points) <> 'array'
     OR jsonb_array_length(p_reorder_points) > 2000
     OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid warehouse guidance settings' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id,0));
  SELECT request_hash,response INTO v_existing_hash,v_response FROM v3.command_receipts
    WHERE facility_id=p_facility_id AND actor_id=p_actor_id AND command_id=p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE='22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed',true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':warehouse-guidance-settings',0));
  SELECT revision INTO v_revision FROM v3.warehouse_guidance_settings WHERE facility_id=p_facility_id FOR UPDATE;
  v_revision := COALESCE(v_revision,0);
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Warehouse guidance settings changed. Reload and retry.' USING ERRCODE='55000';
  END IF;
  IF v_revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Warehouse guidance settings revision is exhausted' USING ERRCODE='22003';
  END IF;
  FOR v_point IN SELECT value FROM jsonb_array_elements(p_reorder_points) LOOP
    IF jsonb_typeof(v_point.value) <> 'object'
       OR (v_point.value - ARRAY['productId','threshold']) <> '{}'::jsonb
       OR NOT (v_point.value ? 'productId') OR NOT (v_point.value ? 'threshold')
       OR jsonb_typeof(v_point.value->'productId') <> 'string'
       OR v_point.value->>'productId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_point.value->'threshold') <> 'string'
       OR v_point.value->>'threshold' !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
       OR (v_point.value->>'threshold')::numeric > 1000000000000 THEN
      RAISE EXCEPTION 'Invalid reorder point' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM v3.products WHERE facility_id=p_facility_id AND id=(v_point.value->>'productId')::uuid AND active)
       OR (v_point.value->>'productId')::uuid = ANY(v_seen) THEN
      RAISE EXCEPTION 'Reorder point product is unavailable or duplicated' USING ERRCODE='22023';
    END IF;
    v_seen := v_seen || (v_point.value->>'productId')::uuid;
  END LOOP;
  DELETE FROM v3.inventory_reorder_points WHERE facility_id=p_facility_id;
  FOR v_point IN SELECT value FROM jsonb_array_elements(p_reorder_points) LOOP
    IF (v_point.value->>'threshold')::numeric > 0 THEN
      INSERT INTO v3.inventory_reorder_points(facility_id,product_id,threshold,updated_by,updated_at)
      VALUES(p_facility_id,(v_point.value->>'productId')::uuid,(v_point.value->>'threshold')::numeric,p_actor_id,clock_timestamp());
    END IF;
  END LOOP;
  INSERT INTO v3.warehouse_guidance_settings(facility_id,expiry_soon_days,revision,updated_by,updated_at)
  VALUES(p_facility_id,p_expiry_soon_days,1,p_actor_id,clock_timestamp())
  ON CONFLICT(facility_id) DO UPDATE SET expiry_soon_days=EXCLUDED.expiry_soon_days,
    revision=v3.warehouse_guidance_settings.revision+1,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at
  RETURNING revision INTO v_revision;
  v_response := jsonb_build_object('outcome','saved','replayed',false,'revision',v_revision);
  INSERT INTO v3.command_receipts(facility_id,actor_id,command_id,request_hash,response,created_at)
  VALUES(p_facility_id,p_actor_id,p_request_id,p_request_hash,v_response,clock_timestamp());
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.scheduled_run_demand(
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
      product_id := NULL; product_code := NULL; product_name := NULL; unit := NULL; quantity := NULL;
      SELECT * INTO v_product FROM v3.products p WHERE p.facility_id=p_facility_id AND p.active
        AND lower(p.code)=lower(v_line.value->>'product_code');
      IF NOT FOUND THEN
        warning := 'An ingredient product in ' || v_recipe.code || ' is unavailable; its demand is unresolved.';
        resolved := false;
        RETURN NEXT;
        CONTINUE;
      END IF;
      product_id := v_product.id; product_code := v_product.code; product_name := v_product.name;
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

CREATE FUNCTION v3.inventory_quantity_text(p_value numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL WHEN strpos(round(p_value,6)::text,'.')>0
    THEN trim(trailing '.' FROM trim(trailing '0' FROM round(p_value,6)::text))
    ELSE round(p_value,6)::text END
$$;

CREATE FUNCTION v3.scheduled_effective_target(p_facility_id uuid,p_production_date date,p_run jsonb)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,v3
AS $$
  SELECT GREATEST((p_run->>'targetCases')::numeric-COALESCE((SELECT sum(a.cases)
    FROM v3.freezer_surplus_allocations a WHERE a.facility_id=p_facility_id
      AND a.production_date=p_production_date AND a.schedule_run_id=(p_run->>'id')::uuid),0),0)
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
    CROSS JOIN jsonb_array_elements(r.data->'ingredients') AS i(value)
    JOIN v3.products p ON p.facility_id = s.facility_id AND lower(p.code) = lower(i.value->>'product_code') AND p.active
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

CREATE OR REPLACE FUNCTION v3.warehouse_guidance(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_today date;
  v_soon_days integer;
  v_settings_revision bigint;
  v_cycle_counts jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_schedule record;
  v_run jsonb;
  v_items jsonb;
  v_reorder_points jsonb;
  v_reorder jsonb;
  v_use_first jsonb;
  v_needs jsonb;
  v_warnings jsonb;
  v_transfer jsonb;
  v_switchovers jsonb;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  v_today := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  SELECT COALESCE(s.expiry_soon_days,7),COALESCE(s.revision,0) INTO v_soon_days,v_settings_revision
    FROM (SELECT 1) AS scope LEFT JOIN v3.warehouse_guidance_settings s ON s.facility_id=p_facility_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'section', section, 'cadenceDays', cadence_days, 'enabled', enabled,
    'lastCountedOn', last_counted_on, 'revision', revision,
    'due', enabled AND (last_counted_on IS NULL OR v_today - last_counted_on >= cadence_days),
    'overdueDays', CASE WHEN enabled AND last_counted_on IS NOT NULL
      THEN GREATEST(v_today - last_counted_on - cadence_days, 0) ELSE NULL END
  ) ORDER BY NOT enabled, NOT (enabled AND (last_counted_on IS NULL OR v_today - last_counted_on >= cadence_days)),
    last_counted_on IS NOT NULL,
    CASE WHEN last_counted_on IS NULL THEN 0 ELSE v_today - last_counted_on - cadence_days END DESC,
    lower(section)), '[]'::jsonb)
  INTO v_cycle_counts FROM v3.cycle_count_schedules WHERE facility_id = p_facility_id;

  FOR v_schedule IN
    SELECT * FROM v3.production_schedules
    WHERE facility_id = p_facility_id AND production_date >= v_today
      AND production_date <= v_today + COALESCE((SELECT max((data->>'daysEarly')::integer) FROM v3.setup_freezer_pull_records
        WHERE facility_id = p_facility_id AND data->>'enabled' = 'true'), 0)
    ORDER BY production_date
  LOOP
    FOR v_run IN SELECT value FROM jsonb_array_elements(v_schedule.plan->'runs') LOOP
      v_items := v3.scheduled_freezer_pull_lines(p_facility_id, v_schedule.production_date, v_run, v_today);
      IF jsonb_array_length(v_items) > 0 THEN
        v_groups := v_groups || jsonb_build_array(jsonb_build_object(
          'productionDate', v_schedule.production_date, 'runId', v_run->>'id',
          'productCode', v_run->>'productCode', 'targetCases', (v_run->>'targetCases')::integer,
          'effectiveTargetCases',v3.scheduled_effective_target(p_facility_id,v_schedule.production_date,v_run),'items', v_items
        ));
      END IF;
    END LOOP;
  END LOOP;

  WITH demand AS MATERIALIZED (
    SELECT d.* FROM v3.production_schedules s
    CROSS JOIN jsonb_array_elements(s.plan->'runs') WITH ORDINALITY raw(value,ordinality)
    CROSS JOIN LATERAL v3.scheduled_run_demand(p_facility_id,s.production_date,raw.value,raw.ordinality::integer) d
    WHERE s.facility_id=p_facility_id AND s.production_date>=v_today
  ), grouped AS (
    SELECT area,product_id,min(product_code) product_code,min(product_name) product_name,
      CASE WHEN count(DISTINCT unit)=1 THEN min(unit) ELSE NULL END unit,
      CASE WHEN bool_and(resolved) AND count(DISTINCT unit)=1 THEN v3.inventory_quantity_text(sum(quantity)) ELSE NULL END quantity,
      bool_and(resolved) AND count(DISTINCT unit)=1 resolved,
      jsonb_agg(jsonb_build_object('scheduleRunId',schedule_run_id,'productionDate',production_date,
        'runLabel',run_label,'quantity',v3.inventory_quantity_text(quantity),'resolved',resolved,
        'warning',warning) ORDER BY production_date,run_label) runs
    FROM demand WHERE product_id IS NOT NULL
    GROUP BY area,product_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('area',area,'items',items) ORDER BY CASE area
    WHEN 'Dough' THEN 1 WHEN 'Sauce' THEN 2 WHEN 'Frontline' THEN 3 ELSE 4 END),'[]'::jsonb)
  INTO v_needs FROM (
    SELECT area,jsonb_agg(jsonb_build_object('productId',product_id,'productCode',product_code,
      'productName',product_name,'unit',unit,'quantity',quantity,'resolved',resolved,'runs',runs)
      ORDER BY lower(product_name),product_code) items
    FROM grouped GROUP BY area
  ) areas;
  WITH demand AS MATERIALIZED (
    SELECT d.* FROM v3.production_schedules s
    CROSS JOIN jsonb_array_elements(s.plan->'runs') WITH ORDINALITY raw(value,ordinality)
    CROSS JOIN LATERAL v3.scheduled_run_demand(p_facility_id,s.production_date,raw.value,raw.ordinality::integer) d
    WHERE s.facility_id=p_facility_id AND s.production_date>=v_today
  )
  SELECT COALESCE(jsonb_agg(DISTINCT run_label || ': ' || warning),'[]'::jsonb) INTO v_warnings
    FROM demand WHERE warning IS NOT NULL;

  WITH demand AS (
    SELECT product_id,sum(quantity) quantity FROM (
      SELECT d.* FROM v3.production_schedules s
      CROSS JOIN jsonb_array_elements(s.plan->'runs') WITH ORDINALITY raw(value,ordinality)
      CROSS JOIN LATERAL v3.scheduled_run_demand(p_facility_id,s.production_date,raw.value,raw.ordinality::integer) d
      WHERE s.facility_id=p_facility_id AND s.production_date>=v_today
    ) all_demand WHERE product_id IS NOT NULL AND resolved GROUP BY product_id
  ), stock AS (
    SELECT product_id,sum(quantity) quantity FROM v3.inventory_balances WHERE facility_id=p_facility_id GROUP BY product_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'productCode',p.code,'productName',p.name,
    'unit',p.base_unit,'onHand',v3.inventory_quantity_text(COALESCE(st.quantity,0)),
    'scheduledDemand',v3.inventory_quantity_text(COALESCE(d.quantity,0)),
    'projectedOnHand',v3.inventory_quantity_text(COALESCE(st.quantity,0)-COALESCE(d.quantity,0)),
    'threshold',v3.inventory_quantity_text(rp.threshold),
    'suggestedQuantity',v3.inventory_quantity_text(GREATEST(1,ceil(rp.threshold-(COALESCE(st.quantity,0)-COALESCE(d.quantity,0))-0.000001))))
    ORDER BY lower(p.name),p.code),'[]'::jsonb)
  INTO v_reorder FROM v3.inventory_reorder_points rp JOIN v3.products p ON p.facility_id=rp.facility_id AND p.id=rp.product_id AND p.active
  LEFT JOIN stock st ON st.product_id=p.id LEFT JOIN demand d ON d.product_id=p.id
  WHERE rp.facility_id=p_facility_id AND rp.threshold>0
    AND COALESCE(st.quantity,0)-COALESCE(d.quantity,0)<=rp.threshold+0.000001;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('lotId',l.id,'productId',p.id,'productCode',p.code,
    'productName',p.name,'unit',p.base_unit,'warehouseId',w.id,'warehouseName',w.name,'lotNumber',l.lot_number,
    'quantity',v3.inventory_quantity_text(l.quantity),'expiresOn',l.expires_on,'daysLeft',l.expires_on-v_today,
    'expired',l.expires_on<v_today,'demandedToday',COALESCE(today.product_id IS NOT NULL,false))
    ORDER BY COALESCE(today.product_id IS NOT NULL,false) DESC,l.expires_on,lower(p.name),l.received_on,l.id),'[]'::jsonb)
  INTO v_use_first FROM v3.inventory_lots l JOIN v3.products p ON p.facility_id=l.facility_id AND p.id=l.product_id
  JOIN v3.inventory_warehouses w ON w.facility_id=l.facility_id AND w.id=l.warehouse_id
  LEFT JOIN LATERAL (
    SELECT DISTINCT d.product_id FROM v3.production_schedules s
    CROSS JOIN jsonb_array_elements(s.plan->'runs') WITH ORDINALITY raw(value,ordinality)
    CROSS JOIN LATERAL v3.scheduled_run_demand(p_facility_id,s.production_date,raw.value,raw.ordinality::integer) d
    WHERE s.facility_id=p_facility_id AND s.production_date=v_today AND d.product_id=l.product_id AND d.resolved
  ) today ON true
  WHERE l.facility_id=p_facility_id AND l.quantity>0 AND l.expires_on IS NOT NULL
    AND l.expires_on<=v_today+v_soon_days;

  WITH demand AS (
    SELECT warehouse_id,product_id,min(product_code) product_code,min(product_name) product_name,
      CASE WHEN count(DISTINCT unit)=1 THEN min(unit) ELSE NULL END unit,sum(quantity) needed
    FROM (
      SELECT d.* FROM v3.production_schedules s
      CROSS JOIN jsonb_array_elements(s.plan->'runs') WITH ORDINALITY raw(value,ordinality)
      CROSS JOIN LATERAL v3.scheduled_run_demand(p_facility_id,s.production_date,raw.value,raw.ordinality::integer) d
      WHERE s.facility_id=p_facility_id AND s.production_date=v_today
    ) today
    WHERE product_id IS NOT NULL AND warehouse_id IS NOT NULL AND resolved
    GROUP BY warehouse_id,product_id
  ), stock AS (
    SELECT b.warehouse_id,b.product_id,sum(b.quantity) quantity FROM v3.inventory_balances b
    WHERE b.facility_id=p_facility_id GROUP BY b.warehouse_id,b.product_id
  ), evaluated AS (
    SELECT d.*,COALESCE(onsite.quantity,0) onsite,GREATEST(COALESCE(total_stock.quantity,0)-COALESCE(onsite.quantity,0),0) offsite,
      GREATEST(d.needed-COALESCE(onsite.quantity,0),0) shortfall
    FROM demand d LEFT JOIN stock onsite ON onsite.warehouse_id=d.warehouse_id AND onsite.product_id=d.product_id
    LEFT JOIN (
      SELECT product_id,sum(quantity) quantity FROM stock GROUP BY product_id
    ) total_stock ON total_stock.product_id=d.product_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('warehouseId',e.warehouse_id,'warehouseName',w.name,
    'productId',e.product_id,'productCode',e.product_code,'productName',e.product_name,'unit',e.unit,
    'needed',v3.inventory_quantity_text(e.needed),'onSite',v3.inventory_quantity_text(e.onsite),
    'offSite',v3.inventory_quantity_text(e.offsite),'shortfall',v3.inventory_quantity_text(e.shortfall),
    'suggestedQuantity',v3.inventory_quantity_text(LEAST(e.shortfall,e.offsite)),
    'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object('warehouseId',sw.id,'warehouseName',sw.name,
      'quantity',v3.inventory_quantity_text(sb.quantity)) ORDER BY lower(sw.name))
      FROM v3.inventory_balances sb JOIN v3.inventory_warehouses sw ON sw.facility_id=sb.facility_id AND sw.id=sb.warehouse_id
      WHERE sb.facility_id=p_facility_id AND sb.product_id=e.product_id AND sb.warehouse_id<>e.warehouse_id AND sb.quantity>0),'[]'::jsonb))
    ORDER BY lower(w.name),lower(e.product_name),e.product_code),'[]'::jsonb)
  INTO v_transfer FROM evaluated e JOIN v3.inventory_warehouses w ON w.facility_id=p_facility_id AND w.id=e.warehouse_id
  WHERE e.shortfall>0.000001 AND e.offsite>0.000001;

  WITH live AS (
    SELECT r.id,r.setup_snapshot,s.inputs,s.progress,
      GREATEST((r.setup_snapshot->>'targetCases')::numeric-COALESCE((s.progress->>'casesProduced')::numeric,0),0) press_left,
      NULLIF(s.inputs->>'casesPerSkid','')::numeric cps,
      NULLIF(s.inputs->>'autoTrackRatePerMinute','')::numeric ppm,
      NULLIF(r.setup_snapshot#>>'{dieSetup,lineSettings,pizzasPerCase}','')::numeric pizzas_per_case,
      NULLIF(r.setup_snapshot#>>'{dieSetup,lineSettings,freezerTime}','')::numeric freezer_minutes
    FROM v3.runs r JOIN v3.run_station_progress s ON s.facility_id=r.facility_id AND s.run_id=r.id AND s.station_key='line'
    WHERE r.facility_id=p_facility_id AND r.status='running'
  ), eligible AS (
    SELECT *,press_left/cps skids_left,press_left<=cps packaging_stage,
      (setup_snapshot->>'targetCases')::numeric<2*cps short_run,
      clock_timestamp()+make_interval(secs=>(press_left*pizzas_per_case/ppm*60)::double precision) press_stop_at
    FROM live WHERE cps>0 AND ppm>0 AND pizzas_per_case>0 AND freezer_minutes>=0
      AND press_left>0 AND press_left<=2*cps
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('runId',id,'runLabel',setup_snapshot->>'label',
    'pressCasesLeft',v3.inventory_quantity_text(press_left),'skidsLeft',round(skids_left,2),
    'packagingStage',packaging_stage,'shortRun',short_run,'pressStopAt',press_stop_at,
    'lineClearAt',press_stop_at+make_interval(mins=>freezer_minutes::integer,secs=>((freezer_minutes-floor(freezer_minutes))*60)::double precision),
    'nextRunLabels',COALESCE((SELECT jsonb_agg('Run ' || raw.ordinality || ' — ' || COALESCE(raw.value->>'productionSetupCode','Scheduled run') ORDER BY raw.ordinality)
      FROM (SELECT ps.plan FROM v3.production_schedules ps WHERE ps.facility_id=p_facility_id AND ps.production_date=v_today) today
      CROSS JOIN jsonb_array_elements(today.plan->'runs') WITH ORDINALITY raw(value,ordinality)
      LIMIT 2),'[]'::jsonb))
    ORDER BY press_stop_at,id),'[]'::jsonb)
  INTO v_switchovers FROM eligible;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'productCode',p.code,'productName',p.name,
    'unit',p.base_unit,'threshold',v3.inventory_quantity_text(rp.threshold)) ORDER BY lower(p.name),p.code),'[]'::jsonb)
  INTO v_reorder_points FROM v3.inventory_reorder_points rp JOIN v3.products p ON p.facility_id=rp.facility_id AND p.id=rp.product_id AND p.active
  WHERE rp.facility_id=p_facility_id;

  RETURN jsonb_build_object('factoryDate',v_today,'cycleCounts',v_cycle_counts,
    'freezerPull',jsonb_build_object('groups',v_groups),
    'settings',jsonb_build_object('expirySoonDays',v_soon_days,'revision',v_settings_revision,'reorderPoints',v_reorder_points),
    'reorder',v_reorder,'useFirst',v_use_first,
    'warehouseNeeds',jsonb_build_object('groups',COALESCE(v_needs,'[]'::jsonb),'warnings',COALESCE(v_warnings,'[]'::jsonb)),
    'transferGuidance',v_transfer,'switchovers',v_switchovers);
END
$$;

REVOKE ALL ON FUNCTION v3.save_warehouse_guidance_settings(uuid,uuid,text,text,integer,jsonb,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.scheduled_run_demand(uuid,date,jsonb,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.inventory_quantity_text(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.scheduled_effective_target(uuid,date,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.scheduled_freezer_pull_lines(uuid,date,jsonb,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.warehouse_guidance(uuid) FROM PUBLIC;
COMMIT;
