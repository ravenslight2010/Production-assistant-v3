import { randomUUID } from "node:crypto";
import { createQcService, QcServiceError } from "../core/qc-service.mjs";

const QC_ROOT = "/api/v3/qc";
const TARGETS_PATH = `${QC_ROOT}/targets`;
const RECORD_PATHS = new Map([
  [`${QC_ROOT}/lots`, "lot"],
  [`${QC_ROOT}/weight-checks`, "weight-check"],
  [`${QC_ROOT}/brix-checks`, "brix-check"],
  [`${QC_ROOT}/component-checks`, "component-check"],
  [`${QC_ROOT}/allergen-reviews`, "allergen-review"],
  [`${QC_ROOT}/cleaning-records`, "cleaning"],
]);
const DASHBOARD_PATH = /^\/api\/v3\/qc\/runs\/([^/]+)$/u;
const VERIFICATION_PATH = /^\/api\/v3\/qc\/cleaning-records\/([^/]+)\/verification$/u;
const SIGN_OFF_PATH = /^\/api\/v3\/qc\/runs\/([^/]+)\/sign-off$/u;
const MAX_BODY_BYTES = 32 * 1024;

class QcApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "QcApiError";
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

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new QcApiError(400, "The request contains missing or unsupported fields.");
  }
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new QcApiError(415, "Send this request as JSON.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new QcApiError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (size === 0) throw new QcApiError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new QcApiError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new QcApiError(400, "The JSON request body must be an object.");
  }
  return body;
}

function noQuery(url) {
  if (url.search) throw new QcApiError(400, "This QC route does not support query parameters.");
}

function safeStatus(error) {
  if (error instanceof QcApiError || error instanceof QcServiceError) return error.status;
  return 500;
}

function safeMessage(error) {
  if (error instanceof QcApiError || error instanceof QcServiceError) return error.message;
  return "The QC request could not be completed. Refresh and try again.";
}

export function createQcApi({ pool, authenticate, verifyCsrf, logger = () => {} }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V3 PostgreSQL pool is required.");
  if (typeof authenticate !== "function" || typeof verifyCsrf !== "function") {
    throw new TypeError("V3 QC authentication and CSRF adapters are required.");
  }
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  const query = (text, values) => pool.query({ text, values, query_timeout: 5_000 });
  const service = createQcService({ query });

  return async function handleQcApi(request, response) {
    const url = new URL(request.url || "/", "http://v3.local");
    const dashboardMatch = DASHBOARD_PATH.exec(url.pathname);
    const verificationMatch = VERIFICATION_PATH.exec(url.pathname);
    const signOffMatch = SIGN_OFF_PATH.exec(url.pathname);
    const recordKind = RECORD_PATHS.get(url.pathname);
    if (url.pathname !== TARGETS_PATH && !recordKind && !dashboardMatch && !verificationMatch && !signOffMatch) return false;
    try {
      const auth = await authenticate(request);
      if (auth?.verified !== true) throw new QcApiError(401, "Sign in to access QC.");
      if (request.method === "POST" && await verifyCsrf(request, auth) !== true) {
        throw new QcApiError(403, "Refresh your session before changing QC state.");
      }
      noQuery(url);

      if (dashboardMatch && request.method === "GET") {
        const dashboard = await service.getDashboard({ auth, runId: decodeURIComponent(dashboardMatch[1]) });
        sendJson(response, 200, dashboard);
        return true;
      }
      if (url.pathname === TARGETS_PATH && request.method === "GET") {
        sendJson(response, 200, await service.getTargets({ auth }));
        return true;
      }
      if (recordKind && request.method === "POST") {
        const body = await readJsonBody(request);
        exactKeys(body, ["requestId", "runId", "details"]);
        const result = await service.record({
          auth, kind: recordKind, requestId: body.requestId, runId: body.runId, details: body.details,
        });
        sendJson(response, result.replayed ? 200 : 201, result);
        return true;
      }
      if (verificationMatch && request.method === "POST") {
        const body = await readJsonBody(request);
        exactKeys(body, ["requestId", "details"]);
        const result = await service.verifyCleaning({
          auth, requestId: body.requestId,
          cleaningRecordId: decodeURIComponent(verificationMatch[1]), details: body.details,
        });
        sendJson(response, result.replayed ? 200 : 201, result);
        return true;
      }
      if (signOffMatch && request.method === "POST") {
        const body = await readJsonBody(request);
        exactKeys(body, ["requestId", "expectedHighWaterMark"]);
        const result = await service.signOff({
          auth, requestId: body.requestId, runId: decodeURIComponent(signOffMatch[1]),
          expectedHighWaterMark: body.expectedHighWaterMark,
        });
        sendJson(response, result.outcome === "conflict" ? 409 : result.replayed ? 200 : 201, result);
        return true;
      }
      if (url.pathname === TARGETS_PATH && request.method === "POST") {
        const body = await readJsonBody(request);
        exactKeys(body, ["requestId", "targetKey", "expectedRevision", "details"]);
        const result = await service.saveTarget({
          auth, requestId: body.requestId, targetKey: body.targetKey,
          expectedRevision: body.expectedRevision, details: body.details,
        });
        sendJson(response, result.outcome === "conflict" ? 409 : 200, result);
        return true;
      }

      const allowed = dashboardMatch || (url.pathname === TARGETS_PATH && !recordKind)
        ? (url.pathname === TARGETS_PATH ? "GET, POST" : "GET") : "POST";
      sendJson(response, 405, { error: "This QC method is not allowed." }, { Allow: allowed });
      return true;
    } catch (error) {
      const status = safeStatus(error);
      if (status >= 500) {
        logger({
          event: "v3.qc.request_failed",
          method: request.method,
          route: dashboardMatch ? "qc.dashboard" : url.pathname === TARGETS_PATH ? "qc.targets" : "qc.record",
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          requestId: request.v3RequestId ?? randomUUID(),
        });
      }
      sendJson(response, status, { error: safeMessage(error) });
      return true;
    }
  };
}
