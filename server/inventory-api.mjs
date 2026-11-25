import { createHash } from "node:crypto";
import {
  ImportCsvError,
  parseOpeningCountCsv,
  parseSetupImportCsv,
} from "../core/import-csv.mjs";
import {
  parseSetupCatalogCsv,
  parseSetupCatalogRecord,
  setupCatalogCsvLimits,
} from "../core/setup-catalog-csv.mjs";
import { parseSetupMasterRecord, setupMasterRecordLimits } from "../core/setup-master-records.mjs";
import {
  parseSourceWorkbook,
  SourceWorkbookImportError,
  sourceWorkbookImportLimits,
} from "../core/source-workbook-import.mjs";
import {
  linkWorkbookCapacityRows,
  parseDoughCapacityWorkbook,
  parseShippingCapacityWorkbook,
  WorkbookCapacityImportError,
  workbookCapacityImportLimits,
} from "../core/workbook-capacity-import.mjs";
import { DIE_DEFAULT_FIELDS, REQUIRED_DIE_DEFAULT_FIELDS, isDieLineSettings } from "../core/die-defaults.mjs";
import {
  combinedSetupReviewLimits,
  projectCombinedSetupReview,
} from "../core/combined-setup-review.mjs";

const IMPORTS_PATH = "/api/v3/imports";
const SETUP_MASTER_RECORDS_PATH = `${IMPORTS_PATH}/records`;
const SETUP_MASTER_EDITS_PATH = `${IMPORTS_PATH}/edits`;
const SETUP_CATALOG_ROOT = "/api/v3/setup-catalog";
const SETUP_CATALOG_PATH = `${SETUP_CATALOG_ROOT}/imports`;
const SETUP_CATALOG_RECORDS_PATH = `${SETUP_CATALOG_ROOT}/records`;
const SETUP_CATALOG_EDITS_PATH = `${SETUP_CATALOG_ROOT}/edits`;
const SOURCE_WORKBOOK_PREVIEW_PATH = `${SETUP_CATALOG_PATH}/workbooks/preview`;
const COMBINED_SETUP_REVIEWS_PATH = `${SETUP_CATALOG_ROOT}/combined-reviews`;
const INVENTORY_PATH = "/api/v3/inventory";
const DIE_DEFAULTS_PATH = `${INVENTORY_PATH}/die-defaults`;
const WAREHOUSE_GUIDANCE_PATH = `${INVENTORY_PATH}/warehouse-guidance`;
const CYCLE_COUNT_SCHEDULES_PATH = `${INVENTORY_PATH}/cycle-counts/schedules`;
const CYCLE_COUNT_MARK_PATH = `${INVENTORY_PATH}/cycle-counts/mark`;
const SURPLUS_PATH = `${INVENTORY_PATH}/freezer-surplus`;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_WORKBOOK_BODY_BYTES = 7_250 * 1024;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const QUANTITY = /^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
const POSITIVE_QUANTITY = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;

class InventoryApiError extends Error {
  constructor(status, message, retryAfterSeconds = undefined) {
    super(message);
    this.name = "InventoryApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
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

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new InventoryApiError(415, "Send this request as JSON.");
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new InventoryApiError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (bytes === 0) throw new InventoryApiError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InventoryApiError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InventoryApiError(400, "The JSON request body must be an object.");
  }
  return body;
}

function requireKeys(body, keys) {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new InventoryApiError(400, "The request contains missing or unsupported fields.");
  }
}

function validateRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new InventoryApiError(400, "Enter a valid request ID.");
  }
  return value;
}

function validateUuid(value, name) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new InventoryApiError(400, `${name} is invalid.`);
  }
  return value.toLowerCase();
}

function validateReason(value) {
  if (typeof value !== "string" || value.trim().length < 3 || value.trim().length > 500
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new InventoryApiError(400, "Enter a reason from 3 to 500 characters.");
  }
  return value.trim();
}

function validateQuantity(value, { positive = false, nonzero = false } = {}) {
  const pattern = positive ? POSITIVE_QUANTITY : QUANTITY;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new InventoryApiError(400, positive
      ? "Enter a non-negative quantity with up to six decimal places."
      : "Enter a quantity with up to six decimal places.");
  }
  if (nonzero && /^-?0(?:\.0{1,6})?$/.test(value)) {
    throw new InventoryApiError(400, "Quantity must be greater than zero.");
  }
  return value;
}

function validateInventoryDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new InventoryApiError(400, `${name} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InventoryApiError(400, `${name} is not a valid calendar date.`);
  }
  return value;
}

function validateLotNumber(value) {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 120
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InventoryApiError(400, "Lot number must be from 1 to 120 characters without control characters.");
  }
  return value.trim();
}

function hashRequest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function validateDieDefaults(value) {
  const keys = [...DIE_DEFAULT_FIELDS].sort();
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000") !== keys.join("\u0000")
    || !isDieLineSettings(value)
    || REQUIRED_DIE_DEFAULT_FIELDS.some((key) => typeof value[key] !== "number")) {
    throw new InventoryApiError(400, "Enter all die default fields as non-negative numbers or leave optional fields blank.");
  }
  return value;
}

function parseLimit(url, { extra = [] } = {}) {
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(["limit", ...extra]);
  if (keys.some((key) => !allowed.has(key)) || url.searchParams.getAll("limit").length > 1) {
    throw new InventoryApiError(400, "Unsupported list query parameter.");
  }
  const value = url.searchParams.get("limit");
  if (value === null) return 50;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 100) {
    throw new InventoryApiError(400, "limit must be from 1 to 100.");
  }
  return Number(value);
}

function parseCatalogListQuery(url) {
  const allowed = new Set(["family", "limit", "after"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))
    || ["family", "limit", "after"].some((key) => url.searchParams.getAll(key).length > 1)) {
    throw new InventoryApiError(400, "Unsupported setup catalog list query.");
  }
  const family = url.searchParams.get("family");
  if (typeof family !== "string" || !setupCatalogCsvLimits.families.includes(family)) {
    throw new InventoryApiError(400, "Choose a supported setup family.");
  }
  const after = url.searchParams.get("after");
  if (after !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(after)) {
    throw new InventoryApiError(400, "The setup catalog cursor is invalid.");
  }
  return { family, limit: parseLimit(url, { extra: ["family", "after"] }), after };
}

function parseMasterListQuery(url) {
  const allowed = new Set(["kind", "limit", "after"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))
    || ["kind", "limit", "after"].some((key) => url.searchParams.getAll(key).length > 1)) {
    throw new InventoryApiError(400, "Unsupported setup record list query.");
  }
  const kind = url.searchParams.get("kind");
  if (typeof kind !== "string" || !setupMasterRecordLimits.kinds.includes(kind)) {
    throw new InventoryApiError(400, "Choose dough recipes or production setups.");
  }
  const after = url.searchParams.get("after");
  if (after !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(after)) {
    throw new InventoryApiError(400, "The setup record cursor is invalid.");
  }
  return { kind, limit: parseLimit(url, { extra: ["kind", "after"] }), after };
}

function safeStatus(error) {
  if (error instanceof InventoryApiError) return error.status;
  if (typeof error?.message === "string" && /referenced|undo is blocked|changed after this import/i.test(error.message)) return 409;
  if (error instanceof ImportCsvError) return 400;
  if (error instanceof WorkbookCapacityImportError) return 400;
  if (error instanceof SourceWorkbookImportError) return 400;
  switch (error?.code) {
    case "P0002": return 404;
    case "42501": return 403;
    case "23505":
    case "23503":
    case "40001":
    case "55000":
    case "22003": return 409;
    case "22023":
    case "23514": return 400;
    default: return 500;
  }
}

function safeMessage(error, operation) {
  if (error instanceof InventoryApiError) return error.message;
  if (error instanceof ImportCsvError) return error.message;
  if (error instanceof WorkbookCapacityImportError) return error.message;
  if (error instanceof SourceWorkbookImportError) return error.message;
  switch (error?.code) {
    case "P0002": return "That warehouse, product, import, or count is no longer available.";
    case "42501": return "You do not have access to this inventory.";
    case "23505": return "A record with those details already exists.";
    case "23503": return operation === "create_import"
      ? "The import references a product that is not active in V3. Import products first."
      : "The request references a record that is not available.";
    case "40001": return "The data changed while you were working. Refresh and review it again.";
    case "55000": return "This operation is not available in the record’s current state.";
    case "22003": return "The available stock or quantity limit does not allow this change.";
    case "22023": return "The request values are invalid. Correct them and try again.";
    case "23514": return "The request conflicts with an inventory rule.";
    default: return "The inventory request could not be completed. Refresh and try again.";
  }
}

function requireManager(auth) {
  if (auth?.verified !== true) throw new InventoryApiError(401, "Sign in to access inventory.");
  if (!Array.isArray(auth.capabilities) || !auth.capabilities.includes("manage-inventory")) {
    throw new InventoryApiError(403, "A manager must approve this inventory action.");
  }
  if (typeof auth.actorId !== "string" || !UUID.test(auth.actorId)
    || typeof auth.facilityId !== "string" || !UUID.test(auth.facilityId)) {
    throw new InventoryApiError(401, "Refresh your V3 session before continuing.");
  }
}

function resultValue(result) {
  return result?.rows?.[0]?.result ?? null;
}

function parseWorkbookUpload(body) {
  if (!["dough-procedure", "shipping-guide"].includes(body.family)) {
    throw new InventoryApiError(400, "Choose a dough procedure or shipping guide workbook.");
  }
  if (typeof body.workbookBase64 !== "string"
    || body.workbookBase64.length > Math.ceil(workbookCapacityImportLimits.maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body.workbookBase64)) {
    throw new InventoryApiError(400, "Choose a valid XLSX workbook no larger than 5 MiB.");
  }
  const workbookBytes = Buffer.from(body.workbookBase64, "base64");
  if (workbookBytes.byteLength > workbookCapacityImportLimits.maxBytes
    || workbookBytes.toString("base64") !== body.workbookBase64) {
    throw new InventoryApiError(400, "Choose a valid XLSX workbook no larger than 5 MiB.");
  }
  const parsed = body.family === "dough-procedure"
    ? parseDoughCapacityWorkbook(workbookBytes, body.fileName)
    : parseShippingCapacityWorkbook(workbookBytes, body.fileName);
  return parsed;
}

function parseSourceWorkbookUpload(body) {
  if (!sourceWorkbookImportLimits.families.includes(body.family)) {
    throw new InventoryApiError(400, "Choose one of the six supported V1 source families.");
  }
  const sauceDocx = body.family === "sauce-guides" && /\.docx$/iu.test(String(body.fileName ?? ""));
  if (typeof body.workbookBase64 !== "string"
    || body.workbookBase64.length > Math.ceil(sourceWorkbookImportLimits.maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body.workbookBase64)) {
    throw new InventoryApiError(400, "Choose a valid supported source file no larger than 5 MiB.");
  }
  const workbookBytes = Buffer.from(body.workbookBase64, "base64");
  if (workbookBytes.byteLength > sourceWorkbookImportLimits.maxBytes
    || workbookBytes.toString("base64") !== body.workbookBase64) {
    throw new InventoryApiError(400, "Choose a valid supported source file no larger than 5 MiB.");
  }
  if (sauceDocx && workbookBytes.byteLength < 22) {
    throw new InventoryApiError(400, "Choose a valid sauce guide DOCX no larger than 5 MiB.");
  }
  return parseSourceWorkbook(body.family, workbookBytes, body.fileName);
}

function validateSourceSummary(value, importedRows) {
  if (value == null) return null;
  const required = [
    "sourceFamily", "sourceSha256", "parserVersion", "sourceRows",
    "importedRows", "skippedRows", "unresolvedRows",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000") !== [...required].sort().join("\u0000")
    || !sourceWorkbookImportLimits.families.includes(value.sourceFamily)
    || typeof value.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sourceSha256)
    || value.parserVersion !== sourceWorkbookImportLimits.parserVersion
    || !Number.isSafeInteger(value.sourceRows) || value.sourceRows < 0 || value.sourceRows > 2000
    || !Number.isSafeInteger(value.importedRows) || value.importedRows !== importedRows
    || !Number.isSafeInteger(value.skippedRows) || value.skippedRows < 0 || value.skippedRows > 2000
    || !Number.isSafeInteger(value.unresolvedRows) || value.unresolvedRows < 0 || value.unresolvedRows > 2000) {
    throw new InventoryApiError(400, "The source review counts are incomplete or do not match the staged rows.");
  }
  return value;
}

function validateSourceRecords(value, records, sourceSummary) {
  if (!sourceSummary) {
    if (value !== undefined) throw new InventoryApiError(400, "Source citations require a source review summary.");
    return records;
  }
  if (!Array.isArray(value) || value.length !== records.length) {
    throw new InventoryApiError(400, "Provide one canonical source citation for every staged source record.");
  }
  const byCode = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).sort().join("\u0000") !== "code\u0000source\u0000sourceDetails"
      || typeof item.code !== "string" || byCode.has(item.code.toLocaleLowerCase("en-US"))
      || !item.source || typeof item.source !== "object" || Array.isArray(item.source)
      || Object.keys(item.source).sort().join("\u0000") !== "cell\u0000workbook"
      || typeof item.source.workbook !== "string" || item.source.workbook.trim().length < 1
      || item.source.workbook.length > 180
      || typeof item.source.cell !== "string" || item.source.cell.trim().length < 1
      || item.source.cell.length > 240
      || (item.sourceDetails !== null && (!item.sourceDetails || typeof item.sourceDetails !== "object"
        || Array.isArray(item.sourceDetails) || JSON.stringify(item.sourceDetails).length > 20_000))) {
      throw new InventoryApiError(400, "The reviewed source citations are incomplete or invalid.");
    }
    byCode.set(item.code.toLocaleLowerCase("en-US"), item);
  }
  return records.map((record) => {
    const citation = byCode.get(record.code.toLocaleLowerCase("en-US"));
    if (!citation || citation.code !== record.code) {
      throw new InventoryApiError(400, "Source citations must match the reviewed record codes exactly.");
    }
    return { ...record, source: citation.source, sourceDetails: citation.sourceDetails };
  });
}

function validateWorkbookProductLinks(value) {
  if (!Array.isArray(value) || value.length > workbookCapacityImportLimits.maxRows) {
    throw new InventoryApiError(400, "Review the workbook product links and try again.");
  }
  const seen = new Set();
  return value.map((link) => {
    if (!link || typeof link !== "object" || Array.isArray(link)
      || Object.keys(link).sort().join(",") !== "productCode,sourceKey"
      || typeof link.sourceKey !== "string" || !/^[0-9a-f]{64}$/u.test(link.sourceKey)
      || typeof link.productCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(link.productCode)
      || seen.has(link.sourceKey)) {
      throw new InventoryApiError(400, "Review the workbook product links and try again.");
    }
    seen.add(link.sourceKey);
    return { sourceKey: link.sourceKey, productCode: link.productCode };
  });
}

async function workbookLinkContext(pool, scope, family) {
  const productResult = await pool.query(
    "SELECT v3.list_inventory_products($1::uuid) AS result",
    scope,
  );
  const products = resultValue(productResult);
  if (!Array.isArray(products)
    || products.some((product) => !product || typeof product.code !== "string"
      || typeof product.name !== "string" || product.active !== true)) {
    throw new InventoryApiError(502, "The active product list is unavailable. Refresh and try again.");
  }
  const priorResult = await pool.query(
    "SELECT v3.list_workbook_source_links($1::uuid, $2::text) AS result",
    [...scope, family],
  );
  const priorLinks = resultValue(priorResult);
  if (!Array.isArray(priorLinks)) {
    throw new InventoryApiError(502, "Saved workbook product links are unavailable. Refresh and try again.");
  }
  return { products, priorLinks };
}

function createUploadLimiter({ maxRequests = 10, windowMs = 60_000, maxKeys = 10_000, clock = Date.now } = {}) {
  const entries = new Map();
  return {
    consume(key) {
      const now = clock();
      for (const [existingKey, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(existingKey);
      }
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        entries.delete(key);
        entries.set(key, entry);
      }
      if (entries.size > maxKeys) entries.delete(entries.keys().next().value);
      if (entry.count >= maxRequests) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
      }
      entry.count += 1;
      return { allowed: true };
    },
  };
}

function parseWarehouseId(url, { allowMovementCursor = false } = {}) {
  const values = url.searchParams.getAll("warehouseId");
  const allowed = allowMovementCursor
    ? new Set(["warehouseId", "limit", "beforeAt", "beforeId"])
    : new Set(["warehouseId"]);
  if (values.length !== 1 || [...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new InventoryApiError(400, "Specify one warehouseId.");
  }
  return validateUuid(values[0], "Warehouse ID");
}

function parseMovementCursor(url) {
  const times = url.searchParams.getAll("beforeAt");
  const ids = url.searchParams.getAll("beforeId");
  if (times.length === 0 && ids.length === 0) return [null, null];
  if (times.length !== 1 || ids.length !== 1 || !ISO_TIMESTAMP.test(times[0])
    || !Number.isFinite(Date.parse(times[0]))) {
    throw new InventoryApiError(400, "Specify a valid movement cursor.");
  }
  return [times[0], validateUuid(ids[0], "Movement cursor ID")];
}

export function createInventoryApi({ pool, authenticate, verifyCsrf, logger = () => {} } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V3 PostgreSQL pool is required.");
  if (typeof authenticate !== "function") throw new TypeError("A V3 session verifier is required.");
  if (typeof verifyCsrf !== "function") throw new TypeError("A V3 CSRF verifier is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  const uploadLimiter = createUploadLimiter();

  return async function handleInventoryApi(request, response) {
    let url;
    try {
      url = new URL(request.url || "/", "http://v3.local");
    } catch {
      sendJson(response, 400, { error: "The request URL is invalid." });
      return false;
    }
    const isImports = url.pathname === IMPORTS_PATH || url.pathname.startsWith(`${IMPORTS_PATH}/`);
    const isSetupCatalog = url.pathname === SETUP_CATALOG_ROOT || url.pathname.startsWith(`${SETUP_CATALOG_ROOT}/`);
    const isInventory = url.pathname === INVENTORY_PATH || url.pathname.startsWith(`${INVENTORY_PATH}/`);
    if (!isImports && !isSetupCatalog && !isInventory) return false;

    let operation = "unknown";
    try {
      if (url.search && request.method !== "GET") {
        throw new InventoryApiError(400, "This request does not accept query parameters.");
      }
      const auth = await authenticate(request);
      const staffGuidanceRead = request.method === "GET" && url.pathname === WAREHOUSE_GUIDANCE_PATH;
      const staffCountWrite = request.method === "POST" && url.pathname === CYCLE_COUNT_MARK_PATH;
      if (!staffGuidanceRead && !staffCountWrite) requireManager(auth);
      else if (!auth?.verified) throw new InventoryApiError(401, "Sign in to access inventory.");
      if (request.method !== "GET") {
        if (request.method !== "POST") throw new InventoryApiError(405, "This method is not allowed.");
        if (await verifyCsrf(request, auth) !== true) {
          throw new InventoryApiError(403, "Refresh your session before changing inventory.");
        }
        if (
          url.pathname === IMPORTS_PATH
          || url.pathname === `${IMPORTS_PATH}/workbooks`
          || url.pathname === `${IMPORTS_PATH}/workbooks/preview`
          || url.pathname === SETUP_CATALOG_PATH
          || url.pathname === SETUP_CATALOG_EDITS_PATH
          || url.pathname === SETUP_MASTER_EDITS_PATH
          || url.pathname === SOURCE_WORKBOOK_PREVIEW_PATH
          || url.pathname === `${INVENTORY_PATH}/opening-counts`
        ) {
          const limit = uploadLimiter.consume(auth.actorId);
          if (!limit.allowed) {
            throw new InventoryApiError(429, "Too many imports. Wait briefly, then try again.", limit.retryAfterSeconds);
          }
        }
      }
      const scope = [auth.facilityId.toLowerCase()];
      const actor = auth.actorId.toLowerCase();

      if (url.pathname === WAREHOUSE_GUIDANCE_PATH && request.method === "GET") {
        operation = "warehouse_guidance";
        const result = await pool.query("SELECT v3.warehouse_guidance($1::uuid) AS result", scope);
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (url.pathname === WAREHOUSE_GUIDANCE_PATH && request.method === "POST") {
        operation = "save_warehouse_guidance_settings";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "expirySoonDays", "reorderPoints", "expectedRevision"]);
        const requestId = validateRequestId(body.requestId);
        if (!Number.isSafeInteger(body.expirySoonDays) || body.expirySoonDays < 0 || body.expirySoonDays > 365
          || !Array.isArray(body.reorderPoints) || body.reorderPoints.length > 2000
          || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
          throw new InventoryApiError(400, "Submit a valid expiry window, reorder-point list, and current revision.");
        }
        const seenProducts = new Set();
        const reorderPoints = body.reorderPoints.map((point) => {
          if (!point || typeof point !== "object" || Array.isArray(point)) {
            throw new InventoryApiError(400, "Review each reorder point and try again.");
          }
          requireKeys(point, ["productId", "threshold"]);
          const productId = validateUuid(point.productId, "Product ID").toLowerCase();
          if (typeof point.threshold !== "string" || !POSITIVE_QUANTITY.test(point.threshold)
            || seenProducts.has(productId)) {
            throw new InventoryApiError(400, "Use one non-negative decimal threshold per product.");
          }
          seenProducts.add(productId);
          return { productId, threshold: point.threshold };
        });
        const payload = {
          expirySoonDays: body.expirySoonDays,
          reorderPoints,
          expectedRevision: body.expectedRevision,
        };
        const result = await pool.query(
          "SELECT v3.save_warehouse_guidance_settings($1::uuid, $2::uuid, $3::text, $4::text, $5::integer, $6::jsonb, $7::bigint) AS result",
          [...scope, actor, requestId, hashRequest(payload), body.expirySoonDays, JSON.stringify(reorderPoints), body.expectedRevision],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (url.pathname === CYCLE_COUNT_MARK_PATH && request.method === "POST") {
        operation = "mark_cycle_counted";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "section"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.section !== "string" || body.section.trim() !== body.section
          || body.section.length < 1 || body.section.length > 120 || /[\u0000-\u001f\u007f]/u.test(body.section)) {
          throw new InventoryApiError(400, "Choose a valid cycle count section.");
        }
        const result = await pool.query(
          "SELECT v3.mark_cycle_counted($1::uuid, $2::uuid, $3::text, $4::text, $5::text) AS result",
          [...scope, actor, requestId, hashRequest({ section: body.section }), body.section],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (url.pathname === CYCLE_COUNT_SCHEDULES_PATH && request.method === "POST") {
        operation = "save_cycle_count_schedule";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "section", "cadenceDays", "enabled", "expectedRevision"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.section !== "string" || body.section.trim() !== body.section
          || body.section.length < 1 || body.section.length > 120 || /[\u0000-\u001f\u007f]/u.test(body.section)
          || !Number.isSafeInteger(body.cadenceDays) || body.cadenceDays < 1 || body.cadenceDays > 365
          || typeof body.enabled !== "boolean" || !Number.isSafeInteger(body.expectedRevision)
          || body.expectedRevision < 0) {
          throw new InventoryApiError(400, "Submit a valid section, cadence, status, and current revision.");
        }
        const payload = {
          section: body.section, cadenceDays: body.cadenceDays,
          enabled: body.enabled, expectedRevision: body.expectedRevision,
        };
        const result = await pool.query(
          "SELECT v3.save_cycle_count_schedule($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::integer, $7::boolean, $8::bigint) AS result",
          [...scope, actor, requestId, hashRequest(payload), body.section, body.cadenceDays, body.enabled, body.expectedRevision],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (url.pathname === SURPLUS_PATH && request.method === "GET") {
        operation = "list_freezer_surplus";
        const result = await pool.query("SELECT v3.list_freezer_surplus($1::uuid) AS result", scope);
        sendJson(response, 200, resultValue(result));
        return true;
      }
      if (url.pathname === `${SURPLUS_PATH}/confirm` && request.method === "POST") {
        operation = "confirm_freezer_surplus";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "runId", "cases"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.runId !== "string" || !UUID.test(body.runId)
          || !Number.isSafeInteger(body.cases) || body.cases < 0 || body.cases > 1_000_000) {
          throw new InventoryApiError(400, "Choose a completed run and a whole number from 0 to 1,000,000 cases.");
        }
        const result = await pool.query(
          "SELECT v3.confirm_freezer_surplus($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::integer) AS result",
          [...scope, actor, requestId, hashRequest({ runId: body.runId.toLowerCase(), cases: body.cases }), body.runId.toLowerCase(), body.cases],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }
      if (url.pathname === `${SURPLUS_PATH}/allocations` && request.method === "POST") {
        operation = "allocate_freezer_surplus";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "lotId", "productionDate", "scheduleRunId", "cases", "expectedRevision"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.lotId !== "string" || !UUID.test(body.lotId) || typeof body.scheduleRunId !== "string" || !UUID.test(body.scheduleRunId)
          || !Number.isSafeInteger(body.cases) || body.cases < 1 || body.cases > 1_000_000
          || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
          throw new InventoryApiError(400, "Choose a surplus lot, scheduled run, positive cases, and current revision.");
        }
        const productionDate = validateInventoryDate(body.productionDate, "Production date");
        const payload = { lotId: body.lotId.toLowerCase(), productionDate, scheduleRunId: body.scheduleRunId.toLowerCase(), cases: body.cases, expectedRevision: body.expectedRevision };
        const result = await pool.query(
          "SELECT v3.allocate_freezer_surplus($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::date,$7::uuid,$8::integer,$9::bigint) AS result",
          [...scope, actor, requestId, hashRequest(payload), payload.lotId, productionDate, payload.scheduleRunId, body.cases, body.expectedRevision],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }
      if (url.pathname === `${SURPLUS_PATH}/adjustments` && request.method === "POST") {
        operation = "adjust_freezer_surplus";
        const body = await readJsonBody(request);
        const hasCorrection = Object.hasOwn(body, "correctsEventId");
        requireKeys(body, ["requestId", "lotId", "eventType", "cases", "reason", "expectedRevision", ...(hasCorrection ? ["correctsEventId"] : [])]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.lotId !== "string" || !UUID.test(body.lotId) || !["damage","return","correction"].includes(body.eventType)
          || !Number.isSafeInteger(body.cases) || body.cases === 0 || Math.abs(body.cases) > 1_000_000
          || (["damage","return"].includes(body.eventType) && body.cases < 1)
          || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 500
          || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1
          || (body.eventType === "correction" && !hasCorrection)
          || (body.eventType !== "correction" && hasCorrection)
          || (hasCorrection && (typeof body.correctsEventId !== "string" || !UUID.test(body.correctsEventId)))) {
          throw new InventoryApiError(400, "Submit a valid adjustment, reason, current revision, and correction link.");
        }
        const payload = { lotId: body.lotId.toLowerCase(), eventType: body.eventType, cases: body.cases,
          reason: body.reason.trim(), expectedRevision: body.expectedRevision,
          ...(hasCorrection ? { correctsEventId: body.correctsEventId.toLowerCase() } : {}) };
        const result = await pool.query(
          "SELECT v3.adjust_freezer_surplus($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,$7::integer,$8::text,$9::bigint,$10::uuid) AS result",
          [...scope, actor, requestId, hashRequest(payload), payload.lotId, body.eventType, body.cases, payload.reason, body.expectedRevision, hasCorrection ? payload.correctsEventId : null],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (isImports && url.pathname === SETUP_MASTER_RECORDS_PATH && request.method === "GET") {
        operation = "list_setup_master_records";
        const { kind, limit, after } = parseMasterListQuery(url);
        const result = await pool.query(
          "SELECT v3.list_setup_master_records($1::uuid, $2::text, $3::integer, $4::text) AS result",
          [...scope, kind, limit, after],
        );
        const page = resultValue(result);
        if (!page || page.kind !== kind || !Array.isArray(page.records)
          || page.records.length > limit || page.records.some((record) =>
            !record || typeof record.fingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(record.fingerprint))) {
          throw new InventoryApiError(502, "The setup record page is incomplete. Refresh and try again.");
        }
        sendJson(response, 200, page);
        return true;
      }

      if (isImports && url.pathname === SETUP_MASTER_EDITS_PATH && request.method === "POST") {
        operation = "stage_setup_master_edit";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "kind", "record", "expectedFingerprint"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.kind !== "string" || !setupMasterRecordLimits.kinds.includes(body.kind)
          || (body.expectedFingerprint !== null
            && (typeof body.expectedFingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(body.expectedFingerprint)))) {
          throw new InventoryApiError(400, "Choose a dough recipe or production setup and its current server fingerprint.");
        }
        const record = parseSetupMasterRecord(body.kind, body.record);
        const requestHash = hashRequest({
          kind: body.kind,
          record,
          expectedFingerprint: body.expectedFingerprint,
        });
        const result = await pool.query(
          "SELECT v3.stage_setup_master_edit($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb, $7::text) AS result",
          [...scope, actor, requestId, requestHash, body.kind, JSON.stringify(record), body.expectedFingerprint],
        );
        const staged = resultValue(result);
        if (!staged || staged.kind !== body.kind || staged.rowCount !== 1) {
          throw new InventoryApiError(502, "The server did not confirm the staged setup edit.");
        }
        sendJson(response, staged.replayed ? 200 : 201, { ...staged, records: [record] });
        return true;
      }

      if (isImports && url.pathname === IMPORTS_PATH && request.method === "GET") {
        operation = "list_imports";
        const result = await pool.query(
          "SELECT v3.list_setup_imports($1::uuid, $2::integer) AS result",
          [...scope, parseLimit(url)],
        );
        sendJson(response, 200, { imports: resultValue(result) });
        return true;
      }

      if (isInventory && url.pathname === DIE_DEFAULTS_PATH && request.method === "GET") {
        operation = "list_die_defaults";
        const limit = parseLimit(url);
        const [defaultsResult, historyResult] = await Promise.all([
          pool.query("SELECT v3.list_die_defaults($1::uuid) AS result", scope),
          pool.query("SELECT v3.list_die_default_events($1::uuid, $2::integer) AS result", [...scope, limit]),
        ]);
        const defaults = resultValue(defaultsResult);
        const history = resultValue(historyResult);
        if (!Array.isArray(defaults) || !Array.isArray(history)) {
          throw new InventoryApiError(502, "Reviewed die defaults are unavailable. Refresh and try again.");
        }
        sendJson(response, 200, { defaults, history });
        return true;
      }

      if (isInventory && url.pathname === DIE_DEFAULTS_PATH && request.method === "POST") {
        operation = "save_die_default";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "dieCode", "expectedRevision", "defaults", "enabled"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.dieCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(body.dieCode)
          || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
          || typeof body.enabled !== "boolean") {
          throw new InventoryApiError(400, "Choose a die type and submit its current revision and status.");
        }
        const defaults = validateDieDefaults(body.defaults);
        const requestHash = hashRequest({
          dieCode: body.dieCode,
          expectedRevision: body.expectedRevision,
          defaults,
          enabled: body.enabled,
        });
        const result = await pool.query(
          "SELECT v3.save_die_default($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::jsonb, $8::boolean) AS result",
          [...scope, actor, requestId, requestHash, body.dieCode, body.expectedRevision, JSON.stringify(defaults), body.enabled],
        );
        const saved = resultValue(result);
        if (!saved || typeof saved !== "object" || !["created", "updated", "retired", "re-enabled"].includes(saved.outcome)
          || !Number.isSafeInteger(saved.revision) || saved.revision < 1) {
          throw new InventoryApiError(502, "The server did not confirm the die default change.");
        }
        sendJson(response, saved.replayed || saved.outcome !== "created" ? 200 : 201, saved);
        return true;
      }

      if (isSetupCatalog && url.pathname === SETUP_CATALOG_RECORDS_PATH && request.method === "GET") {
        operation = "list_setup_catalog_records";
        const { family, limit, after } = parseCatalogListQuery(url);
        const result = await pool.query(
          "SELECT v3.list_setup_catalog_records($1::uuid, $2::text, $3::integer, $4::text) AS result",
          [...scope, family, limit, after],
        );
        const page = resultValue(result);
        if (!page || page.family !== family || !Array.isArray(page.records)
          || page.records.length > limit || page.records.some((record) =>
            !record || typeof record.fingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(record.fingerprint))) {
          throw new InventoryApiError(502, "The setup catalog page is incomplete. Refresh and try again.");
        }
        sendJson(response, 200, page);
        return true;
      }

      if (isSetupCatalog && url.pathname === SETUP_CATALOG_EDITS_PATH && request.method === "POST") {
        operation = "stage_setup_catalog_edit";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "family", "record", "expectedFingerprint"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.family !== "string" || !setupCatalogCsvLimits.families.includes(body.family)
          || (body.expectedFingerprint !== null
            && (typeof body.expectedFingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(body.expectedFingerprint)))) {
          throw new InventoryApiError(400, "Choose a supported setup family and its current server fingerprint.");
        }
        const record = parseSetupCatalogRecord(body.family, body.record);
        const requestHash = hashRequest({
          family: body.family,
          record,
          expectedFingerprint: body.expectedFingerprint,
        });
        const result = await pool.query(
          "SELECT v3.stage_setup_catalog_edit($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb, $7::text) AS result",
          [...scope, actor, requestId, requestHash, body.family, JSON.stringify(record), body.expectedFingerprint],
        );
        const staged = resultValue(result);
        if (!staged || staged.family !== body.family || staged.rowCount !== 1) {
          throw new InventoryApiError(502, "The server did not confirm the staged setup edit.");
        }
        sendJson(response, staged.replayed ? 200 : 201, { ...staged, records: [record] });
        return true;
      }

      if (isSetupCatalog && url.pathname === SETUP_CATALOG_PATH && request.method === "GET") {
        operation = "list_setup_catalog_imports";
        const result = await pool.query(
          "SELECT v3.list_setup_catalog_imports($1::uuid, $2::integer) AS result",
          [...scope, parseLimit(url)],
        );
        sendJson(response, 200, { imports: resultValue(result) });
        return true;
      }

      if (isSetupCatalog && url.pathname === SETUP_CATALOG_PATH && request.method === "POST") {
        operation = "stage_setup_catalog_import";
        const body = await readJsonBody(request);
        const requiredKeys = ["requestId", "family", "csv"];
        const acceptedKeys = new Set([...requiredKeys, "sourceSummary", "sourceRecords"]);
        if (requiredKeys.some((key) => !Object.hasOwn(body, key))
          || Object.keys(body).some((key) => !acceptedKeys.has(key))) {
          throw new InventoryApiError(400, "The request contains missing or unsupported fields.");
        }
        const requestId = validateRequestId(body.requestId);
        if (typeof body.family !== "string" || !setupCatalogCsvLimits.families.includes(body.family)) {
          throw new InventoryApiError(400, "Choose a supported setup family.");
        }
        const records = parseSetupCatalogCsv(body.family, body.csv);
        const sourceSummary = validateSourceSummary(body.sourceSummary, records.length);
        if (sourceSummary && (sourceSummary.sourceFamily === "premix-sheets") !== (body.family === "mixes")) {
          throw new InventoryApiError(400, "The source family does not match its V3 setup target.");
        }
        if (sourceSummary && sourceSummary.sourceFamily !== "premix-sheets" && body.family !== "run-templates") {
          throw new InventoryApiError(400, "This source family must use the V3 run-template target.");
        }
        const storedRecords = validateSourceRecords(body.sourceRecords, records, sourceSummary);
        const requestHash = sourceSummary
          ? hashRequest({ family: body.family, records, sourceSummary, sourceRecords: body.sourceRecords })
          : hashRequest({ family: body.family, records });
        const result = await pool.query(
          "SELECT v3.stage_setup_catalog_import($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb, $7::jsonb) AS result",
          [...scope, actor, requestId, requestHash, body.family, JSON.stringify(storedRecords), sourceSummary ? JSON.stringify(sourceSummary) : null],
        );
        const staged = resultValue(result);
        sendJson(response, staged.replayed ? 200 : 201, { ...staged, records });
        return true;
      }

      if (isSetupCatalog && url.pathname === COMBINED_SETUP_REVIEWS_PATH && request.method === "GET") {
        operation = "list_combined_setup_reviews";
        const result = await pool.query(
          "SELECT v3.list_combined_setup_reviews($1::uuid, $2::integer) AS result",
          [...scope, parseLimit(url)],
        );
        sendJson(response, 200, { reviews: resultValue(result) });
        return true;
      }

      if (isSetupCatalog && url.pathname === COMBINED_SETUP_REVIEWS_PATH && request.method === "POST") {
        operation = "create_combined_setup_review";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "importIds"]);
        const requestId = validateRequestId(body.requestId);
        if (!Array.isArray(body.importIds)
          || body.importIds.length < 1 || body.importIds.length > combinedSetupReviewLimits.maxImports) {
          throw new InventoryApiError(400, "Choose between 1 and 100 canonical source imports.");
        }
        const importIds = [...new Set(body.importIds.map((value) => validateUuid(value, "Import ID")))].sort();
        if (importIds.length !== body.importIds.length) {
          throw new InventoryApiError(400, "A source import may appear only once in a combined review.");
        }
        const requestHash = hashRequest({ importIds });
        const result = await pool.query(
          "SELECT v3.create_combined_setup_review($1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb) AS result",
          [...scope, actor, requestId, requestHash, JSON.stringify(importIds)],
        );
        const payload = resultValue(result);
        const review = projectCombinedSetupReview(payload);
        sendJson(response, payload.replayed ? 200 : 201, review);
        return true;
      }

      const combinedReviewDetail = url.pathname.match(/^\/api\/v3\/setup-catalog\/combined-reviews\/([^/]+)$/);
      if (isSetupCatalog && combinedReviewDetail && request.method === "GET") {
        operation = "get_combined_setup_review";
        const reviewId = validateUuid(combinedReviewDetail[1], "Combined review ID");
        const result = await pool.query(
          "SELECT v3.get_combined_setup_review($1::uuid, $2::uuid) AS result",
          [...scope, reviewId],
        );
        const payload = resultValue(result);
        if (!payload) throw new InventoryApiError(404, "That combined setup review is not available.");
        sendJson(response, 200, projectCombinedSetupReview(payload));
        return true;
      }

      if (isSetupCatalog && url.pathname === SOURCE_WORKBOOK_PREVIEW_PATH && request.method === "POST") {
        operation = "preview_source_workbook_import";
        const body = await readJsonBody(request, MAX_WORKBOOK_BODY_BYTES);
        requireKeys(body, ["family", "fileName", "workbookBase64"]);
        const parsed = parseSourceWorkbookUpload(body);
        sendJson(response, 200, parsed);
        return true;
      }

      const setupCatalogDetail = url.pathname.match(/^\/api\/v3\/setup-catalog\/imports\/([^/]+)$/);
      if (isSetupCatalog && setupCatalogDetail && request.method === "GET") {
        operation = "get_setup_catalog_import";
        const importId = validateUuid(setupCatalogDetail[1], "Import ID");
        const result = await pool.query(
          "SELECT v3.get_setup_catalog_import($1::uuid, $2::uuid) AS result",
          [...scope, importId],
        );
        const item = resultValue(result);
        if (!item) throw new InventoryApiError(404, "That setup import is not available.");
        sendJson(response, 200, item);
        return true;
      }

      const setupCatalogAction = url.pathname.match(
        /^\/api\/v3\/setup-catalog\/imports\/([^/]+)\/(apply|undo)$/,
      );
      if (isSetupCatalog && setupCatalogAction && request.method === "POST") {
        operation = setupCatalogAction[2] === "apply"
          ? "apply_setup_catalog_import"
          : "undo_setup_catalog_import";
        const importId = validateUuid(setupCatalogAction[1], "Import ID");
        const body = await readJsonBody(request);
        requireKeys(body, []);
        const action = setupCatalogAction[2];
        const result = await pool.query(
          `SELECT v3.${action}_setup_catalog_import($1::uuid, $2::uuid, $3::uuid) AS result`,
          [...scope, actor, importId],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (isImports && url.pathname === IMPORTS_PATH && request.method === "POST") {
        operation = "create_import";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "kind", "csv"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.kind !== "string") throw new InventoryApiError(400, "Choose a supported import type.");
        const records = parseSetupImportCsv(body.kind, body.csv);
        const requestHash = hashRequest({ kind: body.kind, records });
        const result = await pool.query(
          "SELECT v3.stage_setup_import($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb) AS result",
          [...scope, actor, requestId, requestHash, body.kind, JSON.stringify(records)],
        );
        const staged = resultValue(result);
        sendJson(response, staged.replayed ? 200 : 201, { ...staged, records });
        return true;
      }

      if (isImports && url.pathname === `${IMPORTS_PATH}/workbooks/preview` && request.method === "POST") {
        operation = "preview_workbook_import";
        const body = await readJsonBody(request, MAX_WORKBOOK_BODY_BYTES);
        requireKeys(body, ["family", "fileName", "workbookBase64"]);
        const parsed = parseWorkbookUpload(body);
        const { products, priorLinks } = await workbookLinkContext(pool, scope, body.family);
        const rows = linkWorkbookCapacityRows(parsed.rows, products, priorLinks);
        sendJson(response, 200, {
          sourceFamily: body.family,
          fileName: parsed.fileName,
          fileSha256: parsed.fileSha256,
          rows: rows.map((row) => ({
            sourceKey: row.sourceKey,
            name: row.name,
            row: row.source.row,
            reason: row.linkType,
            productCode: row.productCode,
          })),
          products: products.map(({ code, name }) => ({ code, name })),
        });
        return true;
      }

      if (isImports && url.pathname === `${IMPORTS_PATH}/workbooks` && request.method === "POST") {
        operation = "create_workbook_import";
        const body = await readJsonBody(request, MAX_WORKBOOK_BODY_BYTES);
        const requiredKeys = ["requestId", "family", "fileName", "workbookBase64"];
        const allowedKeys = new Set([...requiredKeys, "productLinks"]);
        if (requiredKeys.some((key) => !Object.hasOwn(body, key))
          || Object.keys(body).some((key) => !allowedKeys.has(key))) {
          throw new InventoryApiError(400, "The request contains missing or unsupported fields.");
        }
        const requestId = validateRequestId(body.requestId);
        const managerLinks = validateWorkbookProductLinks(body.productLinks ?? []);
        const parsed = parseWorkbookUpload(body);
        const { products, priorLinks } = await workbookLinkContext(pool, scope, body.family);
        const automaticRows = linkWorkbookCapacityRows(parsed.rows, products, priorLinks);
        const unresolvedKeys = new Set(automaticRows.filter((row) => !row.productCode).map((row) => row.sourceKey));
        const productsByCode = new Map(products.map((product) => [product.code.toLocaleLowerCase("en-US"), product]));
        for (const link of managerLinks) {
          if (!unresolvedKeys.has(link.sourceKey)
            || !productsByCode.has(link.productCode.toLocaleLowerCase("en-US"))) {
            throw new InventoryApiError(400, "Choose an active product for an unmatched workbook row.");
          }
        }
        const linkedRows = linkWorkbookCapacityRows(parsed.rows, products, priorLinks, managerLinks);
        const records = linkedRows
          .filter((row) => row.productCode)
          .map((row) => ({
            code: `${body.family === "dough-procedure" ? "DOUGH" : "SHIP"}-${row.sourceKey}`,
            name: row.name,
            productCode: row.productCode,
            data: body.family === "dough-procedure"
              ? {
                sourceFamily: body.family,
                sourceKey: row.sourceKey,
                fileName: parsed.fileName,
                fileSha256: parsed.fileSha256,
                source: row.source,
                doughballYield: row.doughballYield,
                doughballWeightOz: row.doughballWeightOz,
                doughballsPerTray: row.doughballsPerTray,
              }
              : {
                sourceFamily: body.family,
                sourceKey: row.sourceKey,
                fileName: parsed.fileName,
                fileSha256: parsed.fileSha256,
                source: row.source,
                pizzasPerCase: row.pizzasPerCase,
              },
          }));
        if (records.length === 0) {
          throw new InventoryApiError(
            409,
            "No workbook rows are linked to active products. Select an active product for at least one row before staging.",
          );
        }
        const kind = body.family === "dough-procedure" ? "recipes" : "production-setups";
        const requestHash = hashRequest({ family: body.family, fileSha256: parsed.fileSha256, records });
        const result = await pool.query(
          "SELECT v3.stage_setup_import($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb) AS result",
          [...scope, actor, requestId, requestHash, kind, JSON.stringify(records)],
        );
        const staged = resultValue(result);
        const unmatchedRows = linkedRows
          .filter((row) => !row.productCode)
          .map((row) => ({
            sourceKey: row.sourceKey,
            name: row.name,
            row: row.source.row,
            reason: row.linkType,
          }));
        sendJson(response, staged.replayed ? 200 : 201, {
          ...staged,
          records,
          sourceFamily: body.family,
          fileName: parsed.fileName,
          fileSha256: parsed.fileSha256,
          linkedCount: records.length,
          rememberedCount: linkedRows.filter((row) => row.linkType === "remembered").length,
          managerMappedCount: linkedRows.filter((row) => row.linkType === "manager").length,
          unmatchedRows: unmatchedRows.slice(0, 100),
          unmatchedCount: unmatchedRows.length,
          invalidValueCount: linkedRows.filter((row) => body.family === "dough-procedure"
            ? row.doughballYield === null
            : row.pizzasPerCase === null).length,
        });
        return true;
      }

      const importDetail = url.pathname.match(/^\/api\/v3\/imports\/([^/]+)$/);
      if (isImports && importDetail && request.method === "GET") {
        operation = "get_import";
        if (url.search) throw new InventoryApiError(400, "Import details do not accept query parameters.");
        const importId = validateUuid(importDetail[1], "Import ID");
        const result = await pool.query(
          "SELECT v3.get_setup_import($1::uuid, $2::uuid) AS result",
          [...scope, importId],
        );
        const value = resultValue(result);
        if (!value) throw new InventoryApiError(404, "Setup import not found.");
        sendJson(response, 200, { import: value });
        return true;
      }

      const importAction = url.pathname.match(/^\/api\/v3\/imports\/([^/]+)\/(apply|undo)$/);
      if (isImports && importAction && request.method === "POST") {
        const importId = validateUuid(importAction[1], "Import ID");
        const action = importAction[2];
        operation = action === "apply" ? "apply_import" : "undo_import";
        const body = await readJsonBody(request);
        requireKeys(body, []);
        const functionName = action === "apply" ? "apply_setup_import" : "undo_setup_import";
        const result = await pool.query(
          `SELECT v3.${functionName}($1::uuid, $2::uuid, $3::uuid) AS result`,
          [...scope, actor, importId],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (isInventory && url.pathname === `${INVENTORY_PATH}/warehouses` && request.method === "GET") {
        operation = "list_warehouses";
        if (url.search) throw new InventoryApiError(400, "Warehouse lists do not accept query parameters.");
        const result = await pool.query(
          "SELECT v3.list_inventory_warehouses($1::uuid) AS result",
          scope,
        );
        sendJson(response, 200, { warehouses: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/warehouses` && request.method === "POST") {
        operation = "create_warehouse";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "name"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.name !== "string") throw new InventoryApiError(400, "Enter a warehouse name.");
        const name = body.name.trim();
        const result = await pool.query(
          "SELECT v3.create_inventory_warehouse($1::uuid, $2::uuid, $3::text, $4::text, $5::text) AS result",
          [...scope, actor, requestId, hashRequest({ name }), name],
        );
        const value = resultValue(result);
        sendJson(response, value.replayed ? 200 : 201, value);
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/production-warehouse` && request.method === "POST") {
        operation = "set_production_warehouse";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "warehouseId"]);
        const requestId = validateRequestId(body.requestId);
        const warehouseId = validateUuid(body.warehouseId, "Production warehouse ID");
        const result = await pool.query(
          "SELECT v3.set_production_warehouse($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid) AS result",
          [...scope, actor, requestId, hashRequest({ warehouseId }), warehouseId],
        );
        const value = resultValue(result);
        sendJson(response, value.replayed ? 200 : 201, value);
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/products` && request.method === "GET") {
        operation = "list_products";
        if (url.search) throw new InventoryApiError(400, "Product lists do not accept query parameters.");
        const result = await pool.query(
          "SELECT v3.list_inventory_products($1::uuid) AS result",
          scope,
        );
        sendJson(response, 200, { products: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/stock` && request.method === "GET") {
        operation = "list_stock";
        const warehouseId = parseWarehouseId(url);
        const result = await pool.query(
          "SELECT v3.list_inventory_stock($1::uuid, $2::uuid) AS result",
          [...scope, warehouseId],
        );
        sendJson(response, 200, { stock: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/movements` && request.method === "GET") {
        operation = "list_movements";
        const warehouseId = parseWarehouseId(url, { allowMovementCursor: true });
        const limit = parseLimit(url, { extra: ["warehouseId", "beforeAt", "beforeId"] });
        const [beforeAt, beforeId] = parseMovementCursor(url);
        const result = await pool.query(
          "SELECT v3.list_inventory_movements($1::uuid, $2::uuid, $3::integer, $4::timestamptz, $5::uuid) AS result",
          [...scope, warehouseId, limit, beforeAt, beforeId],
        );
        const page = resultValue(result);
        sendJson(response, 200, { movements: page.items, nextCursor: page.nextCursor });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/movements` && request.method === "POST") {
        operation = "record_movement";
        const body = await readJsonBody(request);
        const lotFields = ["lotNumber", "receivedOn", "expiresOn"].filter((key) => Object.hasOwn(body, key));
        requireKeys(body, ["commandId", "warehouseId", "productCode", "type", "quantity", "reason", ...lotFields]);
        const commandId = validateRequestId(body.commandId);
        const warehouseId = validateUuid(body.warehouseId, "Warehouse ID");
        if (typeof body.productCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(body.productCode)) {
          throw new InventoryApiError(400, "Enter a valid product code.");
        }
        if (body.type !== "receipt" && body.type !== "adjustment") {
          throw new InventoryApiError(400, "Choose a receipt or stock adjustment.");
        }
        const quantity = validateQuantity(body.quantity, { nonzero: true });
        if (body.type === "receipt" && quantity.startsWith("-")) {
          throw new InventoryApiError(400, "A receipt quantity must be positive.");
        }
        if (quantity.startsWith("-") && lotFields.length > 0) {
          throw new InventoryApiError(400, "Negative adjustments consume existing lots and cannot supply lot metadata.");
        }
        const lotNumber = Object.hasOwn(body, "lotNumber") ? validateLotNumber(body.lotNumber) : null;
        const receivedOn = Object.hasOwn(body, "receivedOn") ? validateInventoryDate(body.receivedOn, "Received date") : null;
        const expiresOn = Object.hasOwn(body, "expiresOn") ? validateInventoryDate(body.expiresOn, "Expiration date") : null;
        if (receivedOn !== null && expiresOn !== null && expiresOn < receivedOn) {
          throw new InventoryApiError(400, "Expiration date cannot be before the received date.");
        }
        const reason = validateReason(body.reason);
        const basePayload = { warehouseId, productCode: body.productCode, type: body.type, quantity, reason };
        const payload = lotFields.length === 0 ? basePayload : {
          ...basePayload,
          ...(lotNumber === null ? {} : { lotNumber }),
          ...(receivedOn === null ? {} : { receivedOn }),
          ...(expiresOn === null ? {} : { expiresOn }),
        };
        const result = await pool.query(
          "SELECT v3.record_inventory_movement($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::text, $7::text, $8::numeric, $9::text, $10::text, $11::date, $12::date) AS result",
          [...scope, actor, commandId, hashRequest(payload), warehouseId, body.productCode, body.type, quantity, reason, lotNumber, receivedOn, expiresOn],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/transfers` && request.method === "POST") {
        operation = "transfer_stock";
        const body = await readJsonBody(request);
        requireKeys(body, ["commandId", "sourceWarehouseId", "targetWarehouseId", "productCode", "quantity", "reason"]);
        const commandId = validateRequestId(body.commandId);
        const sourceId = validateUuid(body.sourceWarehouseId, "Source warehouse ID");
        const targetId = validateUuid(body.targetWarehouseId, "Target warehouse ID");
        if (sourceId === targetId) throw new InventoryApiError(400, "Choose two different warehouses.");
        if (typeof body.productCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(body.productCode)) {
          throw new InventoryApiError(400, "Enter a valid product code.");
        }
        const quantity = validateQuantity(body.quantity, { positive: true, nonzero: true });
        const reason = validateReason(body.reason);
        const payload = { sourceId, targetId, productCode: body.productCode, quantity, reason };
        const result = await pool.query(
          "SELECT v3.transfer_inventory($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid, $7::text, $8::numeric, $9::text) AS result",
          [...scope, actor, commandId, hashRequest(payload), sourceId, targetId, body.productCode, quantity, reason],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/opening-counts` && request.method === "GET") {
        operation = "list_opening_counts";
        const result = await pool.query(
          "SELECT v3.list_opening_counts($1::uuid, $2::integer) AS result",
          [...scope, parseLimit(url)],
        );
        sendJson(response, 200, { counts: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/opening-counts` && request.method === "POST") {
        operation = "stage_opening_count";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "warehouseId", "csv"]);
        const requestId = validateRequestId(body.requestId);
        const warehouseId = validateUuid(body.warehouseId, "Warehouse ID");
        const productsResult = await pool.query(
          "SELECT v3.list_inventory_products($1::uuid) AS result",
          scope,
        );
        const products = resultValue(productsResult);
        if (!Array.isArray(products) || products.length === 0) {
          throw new InventoryApiError(409, "Import products before starting an opening count.");
        }
        const rows = parseOpeningCountCsv(body.csv, products.map((product) => product.code));
        const requestHash = hashRequest({ warehouseId, rows });
        const result = await pool.query(
          "SELECT v3.stage_opening_count($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::jsonb) AS result",
          [...scope, actor, requestId, requestHash, warehouseId, JSON.stringify(rows)],
        );
        const value = resultValue(result);
        sendJson(response, value.replayed ? 200 : 201, { ...value, rows });
        return true;
      }

      const countAction = url.pathname.match(/^\/api\/v3\/inventory\/opening-counts\/([^/]+)(?:\/(review|apply))?$/);
      if (isInventory && countAction) {
        const countId = validateUuid(countAction[1], "Count ID");
        const action = countAction[2];
        if (!action && request.method === "GET") {
          operation = "get_opening_count";
          const result = await pool.query(
            "SELECT v3.get_opening_count($1::uuid, $2::uuid) AS result",
            [...scope, countId],
          );
          const value = resultValue(result);
          if (!value) throw new InventoryApiError(404, "Opening count not found.");
          sendJson(response, 200, { count: value });
          return true;
        }
        if (action && request.method === "POST") {
          operation = action === "review" ? "review_opening_count" : "apply_opening_count";
          const body = await readJsonBody(request);
          requireKeys(body, []);
          const functionName = action === "review" ? "review_opening_count" : "apply_opening_count";
          const result = await pool.query(
            `SELECT v3.${functionName}($1::uuid, $2::uuid, $3::uuid) AS result`,
            [...scope, actor, countId],
          );
          sendJson(response, 200, resultValue(result));
          return true;
        }
      }
      throw new InventoryApiError(404, "Inventory route not found.");
    } catch (error) {
      const status = safeStatus(error);
      if (status >= 500) {
        logger({
          event: "v3.inventory_api.error",
          requestId: request.v3RequestId ?? null,
          operation,
          status,
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          databaseCode: typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined,
        });
      }
      const headers = Number.isSafeInteger(error?.retryAfterSeconds)
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {};
      sendJson(response, status, { error: safeMessage(error, operation) }, headers);
      return true;
    }
  };
}
