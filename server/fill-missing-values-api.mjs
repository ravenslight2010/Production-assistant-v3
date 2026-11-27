// Factory-wide fill-missing learned values (port of v1's
// GET/POST /api/fill-missing-values).
//
// GET is open to any signed-in staff member: the scan proposes learned
// values to whoever is filling a blank, exactly as v1's
// fetchFillMissingValues had no role gate. POST requires the manage-profiles
// capability (v1 parity: saving learned values was gated by
// useMe().hasCapability("manage-profiles")).

const VALUES_PATH = "/api/v3/fill-missing-values";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

const LIST_SQL = `SELECT v3.list_fill_missing_values($1::uuid) AS result`;
const SAVE_SQL = `SELECT v3.save_fill_missing_values($1::uuid, $2::uuid, $3::jsonb) AS result`;

class FillMissingValuesApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FillMissingValuesApiError";
    this.status = status;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function safeMessage(error) {
  return error instanceof FillMissingValuesApiError
    ? error.message
    : "The fill-missing request could not be completed. Refresh and try again.";
}

async function readJsonBody(request, maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBodyBytes) {
      throw new FillMissingValuesApiError(413, "The fill-missing request body is too large.");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FillMissingValuesApiError(400, "The fill-missing request body must be valid JSON.");
  }
}

function normalizeIdentity(auth) {
  if (auth?.verified !== true) throw new FillMissingValuesApiError(401, "Sign in to continue.");
  if (typeof auth.facilityId !== "string" || !UUID_PATTERN.test(auth.facilityId)
    || typeof auth.actorId !== "string" || !UUID_PATTERN.test(auth.actorId)) {
    throw new FillMissingValuesApiError(401, "Refresh your V3 session before continuing.");
  }
  return { facilityId: auth.facilityId.toLowerCase(), actorId: auth.actorId.toLowerCase() };
}

function requireProfilesManager(auth) {
  const identity = normalizeIdentity(auth);
  if (!Array.isArray(auth.capabilities) || !auth.capabilities.includes("manage-profiles")) {
    throw new FillMissingValuesApiError(403, "A manager must approve saving learned values.");
  }
  return identity;
}

function validateRows(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.rows)) {
    throw new FillMissingValuesApiError(400, "Send a rows array of learned values.");
  }
  if (body.rows.length < 1 || body.rows.length > 100) {
    throw new FillMissingValuesApiError(400, "Send between one and one hundred learned values.");
  }
  for (const row of body.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.productCode !== "string"
      || typeof row.fieldKey !== "string"
      || typeof row.value !== "string") {
      throw new FillMissingValuesApiError(400, "Each learned value needs a product code, a field key, and a value.");
    }
  }
  return body.rows.map((row) => ({
    productCode: row.productCode,
    fieldKey: row.fieldKey,
    value: row.value,
  }));
}

export function createFillMissingValuesApi({ pool, authenticate, verifyCsrf, maxBodyBytes = DEFAULT_MAX_BODY_BYTES, logger = () => {} }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V3 PostgreSQL pool is required.");
  if (typeof authenticate !== "function") throw new TypeError("A server authentication adapter is required.");
  if (typeof verifyCsrf !== "function") throw new TypeError("A server CSRF verification adapter is required.");

  return async function handleFillMissingValuesApi(request, response) {
    if (request.url !== VALUES_PATH) return false;
    try {
      const auth = await authenticate(request);

      if (request.method === "GET") {
        const { facilityId } = normalizeIdentity(auth);
        const result = await pool.query(LIST_SQL, [facilityId]);
        const values = result?.rows?.[0]?.result;
        if (!Array.isArray(values)) {
          throw new FillMissingValuesApiError(502, "Learned values returned an unexpected result.");
        }
        sendJson(response, 200, { values });
        return true;
      }

      if (request.method === "POST") {
        const identity = requireProfilesManager(auth);
        if (await verifyCsrf(request, auth) !== true) {
          throw new FillMissingValuesApiError(403, "Refresh your session before saving learned values.");
        }
        const body = await readJsonBody(request, maxBodyBytes);
        const rows = validateRows(body);
        const result = await pool.query(SAVE_SQL, [identity.facilityId, identity.actorId, JSON.stringify(rows)]);
        const saved = result?.rows?.[0]?.result?.saved;
        if (!Number.isInteger(saved) || saved < 1) {
          throw new FillMissingValuesApiError(502, "Saving learned values returned an unexpected result.");
        }
        sendJson(response, 200, { saved });
        return true;
      }

      sendJson(response, 405, { error: "This method is not allowed for fill-missing values." });
      return true;
    } catch (error) {
      if (error instanceof FillMissingValuesApiError) {
        sendJson(response, error.status, { error: error.message });
      } else {
        logger({
          event: "v3.fill_missing_values.unhandled",
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
        });
        sendJson(response, 500, { error: safeMessage(error) });
      }
      return true;
    }
  };
}
