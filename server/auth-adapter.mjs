import { timingSafeEqual } from "node:crypto";
import {
  createRateLimiter,
  hashHex,
  hashPassword,
  randomToken,
  V3AuthError,
  verifyPassword,
} from "./auth-crypto.mjs";

export { V3AuthError, hashPassword, verifyPassword } from "./auth-crypto.mjs";

const SESSION_COOKIE = "v3_session";
const CSRF_COOKIE = "v3_csrf";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const RUN_ACTIONS = new Set([
  "run.read", "run.create", "run.lifecycle.command", "run.operations.command", "station.read", "station.command",
]);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FIND_STAFF_SQL = "SELECT * FROM v3.find_staff_for_sign_in($1::text)";
const OPEN_SESSION_SQL = "SELECT v3.open_staff_session($1::uuid, $2::text, $3::text, $4::timestamptz) AS opened";
const RESOLVE_SESSION_SQL = "SELECT * FROM v3.resolve_staff_session($1::text)";
const REVOKE_SESSION_SQL = "SELECT v3.revoke_staff_session($1::text) AS revoked";
const BOOTSTRAP_OPEN_SQL = "SELECT v3.staff_bootstrap_open() AS available";
const BOOTSTRAP_MANAGER_SQL = "SELECT v3.bootstrap_first_manager($1::text, $2::text) AS created";
const LIST_STAFF_SQL = "SELECT * FROM v3.list_staff_accounts($1::uuid)";
const LIST_STAFF_ROLES_SQL = "SELECT * FROM v3.list_staff_roles($1::uuid)";

function normalizeUsername(value) {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length < 3
    || value.length > 40
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new V3AuthError(400, "Enter a valid username and password.");
  }
  return value.toLowerCase();
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new V3AuthError(400, "Enter a valid username and password.");
  }
}

function parseCookie(request, cookieName) {
  const raw = request?.headers?.cookie;
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let found = null;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== cookieName) continue;
    if (found !== null) return null;
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    found = value;
  }
  return found;
}

function validatePrincipal(row) {
  const capabilities = row?.capabilities;
  if (
    !row
    || !UUID_PATTERN.test(row.actor_id ?? "")
    || !UUID_PATTERN.test(row.facility_id ?? "")
    || typeof row.username !== "string"
    || typeof row.role_name !== "string"
    || !Array.isArray(capabilities)
    || capabilities.length > 100
    || capabilities.some((capability) => typeof capability !== "string" || capability.length > 80)
    || typeof row.csrf_hash !== "string"
    || !HASH_PATTERN.test(row.csrf_hash)
    || typeof row.expires_at !== "string" && !(row.expires_at instanceof Date)
  ) {
    throw new V3AuthError(503, "Sign-in is temporarily unavailable. Try again.");
  }
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.valueOf())) {
    throw new V3AuthError(503, "Sign-in is temporarily unavailable. Try again.");
  }
  return {
    verified: true,
    actorId: row.actor_id.toLowerCase(),
    facilityId: row.facility_id.toLowerCase(),
    username: row.username,
    role: row.role_name,
    capabilities,
    csrfHash: row.csrf_hash,
    sessionExpiresAt: expiresAt.toISOString(),
  };
}

function publicStaff(auth) {
  return {
    userId: auth.actorId,
    username: auth.username,
    role: auth.role,
    capabilities: [...auth.capabilities],
  };
}

function makeCookie(token, { secure, maxAgeSeconds }) {
  const safeAge = Number.isSafeInteger(maxAgeSeconds) && maxAgeSeconds >= 0
    ? maxAgeSeconds
    : Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${safeAge}${secure ? "; Secure" : ""}`;
}

export function createAuthAdapter({
  query,
  clock = Date.now,
  sessionTtlMs = SESSION_TTL_MS,
  loginLimit = { maxAttempts: 20, windowMs: 60_000 },
  bootstrapSecret = "",
  bootstrapStatusLimit = { maxAttempts: 60, windowMs: 60_000 },
  bootstrapLimit = { maxAttempts: 5, windowMs: 60_000 },
  staffReadLimit = { maxAttempts: 120, windowMs: 60_000 },
  logger = () => {},
} = {}) {
  if (typeof query !== "function") throw new TypeError("A parameterized V3 database query is required.");
  if (typeof clock !== "function") throw new TypeError("A clock function is required.");
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 60_000 || sessionTtlMs > MAX_SESSION_TTL_MS) {
    throw new TypeError("sessionTtlMs must be between one minute and 90 days.");
  }
  if (
    !Number.isSafeInteger(loginLimit?.maxAttempts)
    || loginLimit.maxAttempts < 1
    || !Number.isSafeInteger(loginLimit.windowMs)
    || loginLimit.windowMs < 1000
  ) {
    throw new TypeError("A positive login rate limit is required.");
  }
  for (const [name, limit] of [
    ["bootstrapStatusLimit", bootstrapStatusLimit],
    ["bootstrapLimit", bootstrapLimit],
    ["staffReadLimit", staffReadLimit],
  ]) {
    if (
      !Number.isSafeInteger(limit?.maxAttempts)
      || limit.maxAttempts < 1
      || !Number.isSafeInteger(limit.windowMs)
      || limit.windowMs < 1000
    ) {
      throw new TypeError(`A positive ${name} is required.`);
    }
  }

  const limiter = createRateLimiter({ ...loginLimit, clock });
  const bootstrapStatusLimiter = createRateLimiter({ ...bootstrapStatusLimit, clock });
  const bootstrapLimiter = createRateLimiter({ ...bootstrapLimit, clock });
  const staffReadLimiter = createRateLimiter({ ...staffReadLimit, clock });
  const bootstrapIsConfigured = typeof bootstrapSecret === "string"
    && bootstrapSecret.length >= 32
    && bootstrapSecret.length <= 256;
  let dummyHashPromise;

  function consumeLimit(targetLimiter, keys, message) {
    const results = keys.map((key) => targetLimiter.consume(key));
    const blocked = results.find((result) => !result.allowed);
    if (blocked) {
      throw new V3AuthError(429, message, blocked.retryAfterSeconds);
    }
  }

  function checkBootstrapSecret(value) {
    if (!bootstrapIsConfigured) return false;
    if (typeof value !== "string" || value.length < 32 || value.length > 256) return false;
    const actual = Buffer.from(hashHex(value), "hex");
    const expected = Buffer.from(hashHex(bootstrapSecret), "hex");
    return timingSafeEqual(actual, expected);
  }

  async function dummyHash() {
    dummyHashPromise ??= hashPassword(randomToken());
    return dummyHashPromise;
  }

  async function signIn({ username, password, clientKey }) {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    if (typeof clientKey !== "string" || clientKey.length < 1 || clientKey.length > 256) {
      throw new V3AuthError(400, "Sign-in request is invalid.");
    }

    const ipLimit = limiter.consume(`ip:${hashHex(clientKey)}`);
    const accountLimit = limiter.consume(`account:${hashHex(normalizedUsername)}`);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const retryAfterSeconds = Math.max(
        ipLimit.retryAfterSeconds ?? 0,
        accountLimit.retryAfterSeconds ?? 0,
      );
      logger({
        event: "v3.auth.sign_in",
        outcome: "rate_limited",
        retryAfterSeconds,
      });
      throw new V3AuthError(429, "Too many sign-in attempts. Wait and try again.", retryAfterSeconds);
    }

    const lookup = await query(FIND_STAFF_SQL, [normalizedUsername]);
    const account = lookup?.rows?.[0];
    const passwordHash = typeof account?.password_hash === "string"
      ? account.password_hash
      : await dummyHash();
    const passwordMatches = await verifyPassword(password, passwordHash);
    if (!account || account.disabled !== false || !passwordMatches) {
      logger({ event: "v3.auth.sign_in", outcome: "rejected" });
      throw new V3AuthError(401, "Invalid username or password.");
    }

    const token = randomToken();
    const csrfToken = randomToken();
    const tokenHash = hashHex(token);
    const csrfHash = hashHex(csrfToken);
    const expiresAt = new Date(clock() + sessionTtlMs);
    const opened = await query(OPEN_SESSION_SQL, [
      account.staff_id,
      tokenHash,
      csrfHash,
      expiresAt.toISOString(),
    ]);
    if (opened?.rows?.[0]?.opened !== true) {
      logger({ event: "v3.auth.sign_in", outcome: "rejected" });
      throw new V3AuthError(401, "Invalid username or password.");
    }

    const auth = await resolveToken(token);
    if (!auth) {
      await query(REVOKE_SESSION_SQL, [tokenHash]);
      logger({ event: "v3.auth.sign_in", outcome: "unavailable" });
      throw new V3AuthError(503, "Sign-in is temporarily unavailable. Try again.");
    }

    logger({ event: "v3.auth.sign_in", outcome: "accepted", actorId: auth.actorId });
    return {
      token,
      csrfToken,
      expiresAt: auth.sessionExpiresAt,
      staff: publicStaff(auth),
    };
  }

  function validateClientKey(clientKey, message) {
    if (typeof clientKey !== "string" || clientKey.length < 1 || clientKey.length > 256) {
      throw new V3AuthError(400, message);
    }
    return hashHex(clientKey);
  }

  function validateActorId(actorId) {
    if (typeof actorId !== "string" || !UUID_PATTERN.test(actorId)) {
      throw new V3AuthError(401, "Sign in to manage staff accounts.");
    }
  }

  async function listStaff(actorId) {
    validateActorId(actorId);
    consumeLimit(
      staffReadLimiter,
      [`actor:${actorId}`],
      "Staff account reads are temporarily limited. Wait and try again.",
    );
    const [staffResult, roleResult] = await Promise.all([
      query(LIST_STAFF_SQL, [actorId]),
      query(LIST_STAFF_ROLES_SQL, [actorId]),
    ]);
    return {
      staff: (staffResult?.rows ?? []).map((row) => ({
        userId: row.staff_id,
        username: row.username,
        role: row.role_name,
        disabled: row.disabled,
        createdAt: new Date(row.created_at).toISOString(),
        revision: Number(row.revision),
      })),
      roles: (roleResult?.rows ?? []).map((row) => ({
        name: row.role_name,
        capabilities: row.capabilities,
      })),
    };
  }

  async function bootstrapAvailable({ clientKey } = {}) {
    if (!bootstrapIsConfigured) return false;
    const clientHash = validateClientKey(clientKey, "Setup status request is invalid.");
    consumeLimit(
      bootstrapStatusLimiter,
      [`client:${clientHash}`],
      "Setup status checks are temporarily limited. Wait and try again.",
    );
    const result = await query(BOOTSTRAP_OPEN_SQL, []);
    return result?.rows?.[0]?.available === true;
  }

  async function bootstrapManager({ username, password, bootstrapCode, clientKey }) {
    if (!bootstrapIsConfigured) {
      throw new V3AuthError(404, "First-manager setup is unavailable.");
    }
    const clientHash = validateClientKey(clientKey, "First-manager setup request is invalid.");
    consumeLimit(
      bootstrapLimiter,
      [`client:${clientHash}`],
      "Too many setup attempts. Wait and try again.",
    );
    if (!checkBootstrapSecret(bootstrapCode)) {
      logger({ event: "v3.auth.bootstrap", outcome: "rejected" });
      throw new V3AuthError(401, "First-manager setup could not be completed.");
    }
    const normalizedUsername = normalizeUsername(username);
    if (typeof password !== "string" || password.length < 6 || password.length > 128) {
      throw new V3AuthError(400, "Passwords must be between 6 and 128 characters.");
    }
    if (!await bootstrapAvailable({ clientKey })) {
      throw new V3AuthError(409, "First-manager setup has already been completed.");
    }
    const passwordHash = await hashPassword(password);
    const result = await query(BOOTSTRAP_MANAGER_SQL, [normalizedUsername, passwordHash]);
    if (result?.rows?.[0]?.created !== true) {
      logger({ event: "v3.auth.bootstrap", outcome: "closed" });
      throw new V3AuthError(409, "First-manager setup has already been completed.");
    }
    logger({ event: "v3.auth.bootstrap", outcome: "created" });
    return signIn({ username: normalizedUsername, password, clientKey });
  }

  async function resolveToken(token) {
    if (!token) return null;
    const result = await query(RESOLVE_SESSION_SQL, [hashHex(token)]);
    const row = result?.rows?.[0];
    return row ? validatePrincipal(row) : null;
  }

  return Object.freeze({
    signIn,

    bootstrapAvailable,

    bootstrapManager,

    listStaff,

    authenticate(request) {
      return resolveToken(parseCookie(request, SESSION_COOKIE));
    },

    async verifyCsrf(request, auth) {
      const supplied = request?.headers?.["x-csrf-token"];
      const cookieToken = parseCookie(request, CSRF_COOKIE);
      if (
        auth?.verified !== true
        || typeof supplied !== "string"
        || supplied.length !== 43
        || cookieToken === null
        || supplied !== cookieToken
      ) return false;
      const actualHash = Buffer.from(hashHex(supplied), "hex");
      const expectedHash = Buffer.from(auth.csrfHash, "hex");
      return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
    },

    async signOut(request) {
      const token = parseCookie(request, SESSION_COOKIE);
      if (!token) return false;
      const result = await query(REVOKE_SESSION_SQL, [hashHex(token)]);
      return result?.rows?.[0]?.revoked === true;
    },

    authorizeRun({ auth, action }) {
      return auth?.verified === true && RUN_ACTIONS.has(action);
    },

    sessionCookie(token, { secure = process.env.NODE_ENV === "production" } = {}) {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new TypeError("A generated V3 session token is required.");
      }
      return makeCookie(token, {
        secure,
        maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
      });
    },

    csrfCookie(token, { secure = process.env.NODE_ENV === "production" } = {}) {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new TypeError("A generated V3 CSRF token is required.");
      }
      const maxAgeSeconds = Math.floor(sessionTtlMs / 1000);
      return `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
    },

    clearSessionCookie({ secure = process.env.NODE_ENV === "production" } = {}) {
      return makeCookie("", { secure, maxAgeSeconds: 0 });
    },

    clearCsrfCookie({ secure = process.env.NODE_ENV === "production" } = {}) {
      return `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
    },
  });
}
