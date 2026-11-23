import { V3AuthError } from "./auth-crypto.mjs";

const AUTH_PREFIX = "/api/v3/auth";
const MAX_AUTH_BODY_BYTES = 4096;
const UUID_PATH = "[0-9a-f-]{36}";

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new V3AuthError(415, "Send this request as JSON.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_AUTH_BODY_BYTES) throw new V3AuthError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (size === 0) throw new V3AuthError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new V3AuthError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new V3AuthError(400, "The JSON request body must be an object.");
  }
  return body;
}

function assertSameOriginRequest(request) {
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") throw new V3AuthError(403, "This request was not same-origin.");
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== "string" || origin.length > 512) {
    throw new V3AuthError(403, "This request was not same-origin.");
  }
  const host = request.headers.host;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new V3AuthError(403, "This request was not same-origin.");
  }
  if (
    (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:")
    || typeof host !== "string"
    || parsedOrigin.host.toLowerCase() !== host.toLowerCase() && fetchSite !== "same-origin"
    || parsedOrigin.username || parsedOrigin.password
    || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash
  ) {
    throw new V3AuthError(403, "This request was not same-origin.");
  }
}

function requireKeys(body, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(body);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !Object.hasOwn(body, key))) {
    throw new V3AuthError(400, "The account request contains missing or unsupported fields.");
  }
}

function routeOperation(pathname) {
  if (pathname === `${AUTH_PREFIX}/invitations/accept`) return { name: "invitation_accept" };
  if (pathname === `${AUTH_PREFIX}/invitations`) return { name: "invitations" };
  let match = new RegExp(`^${AUTH_PREFIX}/invitations/(${UUID_PATH})/revoke$`, "i").exec(pathname);
  if (match) return { name: "invitation_revoke", id: match[1] };
  if (pathname === `${AUTH_PREFIX}/password-reset-requests`) return { name: "reset_requests" };
  match = new RegExp(`^${AUTH_PREFIX}/password-reset-requests/(${UUID_PATH})/(approve|decline|reissue)$`, "i").exec(pathname);
  if (match) return { name: `reset_${match[2].toLowerCase()}`, id: match[1] };
  if (pathname === `${AUTH_PREFIX}/password-reset`) return { name: "reset_complete" };
  if (pathname === `${AUTH_PREFIX}/change-password`) return { name: "password_change" };
  match = new RegExp(`^${AUTH_PREFIX}/staff/(${UUID_PATH})/revoke-sessions$`, "i").exec(pathname);
  if (match) return { name: "staff_revoke_sessions", id: match[1] };
  return null;
}

function methodNotAllowed(response, allow, message) {
  sendJson(response, 405, { error: message }, { Allow: allow });
}

export function createAccountApi({
  accounts,
  auth,
  getClientKey,
  secureCookies = process.env.NODE_ENV === "production",
  logger = () => {},
} = {}) {
  for (const method of [
    "listInvitations", "createInvitation", "revokeInvitation", "acceptInvitation",
    "requestPasswordReset", "listPasswordResets", "approvePasswordReset",
    "declinePasswordReset", "reissuePasswordReset", "completePasswordReset",
    "changeOwnPassword", "revokeStaffSessions",
  ]) {
    if (typeof accounts?.[method] !== "function") {
      throw new TypeError(`A V3 account service with ${method}() is required.`);
    }
  }
  for (const method of ["authenticate", "verifyCsrf", "signIn", "sessionCookie", "csrfCookie"]) {
    if (typeof auth?.[method] !== "function") throw new TypeError(`A V3 auth adapter with ${method}() is required.`);
  }
  if (typeof getClientKey !== "function") throw new TypeError("A trusted client-key resolver is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");

  return async function handleAccountApi(request, response) {
    let url;
    try {
      url = new URL(request.url || "/", "http://v3.local");
    } catch {
      return false;
    }
    const operation = routeOperation(url.pathname);
    if (!operation) return false;

    try {
      assertSameOriginRequest(request);
      if (url.search) throw new V3AuthError(400, "Account routes do not accept query parameters.");
      const clientKey = getClientKey(request);

      if (operation.name === "invitation_accept") {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST", "This method is not allowed for invitation acceptance.");
          return true;
        }
        const body = await readJsonBody(request);
        requireKeys(body, ["secret", "username", "password", "requestId"]);
        const result = await accounts.acceptInvitation({ ...body, clientKey });
        sendJson(response, result.outcome === "accepted" ? 201 : 200, {
          outcome: result.outcome,
          staff: result.staff,
        });
        return true;
      }

      if (operation.name === "reset_requests" && request.method === "POST") {
        const body = await readJsonBody(request);
        requireKeys(body, ["username", "requestId"]);
        sendJson(response, 202, await accounts.requestPasswordReset({ ...body, clientKey }));
        return true;
      }

      if (operation.name === "reset_complete") {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST", "This method is not allowed for password recovery.");
          return true;
        }
        const body = await readJsonBody(request);
        requireKeys(body, ["username", "code", "password", "requestId"]);
        sendJson(response, 200, await accounts.completePasswordReset({ ...body, clientKey }));
        return true;
      }

      const current = await auth.authenticate(request);
      if (current?.verified !== true) {
        sendJson(response, 401, { error: "Sign in to access account administration." });
        return true;
      }
      const requiredCapability = ["invitations", "invitation_revoke", "staff_revoke_sessions"].includes(operation.name)
        ? "manage-staff"
        : ["reset_requests", "reset_approve", "reset_decline", "reset_reissue"].includes(operation.name)
          ? "approve-password-resets"
          : null;
      if (requiredCapability && !current.capabilities.includes(requiredCapability)) {
        sendJson(response, 403, { error: "You do not have permission for this account action." });
        return true;
      }
      if (request.method !== "GET" && await auth.verifyCsrf(request, current) !== true) {
        sendJson(response, 403, { error: "Refresh your session before changing account data." });
        return true;
      }

      if (operation.name === "invitations") {
        if (request.method === "GET") {
          sendJson(response, 200, { invitations: await accounts.listInvitations(current.actorId) });
          return true;
        }
        if (request.method !== "POST") {
          methodNotAllowed(response, "GET, POST", "This method is not allowed for invitations.");
          return true;
        }
        const body = await readJsonBody(request);
        requireKeys(body, ["roleName", "requestId"]);
        const result = await accounts.createInvitation({ ...body, actorId: current.actorId, clientKey });
        sendJson(response, 201, { invitation: result.invitation, secret: result.secret });
        return true;
      }

      if (operation.name === "invitation_revoke") {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST", "This method is not allowed for invitation revocation.");
          return true;
        }
        const body = await readJsonBody(request);
        requireKeys(body, ["expectedRevision", "requestId"]);
        const result = await accounts.revokeInvitation({
          ...body, invitationId: operation.id, actorId: current.actorId, clientKey,
        });
        sendJson(response, 200, { invitation: result.invitation, outcome: result.outcome, replayed: result.replayed });
        return true;
      }

      if (operation.name === "reset_requests") {
        if (request.method !== "GET") {
          methodNotAllowed(response, "GET, POST", "This method is not allowed for password reset requests.");
          return true;
        }
        sendJson(response, 200, await accounts.listPasswordResets(current.actorId));
        return true;
      }

      if (["reset_approve", "reset_decline", "reset_reissue"].includes(operation.name)) {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST", "This method is not allowed for password reset administration.");
          return true;
        }
        const body = await readJsonBody(request);
        requireKeys(body, ["expectedRevision", "requestId"]);
        const input = {
          ...body, passwordResetId: operation.id, actorId: current.actorId, clientKey,
        };
        if (operation.name === "reset_approve") {
          const result = await accounts.approvePasswordReset(input);
          sendJson(response, 200, { request: result.request, code: result.code });
        } else if (operation.name === "reset_decline") {
          const result = await accounts.declinePasswordReset(input);
          sendJson(response, 200, { request: result.request, outcome: result.outcome, replayed: result.replayed });
        } else {
          const result = await accounts.reissuePasswordReset(input);
          sendJson(response, 200, { request: result.request, code: result.code });
        }
        return true;
      }

      if (operation.name === "password_change") {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST", "This method is not allowed for password changes.");
          return true;
        }
        const body = await readJsonBody(request);
        requireKeys(body, ["currentPassword", "newPassword", "requestId"]);
        await accounts.changeOwnPassword({
          ...body, actorId: current.actorId, username: current.username, clientKey,
        });
        const result = await auth.signIn({
          username: current.username, password: body.newPassword, clientKey,
        });
        sendJson(response, 200, { staff: result.staff, expiresAt: result.expiresAt }, {
          "Set-Cookie": [
            auth.sessionCookie(result.token, { secure: secureCookies }),
            auth.csrfCookie(result.csrfToken, { secure: secureCookies }),
          ],
        });
        return true;
      }

      if (operation.name === "staff_revoke_sessions") {
        if (request.method !== "POST") {
          methodNotAllowed(response, "POST", "This method is not allowed for session revocation.");
          return true;
        }
        const body = await readJsonBody(request);
        requireKeys(body, ["expectedRevision", "requestId"]);
        const result = await accounts.revokeStaffSessions({
          ...body, staffId: operation.id, actorId: current.actorId, clientKey,
        });
        sendJson(response, 200, result);
        return true;
      }

      return false;
    } catch (error) {
      if (error instanceof V3AuthError) {
        const headers = error.retryAfterSeconds === undefined
          ? {}
          : { "Retry-After": String(error.retryAfterSeconds) };
        sendJson(response, error.status, { error: error.message, ...error.details }, headers);
        return true;
      }
      logger({
        event: "v3.account.http_error",
        requestId: request.v3RequestId ?? null,
        operation: operation.name,
        errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
      });
      sendJson(response, 500, { error: "The account request could not be completed. Try again." });
      return true;
    }
  };
}
