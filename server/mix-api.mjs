import { randomUUID } from "node:crypto";
import { createMixService, MixServiceError } from "../core/mix-service.mjs";

const PATHS = new Set([
  "/api/v3/mix-plan",
  "/api/v3/mix-recipes",
  "/api/v3/mix-surplus",
  "/api/v3/mix-plan/commands",
  "/api/v3/mix-recipes/commands",
  "/api/v3/mix-surplus/commands",
]);
const COMMAND_PATHS = new Map([
  ["/api/v3/mix-recipes/commands", "executeRecipes"],
  ["/api/v3/mix-plan/commands", "executePlan"],
  ["/api/v3/mix-surplus/commands", "executeSurplus"],
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 256_000;

export class MixApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "MixApiError";
    this.status = status;
  }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new MixApiError(400, "The request contains missing or unsupported fields.");
  }
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new MixApiError(415, "Send this request as JSON.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new MixApiError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (size === 0) throw new MixApiError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MixApiError(400, "The request body is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new MixApiError(400, "The request body must be an object.");
  }
  return body;
}

function verifiedIdentity(auth) {
  if (auth?.verified !== true) throw new MixApiError(401, "Sign in to access the Mix Plan.");
  if (typeof auth.actorId !== "string" || !UUID.test(auth.actorId)
    || typeof auth.facilityId !== "string" || !UUID.test(auth.facilityId)) {
    throw new MixApiError(401, "Refresh your V3 session before continuing.");
  }
  return { actorId: auth.actorId.toLowerCase(), facilityId: auth.facilityId.toLowerCase() };
}

function safeStatus(error) {
  if (error instanceof MixApiError || error instanceof MixServiceError) return error.status;
  if (error?.code === "42501") return 403;
  if (["P0002", "23505", "40001", "22003", "55000"].includes(error?.code)) return 409;
  if (["22023", "22P02", "23514"].includes(error?.code)) return 400;
  return 500;
}

function safeMessage(error, status) {
  if (error instanceof MixApiError || error instanceof MixServiceError) return error.message;
  if (status === 403) return "This Mix Plan is not available to your account.";
  if (status === 409) return "The Mix Plan changed or is no longer available. Refresh and review it again.";
  if (status === 400) return "The Mix Plan request contains invalid values or references.";
  return "The Mix Plan request could not be completed. Refresh and try again.";
}

export function createMixApi({ pool, authenticate, verifyCsrf, logger = () => {} }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V3 PostgreSQL pool is required.");
  if (typeof authenticate !== "function" || typeof verifyCsrf !== "function") {
    throw new TypeError("V3 Mix Plan authentication and CSRF adapters are required.");
  }
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");

  const query = (text, values) => pool.query({ text, values, query_timeout: 5_000 });
  const service = createMixService({ query });
  const rateBuckets = new Map();

  function rateLimit(actorId, route) {
    const now = Date.now();
    const key = `${actorId}:${route}`;
    const bucket = (rateBuckets.get(key) ?? []).filter((time) => now - time < 60_000);
    if (bucket.length >= 120) {
      rateBuckets.set(key, bucket);
      return Math.max(1, Math.ceil((60_000 - (now - bucket[0])) / 1000));
    }
    bucket.push(now);
    rateBuckets.set(key, bucket);
    if (rateBuckets.size > 2_000) {
      for (const [oldKey, times] of rateBuckets) {
        if (!times.length || now - times[times.length - 1] >= 3_600_000) rateBuckets.delete(oldKey);
        if (rateBuckets.size <= 1_500) break;
      }
    }
    return 0;
  }

  return async function handleMixApi(request, response) {
    const url = new URL(request.url || "/", "http://v3.local");
    if (![...PATHS].some((path) => url.pathname === path)) return false;
    try {
      const auth = await authenticate(request);
      const { actorId } = verifiedIdentity(auth);
      const commandMethod = COMMAND_PATHS.get(url.pathname);
      const route = commandMethod ? "command" : "read";
      const retryAfter = rateLimit(actorId, route);
      if (retryAfter > 0) {
        sendJson(response, 429, { error: "Too many Mix Plan requests. Wait briefly and try again." }, { "Retry-After": String(retryAfter) });
        return true;
      }

      if (request.method === "GET" && !commandMethod) {
        if (url.pathname === "/api/v3/mix-plan") {
          const keys = [...url.searchParams.keys()];
          if (keys.length !== 1 || keys[0] !== "makeDate" || url.searchParams.getAll("makeDate").length !== 1) {
            throw new MixApiError(400, "Specify one Mix Plan make date.");
          }
          sendJson(response, 200, { plan: await service.getPlan({ auth, makeDate: url.searchParams.get("makeDate") }) });
          return true;
        }
        if (url.search) throw new MixApiError(400, "This Mix Plan read does not support query parameters.");
        if (url.pathname === "/api/v3/mix-recipes") {
          sendJson(response, 200, { catalog: await service.getRecipes({ auth }) });
        } else {
          sendJson(response, 200, { surplus: await service.getSurplus({ auth }) });
        }
        return true;
      }

      if (request.method === "POST" && commandMethod) {
        if (url.search) throw new MixApiError(400, "Mix Plan commands do not support query parameters.");
        if (await verifyCsrf(request, auth) !== true) {
          throw new MixApiError(403, "Refresh your session before changing the Mix Plan.");
        }
        const body = await readJsonBody(request);
        exactKeys(body, ["requestId", "expectedRevision", "command"]);
        const result = await service[commandMethod]({
          auth,
          requestId: body.requestId,
          expectedRevision: body.expectedRevision,
          command: body.command,
        });
        sendJson(response, result.outcome === "conflict" ? 409 : 200, result);
        return true;
      }

      sendJson(response, 405, { error: "This Mix Plan method is not allowed." }, { Allow: commandMethod ? "POST" : "GET" });
      return true;
    } catch (error) {
      const status = safeStatus(error);
      if (status >= 500) {
        logger({
          event: "v3.mix.request_failed",
          method: request.method,
          route: url.pathname.endsWith("/commands") ? "mix.command" : "mix.read",
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          requestId: request.v3RequestId ?? randomUUID(),
        });
      }
      sendJson(response, status, { error: safeMessage(error, status) });
      return true;
    }
  };
}
