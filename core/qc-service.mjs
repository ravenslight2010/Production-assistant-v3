import { createHash } from "node:crypto";
import { evaluateQcMeasurement, QC_WEIGHT_UNITS } from "./qc-domain.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const TARGET_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/u;
const MEASUREMENT = /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const SQL = {
  dashboard: "SELECT v3.get_qc_run_dashboard($1::uuid, $2::uuid) AS result",
  targets: "SELECT v3.get_qc_targets($1::uuid) AS result",
  lot: "SELECT v3.record_qc_lot($1::uuid, $2::text, $3::text, $4::uuid, $5::jsonb) AS result",
  "weight-check": "SELECT v3.record_qc_weight_check($1::uuid, $2::text, $3::text, $4::uuid, $5::jsonb) AS result",
  "brix-check": "SELECT v3.record_qc_brix_check($1::uuid, $2::text, $3::text, $4::uuid, $5::jsonb) AS result",
  target: "SELECT v3.save_qc_target($1::uuid, $2::text, $3::text, $4::text, $5::bigint, $6::jsonb) AS result",
};

export class QcServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "QcServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  return new QcServiceError("INVALID_REQUEST", message, 400);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Enter a valid QC request.");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw invalid("The QC request contains missing or unsupported fields.");
  }
}

function uuid(value, name, status = 400) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new QcServiceError("INVALID_ID", `${name} must be a UUID.`, status);
  }
  return value.toLowerCase();
}

function identity(auth, capability) {
  if (auth?.verified !== true) throw new QcServiceError("UNAUTHENTICATED", "Sign in to access QC.", 401);
  if (!Array.isArray(auth.capabilities) || !auth.capabilities.includes(capability)) {
    throw new QcServiceError("FORBIDDEN", capability === "manage-qc"
      ? "A QC manager must change reviewed targets."
      : "Your role does not include QC recording.", 403);
  }
  return {
    actorId: uuid(auth.actorId, "actorId", 401),
    facilityId: uuid(auth.facilityId, "facilityId", 401),
  };
}

function text(value, name, max, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || CONTROL.test(value)) throw invalid(`${name} contains invalid characters.`);
  const normalized = value.trim();
  if ((!allowEmpty && normalized.length < 1) || normalized.length > max) {
    throw invalid(`${name} must be ${allowEmpty ? "at most" : "from 1 to"} ${max} characters.`);
  }
  return normalized;
}

function targetKey(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !TARGET_KEY.test(value)) throw invalid("Choose a valid reviewed target key.");
  return value;
}

function decimal(value, name, { measurement = false } = {}) {
  if (typeof value !== "string" || !(measurement ? MEASUREMENT : DECIMAL).test(value)) {
    throw invalid(`${name} must be a non-negative decimal with up to six decimal places.`);
  }
  return value;
}

function normalizeLot(details) {
  exactKeys(details, ["productCode", "lotNumber", "notes"]);
  if (!CODE.test(details.productCode)) throw invalid("Enter a valid component product code.");
  return {
    productCode: details.productCode,
    lotNumber: text(details.lotNumber, "Lot number", 120),
    notes: text(details.notes, "Notes", 1000, { allowEmpty: true }),
  };
}

function normalizeMeasurement(kind, details) {
  exactKeys(details, ["phase", "value", "unit", "targetKey", "notes"]);
  if (kind === "weight-check" && !["pre-run", "30-minute"].includes(details.phase)) {
    throw invalid("Choose pre-run or 30-minute weight check.");
  }
  if (kind === "brix-check" && details.phase !== null) throw invalid("Brix checks do not have a weight-check phase.");
  if (kind === "weight-check" && !QC_WEIGHT_UNITS.includes(details.unit)) throw invalid("Choose a supported weight unit.");
  if (kind === "brix-check" && details.unit !== "brix") throw invalid("Brix checks must use the brix unit.");
  const value = decimal(details.value, "Observed value", { measurement: true });
  if (Number(value) <= 0 || (kind === "brix-check" && Number(value) > 100)) {
    throw invalid(kind === "brix-check" ? "Brix must be greater than 0 and at most 100." : "Weight must be greater than zero.");
  }
  return {
    phase: kind === "weight-check" ? details.phase : null,
    value,
    unit: details.unit,
    targetKey: targetKey(details.targetKey),
    notes: text(details.notes, "Notes", 1000, { allowEmpty: true }),
  };
}

function normalizeTarget(details) {
  exactKeys(details, ["kind", "unit", "minimum", "maximum", "active"]);
  if (!["weight", "brix"].includes(details.kind)) throw invalid("Choose a weight or Brix target.");
  if (details.kind === "weight" && !QC_WEIGHT_UNITS.includes(details.unit)) throw invalid("Choose a supported weight unit.");
  if (details.kind === "brix" && details.unit !== "brix") throw invalid("Brix targets must use the brix unit.");
  if (typeof details.active !== "boolean") throw invalid("Target status must be active or inactive.");
  const minimum = details.minimum === null ? null : decimal(details.minimum, "Minimum");
  const maximum = details.maximum === null ? null : decimal(details.maximum, "Maximum");
  if (minimum === null && maximum === null) throw invalid("Enter at least one reviewed target bound.");
  if (minimum !== null && maximum !== null && Number(minimum) > Number(maximum)) {
    throw invalid("Maximum must be greater than or equal to minimum.");
  }
  if (details.kind === "brix" && [minimum, maximum].some((bound) => bound !== null && Number(bound) > 100)) {
    throw invalid("Brix target bounds cannot exceed 100.");
  }
  return { kind: details.kind, unit: details.unit, minimum, maximum, active: details.active };
}

function hashRequest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function storageError(error) {
  switch (error?.code) {
    case "P0002": return new QcServiceError("NOT_FOUND", "That QC run is no longer available.", 404);
    case "42501": return new QcServiceError("FORBIDDEN", "Your role cannot complete this QC action.", 403);
    case "P2002": return new QcServiceError("IDEMPOTENCY_CONFLICT", "This request ID was already used for different QC details.", 409);
    case "22023":
    case "22P02":
    case "23514": return new QcServiceError("INVALID_REQUEST", "The QC values are invalid. Review them and try again.", 400);
    case "23505":
    case "40001":
    case "55000": return new QcServiceError("CONFLICT", "QC state changed. Refresh and review it again.", 409);
    default: return error;
  }
}

function validTarget(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && TARGET_KEY.test(value.targetKey)
    && ["weight", "brix"].includes(value.kind)
    && (value.kind === "weight" ? QC_WEIGHT_UNITS.includes(value.unit) : value.unit === "brix")
    && (value.minimum === null || (typeof value.minimum === "string" && DECIMAL.test(value.minimum)))
    && (value.maximum === null || (typeof value.maximum === "string" && DECIMAL.test(value.maximum)))
    && (value.minimum !== null || value.maximum !== null)
    && typeof value.active === "boolean"
    && Number.isSafeInteger(value.revision) && value.revision >= 1
    && UUID.test(value.updatedBy) && TIMESTAMP.test(value.updatedAt);
}

function validRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !UUID.test(value.recordId) || !/^[1-9][0-9]*$/u.test(value.sequence)
    || (value.runId !== null && !UUID.test(value.runId))
    || !["lot", "weight-check", "brix-check", "target-set"].includes(value.kind)
    || !UUID.test(value.actorId) || value.relatedRecordId !== null || !TIMESTAMP.test(value.recordedAt)
    || !value.details || typeof value.details !== "object" || Array.isArray(value.details)) return false;
  try {
    if (value.kind === "lot") {
      const details = normalizeLot(value.details);
      return Object.entries(details).every(([key, expected]) =>
        JSON.stringify(value.details[key]) === JSON.stringify(expected));
    }
    if (value.kind === "target-set") {
      return value.runId === null && TARGET_KEY.test(value.details.targetKey)
        && Number.isSafeInteger(value.details.revision) && value.details.revision >= 1;
    }
    const normalized = normalizeMeasurement(value.kind, {
      phase: value.details.phase,
      value: value.details.value,
      unit: value.details.unit,
      targetKey: value.details.targetKey,
      notes: value.details.notes,
    });
    for (const [key, expected] of Object.entries(normalized)) {
      if (JSON.stringify(value.details[key]) !== JSON.stringify(expected)) return false;
    }
    if (!QC_OUTCOMES_SAFE.has(value.details.outcome)
      || (value.details.target !== null && !validTarget(value.details.target))
      || value.details.targetKey !== (value.details.target?.targetKey ?? value.details.targetKey)) return false;
    const expected = evaluateQcMeasurement({
      kind: value.kind,
      value: value.details.value,
      unit: value.details.unit,
      targetKey: value.details.targetKey,
      target: value.details.target,
    });
    return value.details.outcome === expected.outcome
      && value.details.notEvaluatedReason === expected.notEvaluatedReason;
  } catch {
    return false;
  }
}

const QC_OUTCOMES_SAFE = new Set(["pass", "fail", "not-evaluated"]);

function requireResult(result, predicate) {
  const value = result?.rows?.[0]?.result;
  if (!predicate(value)) {
    throw new QcServiceError("INVALID_STORAGE_RESPONSE", "QC storage returned an invalid response.", 502);
  }
  return value;
}

function validDashboard(value, runId) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.run?.id === runId && /^[0-9]+$/u.test(value.highWaterMark)
    && Array.isArray(value.records) && value.records.every(validRecord)
    && value.records.every((record) => record.runId === runId)
    && value.records.every((record, index) => index === 0
      || BigInt(record.sequence) > BigInt(value.records[index - 1].sequence));
}

function validTargets(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Array.isArray(value.targets) && value.targets.every(validTarget);
}

function validMutation(value, runId) {
  return value && ["accepted"].includes(value.outcome) && typeof value.replayed === "boolean"
    && validRecord(value.record) && validDashboard(value, runId);
}

export function createQcService({ query }) {
  if (typeof query !== "function") throw new TypeError("A parameterized database query function is required.");

  async function execute(sql, values, predicate) {
    try {
      return requireResult(await query(sql, values), predicate);
    } catch (error) {
      if (error instanceof QcServiceError) throw error;
      throw storageError(error);
    }
  }

  return Object.freeze({
    async getDashboard({ auth, runId }) {
      identity(auth, "record-qc");
      const normalizedRunId = uuid(runId, "runId");
      return execute(SQL.dashboard, [auth.actorId, normalizedRunId], (value) => validDashboard(value, normalizedRunId));
    },

    async getTargets({ auth }) {
      identity(auth, "record-qc");
      return execute(SQL.targets, [auth.actorId.toLowerCase()], validTargets);
    },

    async record({ auth, kind, requestId, runId, details }) {
      const actor = identity(auth, "record-qc");
      if (!["lot", "weight-check", "brix-check"].includes(kind)) throw invalid("Unsupported QC record kind.");
      const normalizedRequestId = uuid(requestId, "requestId");
      const normalizedRunId = uuid(runId, "runId");
      const normalizedDetails = kind === "lot" ? normalizeLot(details) : normalizeMeasurement(kind, details);
      const requestHash = hashRequest({
        facilityId: actor.facilityId, actorId: actor.actorId, requestId: normalizedRequestId,
        kind, runId: normalizedRunId, details: normalizedDetails,
      });
      return execute(SQL[kind], [actor.actorId, normalizedRequestId, requestHash, normalizedRunId,
        JSON.stringify(normalizedDetails)], (value) => validMutation(value, normalizedRunId));
    },

    async saveTarget({ auth, requestId, targetKey: key, expectedRevision, details }) {
      const actor = identity(auth, "manage-qc");
      const normalizedRequestId = uuid(requestId, "requestId");
      if (typeof key !== "string" || !TARGET_KEY.test(key)) throw invalid("Enter a valid target key.");
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw invalid("Target revision is invalid.");
      const normalizedDetails = normalizeTarget(details);
      const requestHash = hashRequest({
        facilityId: actor.facilityId, actorId: actor.actorId, requestId: normalizedRequestId,
        targetKey: key, expectedRevision, details: normalizedDetails,
      });
      return execute(SQL.target, [actor.actorId, normalizedRequestId, requestHash, key,
        expectedRevision, JSON.stringify(normalizedDetails)], (value) => value
          && typeof value.replayed === "boolean"
          && ((value.outcome === "accepted" && validTarget(value.target) && validTargets(value))
            || (value.outcome === "conflict" && validTargets(value))));
    },
  });
}
