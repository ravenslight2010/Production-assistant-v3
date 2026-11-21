BEGIN;

-- Least-privilege V3 equivalents for the two reviewed V1 custom role names.
-- Keep these capability lists aligned with the domain-owned V3 workflows.
INSERT INTO v3.roles (name, capabilities, builtin)
VALUES
  (
    'qc-manager',
    '["review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb,
    false
  ),
  (
    'warehouse',
    '["manage-inventory"]'::jsonb,
    false
  )
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        (
          'qc-manager'::text,
          '["review-incidents","manage-allergens","record-qc","manage-qc"]'::jsonb
        ),
        (
          'warehouse'::text,
          '["manage-inventory"]'::jsonb
        )
    ) AS expected(name, capabilities)
    LEFT JOIN v3.roles AS actual ON actual.name = expected.name
    WHERE actual.name IS NULL
       OR actual.builtin IS DISTINCT FROM false
       OR actual.capabilities IS DISTINCT FROM expected.capabilities
  ) THEN
    RAISE EXCEPTION 'V3 staff role equivalents conflict with the reviewed capability mapping';
  END IF;
END
$$;

COMMIT;
