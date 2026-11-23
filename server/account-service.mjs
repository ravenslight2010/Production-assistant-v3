import { randomInt } from "node:crypto";
import {
  createRateLimiter,
  hashHex,
  hashPassword,
  randomToken,
  V3AuthError,
  verifyPassword,
} from "./auth-crypto.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TRANSIENT_DATABASE_CODES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "40001", "40P01", "53300", "57P01", "57P02", "57P03", "57014",
]);

const CREATE_STAFF_SQL = "SELECT v3.create_staff_account($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text) AS outcome";
const UPDATE_STAFF_SQL = "SELECT v3.update_staff_account($1::uuid, $2::uuid, $3::boolean, $4::text, $5::bigint, $6::text, $7::text) AS outcome";
const CREATE_INVITATION_SQL = "SELECT v3.create_staff_invitation($1::uuid, $2::text, $3::text, $4::text, $5::text) AS outcome";
const LIST_INVITATIONS_SQL = "SELECT * FROM v3.list_staff_invitations($1::uuid)";
const REVOKE_INVITATION_SQL = "SELECT v3.revoke_staff_invitation($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text) AS outcome";
const ACCEPT_INVITATION_SQL = "SELECT v3.accept_staff_invitation($1::text, $2::text, $3::text, $4::text, $5::text) AS outcome";
const REQUEST_RESET_SQL = "SELECT v3.request_password_reset($1::text, $2::text, $3::text) AS outcome";
const LIST_RESETS_SQL = "SELECT * FROM v3.list_password_reset_requests($1::uuid)";
const APPROVE_RESET_SQL = "SELECT v3.approve_password_reset($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text) AS outcome";
const DECLINE_RESET_SQL = "SELECT v3.decline_password_reset($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text) AS outcome";
const REISSUE_RESET_SQL = "SELECT v3.reissue_password_reset_code($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text) AS outcome";
const COMPLETE_RESET_SQL = "SELECT v3.complete_password_reset($1::text, $2::text, $3::text, $4::text, $5::text) AS outcome";
const FIND_STAFF_SQL = "SELECT * FROM v3.find_staff_for_sign_in($1::text)";
const CHANGE_PASSWORD_SQL = "SELECT v3.change_own_password($1::uuid, $2::text, $3::text, $4::text, $5::text) AS outcome";
const REVOKE_SESSIONS_SQL = "SELECT v3.revoke_staff_sessions($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text) AS outcome";

function commandHash(command) {
  return hashHex(JSON.stringify(command));
}

function iso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

function validateLimit(name, limit) {
  if (
    !Number.isSafeInteger(limit?.maxAttempts) || limit.maxAttempts < 1
    || !Number.isSafeInteger(limit?.windowMs) || limit.windowMs < 1000
  ) {
    throw new TypeError(`A positive ${name} is required.`);
  }
}

function assertUsername(value, message = "Enter a valid username.") {
  if (
    typeof value !== "string" || value.trim() !== value
    || value.length < 3 || value.length > 40
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new V3AuthError(400, message);
  }
  return value.toLowerCase();
}

function assertPassword(value, message = "Passwords must be between 6 and 128 characters.") {
  if (typeof value !== "string" || value.length < 6 || value.length > 128) {
    throw new V3AuthError(400, message);
  }
  return value;
}

function assertRoleName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 80) {
    throw new V3AuthError(400, "Choose a valid staff role.");
  }
  return value;
}

function assertUuid(value, message) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new V3AuthError(400, message);
  }
  return value.toLowerCase();
}

function assertActorId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new V3AuthError(401, "Sign in to continue.");
  }
  return value.toLowerCase();
}

function assertRequestId(value) {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 200
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new V3AuthError(400, "A valid requestId is required.");
  }
  return value;
}

function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new V3AuthError(400, "A valid expectedRevision is required.");
  }
  return value;
}

function assertClientKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new V3AuthError(400, "The account request is invalid.");
  }
  return hashHex(value);
}

function assertInvitationSecret(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new V3AuthError(400, "The invitation could not be accepted. Check the details and try again.");
  }
  return value;
}

function normalizeResetCode(value) {
  if (typeof value !== "string" || value.length > 64) {
    throw new V3AuthError(400, "The recovery code or new password could not be accepted.");
  }
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length !== 8 || [...normalized].some((character) => !RESET_ALPHABET.includes(character))) {
    throw new V3AuthError(400, "The recovery code or new password could not be accepted.");
  }
  return normalized;
}

function makeResetCode() {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += RESET_ALPHABET[randomInt(RESET_ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function outcomeOf(result) {
  const outcome = result?.rows?.[0]?.outcome;
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome) || typeof outcome.outcome !== "string") {
    throw new V3AuthError(503, "Account storage is temporarily unavailable. Requery before retrying.");
  }
  return outcome;
}

function fail(status, message, code, details = {}) {
  throw new V3AuthError(status, message, undefined, { code, ...details });
}

function handleCommonOutcome(result, currentKey) {
  const outcome = result.outcome;
  const current = currentKey
    ? result[currentKey] ?? (currentKey === "request" ? result.currentRequest : result.currentInvitation)
    : null;
  if (outcome === "request_mismatch") {
    fail(409, "That requestId was already used for a different account action.", "request_mismatch");
  }
  if (outcome === "secret_replay_unavailable") {
    fail(409, "The action completed, but its secret cannot be shown again. Requery and use the available recovery action.", outcome, {
      replayed: true,
      ...(currentKey && current ? { [currentKey]: current } : {}),
    });
  }
  if (outcome === "conflict") {
    fail(409, "This record changed. Review the current state before retrying.", "conflict", {
      ...(currentKey && current ? { [currentKey]: current } : {}),
    });
  }
  if (outcome === "capability_exceeded") {
    fail(403, "You cannot manage an account or role with capabilities beyond your own.", outcome);
  }
  if (outcome === "invalid_role") fail(400, "Choose a valid staff role.", outcome);
  if (outcome === "not_found") fail(404, "The requested account record was not found.", outcome);
  if (outcome === "invalid_state") {
    fail(409, "This record is no longer in a state that allows that action. Review its current state.", outcome, {
      ...(currentKey && current ? { [currentKey]: current } : {}),
    });
  }
}

export function createAccountService({
  query,
  clock = Date.now,
  readLimit = { maxAttempts: 120, windowMs: 60_000 },
  mutationLimit = { maxAttempts: 30, windowMs: 60_000 },
  invitationAcceptLimit = { maxAttempts: 20, windowMs: 60_000 },
  forgotAccountLimit = { maxAttempts: 5, windowMs: 15 * 60_000 },
  forgotClientLimit = { maxAttempts: 20, windowMs: 15 * 60_000 },
  resetAccountLimit = { maxAttempts: 10, windowMs: 15 * 60_000 },
  resetClientLimit = { maxAttempts: 30, windowMs: 15 * 60_000 },
  logger = () => {},
} = {}) {
  if (typeof query !== "function") throw new TypeError("A parameterized V3 database query is required.");
  if (typeof clock !== "function") throw new TypeError("A clock function is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  for (const [name, limit] of Object.entries({
    readLimit, mutationLimit, invitationAcceptLimit, forgotAccountLimit,
    forgotClientLimit, resetAccountLimit, resetClientLimit,
  })) validateLimit(name, limit);

  const readLimiter = createRateLimiter({ ...readLimit, clock });
  const mutationLimiter = createRateLimiter({ ...mutationLimit, clock });
  const invitationAcceptLimiter = createRateLimiter({ ...invitationAcceptLimit, clock });
  const forgotAccountLimiter = createRateLimiter({ ...forgotAccountLimit, clock });
  const forgotClientLimiter = createRateLimiter({ ...forgotClientLimit, clock });
  const resetAccountLimiter = createRateLimiter({ ...resetAccountLimit, clock });
  const resetClientLimiter = createRateLimiter({ ...resetClientLimit, clock });

  function consume(limiter, keys, message) {
    const results = keys.map((key) => limiter.consume(key));
    const blocked = results.find((result) => !result.allowed);
    if (blocked) throw new V3AuthError(429, message, blocked.retryAfterSeconds);
  }

  function consumeActor(actorId) {
    consume(mutationLimiter, [`actor:${actorId}`], "Too many account changes. Wait and try again.");
  }

  async function execute(sql, params) {
    try {
      return await query(sql, params);
    } catch (error) {
      if (error instanceof V3AuthError) throw error;
      if (error?.code === "42501") fail(403, "You do not have permission for this account action.", "forbidden");
      if (error?.code === "22023") fail(400, "The account request is invalid.", "invalid_request");
      if (TRANSIENT_DATABASE_CODES.has(error?.code)) {
        throw new V3AuthError(503, "Account storage is temporarily unavailable. Requery before retrying.");
      }
      throw error;
    }
  }

  function log(event, outcome, actorId = null, targetId = null) {
    logger({ event, outcome, actorId, targetId });
  }

  async function createStaffAccount({ actorId, username, password, roleName, requestId, clientKey }) {
    actorId = assertActorId(actorId);
    assertClientKey(clientKey);
    consumeActor(actorId);
    const normalizedUsername = assertUsername(username);
    assertPassword(password);
    assertRoleName(roleName);
    assertRequestId(requestId);
    const requestHash = commandHash({
      action: "staff.create", username: normalizedUsername,
      password: hashHex(password), roleName,
    });
    const passwordHash = await hashPassword(password);
    const result = outcomeOf(await execute(CREATE_STAFF_SQL, [
      actorId, normalizedUsername, passwordHash, roleName, requestId, requestHash,
    ]));
    handleCommonOutcome(result);
    if (result.outcome === "duplicate") fail(409, "That username is already in use.", "duplicate");
    if (result.outcome !== "created" || !result.staff) {
      throw new V3AuthError(503, "The staff account could not be created. Requery before retrying.");
    }
    log("v3.account.staff.create", "created", actorId, result.staff.userId);
    return result;
  }

  async function updateStaffAccount({
    actorId, staffId, disabled, roleName, expectedRevision, requestId, clientKey,
  }) {
    actorId = assertActorId(actorId);
    staffId = assertUuid(staffId, "Choose a valid staff account.");
    assertClientKey(clientKey);
    consumeActor(actorId);
    if (disabled !== undefined && typeof disabled !== "boolean") {
      throw new V3AuthError(400, "Choose whether the account is enabled or disabled.");
    }
    if (roleName !== undefined) assertRoleName(roleName);
    if (disabled === undefined && roleName === undefined) {
      throw new V3AuthError(400, "Choose an account status or role to change.");
    }
    assertRevision(expectedRevision);
    assertRequestId(requestId);
    const requestHash = commandHash({
      action: "staff.update", staffId, disabled: disabled ?? null,
      roleName: roleName ?? null, expectedRevision,
    });
    const result = outcomeOf(await execute(UPDATE_STAFF_SQL, [
      actorId, staffId, disabled ?? null, roleName ?? null,
      expectedRevision, requestId, requestHash,
    ]));
    handleCommonOutcome(result, "currentStaff");
    if (result.outcome === "last_manager") {
      fail(409, "At least one enabled account with staff-management capability must remain.", "last_manager");
    }
    if (result.outcome === "self_change") {
      fail(409, "You cannot change your own staff account role or status.", "self_change");
    }
    if (!["updated", "unchanged"].includes(result.outcome) || !result.staff) {
      throw new V3AuthError(503, "The staff account could not be updated. Requery before retrying.");
    }
    log("v3.account.staff.update", result.outcome, actorId, staffId);
    return result;
  }

  async function listInvitations(actorId) {
    actorId = assertActorId(actorId);
    consume(readLimiter, [`actor:${actorId}`], "Account reads are temporarily limited. Wait and try again.");
    const result = await execute(LIST_INVITATIONS_SQL, [actorId]);
    return (result?.rows ?? []).map((row) => ({
      invitationId: row.invitation_id,
      roleName: row.role_name,
      status: row.status,
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
      revision: Number(row.revision),
    }));
  }

  async function createInvitation({ actorId, roleName, requestId, clientKey }) {
    actorId = assertActorId(actorId);
    assertClientKey(clientKey);
    consumeActor(actorId);
    assertRoleName(roleName);
    assertRequestId(requestId);
    const secret = randomToken();
    const requestHash = commandHash({ action: "invitation.create", roleName });
    const result = outcomeOf(await execute(CREATE_INVITATION_SQL, [
      actorId, roleName, hashHex(secret), requestId, requestHash,
    ]));
    handleCommonOutcome(result, "invitation");
    if (result.outcome !== "created" || !result.invitation) {
      throw new V3AuthError(503, "The invitation could not be created. Requery before retrying.");
    }
    log("v3.account.invitation.create", "created", actorId, result.invitation.invitationId);
    return { ...result, secret };
  }

  async function revokeInvitation({ actorId, invitationId, expectedRevision, requestId, clientKey }) {
    actorId = assertActorId(actorId);
    invitationId = assertUuid(invitationId, "Choose a valid invitation.");
    assertClientKey(clientKey);
    consumeActor(actorId);
    assertRevision(expectedRevision);
    assertRequestId(requestId);
    const requestHash = commandHash({
      action: "invitation.revoke", invitationId, expectedRevision,
    });
    const result = outcomeOf(await execute(REVOKE_INVITATION_SQL, [
      actorId, invitationId, expectedRevision, requestId, requestHash,
    ]));
    handleCommonOutcome(result, "currentInvitation");
    if (result.outcome !== "revoked" || !result.invitation) {
      throw new V3AuthError(503, "The invitation could not be revoked. Requery before retrying.");
    }
    log("v3.account.invitation.revoke", "revoked", actorId, invitationId);
    return result;
  }

  async function acceptInvitation({ secret, username, password, requestId, clientKey }) {
    const clientHash = assertClientKey(clientKey);
    consume(invitationAcceptLimiter, [`client:${clientHash}`], "Too many invitation attempts. Wait and try again.");
    assertInvitationSecret(secret);
    const normalizedUsername = assertUsername(username, "The invitation could not be accepted. Check the details and try again.");
    assertPassword(password);
    assertRequestId(requestId);
    const tokenHash = hashHex(secret);
    const requestHash = commandHash({
      action: "invitation.accept", tokenHash, username: normalizedUsername,
      password: hashHex(password),
    });
    const passwordHash = await hashPassword(password);
    const result = outcomeOf(await execute(ACCEPT_INVITATION_SQL, [
      tokenHash, normalizedUsername, passwordHash, requestId, requestHash,
    ]));
    handleCommonOutcome(result);
    if (result.outcome === "invalid") {
      fail(400, "The invitation could not be accepted. Check the details and try again.", "invalid_invitation");
    }
    if (!["accepted", "accepted_sign_in_required"].includes(result.outcome) || !result.staff) {
      throw new V3AuthError(503, "The invitation result is unavailable. Sign in or requery before retrying.");
    }
    log("v3.account.invitation.accept", result.outcome, null, result.staff.userId);
    return result;
  }

  async function requestPasswordReset({ username, requestId, clientKey }) {
    const clientHash = assertClientKey(clientKey);
    const normalizedUsername = assertUsername(username, "Enter a valid username.");
    assertRequestId(requestId);
    const accountKey = hashHex(normalizedUsername);
    consume(forgotClientLimiter, [`client:${clientHash}`], "Too many recovery requests. Wait and try again.");
    consume(forgotAccountLimiter, [`client:${clientHash}:account:${accountKey}`], "Too many recovery requests for this username. Wait and try again.");
    const requestHash = commandHash({ action: "password-reset.request", username: normalizedUsername });
    const result = outcomeOf(await execute(REQUEST_RESET_SQL, [normalizedUsername, requestId, requestHash]));
    handleCommonOutcome(result);
    if (result.outcome !== "accepted") {
      throw new V3AuthError(503, "The recovery request could not be confirmed. Requery before retrying.");
    }
    log("v3.account.password_reset.request", "accepted");
    return { outcome: "accepted" };
  }

  async function listPasswordResets(actorId) {
    actorId = assertActorId(actorId);
    consume(readLimiter, [`actor:${actorId}`], "Account reads are temporarily limited. Wait and try again.");
    const result = await execute(LIST_RESETS_SQL, [actorId]);
    const requests = (result?.rows ?? []).map((row) => ({
      requestId: row.request_id,
      staffId: row.staff_id,
      username: row.username,
      role: row.role_name,
      status: row.status,
      requestedAt: iso(row.requested_at),
      expiresAt: iso(row.expires_at),
      revision: Number(row.revision),
      approvedAt: iso(row.approved_at),
      codeExpiresAt: iso(row.code_expires_at),
    }));
    return {
      requests,
      pendingCount: requests.filter((request) => request.status === "pending").length,
    };
  }

  async function approvePasswordReset({ actorId, passwordResetId, expectedRevision, requestId, clientKey }) {
    actorId = assertActorId(actorId);
    passwordResetId = assertUuid(passwordResetId, "Choose a valid password reset request.");
    assertClientKey(clientKey);
    consumeActor(actorId);
    assertRevision(expectedRevision);
    assertRequestId(requestId);
    const code = makeResetCode();
    const codeHash = hashHex(code.replace("-", ""));
    const requestHash = commandHash({
      action: "password-reset.approve", passwordResetId, expectedRevision,
    });
    const result = outcomeOf(await execute(APPROVE_RESET_SQL, [
      actorId, passwordResetId, expectedRevision, codeHash, requestId, requestHash,
    ]));
    handleCommonOutcome(result, "request");
    if (result.outcome !== "approved" || !result.request) {
      throw new V3AuthError(503, "The recovery request could not be approved. Requery before retrying.");
    }
    log("v3.account.password_reset.approve", "approved", actorId, passwordResetId);
    return { ...result, code };
  }

  async function declinePasswordReset({ actorId, passwordResetId, expectedRevision, requestId, clientKey }) {
    actorId = assertActorId(actorId);
    passwordResetId = assertUuid(passwordResetId, "Choose a valid password reset request.");
    assertClientKey(clientKey);
    consumeActor(actorId);
    assertRevision(expectedRevision);
    assertRequestId(requestId);
    const requestHash = commandHash({
      action: "password-reset.decline", passwordResetId, expectedRevision,
    });
    const result = outcomeOf(await execute(DECLINE_RESET_SQL, [
      actorId, passwordResetId, expectedRevision, requestId, requestHash,
    ]));
    handleCommonOutcome(result, "currentRequest");
    if (result.outcome !== "declined" || !result.request) {
      throw new V3AuthError(503, "The recovery request could not be declined. Requery before retrying.");
    }
    log("v3.account.password_reset.decline", "declined", actorId, passwordResetId);
    return result;
  }

  async function reissuePasswordReset({ actorId, passwordResetId, expectedRevision, requestId, clientKey }) {
    actorId = assertActorId(actorId);
    passwordResetId = assertUuid(passwordResetId, "Choose a valid password reset request.");
    assertClientKey(clientKey);
    consumeActor(actorId);
    assertRevision(expectedRevision);
    assertRequestId(requestId);
    const code = makeResetCode();
    const codeHash = hashHex(code.replace("-", ""));
    const requestHash = commandHash({
      action: "password-reset.reissue", passwordResetId, expectedRevision,
    });
    const result = outcomeOf(await execute(REISSUE_RESET_SQL, [
      actorId, passwordResetId, expectedRevision, codeHash, requestId, requestHash,
    ]));
    handleCommonOutcome(result, "request");
    if (result.outcome !== "reissued" || !result.request) {
      throw new V3AuthError(503, "The recovery code could not be reissued. Requery before retrying.");
    }
    log("v3.account.password_reset.reissue", "reissued", actorId, passwordResetId);
    return { ...result, code };
  }

  async function completePasswordReset({ username, code, password, requestId, clientKey }) {
    const clientHash = assertClientKey(clientKey);
    const normalizedUsername = assertUsername(username, "The recovery code or new password could not be accepted.");
    const normalizedCode = normalizeResetCode(code);
    assertPassword(password);
    assertRequestId(requestId);
    const accountKey = hashHex(normalizedUsername);
    consume(resetClientLimiter, [`client:${clientHash}`], "Too many recovery attempts. Wait and try again.");
    consume(resetAccountLimiter, [`client:${clientHash}:account:${accountKey}`], "Too many recovery attempts for this username. Wait and try again.");
    const codeHash = hashHex(normalizedCode);
    const requestHash = commandHash({
      action: "password-reset.complete", username: normalizedUsername,
      codeHash, password: hashHex(password),
    });
    const passwordHash = await hashPassword(password);
    const result = outcomeOf(await execute(COMPLETE_RESET_SQL, [
      normalizedUsername, codeHash, passwordHash, requestId, requestHash,
    ]));
    handleCommonOutcome(result);
    if (result.outcome === "invalid") {
      fail(400, "The recovery code or new password could not be accepted.", "invalid_reset");
    }
    if (result.outcome !== "completed") {
      throw new V3AuthError(503, "The recovery result is unavailable. Sign in with the new password or requery before retrying.");
    }
    log("v3.account.password_reset.complete", "completed");
    return { outcome: "completed" };
  }

  async function changeOwnPassword({
    actorId, username, currentPassword, newPassword, requestId, clientKey,
  }) {
    actorId = assertActorId(actorId);
    const normalizedUsername = assertUsername(username);
    assertClientKey(clientKey);
    consumeActor(actorId);
    assertPassword(currentPassword, "Enter your current password.");
    assertPassword(newPassword);
    if (currentPassword === newPassword) {
      throw new V3AuthError(400, "Choose a different new password.");
    }
    assertRequestId(requestId);
    const lookup = await execute(FIND_STAFF_SQL, [normalizedUsername]);
    const account = lookup?.rows?.[0];
    if (!account || account.staff_id?.toLowerCase() !== actorId || account.disabled !== false
        || typeof account.password_hash !== "string") {
      fail(400, "The current password is incorrect.", "current_password_mismatch");
    }
    const currentPasswordMatches = await verifyPassword(currentPassword, account.password_hash);
    const newPasswordHash = await hashPassword(newPassword);
    const requestHash = commandHash({
      action: "password.change", actorId,
      currentPassword: hashHex(currentPassword), newPassword: hashHex(newPassword),
    });
    const result = outcomeOf(await execute(CHANGE_PASSWORD_SQL, [
      actorId,
      currentPasswordMatches ? account.password_hash : hashHex(currentPassword),
      newPasswordHash,
      requestId,
      requestHash,
    ]));
    handleCommonOutcome(result);
    if (result.outcome === "current_password_mismatch") {
      fail(400, "The current password is incorrect.", "current_password_mismatch");
    }
    if (result.outcome !== "changed") {
      throw new V3AuthError(503, "The password change is unconfirmed. Sign in with the new password or requery before retrying.");
    }
    log("v3.account.password.change", "changed", actorId, actorId);
    return result;
  }

  async function revokeStaffSessions({ actorId, staffId, expectedRevision, requestId, clientKey }) {
    actorId = assertActorId(actorId);
    staffId = assertUuid(staffId, "Choose a valid staff account.");
    assertClientKey(clientKey);
    consumeActor(actorId);
    assertRevision(expectedRevision);
    assertRequestId(requestId);
    const requestHash = commandHash({
      action: "staff.revoke-sessions", staffId, expectedRevision,
    });
    const result = outcomeOf(await execute(REVOKE_SESSIONS_SQL, [
      actorId, staffId, expectedRevision, requestId, requestHash,
    ]));
    handleCommonOutcome(result, "currentStaff");
    if (result.outcome !== "revoked" || !result.staff) {
      throw new V3AuthError(503, "The sessions could not be revoked. Requery before retrying.");
    }
    log("v3.account.staff.revoke_sessions", "revoked", actorId, staffId);
    return result;
  }

  return Object.freeze({
    createStaffAccount,
    updateStaffAccount,
    listInvitations,
    createInvitation,
    revokeInvitation,
    acceptInvitation,
    requestPasswordReset,
    listPasswordResets,
    approvePasswordReset,
    declinePasswordReset,
    reissuePasswordReset,
    completePasswordReset,
    changeOwnPassword,
    revokeStaffSessions,
  });
}
