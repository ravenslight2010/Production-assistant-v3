import {
  argon2 as argon2Callback,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const PASSWORD_HASH_LENGTH = 32;
const ARGON2_PARAMETERS = Object.freeze({ memory: 19_456, passes: 2, parallelism: 1 });
const MAX_ACTIVE_PASSWORD_CHECKS = 4;
const MAX_RATE_LIMIT_KEYS = 10_000;
let activePasswordChecks = 0;

export class V3AuthError extends Error {
  constructor(status, message, retryAfterSeconds = undefined, details = undefined) {
    super(message);
    this.name = "V3AuthError";
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
    if (details !== undefined) this.details = details;
  }
}

export function hashHex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

function canonicalBase64(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

async function derivePasswordHash(password, salt) {
  if (typeof argon2Callback !== "function") {
    throw new Error("This V3 runtime does not provide the required Argon2id implementation.");
  }
  const result = await new Promise((resolve, reject) => {
    argon2Callback("argon2id", {
      message: Buffer.from(password, "utf8"),
      nonce: salt,
      parallelism: ARGON2_PARAMETERS.parallelism,
      tagLength: PASSWORD_HASH_LENGTH,
      memory: ARGON2_PARAMETERS.memory,
      passes: ARGON2_PARAMETERS.passes,
    }, (error, derived) => error ? reject(error) : resolve(derived));
  });
  return Buffer.from(result);
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 128) {
    throw new TypeError("Passwords must be between 6 and 128 characters.");
  }
  if (activePasswordChecks >= MAX_ACTIVE_PASSWORD_CHECKS) {
    throw new V3AuthError(429, "Password processing is temporarily busy. Wait briefly and try again.", 1);
  }
  activePasswordChecks += 1;
  try {
    const salt = randomBytes(16);
    const derived = await derivePasswordHash(password, salt);
    return `argon2id$v=19$m=${ARGON2_PARAMETERS.memory},t=${ARGON2_PARAMETERS.passes},p=${ARGON2_PARAMETERS.parallelism}$${salt.toString("base64")}$${derived.toString("base64")}`;
  } finally {
    activePasswordChecks -= 1;
  }
}

export async function verifyPassword(password, encodedHash) {
  if (
    typeof password !== "string"
    || password.length < 1
    || password.length > 128
    || typeof encodedHash !== "string"
    || encodedHash.length > 256
  ) {
    return false;
  }
  const parts = encodedHash.split("$");
  const expectedParameters = `m=${ARGON2_PARAMETERS.memory},t=${ARGON2_PARAMETERS.passes},p=${ARGON2_PARAMETERS.parallelism}`;
  if (parts.length !== 5 || parts[0] !== "argon2id" || parts[1] !== "v=19" || parts[2] !== expectedParameters) return false;
  const salt = canonicalBase64(parts[3]);
  const expected = canonicalBase64(parts[4]);
  if (!salt || salt.length !== 16 || !expected || expected.length !== PASSWORD_HASH_LENGTH) return false;
  if (activePasswordChecks >= MAX_ACTIVE_PASSWORD_CHECKS) {
    throw new V3AuthError(429, "Sign-in is temporarily busy. Wait briefly and try again.", 1);
  }

  activePasswordChecks += 1;
  try {
    const actual = await derivePasswordHash(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  } finally {
    activePasswordChecks -= 1;
  }
}

export function createRateLimiter({ maxAttempts, windowMs, clock }) {
  const entries = new Map();
  return {
    consume(key) {
      const now = clock();
      for (const [existingKey, item] of entries) {
        if (item.resetAt <= now) entries.delete(existingKey);
      }

      let item = entries.get(key);
      if (!item || item.resetAt <= now) {
        item = { count: 0, resetAt: now + windowMs };
        entries.delete(key);
        entries.set(key, item);
      } else {
        entries.delete(key);
        entries.set(key, item);
      }
      if (entries.size > MAX_RATE_LIMIT_KEYS) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }

      if (item.count >= maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((item.resetAt - now) / 1000)),
        };
      }
      item.count += 1;
      return { allowed: true };
    },
  };
}
