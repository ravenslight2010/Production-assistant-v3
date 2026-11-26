import { createRunCommandService } from "../core/run-command-service.mjs";
import { createRunService } from "../core/run-service.mjs";
import { createRunToTimeService } from "../core/run-to-time-service.mjs";
import { createRunOperationsService } from "../core/run-operations-service.mjs";
import { createStationCommandService } from "../core/station-command-service.mjs";

const API_PREFIX = "/api/v3/runs";
const STOP_REASONS_PATH = "/api/v3/operations/stop-reasons";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

class RunApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RunApiError";
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

function sendNotModified(response, etag) {
  response.writeHead(304, {
    "Cache-Control": "no-store",
    "ETag": etag,
    "X-Content-Type-Options": "nosniff",
  });
  response.end();
}

async function readJsonBody(request, maxBytes) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RunApiError(415, "Send this request as JSON.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new RunApiError(413, "The request is too large.");
    }
    chunks.push(chunk);
  }
  if (size === 0) throw new RunApiError(400, "A JSON request body is required.");

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RunApiError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RunApiError(400, "The JSON request body must be an object.");
  }
  return body;
}

function requireExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new RunApiError(400, "The request contains missing or unsupported fields.");
  }
}

function safeStatus(error) {
  const knownService = error?.name === "RunServiceError"
    || error?.name === "RunCommandServiceError"
    || error?.name === "RunToTimeServiceError"
    || error?.name === "RunOperationsServiceError"
    || error?.name === "RunStationServiceError"
    || error?.name === "V3AuthError";
  if (error instanceof RunApiError) return error.status;
  if (knownService && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  return 500;
}

function safeMessage(error) {
  if (error instanceof RunApiError
    || error?.name === "RunServiceError"
    || error?.name === "RunCommandServiceError"
    || error?.name === "RunToTimeServiceError"
    || error?.name === "RunOperationsServiceError"
    || error?.name === "RunStationServiceError"
    || error?.name === "V3AuthError") {
    return error.message;
  }
  return "The run request could not be completed. Refresh and try again.";
}

function parseLimit(url) {
  for (const key of url.searchParams.keys()) {
    if (key !== "limit" && key !== "scope") throw new RunApiError(400, "Unsupported run-list query parameter.");
  }
  const values = url.searchParams.getAll("limit");
  if (values.length > 1) throw new RunApiError(400, "Specify run-list limit once.");
  if (values.length === 0) return 50;
  if (!/^[1-9][0-9]*$/.test(values[0])) throw new RunApiError(400, "limit must be from 1 to 100.");
  const limit = Number(values[0]);
  if (!Number.isSafeInteger(limit) || limit > 100) throw new RunApiError(400, "limit must be from 1 to 100.");
  return limit;
}

function parseScope(url) {
  const values = url.searchParams.getAll("scope");
  if (values.length > 1) throw new RunApiError(400, "Specify run-list scope once.");
  if (values.length === 0) return "all";
  if (values[0] !== "all" && values[0] !== "active") {
    throw new RunApiError(400, "scope must be all or active.");
  }
  return values[0];
}

function normalizePathRunId(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new RunApiError(400, "Run ID is invalid.");
  }
  if (!RUN_ID_PATTERN.test(decoded)) throw new RunApiError(400, "Run ID is invalid.");
  return decoded.toLowerCase();
}

export function createRunApi({
  runs,
  commands,
  runToTimes,
  operations,
  stations,
  authenticate,
  verifyCsrf,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  logger = () => {},
}) {
  if (!runs || typeof runs.create !== "function" || typeof runs.get !== "function"
    || typeof runs.list !== "function" || typeof runs.listProducts !== "function") {
    throw new TypeError("Run read and creation services are required.");
  }
  if (!commands || typeof commands.execute !== "function") {
    throw new TypeError("The lifecycle command service is required.");
  }
  if (!runToTimes || typeof runToTimes.execute !== "function") {
    throw new TypeError("The Run to Time command service is required.");
  }
  if (!operations || typeof operations.execute !== "function"
    || typeof operations.getStopReasons !== "function" || typeof operations.saveStopReasons !== "function") {
    throw new TypeError("The run operations service is required.");
  }
  if (stations !== undefined && typeof stations?.execute !== "function") {
    throw new TypeError("The station command service must provide execute().");
  }
  if (typeof authenticate !== "function") {
    throw new TypeError("A server authentication adapter is required.");
  }
  if (typeof verifyCsrf !== "function") {
    throw new TypeError("A server CSRF verification adapter is required.");
  }
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 1024 * 1024) {
    throw new TypeError("maxBodyBytes must be an integer from 1 byte to 1 MiB.");
  }

  return async function handleRunApi(request, response) {
    try {
      const url = new URL(request.url || "/", "http://v3.local");
      if (url.pathname !== STOP_REASONS_PATH && url.pathname !== API_PREFIX
        && !url.pathname.startsWith(`${API_PREFIX}/`)) {
        throw new RunApiError(404, "Run route not found.");
      }

      const auth = await authenticate(request);
      if (auth?.verified !== true) throw new RunApiError(401, "Sign in to access runs.");
      const isMutation = request.method === "POST";
      if (isMutation && await verifyCsrf(request, auth) !== true) {
        throw new RunApiError(403, "Refresh your session before changing run state.");
      }

      if (url.pathname === STOP_REASONS_PATH && request.method === "GET") {
        if (url.search) throw new RunApiError(400, "Stop reason query parameters are not supported.");
        sendJson(response, 200, { settings: await operations.getStopReasons({ auth }) });
        return;
      }

      if (url.pathname === STOP_REASONS_PATH && request.method === "POST") {
        if (url.search) throw new RunApiError(400, "Stop reason query parameters are not supported.");
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["commandId", "expectedRevision", "reasons"]);
        const result = await operations.saveStopReasons({ auth, command: body });
        sendJson(response, result?.outcome === "accepted" ? 200 : 409, result);
        return;
      }

      if (url.pathname === API_PREFIX && request.method === "GET") {
        const limit = parseLimit(url);
        const scope = parseScope(url);
        // ETag = outbox position. Every committed run mutation appends an
        // outbox event in the same transaction, so this changes exactly when
        // the run list could differ. The version travels in the same query
        // as the list, so a conditional poll costs one pool checkout either
        // way; on a match we skip hydrating/serializing the body entirely.
        // The limit is baked into the tag because the body depends on it.
        const list = scope === "active" ? runs.listActiveWithVersion : runs.listWithVersion;
        const { version, runs: listedRuns } = await list({ auth, limit });
        const etag = `"${version}-${limit}-${scope}"`;
        if (request.headers["if-none-match"] === etag) {
          sendNotModified(response, etag);
          return;
        }
        sendJson(response, 200, { runs: listedRuns }, { ETag: etag });
        return;
      }

      if (url.pathname === `${API_PREFIX}/products` && request.method === "GET") {
        if (url.search) throw new RunApiError(400, "Product-list query parameters are not supported.");
        const catalog = await runs.listProducts({ auth });
        sendJson(response, 200, catalog);
        return;
      }

      if (url.pathname === API_PREFIX && request.method === "POST") {
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["requestId", "productionDate", "setupSnapshot"]);
        const result = await runs.create({
          auth,
          requestId: body.requestId,
          productionDate: body.productionDate,
          setupSnapshot: body.setupSnapshot,
        });
        sendJson(response, result.replayed ? 200 : 201, result);
        return;
      }

      const operationMatch = url.pathname.match(/^\/api\/v3\/runs\/([^/]+)\/operations\/commands$/);
      if (operationMatch && request.method === "POST") {
        if (url.search) throw new RunApiError(400, "Run operation query parameters are not supported.");
        const runId = normalizePathRunId(operationMatch[1]);
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["commandId", "commandType", "expectedRevision", "details"]);
        const result = await operations.execute({ auth, command: { ...body, runId } });
        sendJson(response, result?.outcome === "accepted" ? 200 : 409, result);
        return;
      }

      const runToTimeMatch = url.pathname.match(/^\/api\/v3\/runs\/([^/]+)\/run-to-time$/);
      if (runToTimeMatch && request.method === "POST") {
        if (url.search) throw new RunApiError(400, "Run to Time query parameters are not supported.");
        const runId = normalizePathRunId(runToTimeMatch[1]);
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["commandId", "expectedRevision", "runToTime"]);
        const result = await runToTimes.execute({ auth, command: { ...body, runId } });
        sendJson(response, result?.outcome === "accepted" ? 200 : 409, result);
        return;
      }

      const stationMatch = url.pathname.match(/^\/api\/v3\/runs\/([^/]+)\/stations\/([^/]+)\/commands$/);
      if (stationMatch && request.method === "POST") {
        if (!stations) throw new RunApiError(404, "Station route not found.");
        const runId = normalizePathRunId(stationMatch[1]);
        let stationKey;
        try {
          stationKey = decodeURIComponent(stationMatch[2]);
        } catch {
          throw new RunApiError(400, "Station key is invalid.");
        }
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["commandId", "mode", "expectedRevision", "changes"]);
        const result = await stations.execute({
          auth,
          command: { ...body, runId, stationKey },
        });
        const status = ["accepted", "not_due", "not_enabled"].includes(result?.outcome) ? 200 : 409;
        sendJson(response, status, result);
        return;
      }

      const match = url.pathname.match(/^\/api\/v3\/runs\/([^/]+)(?:\/(commands))?$/);
      if (!match) throw new RunApiError(404, "Run route not found.");
      const runId = normalizePathRunId(match[1]);

      if (!match[2] && request.method === "GET") {
        const run = await runs.get({ auth, runId });
        if (!run) throw new RunApiError(404, "Run not found.");
        sendJson(response, 200, { run });
        return;
      }

      if (match[2] === "commands" && request.method === "POST") {
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["commandId", "commandType", "expectedRevision"]);
        const result = await commands.execute({
          auth,
          command: { ...body, runId },
        });
        const status = result?.outcome === "accepted" ? 200 : 409;
        sendJson(response, status, result);
        return;
      }

      throw new RunApiError(405, "This method is not allowed for the run route.");
    } catch (error) {
      const status = safeStatus(error);
      if (status >= 500) {
        logger({
          event: "v3.run_api.error",
          requestId: request.v3RequestId ?? null,
          status,
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          errorCode: typeof error?.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code) ? error.code : null,
        });
      }
      const headers = Number.isSafeInteger(error?.retryAfterSeconds)
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {};
      sendJson(response, status, { error: safeMessage(error) }, headers);
    }
  };
}

export function createRunApiForDatabase({
  pool,
  authorize,
  authenticate,
  verifyCsrf,
  maxBodyBytes,
  logger,
}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A V3 PostgreSQL pool is required.");
  }
  if (typeof authorize !== "function") {
    throw new TypeError("A server authorization function is required.");
  }

  const query = (sql, params) => pool.query(sql, params);
  const runs = createRunService({ query, authorize });
  const commands = createRunCommandService({ query, authorize });
  const runToTimes = createRunToTimeService({ query, authorize });
  const operations = createRunOperationsService({ query, authorize });
  const stations = createStationCommandService({ query, authorize });
  return createRunApi({ runs, commands, runToTimes, operations, stations, authenticate, verifyCsrf, maxBodyBytes, logger });
}
