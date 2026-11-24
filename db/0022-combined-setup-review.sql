-- Canonical source citations and immutable revisions support combined setup review.
-- Combined reviews coordinate existing imports; they never write setup targets.

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
      'rowCount', jsonb_array_length(v_existing.records), 'revision', v_existing.revision,
      'replayed', true, 'result', v_existing.result,
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
    IF jsonb_typeof(v_row) <> 'object'
       OR v3.setup_catalog_object_size(v_row) <> (CASE WHEN p_source_summary IS NULL THEN 3 ELSE 5 END)
       OR NOT (v_row ?& ARRAY['code', 'name', 'data'])
       OR (p_source_summary IS NOT NULL AND (
         NOT (v_row ?& ARRAY['source', 'sourceDetails'])
         OR jsonb_typeof(v_row->'source') <> 'object'
         OR v3.setup_catalog_object_size(v_row->'source') <> 2
         OR NOT ((v_row->'source') ?& ARRAY['workbook', 'cell'])
         OR jsonb_typeof(v_row->'source'->'workbook') <> 'string'
         OR jsonb_typeof(v_row->'source'->'cell') <> 'string'
         OR length(btrim(v_row->'source'->>'workbook')) NOT BETWEEN 1 AND 180
         OR length(btrim(v_row->'source'->>'cell')) NOT BETWEEN 1 AND 240
         OR jsonb_typeof(v_row->'sourceDetails') NOT IN ('object', 'null')
       ))
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
    'rowCount', jsonb_array_length(p_records), 'revision', 1, 'replayed', false,
    'sourceSummary', p_source_summary
  );
END
$$;


ALTER TABLE v3.setup_catalog_imports
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision = 1);

CREATE OR REPLACE FUNCTION v3.list_setup_catalog_imports(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF p_facility_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid setup catalog scope' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid setup catalog list request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'revision', revision, 'family', family, 'status', status,
      'rowCount', jsonb_array_length(records),
      'createdBy', actor_id, 'createdAt', created_at, 'appliedAt', applied_at, 'undoneAt', undone_at,
      'sourceSummary', result->'sourceSummary',
      'createdCount', (result->>'createdCount')::integer,
      'updatedCount', (result->>'updatedCount')::integer
    ) ORDER BY created_at DESC, id DESC)
    FROM (
      SELECT id, revision, family, status, records, result, actor_id, created_at, applied_at, undone_at
      FROM v3.setup_catalog_imports WHERE facility_id = p_facility_id
      ORDER BY created_at DESC, id DESC LIMIT p_limit
    ) recent
  ), '[]'::jsonb);
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
    'id', v_import.id, 'revision', v_import.revision,
    'family', v_import.family, 'status', v_import.status,
    'records', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', item.value->>'code', 'name', item.value->>'name', 'data', item.value->'data'
      ) ORDER BY item.ordinality)
      FROM jsonb_array_elements(v_import.records) WITH ORDINALITY AS item(value, ordinality)
    ), '[]'::jsonb),
    'sourceRecords', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', item.value->>'code', 'source', item.value->'source',
        'sourceDetails', item.value->'sourceDetails'
      ) ORDER BY item.ordinality)
      FROM jsonb_array_elements(v_import.records) WITH ORDINALITY AS item(value, ordinality)
      WHERE item.value ? 'source'
    ), '[]'::jsonb),
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

CREATE TABLE v3.combined_setup_reviews (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id)
);

CREATE TABLE v3.combined_setup_review_imports (
  facility_id uuid NOT NULL,
  review_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 100),
  import_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision = 1),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text NOT NULL CHECK (parser_version IN ('v1-source-import/1', 'v1-source-import/2')),
  PRIMARY KEY (facility_id, review_id, import_id),
  UNIQUE (facility_id, review_id, position),
  FOREIGN KEY (facility_id, review_id)
    REFERENCES v3.combined_setup_reviews (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, import_id)
    REFERENCES v3.setup_catalog_imports (facility_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION v3.get_combined_setup_review(p_facility_id uuid, p_review_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_review v3.combined_setup_reviews%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_review_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid combined setup review scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_review FROM v3.combined_setup_reviews
  WHERE facility_id = p_facility_id AND id = p_review_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1
    FROM v3.combined_setup_review_imports AS pin
    JOIN v3.setup_catalog_imports AS item
      ON item.facility_id = pin.facility_id AND item.id = pin.import_id
    WHERE pin.facility_id = p_facility_id AND pin.review_id = p_review_id
      AND (item.revision <> pin.revision
        OR item.result->'sourceSummary'->>'sourceSha256' <> pin.source_sha256
        OR item.result->'sourceSummary'->>'parserVersion' <> pin.parser_version)
  ) THEN
    RAISE EXCEPTION 'A combined review source revision changed; create a fresh review' USING ERRCODE = '40001';
  END IF;
  RETURN jsonb_build_object(
    'id', v_review.id, 'createdBy', v_review.actor_id, 'createdAt', v_review.created_at,
    'imports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'importId', item.id, 'revision', item.revision, 'family', item.family,
        'status', item.status, 'sourceSummary', item.result->'sourceSummary',
        'records', item.records
      ) ORDER BY pin.position)
      FROM v3.combined_setup_review_imports AS pin
      JOIN v3.setup_catalog_imports AS item
        ON item.facility_id = pin.facility_id AND item.id = pin.import_id
      WHERE pin.facility_id = p_facility_id AND pin.review_id = p_review_id
    ), '[]'::jsonb),
    'currentRecords', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'family', current.family, 'code', current.code, 'name', current.name,
        'data', current.data, 'sourceImportId', current.source_import_id,
        'fingerprint', v3.setup_catalog_record_fingerprint(jsonb_build_object(
          'code', current.code, 'name', current.name, 'data', current.data
        )),
        'updatedAt', current.updated_at
      ) ORDER BY current.family, lower(current.code), current.code)
      FROM (
        SELECT 'run-templates'::text AS family, target.code, target.name, target.data,
          target.source_import_id, target.updated_at
        FROM v3.setup_run_template_records AS target
        WHERE target.facility_id = p_facility_id AND EXISTS (
          SELECT 1
          FROM v3.combined_setup_review_imports AS pin
          JOIN v3.setup_catalog_imports AS item
            ON item.facility_id = pin.facility_id AND item.id = pin.import_id
          CROSS JOIN LATERAL jsonb_array_elements(item.records) AS proposed(value)
          WHERE pin.facility_id = p_facility_id AND pin.review_id = p_review_id
            AND item.family = 'run-templates'
            AND lower(proposed.value->>'code') = lower(target.code)
        )
        UNION ALL
        SELECT 'mixes'::text AS family, target.code, target.name, target.data,
          target.source_import_id, target.updated_at
        FROM v3.setup_mix_records AS target
        WHERE target.facility_id = p_facility_id
      ) AS current
    ), '[]'::jsonb)
  );
END
$$;

CREATE FUNCTION v3.create_combined_setup_review(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text, p_import_ids jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing v3.combined_setup_reviews%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_import_ids) <> 'array'
     OR jsonb_array_length(p_import_ids) NOT BETWEEN 1 AND 100
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_import_ids))
        <> jsonb_array_length(p_import_ids)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(p_import_ids) AS requested(value)
       WHERE value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ) THEN
    RAISE EXCEPTION 'Invalid combined setup review request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0
  ));
  SELECT * INTO v_existing FROM v3.combined_setup_reviews
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Combined review request ID was reused with different imports' USING ERRCODE = '22023';
    END IF;
    RETURN v3.get_combined_setup_review(p_facility_id, v_existing.id) || jsonb_build_object('replayed', true);
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements_text(p_import_ids) AS requested(value)
      JOIN v3.setup_catalog_imports AS item
        ON item.facility_id = p_facility_id AND item.id = requested.value::uuid
       AND item.status <> 'undone' AND item.result->'sourceSummary' IS NOT NULL)
     <> jsonb_array_length(p_import_ids) THEN
    RAISE EXCEPTION 'Every combined review input must be an active canonical source import' USING ERRCODE = '22023';
  END IF;
  IF (SELECT sum(jsonb_array_length(item.records))
      FROM jsonb_array_elements_text(p_import_ids) AS requested(value)
      JOIN v3.setup_catalog_imports AS item
        ON item.facility_id = p_facility_id AND item.id = requested.value::uuid) > 2000 THEN
    RAISE EXCEPTION 'A combined review may contain at most 2,000 records' USING ERRCODE = '22023';
  END IF;
  INSERT INTO v3.combined_setup_reviews(facility_id, actor_id, request_id, request_hash)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash)
  RETURNING id INTO v_id;
  INSERT INTO v3.combined_setup_review_imports(
    facility_id, review_id, position, import_id, revision, source_sha256, parser_version
  )
  SELECT p_facility_id, v_id,
    row_number() OVER (ORDER BY
      CASE item.result->'sourceSummary'->>'sourceFamily'
        WHEN 'spec-sheets' THEN 1 WHEN 'dough-guides' THEN 2 WHEN 'sauce-guides' THEN 3
        WHEN 'premix-sheets' THEN 4 WHEN 'cheese-mix-specs' THEN 5 WHEN 'shipping-guides' THEN 6
      END, item.id),
    item.id, item.revision, item.result->'sourceSummary'->>'sourceSha256',
    item.result->'sourceSummary'->>'parserVersion'
  FROM jsonb_array_elements_text(p_import_ids) AS requested(value)
  JOIN v3.setup_catalog_imports AS item
    ON item.facility_id = p_facility_id AND item.id = requested.value::uuid;
  RETURN v3.get_combined_setup_review(p_facility_id, v_id) || jsonb_build_object('replayed', false);
END
$$;

CREATE FUNCTION v3.list_combined_setup_reviews(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  IF p_facility_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid combined setup review scope' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid combined setup review list request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', review.id, 'createdBy', review.actor_id, 'createdAt', review.created_at,
      'importCount', pins.import_count, 'recordCount', pins.record_count
    ) ORDER BY review.created_at DESC, review.id DESC)
    FROM (
      SELECT id, actor_id, created_at FROM v3.combined_setup_reviews
      WHERE facility_id = p_facility_id ORDER BY created_at DESC, id DESC LIMIT p_limit
    ) AS review
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS import_count, COALESCE(sum(jsonb_array_length(item.records)), 0)::integer AS record_count
      FROM v3.combined_setup_review_imports AS pin
      JOIN v3.setup_catalog_imports AS item
        ON item.facility_id = pin.facility_id AND item.id = pin.import_id
      WHERE pin.facility_id = p_facility_id AND pin.review_id = review.id
    ) AS pins
  ), '[]'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION v3.stage_setup_catalog_import(uuid, uuid, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_setup_catalog_imports(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_setup_catalog_import(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.get_combined_setup_review(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.create_combined_setup_review(uuid, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_combined_setup_reviews(uuid, integer) FROM PUBLIC;

COMMENT ON TABLE v3.combined_setup_reviews IS
  'Server-owned coordination sessions over canonical source imports; no setup target writes.';
COMMENT ON TABLE v3.combined_setup_review_imports IS
  'Immutable import ID, content revision, source hash, and parser pins for a combined review.';

COMMIT;
