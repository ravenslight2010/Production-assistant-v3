BEGIN;

CREATE TABLE v3.inventory_lots (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  lot_number text CHECK (
    lot_number IS NULL OR (
      length(btrim(lot_number)) BETWEEN 1 AND 120
      AND lot_number = btrim(lot_number)
      AND lot_number !~ '[[:cntrl:]]'
    )
  ),
  received_on date NOT NULL,
  expires_on date,
  transferred_from_lot_id uuid,
  quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  FOREIGN KEY (facility_id, warehouse_id)
    REFERENCES v3.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, product_id)
    REFERENCES v3.products (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, transferred_from_lot_id)
    REFERENCES v3.inventory_lots (facility_id, id) ON DELETE RESTRICT,
  CHECK (expires_on IS NULL OR expires_on >= received_on)
);

CREATE INDEX inventory_lots_fefo
  ON v3.inventory_lots (
    facility_id, warehouse_id, product_id, expires_on ASC NULLS LAST, received_on, id
  )
  WHERE quantity > 0;

CREATE TABLE v3.inventory_lot_movements (
  facility_id uuid NOT NULL,
  movement_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  quantity_delta numeric(20,6) NOT NULL CHECK (quantity_delta <> 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, movement_id, lot_id),
  FOREIGN KEY (facility_id, movement_id)
    REFERENCES v3.inventory_movements (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, lot_id)
    REFERENCES v3.inventory_lots (facility_id, id) ON DELETE RESTRICT
);

CREATE INDEX inventory_lot_movements_lot
  ON v3.inventory_lot_movements (facility_id, lot_id, created_at, movement_id);

CREATE TRIGGER inventory_lot_movements_append_only
  BEFORE UPDATE OR DELETE ON v3.inventory_lot_movements
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

INSERT INTO v3.inventory_lots (
  facility_id, warehouse_id, product_id, received_on, quantity, created_at, updated_at
)
SELECT b.facility_id, b.warehouse_id, b.product_id, b.updated_at::date,
  b.quantity, b.updated_at, b.updated_at
FROM v3.inventory_balances b
WHERE b.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM v3.inventory_lots l
    WHERE l.facility_id = b.facility_id
      AND l.warehouse_id = b.warehouse_id
      AND l.product_id = b.product_id
  );

CREATE FUNCTION v3.assert_inventory_lot_balance(
  p_facility_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_balance numeric(20,6);
  v_lots numeric(20,6);
BEGIN
  SELECT quantity INTO v_balance FROM v3.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory balance missing during lot reconciliation'; END IF;
  SELECT COALESCE(sum(quantity), 0)::numeric(20,6) INTO v_lots
  FROM v3.inventory_lots
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = p_product_id;
  IF v_balance <> v_lots THEN
    RAISE EXCEPTION 'Inventory lot total does not match canonical balance';
  END IF;
END
$$;

CREATE FUNCTION v3.create_inventory_lot(
  p_facility_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_movement_id uuid,
  p_quantity numeric,
  p_lot_number text,
  p_received_on date,
  p_expires_on date,
  p_transferred_from_lot_id uuid,
  p_now timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_lot_id uuid;
  v_lot_number text := NULLIF(btrim(p_lot_number), '');
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR p_product_id IS NULL
    OR p_movement_id IS NULL OR p_quantity IS NULL OR p_quantity <= 0
    OR p_received_on IS NULL OR p_now IS NULL
    OR (p_expires_on IS NOT NULL AND p_expires_on < p_received_on)
    OR (v_lot_number IS NOT NULL AND (
      length(v_lot_number) > 120 OR v_lot_number ~ '[[:cntrl:]]'
    ))
    OR NOT EXISTS (
      SELECT 1 FROM v3.inventory_movements m
      WHERE m.facility_id = p_facility_id AND m.id = p_movement_id
        AND m.warehouse_id = p_warehouse_id AND m.product_id = p_product_id
        AND m.quantity_delta >= p_quantity + COALESCE((
          SELECT sum(lm.quantity_delta) FROM v3.inventory_lot_movements lm
          WHERE lm.facility_id = p_facility_id AND lm.movement_id = p_movement_id
        ), 0)
    ) THEN
    RAISE EXCEPTION 'Invalid inventory lot creation' USING ERRCODE = '22023';
  END IF;
  IF p_transferred_from_lot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM v3.inventory_lots
    WHERE facility_id = p_facility_id AND id = p_transferred_from_lot_id
      AND product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Transfer source lot is unavailable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO v3.inventory_lots (
    facility_id, warehouse_id, product_id, lot_number, received_on, expires_on,
    transferred_from_lot_id, quantity, created_at, updated_at
  ) VALUES (
    p_facility_id, p_warehouse_id, p_product_id, v_lot_number, p_received_on,
    p_expires_on, p_transferred_from_lot_id, p_quantity, p_now, p_now
  ) RETURNING id INTO v_lot_id;
  INSERT INTO v3.inventory_lot_movements (
    facility_id, movement_id, lot_id, quantity_delta, created_at
  ) VALUES (
    p_facility_id, p_movement_id, v_lot_id, p_quantity, p_now
  );
  RETURN v_lot_id;
END
$$;

CREATE FUNCTION v3.consume_inventory_lots(
  p_facility_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_movement_id uuid,
  p_quantity numeric,
  p_now timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_lot v3.inventory_lots%ROWTYPE;
  v_take numeric(20,6);
  v_remaining numeric(20,6) := p_quantity;
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR p_product_id IS NULL
    OR p_movement_id IS NULL OR p_quantity IS NULL OR p_quantity <= 0 OR p_now IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM v3.inventory_movements
      WHERE facility_id = p_facility_id AND id = p_movement_id
        AND warehouse_id = p_warehouse_id AND product_id = p_product_id
        AND quantity_delta = -p_quantity
    ) THEN
    RAISE EXCEPTION 'Invalid inventory lot consumption' USING ERRCODE = '22023';
  END IF;
  FOR v_lot IN
    SELECT * FROM v3.inventory_lots
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id
      AND product_id = p_product_id AND quantity > 0
    ORDER BY expires_on ASC NULLS LAST, received_on, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining = 0;
    v_take := LEAST(v_remaining, v_lot.quantity);
    UPDATE v3.inventory_lots
    SET quantity = quantity - v_take, updated_at = p_now
    WHERE facility_id = p_facility_id AND id = v_lot.id;
    INSERT INTO v3.inventory_lot_movements (
      facility_id, movement_id, lot_id, quantity_delta, created_at
    ) VALUES (
      p_facility_id, p_movement_id, v_lot.id, -v_take, p_now
    );
    v_remaining := v_remaining - v_take;
  END LOOP;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Insufficient lot stock for this movement' USING ERRCODE = '22003';
  END IF;
END
$$;

CREATE FUNCTION v3.record_inventory_movement(
  p_facility_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_warehouse_id uuid,
  p_product_code text,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
  p_lot_number text,
  p_received_on date,
  p_expires_on date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_product v3.products%ROWTYPE;
  v_balance v3.inventory_balances%ROWTYPE;
  v_now timestamptz;
  v_next numeric(20,6);
  v_group_id uuid;
  v_movement_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_movement_type IS NULL OR p_movement_type NOT IN ('receipt', 'adjustment')
     OR p_quantity IS NULL OR p_quantity = 0 OR abs(p_quantity) >= 100000000000000
     OR (p_movement_type = 'receipt' AND p_quantity <= 0)
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500
     OR (p_quantity < 0 AND (p_lot_number IS NOT NULL OR p_received_on IS NOT NULL OR p_expires_on IS NOT NULL))
     OR (p_expires_on IS NOT NULL AND p_received_on IS NOT NULL AND p_expires_on < p_received_on) THEN
    RAISE EXCEPTION 'Invalid inventory movement request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_response
  FROM v3.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v3.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v3.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND status = 'applied'
  ) THEN RAISE EXCEPTION 'Review and apply an opening count before recording stock' USING ERRCODE = '55000'; END IF;
  SELECT * INTO v_product FROM v3.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v3.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES (p_facility_id, p_warehouse_id, v_product.id)
  ON CONFLICT DO NOTHING;
  SELECT * INTO v_balance FROM v3.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id
  FOR UPDATE;
  v_next := v_balance.quantity + p_quantity;
  IF v_next < 0 THEN RAISE EXCEPTION 'Insufficient stock for this adjustment' USING ERRCODE = '22003'; END IF;
  IF v_balance.revision = 9007199254740991 THEN RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003'; END IF;
  v_now := clock_timestamp();
  v_group_id := gen_random_uuid();
  INSERT INTO v3.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at
  ) VALUES (
    p_facility_id, p_warehouse_id, v_product.id, v_group_id, p_movement_type,
    p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now
  ) RETURNING id INTO v_movement_id;
  UPDATE v3.inventory_balances
  SET quantity = v_next, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id;
  IF p_quantity > 0 THEN
    PERFORM v3.create_inventory_lot(
      p_facility_id, p_warehouse_id, v_product.id, v_movement_id, p_quantity,
      p_lot_number, COALESCE(p_received_on, v_now::date), p_expires_on, NULL, v_now
    );
  ELSE
    PERFORM v3.consume_inventory_lots(
      p_facility_id, p_warehouse_id, v_product.id, v_movement_id, -p_quantity, v_now
    );
  END IF;
  PERFORM v3.assert_inventory_lot_balance(p_facility_id, p_warehouse_id, v_product.id);
  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'movementId', v_group_id,
    'warehouseId', p_warehouse_id,
    'productCode', v_product.code,
    'quantity', v_next::text,
    'revision', v_balance.revision + 1
  );
  INSERT INTO v3.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION v3.record_inventory_movement(
  p_facility_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_warehouse_id uuid,
  p_product_code text,
  p_movement_type text,
  p_quantity numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  RETURN v3.record_inventory_movement(
    p_facility_id, p_actor_id, p_command_id, p_request_hash, p_warehouse_id,
    p_product_code, p_movement_type, p_quantity, p_reason, NULL, NULL, NULL
  );
END
$$;

CREATE OR REPLACE FUNCTION v3.transfer_inventory(
  p_facility_id uuid,
  p_actor_id uuid,
  p_command_id text,
  p_request_hash text,
  p_source_warehouse_id uuid,
  p_target_warehouse_id uuid,
  p_product_code text,
  p_quantity numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_existing_hash text;
  v_response jsonb;
  v_product v3.products%ROWTYPE;
  v_balance v3.inventory_balances%ROWTYPE;
  v_source_quantity numeric(20,6);
  v_target_quantity numeric(20,6);
  v_source_revision bigint;
  v_target_revision bigint;
  v_now timestamptz;
  v_group_id uuid;
  v_source_movement_id uuid;
  v_target_movement_id uuid;
  v_allocation record;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_source_warehouse_id IS NULL OR p_target_warehouse_id IS NULL
     OR p_source_warehouse_id = p_target_warehouse_id
     OR p_quantity IS NULL OR p_quantity <= 0 OR p_quantity >= 100000000000000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid inventory transfer request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0)
  );
  SELECT request_hash, response INTO v_existing_hash, v_response
  FROM v3.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_existing_hash <> p_request_hash THEN
      RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v3.inventory_warehouses
  WHERE facility_id = p_facility_id AND active
    AND id IN (p_source_warehouse_id, p_target_warehouse_id)
  ORDER BY id
  FOR UPDATE;
  IF (SELECT count(*) FROM v3.inventory_warehouses
      WHERE facility_id = p_facility_id AND active
        AND id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM v3.opening_counts
      WHERE facility_id = p_facility_id AND status = 'applied'
        AND warehouse_id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Review and apply opening counts in both warehouses before transferring stock' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_product FROM v3.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v3.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES
    (p_facility_id, p_source_warehouse_id, v_product.id),
    (p_facility_id, p_target_warehouse_id, v_product.id)
  ON CONFLICT DO NOTHING;
  FOR v_balance IN
    SELECT * FROM v3.inventory_balances
    WHERE facility_id = p_facility_id
      AND product_id = v_product.id
      AND warehouse_id IN (p_source_warehouse_id, p_target_warehouse_id)
    ORDER BY warehouse_id
    FOR UPDATE
  LOOP
    IF v_balance.warehouse_id = p_source_warehouse_id THEN
      v_source_quantity := v_balance.quantity;
      v_source_revision := v_balance.revision;
    ELSE
      v_target_quantity := v_balance.quantity;
      v_target_revision := v_balance.revision;
    END IF;
  END LOOP;
  IF v_source_quantity < p_quantity THEN RAISE EXCEPTION 'Insufficient stock for this transfer' USING ERRCODE = '22003'; END IF;
  IF v_source_revision = 9007199254740991 OR v_target_revision = 9007199254740991 THEN
    RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003';
  END IF;
  v_now := clock_timestamp();
  v_group_id := gen_random_uuid();
  INSERT INTO v3.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at
  ) VALUES (
    p_facility_id, p_source_warehouse_id, v_product.id, v_group_id, 'transfer_out',
    -p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now
  ) RETURNING id INTO v_source_movement_id;
  INSERT INTO v3.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at
  ) VALUES (
    p_facility_id, p_target_warehouse_id, v_product.id, v_group_id, 'transfer_in',
    p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now
  ) RETURNING id INTO v_target_movement_id;
  UPDATE v3.inventory_balances
  SET quantity = quantity - p_quantity, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_source_warehouse_id AND product_id = v_product.id;
  UPDATE v3.inventory_balances
  SET quantity = quantity + p_quantity, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_target_warehouse_id AND product_id = v_product.id;
  PERFORM v3.consume_inventory_lots(
    p_facility_id, p_source_warehouse_id, v_product.id, v_source_movement_id, p_quantity, v_now
  );
  FOR v_allocation IN
    SELECT lm.quantity_delta, l.*
    FROM v3.inventory_lot_movements lm
    JOIN v3.inventory_lots l
      ON l.facility_id = lm.facility_id AND l.id = lm.lot_id
    WHERE lm.facility_id = p_facility_id AND lm.movement_id = v_source_movement_id
    ORDER BY l.id
  LOOP
    PERFORM v3.create_inventory_lot(
      p_facility_id, p_target_warehouse_id, v_product.id, v_target_movement_id,
      -v_allocation.quantity_delta, v_allocation.lot_number, v_allocation.received_on,
      v_allocation.expires_on, v_allocation.id, v_now
    );
  END LOOP;
  PERFORM v3.assert_inventory_lot_balance(p_facility_id, p_source_warehouse_id, v_product.id);
  PERFORM v3.assert_inventory_lot_balance(p_facility_id, p_target_warehouse_id, v_product.id);
  v_response := jsonb_build_object(
    'outcome', 'accepted',
    'replayed', false,
    'transferId', v_group_id,
    'productCode', v_product.code,
    'quantity', p_quantity::text,
    'sourceWarehouseId', p_source_warehouse_id,
    'sourceQuantity', (v_source_quantity - p_quantity)::text,
    'sourceRevision', v_source_revision + 1,
    'targetWarehouseId', p_target_warehouse_id,
    'targetQuantity', (v_target_quantity + p_quantity)::text,
    'targetRevision', v_target_revision + 1
  );
  INSERT INTO v3.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE OR REPLACE FUNCTION v3.apply_opening_count(p_facility_id uuid, p_actor_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_count v3.opening_counts%ROWTYPE;
  v_row jsonb;
  v_product v3.products%ROWTYPE;
  v_quantity numeric(20,6);
  v_now timestamptz;
  v_group_id uuid;
  v_movement_id uuid;
  v_applied integer := 0;
  v_result jsonb;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_count_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid count scope' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_count FROM v3.opening_counts
  WHERE facility_id = p_facility_id AND id = p_count_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opening count not found' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status = 'applied' THEN
    RETURN COALESCE(v_count.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;
  IF v_count.status <> 'reviewed' THEN
    RAISE EXCEPTION 'Review the opening count before applying it' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM v3.facility_scope
  WHERE singleton AND facility_id = p_facility_id
  FOR UPDATE;
  PERFORM 1 FROM v3.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = v_count.warehouse_id AND active
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (
    SELECT 1 FROM v3.inventory_movements
    WHERE facility_id = p_facility_id AND warehouse_id = v_count.warehouse_id
  ) THEN RAISE EXCEPTION 'Stock changed after this count was staged' USING ERRCODE = '40001'; END IF;
  IF EXISTS (
    SELECT 1 FROM v3.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = v_count.warehouse_id
      AND status = 'applied' AND id <> p_count_id
  ) THEN RAISE EXCEPTION 'An opening count was already applied for this warehouse' USING ERRCODE = '55000'; END IF;
  IF (SELECT count(*) FROM v3.products WHERE facility_id = p_facility_id AND active)
       <> jsonb_array_length(v_count.rows)
     OR EXISTS (
       SELECT 1 FROM v3.products p
       WHERE p.facility_id = p_facility_id AND p.active
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_count.rows) AS rows(value)
           WHERE lower(rows.value->>'productCode') = lower(p.code)
         )
     ) THEN
    RAISE EXCEPTION 'Products changed after this count was staged; create a fresh count' USING ERRCODE = '40001';
  END IF;
  v_now := clock_timestamp();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_count.rows) LOOP
    SELECT * INTO v_product FROM v3.products
    WHERE facility_id = p_facility_id AND active
      AND lower(code) = lower(v_row->>'productCode')
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A counted product is no longer active' USING ERRCODE = '40001'; END IF;
    v_quantity := (v_row->>'quantity')::numeric(20,6);
    INSERT INTO v3.inventory_balances (
      facility_id, warehouse_id, product_id, quantity, revision, updated_at
    ) VALUES (
      p_facility_id, v_count.warehouse_id, v_product.id, v_quantity, 1, v_now
    )
    ON CONFLICT (facility_id, warehouse_id, product_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, revision = v3.inventory_balances.revision + 1,
      updated_at = EXCLUDED.updated_at;
    IF v_quantity > 0 THEN
      v_group_id := gen_random_uuid();
      INSERT INTO v3.inventory_movements (
        facility_id, warehouse_id, product_id, movement_group_id, movement_type,
        quantity_delta, reason, actor_id, command_id, occurred_at
      ) VALUES (
        p_facility_id, v_count.warehouse_id, v_product.id, v_group_id, 'opening_count',
        v_quantity, 'Reviewed physical opening count', p_actor_id,
        v_count.request_id, v_now
      ) RETURNING id INTO v_movement_id;
      PERFORM v3.create_inventory_lot(
        p_facility_id, v_count.warehouse_id, v_product.id, v_movement_id, v_quantity,
        NULL, v_now::date, NULL, NULL, v_now
      );
    END IF;
    PERFORM v3.assert_inventory_lot_balance(
      p_facility_id, v_count.warehouse_id, v_product.id
    );
    v_applied := v_applied + 1;
  END LOOP;
  v_result := jsonb_build_object(
    'outcome', 'applied',
    'countId', p_count_id,
    'warehouseId', v_count.warehouse_id,
    'rowCount', v_applied,
    'appliedAt', v_now,
    'replayed', false
  );
  UPDATE v3.opening_counts
  SET status = 'applied', applied_by = p_actor_id, applied_at = v_now, result = v_result
  WHERE facility_id = p_facility_id AND id = p_count_id;
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION v3.apply_run_inventory_consumption(
  p_facility_id uuid,
  p_run_id uuid,
  p_actor_id uuid,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_warehouse_id uuid;
  v_warehouse_name text;
  v_balance v3.inventory_balances%ROWTYPE;
  v_demand record;
  v_deducted numeric;
  v_shortfall numeric;
  v_lines jsonb := '[]'::jsonb;
  v_detail jsonb;
  v_movement_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR NOT EXISTS (
       SELECT 1 FROM v3.facility_scope WHERE singleton AND facility_id = p_facility_id
     ) THEN
    RAISE EXCEPTION 'Invalid run inventory scope' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_warehouse_id := (p_plan->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid run inventory warehouse' USING ERRCODE = '22023';
  END;
  SELECT w.name INTO v_warehouse_name
    FROM v3.inventory_warehouses AS w
    WHERE w.facility_id = p_facility_id
      AND w.id = v_warehouse_id
      AND w.active
      AND EXISTS (
        SELECT 1 FROM v3.opening_counts AS c
        WHERE c.facility_id = w.facility_id
          AND c.warehouse_id = w.id
          AND c.status = 'applied'
      )
    FOR UPDATE;
  IF v_warehouse_name IS NULL THEN
    RAISE EXCEPTION 'The run production warehouse is unavailable'
      USING ERRCODE = '55000';
  END IF;

  FOR v_demand IN
    WITH station_counts AS (
      SELECT s.station_key,
        CASE
          WHEN s.station_key = 'sauce'
            AND s.progress->>'barrelsMade' ~ '^[0-9]+$'
            THEN (s.progress->>'barrelsMade')::numeric
          WHEN s.progress->>'batchesMade' ~ '^[0-9]+$'
            THEN (s.progress->>'batchesMade')::numeric
          ELSE 0::numeric
        END AS quantity
      FROM v3.run_station_progress AS s
      WHERE s.facility_id = p_facility_id AND s.run_id = p_run_id
    ),
    recipe_demand AS (
      SELECT
        (ingredient.value->>'productId')::uuid AS product_id,
        ingredient.value->>'productCode' AS product_code,
        ingredient.value->>'productName' AS product_name,
        ingredient.value->>'unit' AS unit,
        sum((ingredient.value->>'quantity')::numeric * station.quantity) AS required
      FROM jsonb_array_elements(p_plan->'recipes') AS recipe(value)
      JOIN station_counts AS station
        ON station.station_key = recipe.value->>'stationKey'
      CROSS JOIN LATERAL jsonb_array_elements(recipe.value->'ingredients') AS ingredient(value)
      GROUP BY ingredient.value->>'productId',
        ingredient.value->>'productCode', ingredient.value->>'productName',
        ingredient.value->>'unit'
    ),
    packed_cases AS (
      SELECT COALESCE(max(
        CASE WHEN s.progress->>'casesPacked' ~ '^[0-9]+$'
          THEN (s.progress->>'casesPacked')::numeric ELSE 0::numeric END
      ), 0::numeric) AS quantity
      FROM v3.run_station_progress AS s
      WHERE s.facility_id = p_facility_id
        AND s.run_id = p_run_id
        AND s.station_key = 'packaging'
    ),
    packaging_demand AS (
      SELECT
        (line.value->>'productId')::uuid AS product_id,
        line.value->>'productCode' AS product_code,
        line.value->>'productName' AS product_name,
        line.value->>'unit' AS unit,
        sum((line.value->>'quantity')::numeric * packed_cases.quantity) AS required
      FROM jsonb_array_elements(p_plan->'packagingPerCase') AS line(value)
      CROSS JOIN packed_cases
      GROUP BY line.value->>'productId',
        line.value->>'productCode', line.value->>'productName',
        line.value->>'unit'
    ),
    combined AS (
      SELECT * FROM recipe_demand
      UNION ALL
      SELECT * FROM packaging_demand
    )
    SELECT product_id, product_code, product_name, unit, sum(required) AS required
    FROM combined
    WHERE required > 0
    GROUP BY product_id, product_code, product_name, unit
    ORDER BY product_id
  LOOP
    INSERT INTO v3.inventory_balances (facility_id, warehouse_id, product_id)
    VALUES (p_facility_id, v_warehouse_id, v_demand.product_id)
    ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance FROM v3.inventory_balances AS b
      WHERE b.facility_id = p_facility_id
        AND b.warehouse_id = v_warehouse_id
        AND b.product_id = v_demand.product_id
      FOR UPDATE;
    v_deducted := LEAST(v_demand.required, v_balance.quantity);
    v_shortfall := v_demand.required - v_deducted;
    IF v_deducted > 0 THEN
      IF v_balance.revision >= 9007199254740991 THEN
        RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE = '22003';
      END IF;
      INSERT INTO v3.inventory_movements (
        facility_id, warehouse_id, product_id, movement_group_id, movement_type,
        quantity_delta, reason, actor_id, command_id, occurred_at, run_id
      ) VALUES (
        p_facility_id, v_warehouse_id, v_demand.product_id, p_run_id, 'run_consumption',
        -v_deducted, 'Run completion inventory use', p_actor_id,
        'run:' || p_run_id::text || ':' || v_demand.product_id::text,
        v_now, p_run_id
      ) RETURNING id INTO v_movement_id;
      UPDATE v3.inventory_balances
        SET quantity = quantity - v_deducted,
            revision = revision + 1,
            updated_at = v_now
        WHERE facility_id = p_facility_id
          AND warehouse_id = v_warehouse_id
          AND product_id = v_demand.product_id;
      PERFORM v3.consume_inventory_lots(
        p_facility_id, v_warehouse_id, v_demand.product_id, v_movement_id, v_deducted, v_now
      );
      PERFORM v3.assert_inventory_lot_balance(
        p_facility_id, v_warehouse_id, v_demand.product_id
      );
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_demand.product_id,
      'productCode', v_demand.product_code,
      'productName', v_demand.product_name,
      'unit', v_demand.unit,
      'required', v_demand.required::text,
      'deducted', v_deducted::text,
      'shortfall', v_shortfall::text
    ));
  END LOOP;

  v_detail := jsonb_build_object(
    'status', 'completed',
    'runId', p_run_id,
    'warehouseId', v_warehouse_id,
    'warehouseName', v_warehouse_name,
    'lines', v_lines,
    'occurredAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  INSERT INTO v3.run_inventory_consumptions (
    facility_id, run_id, warehouse_id, actor_id, details, occurred_at
  ) VALUES (
    p_facility_id, p_run_id, v_warehouse_id, p_actor_id, v_detail, v_now
  );
  RETURN v_detail;
END
$$;

REVOKE ALL ON FUNCTION v3.assert_inventory_lot_balance(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.create_inventory_lot(uuid, uuid, uuid, uuid, numeric, text, date, date, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.consume_inventory_lots(uuid, uuid, uuid, uuid, numeric, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.record_inventory_movement(uuid, uuid, text, text, uuid, text, text, numeric, text, text, date, date) FROM PUBLIC;

COMMENT ON TABLE v3.inventory_lots IS
  'Canonical per-warehouse lot quantities; the sum for each product equals inventory_balances.';
COMMENT ON TABLE v3.inventory_lot_movements IS
  'Append-only attribution between canonical inventory movements and lot quantity changes.';

COMMIT;
