BEGIN;

CREATE TABLE v3.freezer_surplus_lots (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_code text NOT NULL,
  production_date date NOT NULL,
  total_cases integer NOT NULL CHECK (total_cases BETWEEN 1 AND 1000000),
  remaining_cases integer NOT NULL CHECK (remaining_cases BETWEEN 0 AND 1000000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, product_code) REFERENCES v3.products (facility_id, code) ON DELETE RESTRICT,
  CHECK (remaining_cases <= total_cases)
);

CREATE TABLE v3.freezer_surplus_confirmations (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('none','stored')),
  lot_id uuid,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, run_id),
  FOREIGN KEY (facility_id, run_id) REFERENCES v3.runs (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, lot_id) REFERENCES v3.freezer_surplus_lots (facility_id, id) ON DELETE RESTRICT,
  CHECK ((decision = 'none') = (lot_id IS NULL))
);

CREATE TABLE v3.freezer_surplus_allocations (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL,
  production_date date NOT NULL,
  schedule_run_id uuid NOT NULL,
  cases integer NOT NULL CHECK (cases BETWEEN 1 AND 1000000),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, lot_id) REFERENCES v3.freezer_surplus_lots (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v3.freezer_surplus_events (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('receipt','allocation','damage','return','correction')),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL,
  corrects_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, lot_id) REFERENCES v3.freezer_surplus_lots (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, corrects_event_id) REFERENCES v3.freezer_surplus_events (facility_id, id) ON DELETE RESTRICT
);
CREATE INDEX freezer_surplus_events_lot ON v3.freezer_surplus_events(facility_id, lot_id, created_at DESC);

CREATE TRIGGER freezer_surplus_confirmations_append_only BEFORE UPDATE OR DELETE ON v3.freezer_surplus_confirmations
FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();
CREATE TRIGGER freezer_surplus_allocations_append_only BEFORE UPDATE OR DELETE ON v3.freezer_surplus_allocations
FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();
CREATE TRIGGER freezer_surplus_events_append_only BEFORE UPDATE OR DELETE ON v3.freezer_surplus_events
FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE FUNCTION v3.confirm_freezer_surplus(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_run_id uuid, p_cases integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_run v3.runs%ROWTYPE;
  v_lot_id uuid;
  v_decision text;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR p_cases IS NULL OR p_cases NOT BETWEEN 0 AND 1000000
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid freezer surplus confirmation' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT request_hash, response INTO v_existing_hash, v_response FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':surplus-run:' || p_run_id::text, 0));
  SELECT * INTO v_run FROM v3.runs WHERE facility_id = p_facility_id AND id = p_run_id AND status = 'completed' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a completed run can confirm freezer surplus' USING ERRCODE = '55000'; END IF;
  IF EXISTS (SELECT 1 FROM v3.freezer_surplus_confirmations WHERE facility_id = p_facility_id AND run_id = p_run_id) THEN
    RAISE EXCEPTION 'This completed run already has an immutable surplus decision' USING ERRCODE = '55000';
  END IF;
  v_decision := CASE WHEN p_cases = 0 THEN 'none' ELSE 'stored' END;
  IF p_cases > 0 THEN
    v_lot_id := gen_random_uuid();
    INSERT INTO v3.freezer_surplus_lots(facility_id, id, product_code, production_date, total_cases, remaining_cases, created_by)
    VALUES (p_facility_id, v_lot_id, v_run.setup_snapshot->>'productCode',
      (v_run.completed_at AT TIME ZONE 'America/Chicago')::date, p_cases, p_cases, p_actor_id);
    INSERT INTO v3.freezer_surplus_events(facility_id, lot_id, event_type, quantity_delta, reason, actor_id)
    VALUES (p_facility_id, v_lot_id, 'receipt', p_cases, 'Completed-run freezer surplus receipt', p_actor_id);
  END IF;
  INSERT INTO v3.freezer_surplus_confirmations(facility_id, run_id, decision, lot_id, actor_id)
  VALUES (p_facility_id, p_run_id, v_decision, v_lot_id, p_actor_id);
  v_response := jsonb_build_object('outcome','accepted','replayed',false,'runId',p_run_id,
    'decision',v_decision,'lotId',v_lot_id,'cases',p_cases);
  INSERT INTO v3.command_receipts(facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, clock_timestamp());
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.allocate_freezer_surplus(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_lot_id uuid, p_production_date date, p_schedule_run_id uuid, p_cases integer, p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_lot v3.freezer_surplus_lots%ROWTYPE;
  v_run jsonb;
  v_allocated integer;
  v_allocation_id uuid := gen_random_uuid();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_lot_id IS NULL OR p_production_date IS NULL
     OR p_schedule_run_id IS NULL OR p_cases IS NULL OR p_cases NOT BETWEEN 1 AND 1000000
     OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9007199254740991
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid freezer surplus allocation' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT request_hash, response INTO v_existing_hash, v_response FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':surplus-schedule:' || p_production_date::text || ':' || p_schedule_run_id::text, 0));
  SELECT * INTO v_lot FROM v3.freezer_surplus_lots WHERE facility_id = p_facility_id AND id = p_lot_id FOR UPDATE;
  IF NOT FOUND OR v_lot.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'The freezer surplus lot changed. Reload and retry.' USING ERRCODE = '55000';
  END IF;
  IF v_lot.revision = 9007199254740991 THEN RAISE EXCEPTION 'Surplus lot revision is exhausted' USING ERRCODE = '22003'; END IF;
  SELECT run INTO v_run FROM v3.production_schedules s CROSS JOIN jsonb_array_elements(s.plan->'runs') run
    WHERE s.facility_id = p_facility_id AND s.production_date = p_production_date
      AND run->>'id' = p_schedule_run_id::text AND run->>'productCode' = v_lot.product_code;
  IF v_run IS NULL THEN RAISE EXCEPTION 'The scheduled run does not match this surplus product' USING ERRCODE = '55000'; END IF;
  SELECT COALESCE(sum(cases),0) INTO v_allocated FROM v3.freezer_surplus_allocations
    WHERE facility_id = p_facility_id AND production_date = p_production_date AND schedule_run_id = p_schedule_run_id;
  IF p_cases > v_lot.remaining_cases OR v_allocated + p_cases > (v_run->>'targetCases')::integer THEN
    RAISE EXCEPTION 'Allocation exceeds available surplus or the scheduled target' USING ERRCODE = '55000';
  END IF;
  UPDATE v3.freezer_surplus_lots SET remaining_cases = remaining_cases - p_cases, revision = revision + 1
    WHERE facility_id = p_facility_id AND id = p_lot_id;
  INSERT INTO v3.freezer_surplus_allocations(facility_id, id, lot_id, production_date, schedule_run_id, cases, actor_id)
  VALUES (p_facility_id, v_allocation_id, p_lot_id, p_production_date, p_schedule_run_id, p_cases, p_actor_id);
  INSERT INTO v3.freezer_surplus_events(facility_id, lot_id, event_type, quantity_delta, reason, actor_id)
  VALUES (p_facility_id, p_lot_id, 'allocation', -p_cases, 'Scheduled run carry-in allocation', p_actor_id);
  v_response := jsonb_build_object('outcome','accepted','replayed',false,'allocationId',v_allocation_id,
    'lotId',p_lot_id,'remainingCases',v_lot.remaining_cases-p_cases,'revision',v_lot.revision+1,
    'carriedInCases',v_allocated+p_cases,'effectiveTargetCases',GREATEST((v_run->>'targetCases')::integer-v_allocated-p_cases,0));
  INSERT INTO v3.command_receipts(facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, clock_timestamp());
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.adjust_freezer_surplus(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_lot_id uuid, p_event_type text, p_cases integer, p_reason text, p_expected_revision bigint, p_corrects_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_lot v3.freezer_surplus_lots%ROWTYPE;
  v_delta integer;
  v_event_id uuid := gen_random_uuid();
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_lot_id IS NULL
     OR p_event_type NOT IN ('damage','return','correction') OR p_cases IS NULL OR p_cases = 0 OR abs(p_cases) > 1000000
     OR (p_event_type IN ('damage','return') AND p_cases <= 0)
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500
     OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9007199254740991
     OR (p_event_type = 'correction' AND p_corrects_event_id IS NULL)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid freezer surplus adjustment' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT request_hash, response INTO v_existing_hash, v_response FROM v3.command_receipts
    WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_request_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN RAISE EXCEPTION 'Request ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  SELECT * INTO v_lot FROM v3.freezer_surplus_lots WHERE facility_id = p_facility_id AND id = p_lot_id FOR UPDATE;
  IF NOT FOUND OR v_lot.revision <> p_expected_revision THEN RAISE EXCEPTION 'The freezer surplus lot changed. Reload and retry.' USING ERRCODE = '55000'; END IF;
  IF v_lot.revision = 9007199254740991 THEN RAISE EXCEPTION 'Surplus lot revision is exhausted' USING ERRCODE = '22003'; END IF;
  IF p_corrects_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM v3.freezer_surplus_events
    WHERE facility_id = p_facility_id AND id = p_corrects_event_id AND lot_id = p_lot_id) THEN
    RAISE EXCEPTION 'The corrected event does not belong to this lot' USING ERRCODE = '22023';
  END IF;
  v_delta := CASE p_event_type WHEN 'damage' THEN -p_cases WHEN 'return' THEN p_cases ELSE p_cases END;
  IF v_lot.remaining_cases + v_delta NOT BETWEEN 0 AND v_lot.total_cases THEN
    RAISE EXCEPTION 'Adjustment exceeds physically available or original surplus cases' USING ERRCODE = '55000';
  END IF;
  UPDATE v3.freezer_surplus_lots SET remaining_cases = remaining_cases + v_delta, revision = revision + 1
    WHERE facility_id = p_facility_id AND id = p_lot_id;
  INSERT INTO v3.freezer_surplus_events(facility_id, id, lot_id, event_type, quantity_delta, reason, actor_id, corrects_event_id)
  VALUES (p_facility_id, v_event_id, p_lot_id, p_event_type, v_delta, btrim(p_reason), p_actor_id, p_corrects_event_id);
  v_response := jsonb_build_object('outcome','accepted','replayed',false,'eventId',v_event_id,'lotId',p_lot_id,
    'remainingCases',v_lot.remaining_cases+v_delta,'revision',v_lot.revision+1);
  INSERT INTO v3.command_receipts(facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_request_id, p_request_hash, v_response, clock_timestamp());
  RETURN v_response;
END
$$;

CREATE FUNCTION v3.list_freezer_surplus(p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE v_lots jsonb; v_runs jsonb; v_schedule_runs jsonb; v_allocations jsonb; v_events jsonb;
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'productCode',l.product_code,'productionDate',l.production_date,
    'totalCases',l.total_cases,'remainingCases',l.remaining_cases,'revision',l.revision,'createdAt',l.created_at)
    ORDER BY l.production_date, l.created_at, l.id), '[]'::jsonb) INTO v_lots FROM v3.freezer_surplus_lots l WHERE l.facility_id=p_facility_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('runId',r.id,'label',r.setup_snapshot->>'label','productCode',r.setup_snapshot->>'productCode',
    'completedAt',r.completed_at,'decision',c.decision,'lotId',c.lot_id) ORDER BY r.completed_at DESC, r.id), '[]'::jsonb)
    INTO v_runs FROM v3.runs r LEFT JOIN v3.freezer_surplus_confirmations c ON c.facility_id=r.facility_id AND c.run_id=r.id
    WHERE r.facility_id=p_facility_id AND r.status='completed';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('productionDate',s.production_date,'runId',run.value->>'id',
    'productCode',run.value->>'productCode','targetCases',(run.value->>'targetCases')::integer,
    'carriedInCases',COALESCE((SELECT sum(a.cases) FROM v3.freezer_surplus_allocations a WHERE a.facility_id=s.facility_id
      AND a.production_date=s.production_date AND a.schedule_run_id=(run.value->>'id')::uuid),0),
    'effectiveTargetCases',GREATEST((run.value->>'targetCases')::integer-COALESCE((SELECT sum(a.cases) FROM v3.freezer_surplus_allocations a
      WHERE a.facility_id=s.facility_id AND a.production_date=s.production_date AND a.schedule_run_id=(run.value->>'id')::uuid),0),0))
    ORDER BY s.production_date, run.ordinality), '[]'::jsonb)
    INTO v_schedule_runs FROM v3.production_schedules s CROSS JOIN jsonb_array_elements(s.plan->'runs') WITH ORDINALITY run(value,ordinality)
    WHERE s.facility_id=p_facility_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'lotId',a.lot_id,'productionDate',a.production_date,
    'scheduleRunId',a.schedule_run_id,'cases',a.cases,'createdAt',a.created_at) ORDER BY a.created_at DESC,a.id), '[]'::jsonb)
    INTO v_allocations FROM v3.freezer_surplus_allocations a WHERE a.facility_id=p_facility_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'lotId',e.lot_id,'eventType',e.event_type,'quantityDelta',e.quantity_delta,
    'reason',e.reason,'correctsEventId',e.corrects_event_id,'createdAt',e.created_at) ORDER BY e.created_at DESC,e.id), '[]'::jsonb)
    INTO v_events FROM (SELECT * FROM v3.freezer_surplus_events WHERE facility_id=p_facility_id ORDER BY created_at DESC LIMIT 100) e;
  RETURN jsonb_build_object('lots',v_lots,'runs',v_runs,'scheduleRuns',v_schedule_runs,'allocations',v_allocations,'events',v_events);
END
$$;

CREATE OR REPLACE FUNCTION v3.get_production_schedule(p_facility_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, v3
AS $$
DECLARE v_schedule v3.production_schedules%ROWTYPE; v_runs jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_date IS NULL OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid production schedule scope' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_schedule FROM v3.production_schedules WHERE facility_id=p_facility_id AND production_date=p_date;
  IF NOT FOUND THEN RETURN jsonb_build_object('date',p_date,'revision',0,'timeZone','America/Chicago',
    'productionStartTime',v3.schedule_default_start_time(p_facility_id),'runs','[]'::jsonb,'breaks',jsonb_build_array(
      jsonb_build_object('slot',1,'enabled',false,'runId',NULL),jsonb_build_object('slot',2,'enabled',false,'runId',NULL),
      jsonb_build_object('slot',3,'enabled',false,'runId',NULL)),'updatedAt',NULL);
  END IF;
  SELECT COALESCE(jsonb_agg(run.value || jsonb_build_object('carriedInCases',COALESCE((SELECT sum(a.cases)
    FROM v3.freezer_surplus_allocations a WHERE a.facility_id=p_facility_id AND a.production_date=p_date
    AND a.schedule_run_id=(run.value->>'id')::uuid),0),'effectiveTargetCases',GREATEST((run.value->>'targetCases')::integer-COALESCE((
    SELECT sum(a.cases) FROM v3.freezer_surplus_allocations a WHERE a.facility_id=p_facility_id AND a.production_date=p_date
    AND a.schedule_run_id=(run.value->>'id')::uuid),0),0)) ORDER BY run.ordinality),'[]'::jsonb)
    INTO v_runs FROM jsonb_array_elements(v_schedule.plan->'runs') WITH ORDINALITY run(value,ordinality);
  RETURN jsonb_build_object('date',v_schedule.production_date,'revision',v_schedule.revision,'timeZone',v_schedule.time_zone,
    'productionStartTime',v_schedule.plan->'productionStartTime','runs',v_runs,'breaks',v_schedule.plan->'breaks','updatedAt',v_schedule.updated_at);
END
$$;

REVOKE ALL ON FUNCTION v3.confirm_freezer_surplus(uuid,uuid,text,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.allocate_freezer_surplus(uuid,uuid,text,text,uuid,date,uuid,integer,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.adjust_freezer_surplus(uuid,uuid,text,text,uuid,text,integer,text,bigint,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.list_freezer_surplus(uuid) FROM PUBLIC;
COMMIT;
