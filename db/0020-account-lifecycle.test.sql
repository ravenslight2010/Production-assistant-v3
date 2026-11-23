BEGIN;
INSERT INTO v3.roles (name, capabilities, builtin) VALUES
  ('limited-manager', '["manage-staff"]'::jsonb, false),
  ('reset-approver', '["approve-password-resets"]'::jsonb, false);
INSERT INTO v3.staff_accounts (id, username, password_hash) VALUES
  ('72000000-0000-4000-8000-000000000001', 'AccountManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
  ('72000000-0000-4000-8000-000000000002', 'LimitedManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
  ('72000000-0000-4000-8000-000000000003', 'AccountOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
INSERT INTO v3.user_roles (user_id, role_name) VALUES
  ('72000000-0000-4000-8000-000000000001', 'manager'),
  ('72000000-0000-4000-8000-000000000002', 'limited-manager'),
  ('72000000-0000-4000-8000-000000000003', 'operator');
DO $$
DECLARE
  v_result jsonb;
  v_staff_id uuid;
BEGIN
  v_result := v3.create_staff_account(
    '72000000-0000-4000-8000-000000000002', 'LimitedCreatesManager',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', 'manager',
    'limited-create-manager', repeat('a', 64)
  );
  IF v_result->>'outcome' <> 'capability_exceeded' THEN
    RAISE EXCEPTION 'limited manager granted capabilities outside its subset: %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM v3.list_staff_roles('72000000-0000-4000-8000-000000000002')
    WHERE role_name = 'manager'
  ) THEN RAISE EXCEPTION 'assignable role list leaked manager capabilities'; END IF;

  v_result := v3.create_staff_account(
    '72000000-0000-4000-8000-000000000002', 'LimitedCreatedOperator',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', 'operator',
    'limited-create-operator', repeat('b', 64)
  );
  v_staff_id := (v_result->'staff'->>'userId')::uuid;
  IF v_result->>'outcome' <> 'created' OR v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'covered account creation failed: %', v_result;
  END IF;
  v_result := v3.create_staff_account(
    '72000000-0000-4000-8000-000000000002', 'LimitedCreatedOperator',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', 'operator',
    'limited-create-operator', repeat('b', 64)
  );
  IF v_result->>'replayed' <> 'true'
     OR (v_result->'staff'->>'userId')::uuid <> v_staff_id THEN
    RAISE EXCEPTION 'account creation retry did not replay safely: %', v_result;
  END IF;
  v_result := v3.create_staff_account(
    '72000000-0000-4000-8000-000000000002', 'DifferentUsername',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==', 'operator',
    'limited-create-operator', repeat('c', 64)
  );
  IF v_result->>'outcome' <> 'request_mismatch' THEN
    RAISE EXCEPTION 'changed command reused a request ID: %', v_result;
  END IF;
  v_result := v3.update_staff_account(
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000003', NULL, 'manager', 1,
    'limited-role-escalation', repeat('d', 64)
  );
  IF v_result->>'outcome' <> 'capability_exceeded' THEN
    RAISE EXCEPTION 'role update escaped actor capability subset: %', v_result;
  END IF;

  v_result := v3.update_staff_account(
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002', NULL, 'operator', 1,
    'demote-limited-manager', repeat('e', 64)
  );
  IF v_result->>'outcome' <> 'updated' THEN
    RAISE EXCEPTION 'manager could not demote covered custom manager: %', v_result;
  END IF;
  v_result := v3.update_staff_account(
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001', true, NULL, 1,
    'disable-last-capability-holder', repeat('f', 64)
  );
  IF v_result->>'outcome' <> 'last_manager' THEN
    RAISE EXCEPTION 'last enabled manage-staff holder was not protected: %', v_result;
  END IF;
  IF (SELECT revision FROM v3.staff_accounts
      WHERE id = '72000000-0000-4000-8000-000000000002') <> 2 THEN
    RAISE EXCEPTION 'account update did not increment its revision';
  END IF;
END $$;
ROLLBACK;

BEGIN;
INSERT INTO v3.staff_accounts (id, username, password_hash) VALUES
  ('72100000-0000-4000-8000-000000000001', 'InvitationManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
INSERT INTO v3.user_roles (user_id, role_name) VALUES
  ('72100000-0000-4000-8000-000000000001', 'manager');
DO $$
DECLARE
  v_result jsonb;
  v_invitation_id uuid;
  v_staff_id uuid;
BEGIN
  v_result := v3.create_staff_invitation(
    '72100000-0000-4000-8000-000000000001', 'operator', repeat('0', 64),
    'invite-one', repeat('1', 64)
  );
  v_invitation_id := (v_result->'invitation'->>'invitationId')::uuid;
  IF v_result->>'outcome' <> 'created'
     OR (v_result->'invitation'->>'status') <> 'active' THEN
    RAISE EXCEPTION 'invitation creation failed: %', v_result;
  END IF;
  v_result := v3.create_staff_invitation(
    '72100000-0000-4000-8000-000000000001', 'operator', repeat('0', 64),
    'invite-one', repeat('1', 64)
  );
  IF v_result->>'outcome' <> 'secret_replay_unavailable'
     OR v_result ? 'secret' OR v_result ? 'tokenHash' THEN
    RAISE EXCEPTION 'invitation retry exposed or recreated a secret: %', v_result;
  END IF;

  v_result := v3.accept_staff_invitation(
    repeat('0', 64), 'InvitedOperator',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'accept-one', repeat('2', 64)
  );
  v_staff_id := (v_result->'staff'->>'userId')::uuid;
  IF v_result->>'outcome' <> 'accepted' THEN
    RAISE EXCEPTION 'valid invitation was not accepted: %', v_result;
  END IF;
  v_result := v3.accept_staff_invitation(
    repeat('0', 64), 'InvitedOperator',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'accept-one', repeat('2', 64)
  );
  IF v_result->>'outcome' <> 'accepted_sign_in_required'
     OR (v_result->'staff'->>'userId')::uuid <> v_staff_id THEN
    RAISE EXCEPTION 'lost acceptance response did not recover through sign-in: %', v_result;
  END IF;
  IF (SELECT status FROM v3.staff_invitations WHERE id = v_invitation_id) <> 'consumed' THEN
    RAISE EXCEPTION 'accepted invitation was not consumed';
  END IF;
  v_result := v3.accept_staff_invitation(
    repeat('0', 64), 'DifferentUser',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'accept-consumed', repeat('3', 64)
  );
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'consumed invitation was accepted again: %', v_result;
  END IF;

  v_result := v3.create_staff_invitation(
    '72100000-0000-4000-8000-000000000001', 'operator', repeat('4', 64),
    'invite-two', repeat('5', 64)
  );
  v_invitation_id := (v_result->'invitation'->>'invitationId')::uuid;
  v_result := v3.revoke_staff_invitation(
    '72100000-0000-4000-8000-000000000001', v_invitation_id, 1,
    'revoke-two', repeat('6', 64)
  );
  IF v_result->>'outcome' <> 'revoked'
     OR v_result->'invitation'->>'status' <> 'revoked' THEN
    RAISE EXCEPTION 'active invitation could not be revoked: %', v_result;
  END IF;
  v_result := v3.accept_staff_invitation(
    repeat('4', 64), 'RevokedUser',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'accept-revoked', repeat('7', 64)
  );
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'revoked invitation was accepted: %', v_result;
  END IF;

  v_result := v3.create_staff_invitation(
    '72100000-0000-4000-8000-000000000001', 'operator', repeat('8', 64),
    'invite-expired', repeat('9', 64)
  );
  UPDATE v3.staff_invitations
    SET created_at = clock_timestamp() - interval '25 hours',
        updated_at = clock_timestamp() - interval '25 hours',
        expires_at = clock_timestamp() - interval '1 second'
    WHERE token_hash = repeat('8', 64);
  v_result := v3.accept_staff_invitation(
    repeat('8', 64), 'ExpiredUser',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'accept-expired', repeat('a', 64)
  );
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'expired invitation was accepted: %', v_result;
  END IF;
END $$;
ROLLBACK;

BEGIN;
INSERT INTO v3.roles (name, capabilities, builtin) VALUES
  ('reset-approver', '["approve-password-resets"]'::jsonb, false);
INSERT INTO v3.staff_accounts (id, username, password_hash) VALUES
  ('72200000-0000-4000-8000-000000000001', 'ResetManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
  ('72200000-0000-4000-8000-000000000002', 'ResetApprover', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
  ('72200000-0000-4000-8000-000000000003', 'ResetOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
INSERT INTO v3.user_roles (user_id, role_name) VALUES
  ('72200000-0000-4000-8000-000000000001', 'manager'),
  ('72200000-0000-4000-8000-000000000002', 'reset-approver'),
  ('72200000-0000-4000-8000-000000000003', 'operator');
DO $$
DECLARE
  v_result jsonb;
  v_request_id uuid;
  v_second_request uuid;
BEGIN
  PERFORM v3.open_staff_session(
    '72200000-0000-4000-8000-000000000003', repeat('a', 64), repeat('b', 64),
    clock_timestamp() + interval '1 day'
  );
  v_result := v3.request_password_reset('resetoperator', 'reset-request-one', repeat('c', 64));
  IF v_result->>'outcome' <> 'accepted' OR v_result ? 'requestId' THEN
    RAISE EXCEPTION 'public reset request leaked account metadata: %', v_result;
  END IF;
  SELECT id INTO v_request_id FROM v3.password_reset_requests
    WHERE account_id = '72200000-0000-4000-8000-000000000003' AND status = 'pending';
  IF NOT EXISTS (
    SELECT 1 FROM v3.list_password_reset_requests('72200000-0000-4000-8000-000000000002')
    WHERE request_id = v_request_id
  ) THEN RAISE EXCEPTION 'covered reset-only approver could not see the request'; END IF;

  v_result := v3.approve_password_reset(
    '72200000-0000-4000-8000-000000000002', v_request_id, 1, repeat('d', 64),
    'reset-approve-one', repeat('e', 64)
  );
  IF v_result->>'outcome' <> 'approved'
     OR v_result->'request'->>'status' <> 'approved' THEN
    RAISE EXCEPTION 'reset approval failed: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM v3.resolve_staff_session(repeat('a', 64))) THEN
    RAISE EXCEPTION 'approval did not revoke existing target sessions';
  END IF;
  v_result := v3.approve_password_reset(
    '72200000-0000-4000-8000-000000000002', v_request_id, 1, repeat('d', 64),
    'reset-approve-one', repeat('e', 64)
  );
  IF v_result->>'outcome' <> 'secret_replay_unavailable' OR v_result ? 'code' THEN
    RAISE EXCEPTION 'approval replay exposed a reset code: %', v_result;
  END IF;

  v_result := v3.reissue_password_reset_code(
    '72200000-0000-4000-8000-000000000002', v_request_id, 2, repeat('f', 64),
    'reset-reissue-one', repeat('0', 64)
  );
  IF v_result->>'outcome' <> 'reissued' OR v_result->'request'->>'revision' <> '3' THEN
    RAISE EXCEPTION 'reset code reissue failed: %', v_result;
  END IF;
  v_result := v3.complete_password_reset(
    'ResetOperator', repeat('d', 64),
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$bmV3aGFzaA==',
    'old-code-complete', repeat('1', 64)
  );
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'reissued request accepted its old code: %', v_result;
  END IF;
  v_result := v3.complete_password_reset(
    'ResetOperator', repeat('f', 64),
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$bmV3aGFzaA==',
    'new-code-complete', repeat('2', 64)
  );
  IF v_result->>'outcome' <> 'completed' THEN
    RAISE EXCEPTION 'replacement reset code did not complete: %', v_result;
  END IF;
  IF (SELECT status FROM v3.password_reset_requests WHERE id = v_request_id) <> 'used'
     OR (SELECT code_hash FROM v3.password_reset_requests WHERE id = v_request_id) IS NOT NULL THEN
    RAISE EXCEPTION 'completed reset did not consume and clear its code';
  END IF;
  v_result := v3.complete_password_reset(
    'ResetOperator', repeat('f', 64),
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$bmV3aGFzaA==',
    'new-code-complete', repeat('2', 64)
  );
  IF v_result->>'outcome' <> 'completed' OR v_result->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'completion response loss was not idempotent: %', v_result;
  END IF;

  PERFORM v3.request_password_reset('ResetOperator', 'reset-request-decline', repeat('3', 64));
  SELECT id INTO v_second_request FROM v3.password_reset_requests
    WHERE account_id = '72200000-0000-4000-8000-000000000003' AND status = 'pending';
  PERFORM v3.open_staff_session(
    '72200000-0000-4000-8000-000000000003', repeat('4', 64), repeat('5', 64),
    clock_timestamp() + interval '1 day'
  );
  v_result := v3.decline_password_reset(
    '72200000-0000-4000-8000-000000000002', v_second_request, 1,
    'reset-decline', repeat('6', 64)
  );
  IF v_result->>'outcome' <> 'declined' THEN
    RAISE EXCEPTION 'reset decline failed: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v3.resolve_staff_session(repeat('4', 64))) THEN
    RAISE EXCEPTION 'decline incorrectly revoked target sessions';
  END IF;

  PERFORM v3.request_password_reset('ResetManager', 'manager-reset-request', repeat('7', 64));
  SELECT id INTO v_second_request FROM v3.password_reset_requests
    WHERE account_id = '72200000-0000-4000-8000-000000000001' AND status = 'pending';
  v_result := v3.approve_password_reset(
    '72200000-0000-4000-8000-000000000002', v_second_request, 1, repeat('8', 64),
    'approve-out-of-scope', repeat('9', 64)
  );
  IF v_result->>'outcome' <> 'capability_exceeded' THEN
    RAISE EXCEPTION 'reset-only approver could take over a manager: %', v_result;
  END IF;
END $$;
ROLLBACK;

BEGIN;
INSERT INTO v3.roles (name, capabilities, builtin) VALUES
  ('reset-approver', '["approve-password-resets"]'::jsonb, false);
INSERT INTO v3.staff_accounts (id, username, password_hash) VALUES
  ('72300000-0000-4000-8000-000000000001', 'PrivilegeManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
  ('72300000-0000-4000-8000-000000000002', 'PrivilegeApprover', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
  ('72300000-0000-4000-8000-000000000003', 'PrivilegeOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
INSERT INTO v3.user_roles (user_id, role_name) VALUES
  ('72300000-0000-4000-8000-000000000001', 'manager'),
  ('72300000-0000-4000-8000-000000000002', 'reset-approver'),
  ('72300000-0000-4000-8000-000000000003', 'operator');
DO $$
DECLARE
  v_request_id uuid;
  v_result jsonb;
BEGIN
  PERFORM v3.request_password_reset('PrivilegeOperator', 'privilege-request', repeat('a', 64));
  SELECT id INTO v_request_id FROM v3.password_reset_requests
    WHERE account_id = '72300000-0000-4000-8000-000000000003' AND status = 'pending';
  PERFORM v3.approve_password_reset(
    '72300000-0000-4000-8000-000000000002', v_request_id, 1, repeat('b', 64),
    'privilege-approve', repeat('c', 64)
  );
  PERFORM v3.update_staff_account(
    '72300000-0000-4000-8000-000000000001',
    '72300000-0000-4000-8000-000000000002', NULL, 'operator', 1,
    'remove-approver-privilege', repeat('d', 64)
  );
  v_result := v3.complete_password_reset(
    'PrivilegeOperator', repeat('b', 64),
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$bmV3aGFzaA==',
    'privilege-complete', repeat('e', 64)
  );
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'old code survived approver privilege removal: %', v_result;
  END IF;
END $$;
ROLLBACK;

BEGIN;
INSERT INTO v3.staff_accounts (id, username, password_hash) VALUES
  ('72400000-0000-4000-8000-000000000001', 'SelfManager', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA=='),
  ('72400000-0000-4000-8000-000000000002', 'SelfOperator', 'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==');
INSERT INTO v3.user_roles (user_id, role_name) VALUES
  ('72400000-0000-4000-8000-000000000001', 'manager'),
  ('72400000-0000-4000-8000-000000000002', 'operator');
DO $$
DECLARE
  v_result jsonb;
  v_request_id uuid;
  v_invitation_id uuid;
  v_audit_count integer;
  v_purged integer;
BEGIN
  PERFORM v3.open_staff_session(
    '72400000-0000-4000-8000-000000000002', repeat('a', 64), repeat('b', 64),
    clock_timestamp() + interval '1 day'
  );
  PERFORM v3.request_password_reset('SelfOperator', 'self-reset-request', repeat('c', 64));
  v_result := v3.change_own_password(
    '72400000-0000-4000-8000-000000000002',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==',
    'argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$bmV3aGFzaA==',
    'self-change', repeat('d', 64)
  );
  IF v_result->>'outcome' <> 'changed'
     OR EXISTS (SELECT 1 FROM v3.resolve_staff_session(repeat('a', 64)))
     OR EXISTS (SELECT 1 FROM v3.password_reset_requests
       WHERE account_id = '72400000-0000-4000-8000-000000000002'
         AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'self password change did not revoke sessions and recovery: %', v_result;
  END IF;
  PERFORM v3.open_staff_session(
    '72400000-0000-4000-8000-000000000002', repeat('e', 64), repeat('f', 64),
    clock_timestamp() + interval '1 day'
  );
  v_result := v3.revoke_staff_sessions(
    '72400000-0000-4000-8000-000000000001',
    '72400000-0000-4000-8000-000000000002', 1,
    'stale-session-revoke', repeat('0', 64)
  );
  IF v_result->>'outcome' <> 'conflict' THEN
    RAISE EXCEPTION 'stale manual session revocation was accepted: %', v_result;
  END IF;
  v_result := v3.revoke_staff_sessions(
    '72400000-0000-4000-8000-000000000001',
    '72400000-0000-4000-8000-000000000002', 2,
    'session-revoke', repeat('1', 64)
  );
  IF v_result->>'outcome' <> 'revoked'
     OR EXISTS (SELECT 1 FROM v3.resolve_staff_session(repeat('e', 64))) THEN
    RAISE EXCEPTION 'manual session revocation failed: %', v_result;
  END IF;

  v_result := v3.create_staff_invitation(
    '72400000-0000-4000-8000-000000000001', 'operator', repeat('2', 64),
    'retention-invite', repeat('3', 64)
  );
  v_invitation_id := (v_result->'invitation'->>'invitationId')::uuid;
  PERFORM v3.revoke_staff_invitation(
    '72400000-0000-4000-8000-000000000001', v_invitation_id, 1,
    'retention-revoke', repeat('4', 64)
  );
  UPDATE v3.staff_invitations SET updated_at = clock_timestamp() - interval '31 days'
    WHERE id = v_invitation_id;
  SELECT id INTO v_request_id FROM v3.password_reset_requests
    WHERE account_id = '72400000-0000-4000-8000-000000000002';
  UPDATE v3.password_reset_requests SET updated_at = clock_timestamp() - interval '91 days'
    WHERE id = v_request_id;
  v_purged := v3.purge_account_lifecycle_metadata(1000);
  IF v_purged <> 2
     OR EXISTS (SELECT 1 FROM v3.staff_invitations WHERE id = v_invitation_id)
     OR EXISTS (SELECT 1 FROM v3.password_reset_requests WHERE id = v_request_id) THEN
    RAISE EXCEPTION 'bounded lifecycle retention failed: purged %, invitation %, reset %',
      v_purged, v_invitation_id, v_request_id;
  END IF;
  SELECT count(*) INTO v_audit_count FROM v3.account_audit_events;
  IF v_audit_count < 5 OR EXISTS (
    SELECT 1 FROM v3.account_audit_events
    WHERE metadata::text ~ 'argon2id|codeHash|tokenHash|password|csrf|sessionToken'
  ) THEN RAISE EXCEPTION 'account audit was missing or contained secrets'; END IF;
END $$;
ROLLBACK;
