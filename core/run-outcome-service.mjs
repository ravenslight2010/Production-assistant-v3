// Run outcome command service. Records the closeout capture (actual cases,
// waste lbs) of a running, paused, or completed run through
// v3.apply_run_outcome_command — the same revision-checked, receipt-
// deduplicated command envelope as the lifecycle commands. Wholesale replace
// semantics: resending a field overwrites it, sending null clears it
// (v1 updateRunMeta parity). Mirrors core/line-timing-command-service.mjs
// on purpose.

import { createHash } from "node:crypto";

const SQL = `SELECT v3.apply_run_outcome_command(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::bigint, $7::integer, $8::numeric
) AS result`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_FIELD_VALUE = 10000000;

export class RunOutcomeCommandServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "RunOutcomeCommandServiceError";
    this.code = code;
    this.status = status;
  }
}

function normalizeUuid(value, field) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RunOutcomeCommandServiceError("INVALID_COMMAND", `${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function normalizeCases(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)
      || value < 0 || value > MAX_FIELD_VALUE) {
    throw new RunOutcomeCommandServiceError(
      "INVALID_COMMAND", `${field} must be a whole number between 0 and ${MAX_FIELD_VALUE}.`);
  }
  return value;
}

function normalizeLbs(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)
      || value < 0 || value > MAX_FIELD_VALUE) {
    throw new RunOutcomeCommandServiceError(
      "INVALID_COMMAND", `${field} must be a finite number between 0 and ${MAX_FIELD_VALUE}.`);
  }
  return value;
}

function normalizeCommand(command) {
  if (command === null || typeof command !== "object") {
    throw new RunOutcomeCommandServiceError("INVALID_COMMAND", "command is required.");
  }
  const commandId = command.commandId;
  if (typeof commandId !== "string" || commandId.trim() !== commandId
      || commandId.length === 0 || commandId.length > 200) {
    throw new RunOutcomeCommandServiceError("INVALID_COMMAND", "commandId must be a trimmed string of at most 200 characters.");
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw new RunOutcomeCommandServiceError("INVALID_COMMAND", "expectedRevision must be a non-negative safe integer.");
  }
  const actualCases = normalizeCases(command.actualCases, "actualCases");
  const wasteLbs = normalizeLbs(command.wasteLbs, "wasteLbs");
  return {
    runId: normalizeUuid(command.runId, "runId"),
    commandId,
    expectedRevision: command.expectedRevision,
    actualCases,
    wasteLbs,
  };
}

function normalizeAuth(auth) {
  if (auth?.verified !== true) {
    throw new RunOutcomeCommandServiceError("UNAUTHENTICATED", "Verified server authentication is required.", 401);
  }
  try {
    return {
      facilityId: normalizeUuid(auth.facilityId, "facilityId"),
      actorId: normalizeUuid(auth.actorId, "actorId"),
    };
  } catch {
    throw new RunOutcomeCommandServiceError("UNAUTHENTICATED", "Verified facility and actor identity are required.", 401);
  }
}

export function createRunOutcomeCommandService({ query, authorize }) {
  if (typeof query !== "function") {
    throw new TypeError("A parameterized database query function is required.");
  }
  if (typeof authorize !== "function") {
    throw new TypeError("A server authorization function is required.");
  }

  return Object.freeze({
    async execute({ auth, command } = {}) {
      const identity = normalizeAuth(auth);
      const normalizedCommand = normalizeCommand(command);
      const authorized = await authorize({
        auth,
        action: "run.lifecycle.command",
        commandType: "run_outcome",
      });
      if (authorized !== true) {
        throw new RunOutcomeCommandServiceError("FORBIDDEN", "You cannot change this run.", 403);
      }

      const canonicalRequest = JSON.stringify({
        facilityId: identity.facilityId,
        actorId: identity.actorId,
        runId: normalizedCommand.runId,
        commandId: normalizedCommand.commandId,
        actualCases: normalizedCommand.actualCases,
        wasteLbs: normalizedCommand.wasteLbs,
        expectedRevision: normalizedCommand.expectedRevision,
      });
      const requestHash = createHash("sha256").update(canonicalRequest, "utf8").digest("hex");
      const result = await query(SQL, [
        identity.facilityId,
        normalizedCommand.runId,
        identity.actorId,
        normalizedCommand.commandId,
        requestHash,
        normalizedCommand.expectedRevision,
        normalizedCommand.actualCases,
        normalizedCommand.wasteLbs,
      ]);
      const outcome = result?.rows?.[0]?.result?.outcome;
      if (!["accepted", "conflict", "invalid_transition"].includes(outcome)) {
        throw new RunOutcomeCommandServiceError(
          "INVALID_STORAGE_RESPONSE",
          "The run outcome command service received an invalid database result.",
          502,
        );
      }
      return result.rows[0].result;
    },
  });
}
