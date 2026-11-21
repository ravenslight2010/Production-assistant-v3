BEGIN;

CREATE TABLE v3.cycle_count_schedules (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  section text NOT NULL CHECK (btrim(section) = section AND length(section) BETWEEN 1 AND 120
    AND section !~ '[[:cntrl:]]'),
  cadence_days integer NOT NULL DEFAULT 7 CHECK (cadence_days BETWEEN 1 AND 365),
  enabled boolean NOT NULL DEFAULT true,
  last_counted_on date,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, section)
);
CREATE UNIQUE INDEX cycle_count_schedules_section_folded ON v3.cycle_count_schedules(facility_id, lower(section));

CREATE TABLE v3.cycle_count_confirmations (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  section text NOT NULL,
  counted_on date NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, section) REFERENCES v3.cycle_count_schedules (facility_id, section) ON DELETE RESTRICT
);
CREATE INDEX cycle_count_confirmations_section ON v3.cycle_count_confirmations(facility_id, section, counted_on DESC, created_at DESC);

CREATE TRIGGER cycle_count_confirmations_append_only
BEFORE UPDATE OR DELETE ON v3.cycle_count_confirmations
FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE FUNCTION v3.save_cycle_count_schedule(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_section text, p_cadence_days integer, p_enabled boolean, p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_schedule v3.cycle_count_schedules%ROWTYPE;
  v_outcome text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_section IS NULL
     OR btrim(p_section) <> p_section OR length(p_section) NOT BETWEEN 1 AND 120
     OR p_section ~ '[[:cntrl:]]' OR p_cadence_days NOT BETWEEN 1 AND 365
     OR p_enabled IS NULL OR p_expected_revision IS NULL
     OR p_expected_revision NOT BETWEEN 0 AND 9007199254740991
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid cycle count schedule request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT request_hash, response INTO v_existing_hash, v_response
    FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':cycle-count:' || lower(p_section), 0));
  SELECT * INTO v_schedule FROM v3.cycle_count_schedules
    WHERE facility_id = p_facility_id AND lower(section) = lower(p_section) FOR UPDATE;
  IF NOT FOUND AND p_expected_revision <> 0 THEN
    RAISE EXCEPTION 'The cycle count schedule changed. Reload and retry.' USING ERRCODE = '55000';
  END IF;
  IF FOUND AND (v_schedule.revision <> p_expected_revision OR v_schedule.section <> p_section) THEN
    RAISE EXCEPTION 'The cycle count schedule changed. Reload and retry.' USING ERRCODE = '55000';
  END IF;
  IF FOUND AND v_schedule.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Cycle count schedule revision is exhausted' USING ERRCODE = '22003';
  END IF;
  v_outcome := CASE WHEN NOT FOUND THEN 'created' WHEN p_enabled AND NOT v_schedule.enabled THEN 're-enabled'
    WHEN NOT p_enabled AND v_schedule.enabled THEN 'retired' ELSE 'updated' END;
  INSERT INTO v3.cycle_count_schedules (
    facility_id, section, cadence_days, enabled, revision, updated_by, updated_at
  ) VALUES (
    p_facility_id, p_section, p_cadence_days, p_enabled, 1, p_actor_id, clock_timestamp()
  )
  ON CONFLICT (facility_id, section) DO UPDATE SET
    cadence_days = EXCLUDED.cadence_days, enabled = EXCLUDED.enabled,
    revision = v3.cycle_count_schedules.revision + 1,
    updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_schedule;
  v_response := jsonb_build_object(
    'outcome', v_outcome, 'replayed', false,
    'schedule', jsonb_build_object(
      'section', v_schedule.section, 'cadenceDays', v_schedule.cadence_days,
      'enabled', v_schedule.enabled, 'lastCountedOn', v_schedule.last_counted_on,
      'revision', v_schedule.revision,
      'due', v_schedule.enabled AND (v_schedule.last_counted_on IS NULL
        OR (clock_timestamp() AT TIME ZONE 'America/Chicago')::date - v_schedule.last_counted_on >= v_schedule.cadence_days),
      'overdueDays', CASE WHEN v_schedule.enabled AND v_schedule.last_counted_on IS NOT NULL
        THEN GREATEST((clock_timestamp() AT TIME ZONE 'America/Chicago')::date - v_schedule.last_counted_on - v_schedule.cadence_days, 0)
        ELSE NULL END
    )
  );
  INSERT INTO v3.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, clock_timestamp());
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.mark_cycle_counted(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text, p_section text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_schedule v3.cycle_count_schedules%ROWTYPE;
  v_counted_on date;
  v_confirmation_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_section IS NULL
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid cycle count confirmation' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT request_hash, response INTO v_existing_hash, v_response
    FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  SELECT * INTO v_schedule FROM v3.cycle_count_schedules
    WHERE facility_id = p_facility_id AND section = p_section AND enabled FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The cycle count section is not enabled' USING ERRCODE = '55000';
  END IF;
  IF v_schedule.revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Cycle count schedule revision is exhausted' USING ERRCODE = '22003';
  END IF;
  v_counted_on := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  v_confirmation_id := gen_random_uuid();
  INSERT INTO v3.cycle_count_confirmations (facility_id, id, section, counted_on, actor_id)
  VALUES (p_facility_id, v_confirmation_id, v_schedule.section, v_counted_on, p_actor_id);
  UPDATE v3.cycle_count_schedules SET last_counted_on = v_counted_on,
    revision = revision + 1, updated_by = p_actor_id, updated_at = clock_timestamp()
    WHERE facility_id = p_facility_id AND section = v_schedule.section;
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'confirmationId', v_confirmation_id,
    'section', v_schedule.section, 'countedOn', v_counted_on
  );
  INSERT INTO v3.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, clock_timestamp());
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.scheduled_station_quantity(p_station_key text, p_target_cases numeric, p_template jsonb)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_crusts numeric;
  v_yield numeric;
  v_ounces numeric;
  v_batch_lbs numeric;
BEGIN
  IF p_target_cases IS NULL OR p_target_cases <= 0 OR jsonb_typeof(p_template) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  IF p_template->>'crustsPerCase' !~ '^[0-9]+(?:\.[0-9]+)?$' THEN RETURN NULL; END IF;
  v_crusts := (p_template->>'crustsPerCase')::numeric;
  IF v_crusts <= 0 THEN RETURN NULL; END IF;
  IF p_station_key = 'dough' THEN
    IF p_template->>'doughBatchYield' !~ '^[0-9]+(?:\.[0-9]+)?$' THEN RETURN NULL; END IF;
    v_yield := (p_template->>'doughBatchYield')::numeric;
    RETURN CASE WHEN v_yield > 0 THEN ceil(p_target_cases * v_crusts / v_yield) ELSE NULL END;
  END IF;
  IF p_station_key = 'sauce' THEN
    IF p_template->>'sauceOzPerPizza' !~ '^[0-9]+(?:\.[0-9]+)?$'
       OR p_template->>'sauceBarrelLbs' !~ '^[0-9]+(?:\.[0-9]+)?$' THEN RETURN NULL; END IF;
    v_ounces := (p_template->>'sauceOzPerPizza')::numeric;
    v_batch_lbs := (p_template->>'sauceBarrelLbs')::numeric;
    RETURN CASE WHEN v_batch_lbs > 0 THEN ceil(p_target_cases * v_crusts * v_ounces / (v_batch_lbs * 16)) ELSE NULL END;
  END IF;
  IF p_station_key ~ '^app[1-4]$' THEN
    v_ounces := CASE WHEN p_template->>(p_station_key || 'OzPerPizza') ~ '^[0-9]+(?:\.[0-9]+)?$'
      THEN (p_template->>(p_station_key || 'OzPerPizza'))::numeric ELSE NULL END;
    v_batch_lbs := CASE WHEN p_template->>(p_station_key || 'BatchLbs') ~ '^[0-9]+(?:\.[0-9]+)?$'
      THEN (p_template->>(p_station_key || 'BatchLbs'))::numeric ELSE NULL END;
    RETURN CASE WHEN v_batch_lbs > 0 THEN ceil(p_target_cases * v_crusts * v_ounces / (v_batch_lbs * 16)) ELSE NULL END;
  END IF;
  IF p_station_key ~ '^pep[12]$' THEN
    v_ounces := CASE WHEN p_template->>(p_station_key || 'OzPerPizza') ~ '^[0-9]+(?:\.[0-9]+)?$'
      THEN (p_template->>(p_station_key || 'OzPerPizza'))::numeric ELSE NULL END;
    v_batch_lbs := CASE WHEN p_template->>(p_station_key || 'BatchLbs') ~ '^[0-9]+(?:\.[0-9]+)?$'
      THEN (p_template->>(p_station_key || 'BatchLbs'))::numeric ELSE NULL END;
    RETURN CASE WHEN v_batch_lbs > 0 THEN ceil(p_target_cases * v_crusts * v_ounces / (v_batch_lbs * 16)) ELSE NULL END;
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION v3.scheduled_freezer_pull_lines(
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
        r.data->>'station_key', (p_run->>'targetCases')::numeric, COALESCE(t.data->'values', '{}'::jsonb)
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
      (line.value->>'quantity')::numeric * (p_run->>'targetCases')::numeric
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
        THEN CASE WHEN strpos(sum(quantity)::text, '.') > 0
          THEN trim(trailing '.' from trim(trailing '0' from sum(quantity)::text))
          ELSE sum(quantity)::text END ELSE NULL END AS quantity,
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

CREATE FUNCTION v3.warehouse_guidance(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_today date;
  v_cycle_counts jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_schedule record;
  v_run jsonb;
  v_items jsonb;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  v_today := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
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
          'productCode', v_run->>'productCode', 'targetCases', v_run->>'targetCases', 'items', v_items
        ));
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('factoryDate', v_today, 'cycleCounts', v_cycle_counts,
    'freezerPull', jsonb_build_object('groups', v_groups));
END
$$;

REVOKE ALL ON FUNCTION v3.save_cycle_count_schedule(uuid, uuid, text, text, text, integer, boolean, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.mark_cycle_counted(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.scheduled_station_quantity(text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.scheduled_freezer_pull_lines(uuid, date, jsonb, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.warehouse_guidance(uuid) FROM PUBLIC;

COMMIT;
