BEGIN;

DO $$
DECLARE
  v_facility uuid;
  v_actor uuid := '99100000-0000-4000-8000-000000000001';
  v_import uuid;
  v_product uuid;
  v_source uuid;
  v_target uuid;
  v_count uuid;
  v_result jsonb;
  v_lot_count integer;
  v_allocation_count integer;
  v_balance numeric;
  v_failed boolean;
BEGIN
  SELECT facility_id INTO STRICT v_facility FROM v3.facility_scope WHERE singleton;
  v_import := (v3.stage_setup_import(
    v_facility, v_actor, 'lot-products', repeat('1', 64), 'products',
    '[{"code":"LOT-A","name":"Lot controlled ingredient","unit":"lb"}]'::jsonb
  )->>'importId')::uuid;
  PERFORM v3.apply_setup_import(v_facility, v_actor, v_import);
  SELECT id INTO STRICT v_product FROM v3.products
  WHERE facility_id = v_facility AND code = 'LOT-A';
  v_source := (v3.create_inventory_warehouse(
    v_facility, v_actor, 'lot-source', repeat('2', 64), 'Lot source'
  )->'warehouse'->>'id')::uuid;
  v_target := (v3.create_inventory_warehouse(
    v_facility, v_actor, 'lot-target', repeat('3', 64), 'Lot target'
  )->'warehouse'->>'id')::uuid;

  v_count := (v3.stage_opening_count(
    v_facility, v_actor, 'lot-source-opening', repeat('4', 64), v_source,
    (SELECT jsonb_agg(jsonb_build_object(
      'productCode', p.code, 'quantity', CASE WHEN p.id = v_product THEN '1' ELSE '0' END
    )) FROM v3.products p WHERE p.facility_id = v_facility AND p.active)
  )->>'countId')::uuid;
  PERFORM v3.review_opening_count(v_facility, v_actor, v_count);
  PERFORM v3.apply_opening_count(v_facility, v_actor, v_count);
  v_count := (v3.stage_opening_count(
    v_facility, v_actor, 'lot-target-opening', repeat('5', 64), v_target,
    (SELECT jsonb_agg(jsonb_build_object('productCode', p.code, 'quantity', '0'))
     FROM v3.products p WHERE p.facility_id = v_facility AND p.active)
  )->>'countId')::uuid;
  PERFORM v3.review_opening_count(v_facility, v_actor, v_count);
  PERFORM v3.apply_opening_count(v_facility, v_actor, v_count);

  IF (SELECT count(*) FROM v3.inventory_lots
      WHERE facility_id = v_facility AND warehouse_id = v_source AND product_id = v_product
        AND expires_on IS NULL AND quantity = 1) <> 1 THEN
    RAISE EXCEPTION 'Opening count did not create its coordinated undated lot';
  END IF;

  PERFORM v3.record_inventory_movement(
    v_facility, v_actor, 'lot-receipt-later-expiry', repeat('6', 64), v_source,
    'LOT-A', 'receipt', 2, 'Received later expiry lot', 'LOT-B', '2026-11-01', '2027-02-01'
  );
  PERFORM v3.record_inventory_movement(
    v_facility, v_actor, 'lot-receipt-first-expiry', repeat('7', 64), v_source,
    'LOT-A', 'receipt', 3, 'Received first expiry lot', 'LOT-A-2027', '2026-11-02', '2027-01-01'
  );
  PERFORM v3.record_inventory_movement(
    v_facility, v_actor, 'lot-fefo-adjustment', repeat('8', 64), v_source,
    'LOT-A', 'adjustment', -2, 'Remove damaged earliest expiry stock'
  );
  IF NOT EXISTS (
    SELECT 1 FROM v3.inventory_lots
    WHERE facility_id = v_facility AND warehouse_id = v_source AND product_id = v_product
      AND lot_number = 'LOT-A-2027' AND quantity = 1
  ) OR EXISTS (
    SELECT 1 FROM v3.inventory_lots
    WHERE facility_id = v_facility AND warehouse_id = v_source AND product_id = v_product
      AND lot_number IS NULL AND quantity <> 1
  ) THEN
    RAISE EXCEPTION 'Negative adjustment did not consume earliest expiration first';
  END IF;

  v_result := v3.transfer_inventory(
    v_facility, v_actor, 'lot-transfer', repeat('9', 64), v_source, v_target,
    'LOT-A', 2.5, 'Transfer dated stock using FEFO'
  );
  IF v_result->>'sourceQuantity' <> '1.500000' OR v_result->>'targetQuantity' <> '2.500000' THEN
    RAISE EXCEPTION 'Lot transfer returned unexpected balances: %', v_result;
  END IF;
  IF (SELECT count(*) FROM v3.inventory_lots
      WHERE facility_id = v_facility AND warehouse_id = v_target AND product_id = v_product) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM v3.inventory_lots
      WHERE facility_id = v_facility AND warehouse_id = v_target AND product_id = v_product
        AND lot_number = 'LOT-A-2027' AND expires_on = '2027-01-01' AND quantity = 1
        AND transferred_from_lot_id IS NOT NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM v3.inventory_lots
      WHERE facility_id = v_facility AND warehouse_id = v_target AND product_id = v_product
        AND lot_number = 'LOT-B' AND expires_on = '2027-02-01' AND quantity = 1.5
        AND transferred_from_lot_id IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'Transfer did not preserve source lot identity metadata and quantities';
  END IF;

  SELECT count(*) INTO v_lot_count FROM v3.inventory_lots
  WHERE facility_id = v_facility AND product_id = v_product;
  SELECT count(*) INTO v_allocation_count FROM v3.inventory_lot_movements lm
  JOIN v3.inventory_movements m ON m.facility_id = lm.facility_id AND m.id = lm.movement_id
  WHERE lm.facility_id = v_facility AND m.product_id = v_product;
  v_result := v3.transfer_inventory(
    v_facility, v_actor, 'lot-transfer', repeat('9', 64), v_source, v_target,
    'LOT-A', 2.5, 'Transfer dated stock using FEFO'
  );
  IF v_result->>'replayed' <> 'true'
    OR (SELECT count(*) FROM v3.inventory_lots
        WHERE facility_id = v_facility AND product_id = v_product) <> v_lot_count
    OR (SELECT count(*) FROM v3.inventory_lot_movements lm
        JOIN v3.inventory_movements m ON m.facility_id = lm.facility_id AND m.id = lm.movement_id
        WHERE lm.facility_id = v_facility AND m.product_id = v_product) <> v_allocation_count THEN
    RAISE EXCEPTION 'Exact transfer retry duplicated lots or lot allocations';
  END IF;

  IF EXISTS (
    SELECT 1 FROM v3.inventory_movements m
    WHERE m.facility_id = v_facility AND m.product_id = v_product
      AND abs(m.quantity_delta) <> COALESCE((
        SELECT abs(sum(lm.quantity_delta)) FROM v3.inventory_lot_movements lm
        WHERE lm.facility_id = m.facility_id AND lm.movement_id = m.id
      ), 0)
  ) OR EXISTS (
    SELECT 1 FROM v3.inventory_balances b
    WHERE b.facility_id = v_facility
      AND b.quantity <> COALESCE((
        SELECT sum(l.quantity) FROM v3.inventory_lots l
        WHERE l.facility_id = b.facility_id AND l.warehouse_id = b.warehouse_id
          AND l.product_id = b.product_id
      ), 0)
  ) THEN
    RAISE EXCEPTION 'Lot allocations, balances, and movements do not reconcile';
  END IF;

  v_balance := (v_result->>'sourceQuantity')::numeric;
  v_failed := false;
  BEGIN
    PERFORM v3.record_inventory_movement(
      v_facility, v_actor, 'lot-overspend', repeat('a', 64), v_source,
      'LOT-A', 'adjustment', -99, 'Reject excessive lot consumption'
    );
  EXCEPTION WHEN SQLSTATE '22003' THEN v_failed := true;
  END;
  IF NOT v_failed OR (SELECT quantity FROM v3.inventory_balances
      WHERE facility_id = v_facility AND warehouse_id = v_source AND product_id = v_product) <> v_balance THEN
    RAISE EXCEPTION 'Insufficient lot consumption was not rolled back atomically';
  END IF;

  v_failed := false;
  BEGIN
    DELETE FROM v3.inventory_lot_movements WHERE facility_id = v_facility AND lot_id IN (
      SELECT id FROM v3.inventory_lots WHERE facility_id = v_facility AND product_id = v_product
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Lot allocation ledger allowed deletion'; END IF;
END
$$;

ROLLBACK;

SELECT 'V3 coordinated inventory lot checks passed.';
