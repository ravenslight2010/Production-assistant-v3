import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAccountApi } from "./account-api.mjs";
import { V3AuthError } from "./auth-crypto.mjs";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const STAFF_ID = "10000000-0000-4000-8000-000000000002";
const RESET_ID = "10000000-0000-4000-8000-000000000003";
const INVITATION_ID = "10000000-0000-4000-8000-000000000004";
const SESSION_TOKEN = "s".repeat(43);
const CSRF_TOKEN = "c".repeat(43);
const INVITATION_SECRET = "i".repeat(43);

const STAFF = {
  userId: STAFF_ID,
  username: "operator",
  role: "operator",
  disabled: false,
  createdAt: "2026-11-24T00:00:00.000Z",
  revision: 1,
};
const INVITATION = {
  invitationId: INVITATION_ID,
  roleName: "operator",
  status: "active",
  createdAt: "2026-11-24T00:00:00.000Z",
  expiresAt: "2026-11-25T00:00:00.000Z",
  revision: 1,
};
const RESET_REQUEST = {
  requestId: RESET_ID,
  staffId: STAFF_ID,
  username: "operator",
  role: "operator",
  status: "pending",
  requestedAt: "2026-11-24T00:00:00.000Z",
  expiresAt: "2026-12-01T00:00:00.000Z",
  revision: 1,
  approvedAt: null,
  codeExpiresAt: null,
};

function makeAccounts() {
  return {
    async listInvitations() { return [INVITATION]; },
    async createInvitation() { return { invitation: INVITATION, secret: INVITATION_SECRET }; },
    async revokeInvitation() { return { outcome: "revoked", invitation: INVITATION, replayed: false }; },
    async acceptInvitation() { return { outcome: "accepted", staff: STAFF, replayed: false }; },
    async requestPasswordReset() { return { outcome: "accepted" }; },
    async listPasswordResets() { return { requests: [RESET_REQUEST], pendingCount: 1 }; },
    async approvePasswordReset() { return { request: RESET_REQUEST, code: "ABCD-2345" }; },
    async declinePasswordReset() { return { outcome: "declined", request: RESET_REQUEST, replayed: false }; },
    async reissuePasswordReset() { return { request: RESET_REQUEST, code: "WXYZ-6789" }; },
    async completePasswordReset() { return { outcome: "completed" }; },
    async changeOwnPassword() { return { outcome: "changed", revision: 2, replayed: false }; },
    async revokeStaffSessions() { return { outcome: "revoked", staff: STAFF, replayed: false }; },
  };
}

function makeAuth() {
  const auth = {
    current: {
      verified: true,
      actorId: ACTOR_ID,
      username: "manager",
      role: "manager",
      capabilities: ["manage-staff", "approve-password-resets"],
    },
    async authenticate() { return auth.current; },
    async verifyCsrf(request) { return request.headers["x-csrf-token"] === CSRF_TOKEN; },
    async signIn(input) {
      auth.signInInput = input;
      return {
        token: SESSION_TOKEN,
        csrfToken: CSRF_TOKEN,
        expiresAt: "2026-12-24T00:00:00.000Z",
        staff: { ...STAFF, username: "manager", role: "manager" },
      };
    },
    sessionCookie(value, options) {
      return `v3_session=${value}; Path=/; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}`;
    },
    csrfCookie(value, options) {
      return `v3_csrf=${value}; Path=/; SameSite=Lax${options.secure ? "; Secure" : ""}`;
    },
  };
  return auth;
}

async function withServer(handler, run) {
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeHandler(accounts = makeAccounts(), auth = makeAuth(), logs = []) {
  return createAccountApi({
    accounts,
    auth,
    getClientKey: () => "test-client",
    secureCookies: true,
    logger: (entry) => logs.push(entry),
  });
}

function mutationHeaders(baseUrl, authenticated = true) {
  return {
    "content-type": "application/json",
    origin: baseUrl,
    "sec-fetch-site": "same-origin",
    ...(authenticated ? {
      cookie: `v3_session=${SESSION_TOKEN}; v3_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    } : {}),
  };
}

test("public invitation acceptance and forgot-password routes use canonical replay outcomes", async () => {
  const accounts = makeAccounts();
  const acceptanceInputs = [];
  accounts.acceptInvitation = async (input) => {
    acceptanceInputs.push(input);
    return input.requestId === "accept-replay"
      ? { outcome: "accepted_sign_in_required", staff: STAFF, replayed: true }
      : { outcome: "accepted", staff: STAFF, replayed: false };
  };
  await withServer(makeHandler(accounts), async (baseUrl) => {
    for (const [requestId, status, outcome] of [
      ["accept-first", 201, "accepted"],
      ["accept-replay", 200, "accepted_sign_in_required"],
    ]) {
      const response = await fetch(`${baseUrl}/api/v3/auth/invitations/accept`, {
        method: "POST",
        headers: mutationHeaders(baseUrl, false),
        body: JSON.stringify({
          secret: INVITATION_SECRET,
          username: "NewOperator",
          password: "test-password",
          requestId,
        }),
      });
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.outcome, outcome);
      assert.equal("secret" in body, false);
      assert.equal("token" in body, false);
      assert.equal(JSON.stringify(body).includes("test-password"), false);
    }
    assert.equal(acceptanceInputs[0].clientKey, "test-client");

    const reset = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests`, {
      method: "POST",
      headers: mutationHeaders(baseUrl, false),
      body: JSON.stringify({ username: "UnknownUser", requestId: "forgot-1" }),
    });
    assert.equal(reset.status, 202);
    assert.deepEqual(await reset.json(), { outcome: "accepted" });
  });
});

test("account routes enforce same-origin, strict JSON, body limits, methods, and query rejection", async () => {
  const accounts = makeAccounts();
  let acceptanceCalls = 0;
  accounts.acceptInvitation = async () => {
    acceptanceCalls += 1;
    return { outcome: "accepted", staff: STAFF };
  };
  await withServer(makeHandler(accounts), async (baseUrl) => {
    const validBody = JSON.stringify({
      secret: INVITATION_SECRET, username: "NewOperator", password: "test-password", requestId: "accept-1",
    });
    const crossOrigin = await fetch(`${baseUrl}/api/v3/auth/invitations/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      body: validBody,
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(acceptanceCalls, 0);

    const wrongMethod = await fetch(`${baseUrl}/api/v3/auth/invitations/accept`);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");
    const query = await fetch(`${baseUrl}/api/v3/auth/invitations/accept?next=staff`, {
      method: "POST", headers: mutationHeaders(baseUrl, false), body: validBody,
    });
    assert.equal(query.status, 400);
    const wrongType = await fetch(`${baseUrl}/api/v3/auth/invitations/accept`, {
      method: "POST", headers: { "content-type": "text/plain" }, body: validBody,
    });
    assert.equal(wrongType.status, 415);
    const unsupported = await fetch(`${baseUrl}/api/v3/auth/invitations/accept`, {
      method: "POST",
      headers: mutationHeaders(baseUrl, false),
      body: JSON.stringify({ ...JSON.parse(validBody), passwordHash: "not-allowed" }),
    });
    assert.equal(unsupported.status, 400);
    const oversized = await fetch(`${baseUrl}/api/v3/auth/invitations/accept`, {
      method: "POST",
      headers: mutationHeaders(baseUrl, false),
      body: JSON.stringify({ secret: INVITATION_SECRET, username: "NewOperator", password: "x".repeat(4100), requestId: "accept-1" }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(acceptanceCalls, 0);
  });
});

test("reset-only approvers are scoped to the queue while manager secrets require CSRF", async () => {
  const accounts = makeAccounts();
  const auth = makeAuth();
  auth.current = {
    verified: true,
    actorId: ACTOR_ID,
    username: "approver",
    role: "recovery-approver",
    capabilities: ["approve-password-resets"],
  };
  let approvalCalls = 0;
  accounts.approvePasswordReset = async () => {
    approvalCalls += 1;
    return { request: RESET_REQUEST, code: "ABCD-2345" };
  };
  await withServer(makeHandler(accounts, auth), async (baseUrl) => {
    const queue = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests`);
    assert.equal(queue.status, 200);
    assert.equal((await queue.json()).pendingCount, 1);
    const invitations = await fetch(`${baseUrl}/api/v3/auth/invitations`);
    assert.equal(invitations.status, 403);

    const missingCsrf = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests/${RESET_ID}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, requestId: "approve-1" }),
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal(approvalCalls, 0);
    const approved = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests/${RESET_ID}/approve`, {
      method: "POST",
      headers: mutationHeaders(baseUrl),
      body: JSON.stringify({ expectedRevision: 1, requestId: "approve-1" }),
    });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).code, "ABCD-2345");

    auth.current = null;
    const unauthenticated = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests`);
    assert.equal(unauthenticated.status, 401);
  });
});

test("secret replay and stale conflicts expose only safe structured metadata", async () => {
  const accounts = makeAccounts();
  const auth = makeAuth();
  accounts.createInvitation = async () => {
    throw new V3AuthError(409, "The invitation secret cannot be shown again.", undefined, {
      code: "secret_replay_unavailable",
      replayed: true,
      invitation: INVITATION,
    });
  };
  accounts.approvePasswordReset = async () => {
    throw new V3AuthError(409, "Review the current reset request.", undefined, {
      code: "conflict",
      request: { ...RESET_REQUEST, revision: 8 },
    });
  };
  await withServer(makeHandler(accounts, auth), async (baseUrl) => {
    const replay = await fetch(`${baseUrl}/api/v3/auth/invitations`, {
      method: "POST",
      headers: mutationHeaders(baseUrl),
      body: JSON.stringify({ roleName: "operator", requestId: "invite-replay" }),
    });
    assert.equal(replay.status, 409);
    const replayBody = await replay.json();
    assert.equal(replayBody.code, "secret_replay_unavailable");
    assert.deepEqual(replayBody.invitation, INVITATION);
    assert.equal("secret" in replayBody, false);
    assert.equal(JSON.stringify(replayBody).includes(INVITATION_SECRET), false);
    assert.equal(replay.headers.get("cache-control"), "no-store");
    assert.equal(replay.headers.get("x-content-type-options"), "nosniff");

    const conflict = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests/${RESET_ID}/approve`, {
      method: "POST",
      headers: mutationHeaders(baseUrl),
      body: JSON.stringify({ expectedRevision: 7, requestId: "approve-stale" }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).request.revision, 8);
  });
});

test("password change returns a fresh authenticated session without exposing passwords or tokens", async () => {
  const accounts = makeAccounts();
  const auth = makeAuth();
  let changeInput;
  accounts.changeOwnPassword = async (input) => {
    changeInput = input;
    return { outcome: "changed", revision: 2, replayed: false };
  };
  await withServer(makeHandler(accounts, auth), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v3/auth/change-password`, {
      method: "POST",
      headers: mutationHeaders(baseUrl),
      body: JSON.stringify({
        currentPassword: "old-test-password",
        newPassword: "new-test-password",
        requestId: "change-password-1",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(changeInput.actorId, ACTOR_ID);
    assert.equal(changeInput.username, "manager");
    assert.equal(auth.signInInput.password, "new-test-password");
    const bodyText = await response.text();
    assert.equal(bodyText.includes("old-test-password"), false);
    assert.equal(bodyText.includes("new-test-password"), false);
    assert.equal(bodyText.includes(SESSION_TOKEN), false);
    assert.equal(bodyText.includes(CSRF_TOKEN), false);
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], /HttpOnly/);
    assert.match(cookies[0], /Secure/);
    assert.doesNotMatch(cookies[1], /HttpOnly/);
  });
});

test("rate limits, storage outages, and unexpected failures retain safe HTTP semantics", async () => {
  const accounts = makeAccounts();
  const auth = makeAuth();
  const logs = [];
  accounts.requestPasswordReset = async () => {
    throw new V3AuthError(429, "Too many recovery requests.", 17);
  };
  accounts.createInvitation = async () => {
    throw new V3AuthError(503, "Account storage is temporarily unavailable. Requery before retrying.");
  };
  accounts.completePasswordReset = async () => {
    throw new Error("sensitive database detail and test-password");
  };
  await withServer(makeHandler(accounts, auth, logs), async (baseUrl) => {
    const limited = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests`, {
      method: "POST",
      headers: mutationHeaders(baseUrl, false),
      body: JSON.stringify({ username: "operator", requestId: "forgot-limited" }),
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "17");

    const outage = await fetch(`${baseUrl}/api/v3/auth/invitations`, {
      method: "POST",
      headers: mutationHeaders(baseUrl),
      body: JSON.stringify({ roleName: "operator", requestId: "invite-outage" }),
    });
    assert.equal(outage.status, 503);

    const failure = await fetch(`${baseUrl}/api/v3/auth/password-reset`, {
      method: "POST",
      headers: mutationHeaders(baseUrl, false),
      body: JSON.stringify({ username: "operator", code: "ABCD-2345", password: "test-password", requestId: "reset-failure" }),
    });
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: "The account request could not be completed. Try again." });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].operation, "reset_complete");
    assert.equal(logs[0].errorName, "Error");
    assert.equal(JSON.stringify(logs).includes("sensitive database detail"), false);
    assert.equal(JSON.stringify(logs).includes("test-password"), false);
  });
});

test("existing staff routes remain outside the account router and invalid UUID actions are not matched", async () => {
  await withServer(makeHandler(), async (baseUrl) => {
    const existing = await fetch(`${baseUrl}/api/v3/auth/staff`);
    assert.equal(existing.status, 404);
    const invalidAction = await fetch(`${baseUrl}/api/v3/auth/password-reset-requests/not-a-uuid/approve`, {
      method: "POST",
      headers: mutationHeaders(baseUrl),
      body: JSON.stringify({ expectedRevision: 1, requestId: "approve-invalid" }),
    });
    assert.equal(invalidAction.status, 404);
  });
});
