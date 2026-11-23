import assert from "node:assert/strict";
import test from "node:test";
import { createAccountService } from "./account-service.mjs";
import { hashHex, hashPassword, V3AuthError } from "./auth-crypto.mjs";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const STAFF_ID = "10000000-0000-4000-8000-000000000002";
const RESET_ID = "10000000-0000-4000-8000-000000000003";
const INVITATION_ID = "10000000-0000-4000-8000-000000000004";
const CLIENT_KEY = "test-client";

function staff(revision = 1) {
  return {
    userId: STAFF_ID,
    username: "operator",
    role: "operator",
    disabled: false,
    createdAt: "2026-11-24T00:00:00.000Z",
    revision,
  };
}

function invitation(revision = 1) {
  return {
    invitationId: INVITATION_ID,
    roleName: "operator",
    status: "active",
    createdAt: "2026-11-24T00:00:00.000Z",
    expiresAt: "2026-11-25T00:00:00.000Z",
    revision,
  };
}

function resetRequest(revision = 1) {
  return {
    requestId: RESET_ID,
    staffId: STAFF_ID,
    username: "operator",
    role: "operator",
    status: "pending",
    requestedAt: "2026-11-24T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    revision,
    approvedAt: null,
    codeExpiresAt: null,
  };
}

function harness(query, options = {}) {
  const calls = [];
  const logs = [];
  const service = createAccountService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return query(sql, params, calls.length);
    },
    logger: (entry) => logs.push(entry),
    ...options,
  });
  return { service, calls, logs };
}

function outcomeQuery(outcomes) {
  return async () => {
    assert.ok(outcomes.length > 0, "an unexpected database call was made");
    const outcome = outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return { rows: [{ outcome }] };
  };
}

async function expectAuthError(promise, status, code) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof V3AuthError);
    assert.equal(error.status, status);
    if (code !== undefined) assert.equal(error.details?.code, code);
    return error;
  }
  assert.fail(`Expected V3AuthError ${status}${code ? ` ${code}` : ""}.`);
}

test("staff creation replays exactly, rejects changed request reuse, and never sends plaintext passwords to SQL", async () => {
  const { service, calls, logs } = harness(outcomeQuery([
    { outcome: "created", staff: staff(), replayed: false },
    { outcome: "created", staff: staff(), replayed: true },
    { outcome: "request_mismatch" },
  ]));
  const input = {
    actorId: ACTOR_ID,
    username: "NewOperator",
    password: "correct-test-password",
    roleName: "operator",
    requestId: "create-operator-1",
    clientKey: CLIENT_KEY,
  };
  const first = await service.createStaffAccount(input);
  const replay = await service.createStaffAccount(input);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  await expectAuthError(
    service.createStaffAccount({ ...input, roleName: "manager" }),
    409,
    "request_mismatch",
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[0].params[1], "newoperator");
  assert.match(calls[0].params[2], /^argon2id\$/);
  assert.equal(calls[0].params[5], calls[1].params[5]);
  assert.notEqual(calls[0].params[5], calls[2].params[5]);
  assert.equal(JSON.stringify(calls).includes(input.password), false);
  assert.equal(JSON.stringify(logs).includes(input.password), false);
});

test("stale staff updates return canonical current state without adopting it as a success", async () => {
  const currentStaff = staff(7);
  const { service, calls } = harness(outcomeQuery([
    { outcome: "conflict", currentStaff },
  ]));
  const error = await expectAuthError(service.updateStaffAccount({
    actorId: ACTOR_ID,
    staffId: STAFF_ID,
    disabled: true,
    expectedRevision: 6,
    requestId: "disable-operator-1",
    clientKey: CLIENT_KEY,
  }), 409, "conflict");
  assert.deepEqual(error.details.currentStaff, currentStaff);
  assert.equal(calls.length, 1);
});

test("invitation and reset-secret replays return safe metadata and never return the original secret", async () => {
  const { service, calls } = harness(outcomeQuery([
    { outcome: "created", invitation: invitation(), replayed: false },
    { outcome: "secret_replay_unavailable", invitation: invitation(), replayed: true },
    { outcome: "approved", request: resetRequest(2), replayed: false },
    { outcome: "secret_replay_unavailable", request: resetRequest(2), replayed: true },
    { outcome: "reissued", request: resetRequest(3), replayed: false },
    { outcome: "secret_replay_unavailable", request: resetRequest(3), replayed: true },
  ]));
  const createInput = {
    actorId: ACTOR_ID, roleName: "operator", requestId: "invite-1", clientKey: CLIENT_KEY,
  };
  const created = await service.createInvitation(createInput);
  assert.match(created.secret, /^[A-Za-z0-9_-]{43}$/);
  const invitationReplay = await expectAuthError(
    service.createInvitation(createInput), 409, "secret_replay_unavailable",
  );
  assert.deepEqual(invitationReplay.details.invitation, invitation());
  assert.equal(JSON.stringify(invitationReplay.details).includes(created.secret), false);

  for (const [method, firstOutcome] of [
    ["approvePasswordReset", "approved"],
    ["reissuePasswordReset", "reissued"],
  ]) {
    const input = {
      actorId: ACTOR_ID,
      passwordResetId: RESET_ID,
      expectedRevision: 1,
      requestId: `${method}-1`,
      clientKey: CLIENT_KEY,
    };
    const approved = await service[method](input);
    assert.equal(approved.outcome, firstOutcome);
    assert.match(approved.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    const replay = await expectAuthError(service[method](input), 409, "secret_replay_unavailable");
    assert.equal(JSON.stringify(replay.details).includes(approved.code), false);
  }
  assert.equal(JSON.stringify(calls).includes(created.secret), false);
});

test("public invitation and recovery failures are generic and invitation replay requires a fresh sign-in", async () => {
  const { service } = harness(outcomeQuery([
    { outcome: "invalid" },
    { outcome: "accepted_sign_in_required", staff: staff(), replayed: true },
    { outcome: "accepted", replayed: false },
    { outcome: "invalid" },
  ]));
  const invalid = await expectAuthError(service.acceptInvitation({
    secret: "a".repeat(43),
    username: "ExistingUser",
    password: "test-password",
    requestId: "accept-invalid-1",
    clientKey: CLIENT_KEY,
  }), 400, "invalid_invitation");
  assert.equal(invalid.message, "The invitation could not be accepted. Check the details and try again.");
  assert.equal(JSON.stringify(invalid.details).includes("ExistingUser"), false);

  const replay = await service.acceptInvitation({
    secret: "a".repeat(43),
    username: "AcceptedUser",
    password: "test-password",
    requestId: "accept-replay-1",
    clientKey: CLIENT_KEY,
  });
  assert.equal(replay.outcome, "accepted_sign_in_required");
  assert.equal("token" in replay, false);
  assert.equal("csrfToken" in replay, false);

  assert.deepEqual(await service.requestPasswordReset({
    username: "UnknownUser", requestId: "forgot-1", clientKey: CLIENT_KEY,
  }), { outcome: "accepted" });
  const resetError = await expectAuthError(service.completePasswordReset({
    username: "UnknownUser",
    code: "ABCD-2345",
    password: "replacement-password",
    requestId: "complete-invalid-1",
    clientKey: CLIENT_KEY,
  }), 400, "invalid_reset");
  assert.equal(resetError.message, "The recovery code or new password could not be accepted.");
});

test("forgot-password limits are bounded by client and normalized username with Retry-After", async () => {
  const { service, calls } = harness(outcomeQuery([
    { outcome: "accepted", replayed: false },
    { outcome: "accepted", replayed: false },
  ]), {
    clock: () => 0,
    forgotAccountLimit: { maxAttempts: 1, windowMs: 60_000 },
    forgotClientLimit: { maxAttempts: 10, windowMs: 60_000 },
  });
  await service.requestPasswordReset({
    username: "CaseSensitive", requestId: "forgot-a", clientKey: CLIENT_KEY,
  });
  const limited = await expectAuthError(service.requestPasswordReset({
    username: "casesensitive", requestId: "forgot-b", clientKey: CLIENT_KEY,
  }), 429);
  assert.equal(limited.retryAfterSeconds, 60);
  await service.requestPasswordReset({
    username: "AnotherUser", requestId: "forgot-c", clientKey: CLIENT_KEY,
  });
  assert.equal(calls.length, 2);
});

test("password change supports exact response-loss replay but rejects a wrong current password for a new command", async () => {
  const currentPassword = "old-test-password";
  const newPassword = "new-test-password";
  let storedHash = await hashPassword(currentPassword);
  let receipt = null;
  const { service, calls } = harness(async (sql, params) => {
    if (sql.includes("find_staff_for_sign_in")) {
      return { rows: [{
        staff_id: ACTOR_ID,
        username: "manager",
        password_hash: storedHash,
        disabled: false,
      }] };
    }
    assert.match(sql, /change_own_password/);
    const [actorId, expectedCurrentHash, replacementHash, requestId, requestHash] = params;
    assert.equal(actorId, ACTOR_ID);
    if (receipt && receipt.commandId === requestId) {
      if (receipt.requestHash !== requestHash) return { rows: [{ outcome: { outcome: "request_mismatch" } }] };
      return { rows: [{ outcome: receipt.response }] };
    }
    if (expectedCurrentHash !== storedHash) {
      return { rows: [{ outcome: { outcome: "current_password_mismatch" } }] };
    }
    storedHash = replacementHash;
    receipt = {
      commandId: requestId,
      requestHash,
      response: { outcome: "changed", revision: 2, replayed: true },
    };
    return { rows: [{ outcome: { outcome: "changed", revision: 2, replayed: false } }] };
  });
  const input = {
    actorId: ACTOR_ID,
    username: "Manager",
    currentPassword,
    newPassword,
    requestId: "change-password-1",
    clientKey: CLIENT_KEY,
  };
  const first = await service.changeOwnPassword(input);
  const replay = await service.changeOwnPassword(input);
  assert.equal(first.replayed, false);
  assert.deepEqual(replay, { outcome: "changed", revision: 2, replayed: true });
  await expectAuthError(service.changeOwnPassword({
    ...input,
    currentPassword: "wrong-test-password",
    requestId: "change-password-2",
  }), 400, "current_password_mismatch");
  assert.equal(JSON.stringify(calls).includes(currentPassword), false);
  assert.equal(JSON.stringify(calls).includes(newPassword), false);
});

test("reset completion normalizes code casing, whitespace, and dashes before hashing", async () => {
  const { service, calls } = harness(outcomeQuery([
    { outcome: "completed", replayed: false },
  ]));
  await service.completePasswordReset({
    username: "Operator",
    code: "ab cd-2345",
    password: "replacement-password",
    requestId: "complete-normalized-1",
    clientKey: CLIENT_KEY,
  });
  assert.equal(calls[0].params[0], "operator");
  assert.equal(calls[0].params[1], hashHex("ABCD2345"));
  assert.match(calls[0].params[2], /^argon2id\$/);
});

test("account list mapping exposes revisions and pending counts without secret fields", async () => {
  const { service } = harness(async (sql) => {
    if (sql.includes("list_staff_invitations")) {
      return { rows: [{
        invitation_id: INVITATION_ID,
        role_name: "operator",
        status: "active",
        created_at: "2026-11-24T00:00:00.000Z",
        expires_at: "2026-11-25T00:00:00.000Z",
        revision: "4",
      }] };
    }
    assert.match(sql, /list_password_reset_requests/);
    return { rows: [
      {
        request_id: RESET_ID,
        staff_id: STAFF_ID,
        username: "operator",
        role_name: "operator",
        status: "pending",
        requested_at: "2026-11-24T00:00:00.000Z",
        expires_at: "2026-12-01T00:00:00.000Z",
        revision: "2",
        approved_at: null,
        code_expires_at: null,
      },
      { ...resetRequest(3), request_id: "10000000-0000-4000-8000-000000000009", status: "used" },
    ].map((row) => ({
      request_id: row.request_id ?? row.requestId,
      staff_id: row.staff_id ?? row.staffId,
      username: row.username,
      role_name: row.role_name ?? row.role,
      status: row.status,
      requested_at: row.requested_at ?? row.requestedAt,
      expires_at: row.expires_at ?? row.expiresAt,
      revision: String(row.revision),
      approved_at: row.approved_at ?? row.approvedAt,
      code_expires_at: row.code_expires_at ?? row.codeExpiresAt,
    })) };
  });
  const invitations = await service.listInvitations(ACTOR_ID);
  const resets = await service.listPasswordResets(ACTOR_ID);
  assert.equal(invitations[0].revision, 4);
  assert.equal(resets.pendingCount, 1);
  assert.equal(resets.requests[0].revision, 2);
  assert.equal(JSON.stringify({ invitations, resets }).includes("codeHash"), false);
  assert.equal(JSON.stringify({ invitations, resets }).includes("tokenHash"), false);
});

test("known storage outages become 503 while unexpected errors retain their failure identity", async () => {
  const transient = Object.assign(new Error("sensitive driver detail"), { code: "08006" });
  const outage = harness(outcomeQuery([transient]));
  await expectAuthError(outage.service.createInvitation({
    actorId: ACTOR_ID, roleName: "operator", requestId: "invite-outage", clientKey: CLIENT_KEY,
  }), 503);

  const unexpected = new Error("sensitive driver detail");
  const failure = harness(outcomeQuery([unexpected]));
  await assert.rejects(failure.service.createInvitation({
    actorId: ACTOR_ID, roleName: "operator", requestId: "invite-failure", clientKey: CLIENT_KEY,
  }), (error) => error === unexpected);
});
