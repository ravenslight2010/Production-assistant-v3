BEGIN;

ALTER TABLE v3.staff_accounts
  ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN revision bigint NOT NULL DEFAULT 1
    CHECK (revision BETWEEN 1 AND 9007199254740991);

CREATE TABLE v3.staff_invitations (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  role_name text NOT NULL REFERENCES v3.roles (name) ON DELETE RESTRICT,
  invited_by uuid NOT NULL REFERENCES v3.staff_accounts (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','consumed','revoked','expired')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES v3.staff_accounts (id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX staff_invitations_facility_created
  ON v3.staff_invitations (facility_id, created_at DESC, id);

CREATE TABLE v3.password_reset_requests (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES v3.staff_accounts (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','used','superseded','invalidated','expired')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  approved_by uuid REFERENCES v3.staff_accounts (id) ON DELETE RESTRICT,
  approved_at timestamptz,
  code_hash text CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at timestamptz,
  used_at timestamptz,
  closed_at timestamptz,
  CHECK (expires_at > requested_at),
  CHECK (code_expires_at IS NULL OR code_hash IS NOT NULL),
  CHECK (code_hash IS NULL OR code_expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX password_reset_one_active
  ON v3.password_reset_requests (account_id)
  WHERE status IN ('pending','approved');
CREATE INDEX password_reset_facility_requested
  ON v3.password_reset_requests (facility_id, requested_at DESC, id);
CREATE INDEX password_reset_code_lookup
  ON v3.password_reset_requests (account_id, code_hash)
  WHERE status = 'approved';

CREATE TABLE v3.account_audit_events (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES v3.staff_accounts (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = btrim(action) AND length(action) BETWEEN 1 AND 80),
  target_account_id uuid REFERENCES v3.staff_accounts (id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('account','invitation','password_reset')),
  entity_id uuid,
  request_id text CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX account_audit_target_created
  ON v3.account_audit_events (facility_id, target_account_id, created_at DESC, id);
CREATE TRIGGER account_audit_events_append_only
  BEFORE UPDATE OR DELETE ON v3.account_audit_events
  FOR EACH ROW EXECUTE FUNCTION v3.reject_immutable_row_mutation();

CREATE TABLE v3.account_command_receipts (
  facility_id uuid NOT NULL REFERENCES v3.facility_scope (facility_id) ON DELETE RESTRICT,
  actor_key text NOT NULL CHECK (
    actor_key = 'public'
    OR actor_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  command_id text NOT NULL CHECK (
    length(command_id) BETWEEN 1 AND 200 AND command_id !~ '[[:cntrl:]]'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, actor_key, command_id)
);

CREATE FUNCTION v3.account_actor_capabilities(p_actor_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT r.capabilities
  FROM v3.staff_accounts AS u
  JOIN v3.user_roles AS ur ON ur.user_id = u.id
  JOIN v3.roles AS r ON r.name = ur.role_name
  WHERE u.id = p_actor_id AND u.disabled = false
$$;

CREATE FUNCTION v3.account_capabilities_cover(p_actor_capabilities jsonb, p_target_capabilities jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT p_actor_capabilities IS NOT NULL
     AND p_target_capabilities IS NOT NULL
     AND jsonb_typeof(p_actor_capabilities) = 'array'
     AND jsonb_typeof(p_target_capabilities) = 'array'
     AND NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(p_target_capabilities) AS capability(name)
       WHERE NOT p_actor_capabilities ? capability.name
     )
$$;

CREATE FUNCTION v3.account_authorize(p_actor_id uuid, p_permission text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_capabilities jsonb;
BEGIN
  v_capabilities := v3.account_actor_capabilities(p_actor_id);
  IF v_capabilities IS NULL OR NOT v_capabilities ? p_permission THEN
    RAISE EXCEPTION 'Account operation is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN v_capabilities;
END
$$;

CREATE FUNCTION v3.account_facility_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT facility_id FROM v3.facility_scope WHERE singleton = true
$$;

CREATE FUNCTION v3.account_replay(
  p_facility_id uuid,
  p_actor_key text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_receipt v3.account_command_receipts%ROWTYPE;
BEGIN
  IF p_command_id IS NULL OR length(p_command_id) NOT BETWEEN 1 AND 200
     OR p_command_id ~ '[[:cntrl:]]'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid account command envelope' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_receipt
    FROM v3.account_command_receipts
    WHERE facility_id = p_facility_id
      AND actor_key = p_actor_key
      AND command_id = p_command_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_receipt.request_hash <> p_request_hash THEN
    RETURN '{"outcome":"request_mismatch"}'::jsonb;
  END IF;
  RETURN v_receipt.response;
END
$$;

CREATE FUNCTION v3.account_store_receipt(
  p_facility_id uuid,
  p_actor_key text,
  p_command_id text,
  p_request_hash text,
  p_response jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  INSERT INTO v3.account_command_receipts (
    facility_id, actor_key, command_id, request_hash, response
  ) VALUES (
    p_facility_id, p_actor_key, p_command_id, p_request_hash, p_response
  )
$$;

CREATE FUNCTION v3.account_audit(
  p_facility_id uuid,
  p_actor_id uuid,
  p_action text,
  p_target_account_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_request_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  INSERT INTO v3.account_audit_events (
    facility_id, actor_id, action, target_account_id,
    entity_type, entity_id, request_id, metadata
  ) VALUES (
    p_facility_id, p_actor_id, p_action, p_target_account_id,
    p_entity_type, p_entity_id, p_request_id, coalesce(p_metadata, '{}'::jsonb)
  )
$$;

CREATE FUNCTION v3.account_staff_json(p_staff_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT jsonb_build_object(
    'userId', u.id,
    'username', u.username,
    'role', r.name,
    'disabled', u.disabled,
    'createdAt', u.created_at,
    'revision', u.revision
  )
  FROM v3.staff_accounts AS u
  JOIN v3.user_roles AS ur ON ur.user_id = u.id
  JOIN v3.roles AS r ON r.name = ur.role_name
  WHERE u.id = p_staff_id
$$;

CREATE FUNCTION v3.account_invitation_json(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT jsonb_build_object(
    'invitationId', i.id,
    'roleName', i.role_name,
    'status', CASE
      WHEN i.status = 'active' AND i.expires_at <= clock_timestamp() THEN 'expired'
      ELSE i.status
    END,
    'createdAt', i.created_at,
    'expiresAt', i.expires_at,
    'revision', i.revision
  )
  FROM v3.staff_invitations AS i
  WHERE i.id = p_invitation_id
$$;

CREATE FUNCTION v3.account_reset_json(p_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
  SELECT jsonb_build_object(
    'requestId', q.id,
    'staffId', u.id,
    'username', u.username,
    'role', r.name,
    'status', CASE
      WHEN q.status = 'pending' AND q.expires_at <= clock_timestamp() THEN 'expired'
      WHEN q.status = 'approved' AND q.code_expires_at <= clock_timestamp() THEN 'expired'
      ELSE q.status
    END,
    'requestedAt', q.requested_at,
    'expiresAt', q.expires_at,
    'revision', q.revision,
    'approvedAt', q.approved_at,
    'codeExpiresAt', q.code_expires_at
  )
  FROM v3.password_reset_requests AS q
  JOIN v3.staff_accounts AS u ON u.id = q.account_id
  JOIN v3.user_roles AS ur ON ur.user_id = u.id
  JOIN v3.roles AS r ON r.name = ur.role_name
  WHERE q.id = p_request_id
$$;

DROP FUNCTION v3.list_staff_accounts(uuid);
DROP FUNCTION v3.list_staff_roles(uuid);
DROP FUNCTION v3.create_staff_account(uuid, text, text, text);
DROP FUNCTION v3.update_staff_account(uuid, uuid, boolean, text);

CREATE FUNCTION v3.list_staff_accounts(p_actor_id uuid)
RETURNS TABLE (
  staff_id uuid,
  username text,
  role_name text,
  disabled boolean,
  created_at timestamptz,
  revision bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
BEGIN
  PERFORM v3.account_authorize(p_actor_id, 'manage-staff');
  RETURN QUERY
    SELECT u.id, u.username, r.name, u.disabled, u.created_at, u.revision
    FROM v3.staff_accounts AS u
    JOIN v3.user_roles AS ur ON ur.user_id = u.id
    JOIN v3.roles AS r ON r.name = ur.role_name
    ORDER BY lower(u.username), u.id
    LIMIT 200;
END
$$;

CREATE FUNCTION v3.list_staff_roles(p_actor_id uuid)
RETURNS TABLE (role_name text, capabilities jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
BEGIN
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'manage-staff');
  RETURN QUERY
    SELECT r.name, r.capabilities
    FROM v3.roles AS r
    WHERE v3.account_capabilities_cover(v_actor_capabilities, r.capabilities)
    ORDER BY r.name
    LIMIT 100;
END
$$;

CREATE FUNCTION v3.create_staff_account(
  p_actor_id uuid,
  p_username text,
  p_password_hash text,
  p_role_name text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_user_id uuid;
  v_staff jsonb;
  v_response jsonb;
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid staff account request' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'manage-staff');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT capabilities INTO v_target_capabilities FROM v3.roles WHERE name = p_role_name;
  IF NOT FOUND THEN RETURN '{"outcome":"invalid_role"}'::jsonb; END IF;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;

  BEGIN
    INSERT INTO v3.staff_accounts (username, password_hash, password_changed_at)
      VALUES (p_username, p_password_hash, clock_timestamp())
      RETURNING id INTO v_user_id;
  EXCEPTION
    WHEN unique_violation THEN RETURN '{"outcome":"duplicate"}'::jsonb;
  END;
  INSERT INTO v3.user_roles (user_id, role_name) VALUES (v_user_id, p_role_name);
  v_staff := v3.account_staff_json(v_user_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'account_created', v_user_id,
    'account', v_user_id, p_command_id,
    jsonb_build_object('roleName', p_role_name, 'revision', 1)
  );
  v_response := jsonb_build_object('outcome', 'created', 'staff', v_staff, 'replayed', true);
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_response
  );
  RETURN jsonb_build_object('outcome', 'created', 'staff', v_staff, 'replayed', false);
END
$$;

CREATE FUNCTION v3.update_staff_account(
  p_actor_id uuid,
  p_staff_id uuid,
  p_disabled boolean,
  p_role_name text,
  p_expected_revision bigint,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_next_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_account v3.staff_accounts%ROWTYPE;
  v_current_role text;
  v_next_disabled boolean;
  v_next_role text;
  v_staff jsonb;
  v_response jsonb;
BEGIN
  IF p_staff_id IS NULL OR (p_disabled IS NULL AND p_role_name IS NULL)
     OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Invalid staff account update' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'manage-staff');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT u.* INTO v_account
    FROM v3.staff_accounts AS u
    JOIN v3.user_roles AS ur ON ur.user_id = u.id
    WHERE u.id = p_staff_id
    FOR UPDATE OF u, ur;
  IF NOT FOUND THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  SELECT r.name, r.capabilities INTO v_current_role, v_target_capabilities
    FROM v3.user_roles AS ur
    JOIN v3.roles AS r ON r.name = ur.role_name
    WHERE ur.user_id = p_staff_id;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;
  v_staff := v3.account_staff_json(p_staff_id);
  IF v_account.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'currentStaff', v_staff);
  END IF;

  v_next_disabled := coalesce(p_disabled, v_account.disabled);
  v_next_role := coalesce(p_role_name, v_current_role);
  SELECT capabilities INTO v_next_capabilities FROM v3.roles WHERE name = v_next_role;
  IF NOT FOUND THEN RETURN '{"outcome":"invalid_role"}'::jsonb; END IF;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_next_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;

  IF v_account.disabled = false AND v_target_capabilities ? 'manage-staff'
     AND (v_next_disabled OR NOT v_next_capabilities ? 'manage-staff')
     AND NOT EXISTS (
       SELECT 1
       FROM v3.staff_accounts AS u
       JOIN v3.user_roles AS ur ON ur.user_id = u.id
       JOIN v3.roles AS r ON r.name = ur.role_name
       WHERE u.id <> p_staff_id AND u.disabled = false
         AND r.capabilities ? 'manage-staff'
     ) THEN
    RETURN '{"outcome":"last_manager"}'::jsonb;
  END IF;
  IF p_actor_id = p_staff_id THEN RETURN '{"outcome":"self_change"}'::jsonb; END IF;
  IF v_account.disabled = v_next_disabled AND v_current_role = v_next_role THEN
    RETURN jsonb_build_object('outcome', 'unchanged', 'staff', v_staff, 'replayed', false);
  END IF;

  UPDATE v3.staff_accounts
    SET disabled = v_next_disabled, revision = revision + 1
    WHERE id = p_staff_id;
  UPDATE v3.user_roles
    SET role_name = v_next_role, updated_at = clock_timestamp()
    WHERE user_id = p_staff_id;
  UPDATE v3.staff_sessions
    SET revoked_at = clock_timestamp()
    WHERE user_id = p_staff_id AND revoked_at IS NULL;
  UPDATE v3.password_reset_requests
    SET status = 'invalidated', revision = revision + 1,
        code_hash = NULL, code_expires_at = NULL,
        closed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE account_id = p_staff_id AND status IN ('pending','approved');
  v_staff := v3.account_staff_json(p_staff_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'account_updated', p_staff_id,
    'account', p_staff_id, p_command_id,
    jsonb_build_object(
      'disabled', v_next_disabled, 'roleName', v_next_role,
      'revision', v_account.revision + 1
    )
  );
  v_response := jsonb_build_object('outcome', 'updated', 'staff', v_staff, 'replayed', true);
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_response
  );
  RETURN jsonb_build_object('outcome', 'updated', 'staff', v_staff, 'replayed', false);
END
$$;

CREATE FUNCTION v3.create_staff_invitation(
  p_actor_id uuid,
  p_role_name text,
  p_token_hash text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_invitation_id uuid;
  v_invitation jsonb;
  v_receipt_response jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation request' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'manage-staff');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT capabilities INTO v_target_capabilities FROM v3.roles WHERE name = p_role_name;
  IF NOT FOUND THEN RETURN '{"outcome":"invalid_role"}'::jsonb; END IF;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;

  INSERT INTO v3.staff_invitations (
    facility_id, role_name, invited_by, token_hash, expires_at
  ) VALUES (
    v_facility_id, p_role_name, p_actor_id, p_token_hash,
    clock_timestamp() + interval '24 hours'
  ) RETURNING id INTO v_invitation_id;
  v_invitation := v3.account_invitation_json(v_invitation_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'invitation_created', NULL,
    'invitation', v_invitation_id, p_command_id,
    jsonb_build_object('roleName', p_role_name, 'revision', 1)
  );
  v_receipt_response := jsonb_build_object(
    'outcome', 'secret_replay_unavailable', 'invitation', v_invitation, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_receipt_response
  );
  RETURN jsonb_build_object(
    'outcome', 'created', 'invitation', v_invitation, 'replayed', false
  );
END
$$;

CREATE FUNCTION v3.list_staff_invitations(p_actor_id uuid)
RETURNS TABLE (
  invitation_id uuid,
  role_name text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  revision bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
BEGIN
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'manage-staff');
  RETURN QUERY
    SELECT i.id, i.role_name,
      CASE WHEN i.status = 'active' AND i.expires_at <= clock_timestamp()
        THEN 'expired' ELSE i.status END,
      i.created_at, i.expires_at, i.revision
    FROM v3.staff_invitations AS i
    JOIN v3.roles AS r ON r.name = i.role_name
    WHERE i.facility_id = v3.account_facility_id()
      AND v3.account_capabilities_cover(v_actor_capabilities, r.capabilities)
    ORDER BY i.created_at DESC, i.id
    LIMIT 200;
END
$$;

CREATE FUNCTION v3.revoke_staff_invitation(
  p_actor_id uuid,
  p_invitation_id uuid,
  p_expected_revision bigint,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_invitation v3.staff_invitations%ROWTYPE;
  v_current jsonb;
BEGIN
  IF p_invitation_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Invalid invitation revocation' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'manage-staff');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_invitation FROM v3.staff_invitations
    WHERE id = p_invitation_id AND facility_id = v_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  SELECT capabilities INTO v_target_capabilities FROM v3.roles WHERE name = v_invitation.role_name;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;
  v_current := v3.account_invitation_json(p_invitation_id);
  IF v_invitation.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'currentInvitation', v_current);
  END IF;
  IF v_invitation.status <> 'active' OR v_invitation.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('outcome', 'invalid_state', 'currentInvitation', v_current);
  END IF;
  UPDATE v3.staff_invitations
    SET status = 'revoked', revision = revision + 1,
        revoked_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = p_invitation_id;
  v_current := v3.account_invitation_json(p_invitation_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'invitation_revoked', NULL,
    'invitation', p_invitation_id, p_command_id,
    jsonb_build_object('revision', v_invitation.revision + 1)
  );
  v_replay := jsonb_build_object(
    'outcome', 'revoked', 'invitation', v_current, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_replay
  );
  RETURN jsonb_build_object(
    'outcome', 'revoked', 'invitation', v_current, 'replayed', false
  );
END
$$;

CREATE FUNCTION v3.accept_staff_invitation(
  p_token_hash text,
  p_username text,
  p_password_hash text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility_id uuid;
  v_replay jsonb;
  v_invitation v3.staff_invitations%ROWTYPE;
  v_user_id uuid;
  v_staff jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]'
     OR p_password_hash IS NULL OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid invitation acceptance' USING ERRCODE = '22023';
  END IF;
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, 'public', p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_invitation FROM v3.staff_invitations
    WHERE token_hash = p_token_hash AND facility_id = v_facility_id FOR UPDATE;
  IF NOT FOUND OR v_invitation.status <> 'active'
     OR v_invitation.expires_at <= clock_timestamp() THEN
    RETURN '{"outcome":"invalid"}'::jsonb;
  END IF;
  BEGIN
    INSERT INTO v3.staff_accounts (username, password_hash, password_changed_at)
      VALUES (p_username, p_password_hash, clock_timestamp())
      RETURNING id INTO v_user_id;
  EXCEPTION
    WHEN unique_violation THEN RETURN '{"outcome":"invalid"}'::jsonb;
  END;
  INSERT INTO v3.user_roles (user_id, role_name) VALUES (v_user_id, v_invitation.role_name);
  UPDATE v3.staff_invitations
    SET status = 'consumed', revision = revision + 1,
        consumed_at = clock_timestamp(), consumed_by = v_user_id,
        updated_at = clock_timestamp()
    WHERE id = v_invitation.id;
  PERFORM v3.account_audit(
    v_facility_id, v_user_id, 'invitation_accepted', v_user_id,
    'invitation', v_invitation.id, p_command_id,
    jsonb_build_object('roleName', v_invitation.role_name)
  );
  v_staff := v3.account_staff_json(v_user_id);
  v_replay := jsonb_build_object(
    'outcome', 'accepted_sign_in_required', 'staff', v_staff, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, 'public', p_command_id, p_request_hash, v_replay
  );
  RETURN jsonb_build_object('outcome', 'accepted', 'staff', v_staff, 'replayed', false);
END
$$;

CREATE FUNCTION v3.request_password_reset(
  p_username text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility_id uuid;
  v_replay jsonb;
  v_account v3.staff_accounts%ROWTYPE;
  v_request_id uuid;
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid password reset request' USING ERRCODE = '22023';
  END IF;
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, 'public', p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_account FROM v3.staff_accounts
    WHERE lower(username) = lower(p_username) FOR UPDATE;
  IF FOUND AND v_account.disabled = false THEN
    UPDATE v3.password_reset_requests
      SET status = 'superseded', revision = revision + 1,
          code_hash = NULL, code_expires_at = NULL,
          closed_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE account_id = v_account.id AND status IN ('pending','approved');
    INSERT INTO v3.password_reset_requests (
      facility_id, account_id, expires_at
    ) VALUES (
      v_facility_id, v_account.id, clock_timestamp() + interval '7 days'
    ) RETURNING id INTO v_request_id;
    PERFORM v3.account_audit(
      v_facility_id, NULL, 'password_reset_requested', v_account.id,
      'password_reset', v_request_id, p_command_id,
      jsonb_build_object('revision', 1)
    );
  END IF;
  v_replay := '{"outcome":"accepted","replayed":true}'::jsonb;
  PERFORM v3.account_store_receipt(
    v_facility_id, 'public', p_command_id, p_request_hash, v_replay
  );
  RETURN '{"outcome":"accepted","replayed":false}'::jsonb;
END
$$;

CREATE FUNCTION v3.list_password_reset_requests(p_actor_id uuid)
RETURNS TABLE (
  request_id uuid,
  staff_id uuid,
  username text,
  role_name text,
  status text,
  requested_at timestamptz,
  expires_at timestamptz,
  revision bigint,
  approved_at timestamptz,
  code_expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
BEGIN
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'approve-password-resets');
  RETURN QUERY
    SELECT q.id, u.id, u.username, r.name,
      CASE
        WHEN q.status = 'pending' AND q.expires_at <= clock_timestamp() THEN 'expired'
        WHEN q.status = 'approved' AND q.code_expires_at <= clock_timestamp() THEN 'expired'
        ELSE q.status
      END,
      q.requested_at, q.expires_at, q.revision, q.approved_at, q.code_expires_at
    FROM v3.password_reset_requests AS q
    JOIN v3.staff_accounts AS u ON u.id = q.account_id
    JOIN v3.user_roles AS ur ON ur.user_id = u.id
    JOIN v3.roles AS r ON r.name = ur.role_name
    WHERE q.facility_id = v3.account_facility_id()
      AND v3.account_capabilities_cover(v_actor_capabilities, r.capabilities)
    ORDER BY q.requested_at DESC, q.id
    LIMIT 200;
END
$$;

CREATE FUNCTION v3.approve_password_reset(
  p_actor_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_code_hash text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_reset v3.password_reset_requests%ROWTYPE;
  v_account v3.staff_accounts%ROWTYPE;
  v_current jsonb;
  v_receipt_response jsonb;
BEGIN
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid password reset approval' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'approve-password-resets');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_reset FROM v3.password_reset_requests
    WHERE id = p_request_id AND facility_id = v_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  SELECT * INTO v_account FROM v3.staff_accounts WHERE id = v_reset.account_id FOR UPDATE;
  SELECT r.capabilities INTO v_target_capabilities
    FROM v3.user_roles AS ur JOIN v3.roles AS r ON r.name = ur.role_name
    WHERE ur.user_id = v_account.id;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;
  v_current := v3.account_reset_json(p_request_id);
  IF v_reset.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'currentRequest', v_current);
  END IF;
  IF v_reset.status <> 'pending' OR v_reset.expires_at <= clock_timestamp()
     OR v_account.disabled THEN
    RETURN jsonb_build_object('outcome', 'invalid_state', 'currentRequest', v_current);
  END IF;
  UPDATE v3.password_reset_requests
    SET status = 'approved', revision = revision + 1,
        approved_by = p_actor_id, approved_at = clock_timestamp(),
        code_hash = p_code_hash,
        code_expires_at = clock_timestamp() + interval '30 minutes',
        updated_at = clock_timestamp()
    WHERE id = p_request_id;
  UPDATE v3.staff_sessions SET revoked_at = clock_timestamp()
    WHERE user_id = v_account.id AND revoked_at IS NULL;
  v_current := v3.account_reset_json(p_request_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'password_reset_approved', v_account.id,
    'password_reset', p_request_id, p_command_id,
    jsonb_build_object('revision', v_reset.revision + 1)
  );
  v_receipt_response := jsonb_build_object(
    'outcome', 'secret_replay_unavailable', 'request', v_current, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_receipt_response
  );
  RETURN jsonb_build_object('outcome', 'approved', 'request', v_current, 'replayed', false);
END
$$;

CREATE FUNCTION v3.decline_password_reset(
  p_actor_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_reset v3.password_reset_requests%ROWTYPE;
  v_account v3.staff_accounts%ROWTYPE;
  v_current jsonb;
BEGIN
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Invalid password reset decline' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'approve-password-resets');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_reset FROM v3.password_reset_requests
    WHERE id = p_request_id AND facility_id = v_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  SELECT * INTO v_account FROM v3.staff_accounts WHERE id = v_reset.account_id FOR UPDATE;
  SELECT r.capabilities INTO v_target_capabilities
    FROM v3.user_roles AS ur JOIN v3.roles AS r ON r.name = ur.role_name
    WHERE ur.user_id = v_account.id;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;
  v_current := v3.account_reset_json(p_request_id);
  IF v_reset.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'currentRequest', v_current);
  END IF;
  IF v_reset.status <> 'pending' OR v_reset.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('outcome', 'invalid_state', 'currentRequest', v_current);
  END IF;
  UPDATE v3.password_reset_requests
    SET status = 'declined', revision = revision + 1,
        closed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = p_request_id;
  v_current := v3.account_reset_json(p_request_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'password_reset_declined', v_account.id,
    'password_reset', p_request_id, p_command_id,
    jsonb_build_object('revision', v_reset.revision + 1)
  );
  v_replay := jsonb_build_object(
    'outcome', 'declined', 'request', v_current, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_replay
  );
  RETURN jsonb_build_object('outcome', 'declined', 'request', v_current, 'replayed', false);
END
$$;

CREATE FUNCTION v3.reissue_password_reset_code(
  p_actor_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_code_hash text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_reset v3.password_reset_requests%ROWTYPE;
  v_account v3.staff_accounts%ROWTYPE;
  v_current jsonb;
  v_receipt_response jsonb;
BEGIN
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid password reset reissue' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'approve-password-resets');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_reset FROM v3.password_reset_requests
    WHERE id = p_request_id AND facility_id = v_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  SELECT * INTO v_account FROM v3.staff_accounts WHERE id = v_reset.account_id FOR UPDATE;
  SELECT r.capabilities INTO v_target_capabilities
    FROM v3.user_roles AS ur JOIN v3.roles AS r ON r.name = ur.role_name
    WHERE ur.user_id = v_account.id;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;
  v_current := v3.account_reset_json(p_request_id);
  IF v_reset.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'currentRequest', v_current);
  END IF;
  IF v_reset.status <> 'approved' OR v_reset.code_expires_at <= clock_timestamp()
     OR v_account.disabled THEN
    RETURN jsonb_build_object('outcome', 'invalid_state', 'currentRequest', v_current);
  END IF;
  UPDATE v3.password_reset_requests
    SET revision = revision + 1, code_hash = p_code_hash,
        code_expires_at = clock_timestamp() + interval '30 minutes',
        updated_at = clock_timestamp()
    WHERE id = p_request_id;
  UPDATE v3.staff_sessions SET revoked_at = clock_timestamp()
    WHERE user_id = v_account.id AND revoked_at IS NULL;
  v_current := v3.account_reset_json(p_request_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'password_reset_code_reissued', v_account.id,
    'password_reset', p_request_id, p_command_id,
    jsonb_build_object('revision', v_reset.revision + 1)
  );
  v_receipt_response := jsonb_build_object(
    'outcome', 'secret_replay_unavailable', 'request', v_current, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_receipt_response
  );
  RETURN jsonb_build_object('outcome', 'reissued', 'request', v_current, 'replayed', false);
END
$$;

CREATE FUNCTION v3.complete_password_reset(
  p_username text,
  p_code_hash text,
  p_password_hash text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility_id uuid;
  v_replay jsonb;
  v_account v3.staff_accounts%ROWTYPE;
  v_reset v3.password_reset_requests%ROWTYPE;
  v_approver_capabilities jsonb;
  v_target_capabilities jsonb;
BEGIN
  IF p_username IS NULL OR length(btrim(p_username)) NOT BETWEEN 3 AND 40
     OR p_username <> btrim(p_username) OR p_username ~ '[[:cntrl:]]'
     OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$'
     OR p_password_hash IS NULL OR length(p_password_hash) NOT BETWEEN 20 AND 256
     OR p_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid password reset completion' USING ERRCODE = '22023';
  END IF;
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, 'public', p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_account FROM v3.staff_accounts
    WHERE lower(username) = lower(p_username) FOR UPDATE;
  IF NOT FOUND OR v_account.disabled THEN RETURN '{"outcome":"invalid"}'::jsonb; END IF;
  SELECT * INTO v_reset FROM v3.password_reset_requests
    WHERE account_id = v_account.id AND status = 'approved'
      AND code_hash = p_code_hash
    FOR UPDATE;
  IF NOT FOUND OR v_reset.code_expires_at <= clock_timestamp()
     OR v_reset.approved_by IS NULL THEN
    RETURN '{"outcome":"invalid"}'::jsonb;
  END IF;
  v_approver_capabilities := v3.account_actor_capabilities(v_reset.approved_by);
  SELECT r.capabilities INTO v_target_capabilities
    FROM v3.user_roles AS ur JOIN v3.roles AS r ON r.name = ur.role_name
    WHERE ur.user_id = v_account.id;
  IF v_approver_capabilities IS NULL
     OR NOT v_approver_capabilities ? 'approve-password-resets'
     OR NOT v3.account_capabilities_cover(v_approver_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"invalid"}'::jsonb;
  END IF;

  UPDATE v3.staff_accounts
    SET password_hash = p_password_hash, password_changed_at = clock_timestamp(),
        revision = revision + 1
    WHERE id = v_account.id;
  UPDATE v3.password_reset_requests
    SET status = 'used', revision = revision + 1,
        code_hash = NULL, code_expires_at = NULL,
        used_at = clock_timestamp(), closed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = v_reset.id;
  UPDATE v3.staff_sessions SET revoked_at = clock_timestamp()
    WHERE user_id = v_account.id AND revoked_at IS NULL;
  PERFORM v3.account_audit(
    v_facility_id, NULL, 'password_reset_completed', v_account.id,
    'password_reset', v_reset.id, p_command_id,
    jsonb_build_object('approvedBy', v_reset.approved_by, 'revision', v_reset.revision + 1)
  );
  v_replay := '{"outcome":"completed","replayed":true}'::jsonb;
  PERFORM v3.account_store_receipt(
    v_facility_id, 'public', p_command_id, p_request_hash, v_replay
  );
  RETURN '{"outcome":"completed","replayed":false}'::jsonb;
END
$$;

CREATE FUNCTION v3.change_own_password(
  p_actor_id uuid,
  p_current_password_hash text,
  p_new_password_hash text,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_facility_id uuid;
  v_replay jsonb;
  v_account v3.staff_accounts%ROWTYPE;
BEGIN
  IF p_current_password_hash IS NULL OR length(p_current_password_hash) NOT BETWEEN 20 AND 256
     OR p_new_password_hash IS NULL OR length(p_new_password_hash) NOT BETWEEN 20 AND 256
     OR p_new_password_hash NOT LIKE 'argon2id$v=19$m=19456,t=2,p=1$%$%' THEN
    RAISE EXCEPTION 'Invalid password change' USING ERRCODE = '22023';
  END IF;
  IF v3.account_actor_capabilities(p_actor_id) IS NULL THEN
    RAISE EXCEPTION 'Account operation is not authorized' USING ERRCODE = '42501';
  END IF;
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_account FROM v3.staff_accounts WHERE id = p_actor_id FOR UPDATE;
  IF NOT FOUND OR v_account.disabled THEN
    RAISE EXCEPTION 'Account operation is not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_account.password_hash <> p_current_password_hash THEN
    RETURN '{"outcome":"current_password_mismatch"}'::jsonb;
  END IF;
  UPDATE v3.staff_accounts
    SET password_hash = p_new_password_hash, password_changed_at = clock_timestamp(),
        revision = revision + 1
    WHERE id = p_actor_id;
  UPDATE v3.password_reset_requests
    SET status = 'invalidated', revision = revision + 1,
        code_hash = NULL, code_expires_at = NULL,
        closed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE account_id = p_actor_id AND status IN ('pending','approved');
  UPDATE v3.staff_sessions SET revoked_at = clock_timestamp()
    WHERE user_id = p_actor_id AND revoked_at IS NULL;
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'password_changed', p_actor_id,
    'account', p_actor_id, p_command_id,
    jsonb_build_object('revision', v_account.revision + 1)
  );
  v_replay := jsonb_build_object(
    'outcome', 'changed', 'revision', v_account.revision + 1, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_replay
  );
  RETURN jsonb_build_object(
    'outcome', 'changed', 'revision', v_account.revision + 1, 'replayed', false
  );
END
$$;

CREATE FUNCTION v3.revoke_staff_sessions(
  p_actor_id uuid,
  p_staff_id uuid,
  p_expected_revision bigint,
  p_command_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_actor_capabilities jsonb;
  v_target_capabilities jsonb;
  v_facility_id uuid;
  v_replay jsonb;
  v_account v3.staff_accounts%ROWTYPE;
  v_staff jsonb;
BEGIN
  IF p_staff_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Invalid session revocation' USING ERRCODE = '22023';
  END IF;
  v_actor_capabilities := v3.account_authorize(p_actor_id, 'manage-staff');
  v_facility_id := v3.account_facility_id();
  PERFORM pg_advisory_xact_lock(20855409, 1);
  v_replay := v3.account_replay(v_facility_id, p_actor_id::text, p_command_id, p_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_account FROM v3.staff_accounts WHERE id = p_staff_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  SELECT r.capabilities INTO v_target_capabilities
    FROM v3.user_roles AS ur JOIN v3.roles AS r ON r.name = ur.role_name
    WHERE ur.user_id = p_staff_id;
  IF NOT v3.account_capabilities_cover(v_actor_capabilities, v_target_capabilities) THEN
    RETURN '{"outcome":"capability_exceeded"}'::jsonb;
  END IF;
  v_staff := v3.account_staff_json(p_staff_id);
  IF v_account.revision <> p_expected_revision THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'currentStaff', v_staff);
  END IF;
  UPDATE v3.staff_sessions SET revoked_at = clock_timestamp()
    WHERE user_id = p_staff_id AND revoked_at IS NULL;
  UPDATE v3.staff_accounts SET revision = revision + 1 WHERE id = p_staff_id;
  v_staff := v3.account_staff_json(p_staff_id);
  PERFORM v3.account_audit(
    v_facility_id, p_actor_id, 'sessions_revoked', p_staff_id,
    'account', p_staff_id, p_command_id,
    jsonb_build_object('revision', v_account.revision + 1)
  );
  v_replay := jsonb_build_object(
    'outcome', 'revoked', 'staff', v_staff, 'replayed', true
  );
  PERFORM v3.account_store_receipt(
    v_facility_id, p_actor_id::text, p_command_id, p_request_hash, v_replay
  );
  RETURN jsonb_build_object(
    'outcome', 'revoked', 'staff', v_staff, 'replayed', false
  );
END
$$;

CREATE FUNCTION v3.purge_account_lifecycle_metadata(p_batch_size integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, v3
AS $$
DECLARE
  v_limit integer := least(1000, greatest(1, coalesce(p_batch_size, 1000)));
  v_invitations integer := 0;
  v_resets integer := 0;
BEGIN
  WITH doomed AS (
    SELECT id FROM v3.staff_invitations
    WHERE updated_at < clock_timestamp() - interval '30 days'
      AND (status <> 'active' OR expires_at <= clock_timestamp())
    ORDER BY updated_at, id LIMIT v_limit
  )
  DELETE FROM v3.staff_invitations AS i USING doomed WHERE i.id = doomed.id;
  GET DIAGNOSTICS v_invitations = ROW_COUNT;
  WITH doomed AS (
    SELECT id FROM v3.password_reset_requests
    WHERE updated_at < clock_timestamp() - interval '90 days'
      AND (
        status NOT IN ('pending','approved')
        OR (status = 'pending' AND expires_at <= clock_timestamp())
        OR (status = 'approved' AND code_expires_at <= clock_timestamp())
      )
    ORDER BY updated_at, id LIMIT greatest(0, v_limit - v_invitations)
  )
  DELETE FROM v3.password_reset_requests AS q USING doomed WHERE q.id = doomed.id;
  GET DIAGNOSTICS v_resets = ROW_COUNT;
  RETURN v_invitations + v_resets;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA v3 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v3 FROM PUBLIC;

COMMENT ON TABLE v3.staff_invitations IS
  'Single-use manager invitations; only SHA-256 bearer-secret hashes are stored.';
COMMENT ON TABLE v3.password_reset_requests IS
  'Approved account recovery with expiring single-use code hashes and full lifecycle revisions.';
COMMENT ON TABLE v3.account_audit_events IS
  'Append-only non-secret account mutation audit; passwords, codes, tokens, and hashes are prohibited.';
COMMENT ON TABLE v3.account_command_receipts IS
  'Non-secret account command outcomes keyed by facility, server-derived actor scope, and command ID.';
COMMENT ON FUNCTION v3.update_staff_account(uuid, uuid, boolean, text, bigint, text, text) IS
  'Capability-covered, revision-checked account changes preserve the last enabled manage-staff holder and revoke sessions.';
COMMENT ON FUNCTION v3.complete_password_reset(text, text, text, text, text) IS
  'Completes recovery atomically only while the approver and target retain their required privileges.';

COMMIT;
