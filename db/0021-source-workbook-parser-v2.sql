-- Source parser /2 changes parsed values and review evidence.
-- Existing /1 imports remain canonical history; only new staging requires /2.

BEGIN;

CREATE OR REPLACE FUNCTION v3.stage_setup_catalog_import(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_family text, p_records jsonb, p_source_summary jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing v3.setup_catalog_imports%ROWTYPE;
  v_id uuid;
  v_row jsonb;
  v_stage_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR v3.setup_catalog_table_name(p_family) IS NULL
     OR jsonb_typeof(p_records) <> 'array'
     OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Invalid setup catalog import' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0
  ));
  SELECT * INTO v_existing FROM v3.setup_catalog_imports
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash OR v_existing.family <> p_family THEN
      RAISE EXCEPTION 'Import request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'outcome', v_existing.status, 'importId', v_existing.id, 'family', v_existing.family,
      'rowCount', jsonb_array_length(v_existing.records), 'replayed', true, 'result', v_existing.result,
      'sourceSummary', v_existing.result->'sourceSummary'
    );
  END IF;
  IF p_source_summary IS NOT NULL AND (
    v3.setup_catalog_object_size(p_source_summary) <> 7
    OR NOT (p_source_summary ?& ARRAY[
      'sourceFamily','sourceSha256','parserVersion','sourceRows',
      'importedRows','skippedRows','unresolvedRows'
    ])
    OR p_source_summary->>'sourceFamily' NOT IN (
      'spec-sheets','premix-sheets','cheese-mix-specs',
      'shipping-guides','sauce-guides','dough-guides'
    )
    OR p_source_summary->>'sourceSha256' !~ '^[0-9a-f]{64}$'
    OR p_source_summary->>'parserVersion' <> 'v1-source-import/2'
    OR jsonb_typeof(p_source_summary->'sourceRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'importedRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'skippedRows') <> 'number'
    OR jsonb_typeof(p_source_summary->'unresolvedRows') <> 'number'
    OR (p_source_summary->>'sourceRows')::numeric NOT BETWEEN 0 AND 2000
    OR (p_source_summary->>'importedRows')::numeric <> jsonb_array_length(p_records)
    OR (p_source_summary->>'skippedRows')::numeric NOT BETWEEN 0 AND 2000
    OR (p_source_summary->>'unresolvedRows')::numeric NOT BETWEEN 0 AND 2000
    OR ((p_source_summary->>'sourceRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'importedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'skippedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'unresolvedRows')::numeric % 1) <> 0
    OR ((p_source_summary->>'sourceFamily' = 'premix-sheets') <> (p_family = 'mixes'))
    OR (p_source_summary->>'sourceFamily' <> 'premix-sheets' AND p_family <> 'run-templates')
  ) THEN
    RAISE EXCEPTION 'Invalid source import summary' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    IF jsonb_typeof(v_row) <> 'object' OR v3.setup_catalog_object_size(v_row) <> 3
       OR NOT (v_row ?& ARRAY['code', 'name', 'data'])
       OR jsonb_typeof(v_row->'code') <> 'string'
       OR jsonb_typeof(v_row->'name') <> 'string'
       OR jsonb_typeof(v_row->'data') <> 'object'
       OR length(btrim(v_row->>'code')) NOT BETWEEN 1 AND 80
       OR length(btrim(v_row->>'name')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Setup catalog row has an invalid shape' USING ERRCODE = '22023';
    END IF;
    IF
      (p_family = 'ingredients' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 5
        OR NOT ((v_row->'data') ?& ARRAY['categories','allergens','allergensReviewed','mergedIntoCode','enabled'])
        OR jsonb_typeof(v_row->'data'->'categories') <> 'array'
        OR jsonb_typeof(v_row->'data'->'allergens') <> 'array'
        OR jsonb_typeof(v_row->'data'->'allergensReviewed') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'mixes' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 8
        OR NOT ((v_row->'data') ?& ARRAY['brand','flavor','batchSizeLbs','daysEarly','notes','isPrep','enabled','components'])
        OR jsonb_typeof(v_row->'data'->'components') <> 'array'
        OR jsonb_typeof(v_row->'data'->'isPrep') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'die-types' AND v3.setup_catalog_object_size(v_row->'data') <> 0)
      OR (p_family = 'die-line-defaults' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 9
        OR NOT ((v_row->'data') ?& ARRAY[
          'crusts_per_cycle','cycle_speed','speed_adjustment','freezer_time','cases_per_layer',
          'pre_tunnel_min','post_tunnel_min','press_oven_min','frontline_min'
        ])
      ))
      OR (p_family = 'production-rules' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 11
        OR NOT ((v_row->'data') ?& ARRAY[
          'type','enforcement','enabled','field','min','max','attribute','before','after','bypass','checklist'
        ])
        OR v_row->'data'->>'type' NOT IN ('required-field','numeric-range','sequence')
        OR v_row->'data'->>'enforcement' NOT IN ('flexible','strict')
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
        OR jsonb_typeof(v_row->'data'->'bypass') <> 'array'
        OR jsonb_typeof(v_row->'data'->'checklist') <> 'array'
      ))
      OR (p_family = 'freezer-pull-items' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 4
        OR NOT ((v_row->'data') ?& ARRAY['ingredientName','ingredientCode','daysEarly','enabled'])
        OR jsonb_typeof(v_row->'data'->'ingredientName') <> 'string'
        OR jsonb_typeof(v_row->'data'->'daysEarly') <> 'number'
        OR jsonb_typeof(v_row->'data'->'enabled') <> 'boolean'
      ))
      OR (p_family = 'run-templates' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 3
        OR NOT ((v_row->'data') ?& ARRAY['brand','flavor','values'])
        OR jsonb_typeof(v_row->'data'->'values') <> 'object'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(v_row->'data'->'values') AS field(key)
          WHERE field.key <> ALL (ARRAY[
            'crustsPerCycle','cycleSpeed','speedAdjustment','approxLineSpeed','freezerTime','pizzasPerCase',
            'casesPerSkid','casesPerLayer','doughballsPerTray','crustsPerStack','doughBatchYield','crustsPerCase',
            'mixerLowSec','mixerHighSec','hopperSec','sauceOzPerPizza','sauceBarrelLbs',
            'app1OzPerPizza','app1BatchLbs','app2OzPerPizza','app2BatchLbs','app3OzPerPizza','app3BatchLbs',
            'app4OzPerPizza','app4BatchLbs','pep1Sticks','pep1OzPerPizza','pep1BatchLbs','pep2Sticks',
            'pep2OzPerPizza','pep2BatchLbs','pep1SticksB','pep1OzPerPizzaB','pep1BatchLbsB',
            'pep2SticksB','pep2OzPerPizzaB','pep2BatchLbsB','pep1Combined','app1Type','app2Type','app3Type',
            'app4Type','pep1Type','pep2Type','pep1TypeB','pep2TypeB','dieType','allergen','doughRecipeName',
            'targetDoughballWeight','doughRecipe','app1CheeseRecipeName','app1CheeseRecipe',
            'app2CheeseRecipeName','app2CheeseRecipe','app3CheeseRecipeName','app3CheeseRecipe',
            'app4CheeseRecipeName','app4CheeseRecipe','frontlineRecipeName','frontlineRecipe','cartoned',
            'labelPosition','cartonsPerCase','cartonSize','labelsPerRoll','topLabelsPerRoll',
            'bottomLabelsPerRoll','circles','shipper','skidStacking','gripSheets','slipSheets',
            'preTunnelMin','pressOvenMin','frontlineMin','postTunnelMin'
          ])
        )
      ))
      OR (p_family = 'manager-lists' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 2
        OR NOT ((v_row->'data') ?& ARRAY['key','value'])
        OR v_row->'data'->>'key' <> v_row->>'code'
        OR v_row->>'code' <> ALL (ARRAY[
          'run-calc-brands','run-calc-brand-flavors','run-calc-flavors','run-calc-ingredient-types','run-calc-pep-types',
          'run-calc-die-types','run-calc-cheese-ingredients','run-calc-dough-ingredients',
          'run-calc-frontline-ingredients','run-calc-mix-ingredients','run-calc-dough-recipe-names',
          'run-calc-dough-recipe-presets','run-calc-frontline-recipe-names','run-calc-frontline-recipe-presets',
          'run-calc-cheese-recipe-names','run-calc-cheese-recipe-presets','run-calc-mix-recipe-names',
          'run-calc-stop-reasons','run-calc-circles','run-calc-shippers','run-calc-skid-stacking',
          'run-calc-grip-sheets','run-calc-shift-start-time','run-calc-production-start-time'
        ])
      ))
      OR (p_family = 'aliases' AND (
        v3.setup_catalog_object_size(v_row->'data') <> 6
        OR NOT ((v_row->'data') ?& ARRAY['aliasType','kind','externalName','canonicalName','context','brand'])
        OR v_row->'data'->>'aliasType' NOT IN ('spec','merge')
        OR jsonb_typeof(v_row->'data'->'externalName') <> 'string'
        OR jsonb_typeof(v_row->'data'->'canonicalName') <> 'string'
      ))
    THEN
      RAISE EXCEPTION 'Setup catalog data is outside the approved family field map' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT lower(value->>'code')) FROM jsonb_array_elements(p_records))
     <> jsonb_array_length(p_records) THEN
    RAISE EXCEPTION 'Import contains duplicate codes' USING ERRCODE = '22023';
  END IF;
  v_stage_result := CASE WHEN p_source_summary IS NULL THEN NULL
    ELSE jsonb_build_object('sourceSummary', p_source_summary) END;
  INSERT INTO v3.setup_catalog_imports(
    facility_id, actor_id, request_id, request_hash, family, records, result
  )
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, p_family, p_records, v_stage_result)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'outcome', 'staged', 'importId', v_id, 'family', p_family,
    'rowCount', jsonb_array_length(p_records), 'replayed', false,
    'sourceSummary', p_source_summary
  );
END
$$;

COMMIT;
