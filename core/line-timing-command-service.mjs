// Run line-timing command service. Adjusts the reviewed die-line transit
// timings (press/oven, frontline, post-tunnel, freezer) of a planned,
// running, or paused run through v3.apply_line_timing_command — the same
// revision-checked, receipt-deduplicated command envelope as the lifecycle
// commands. Mirrors core/run-command-service.mjs on purpose.

import { createHash } from "node:crypto";

const SQL = `SELECT v3.apply_line_timing_command(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::bigint, $7::jsonb
) AS result`;

const TIMING_KEYS = new Set(["pressOvenMin", "frontlineMin", "postTunnelMin", "freezerTime"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class LineTimingCommandServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "LineTimingCommandServiceError";
    this.code = code;
    this.status = status;
  }
}

function normalizeUuid(value, field) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new LineTimingCommandServiceError("INVALID_COMMAND", `${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function normalizeTiming(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LineTimingCommandServiceError("INVALID_COMMAND", "timing must be an object.");
  }
  const timing = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!TIMING_KEYS.has(key)) {
      throw new LineTimingCommandServiceError("INVALID_COMMAND", `Unsupported timing field: ${key}.`);
    }
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 100000) {
      throw new LineTimingCommandServiceError("INVALID_COMMAND", `${key} must be a finite number between 0 and 100000.`);
    }
    timing[key] = entry;
  }
  if (Object.keys(timing).length === 0) {
    throw new LineTimingCommandServiceError("INVALID_COMMAND", "timing must set at least one field.");
  }
  return timing;
}

function normalizeCommand(command) {
  if (command === null || typeof command !== "object") {
    throw new LineTimingCommandServiceError("INVALID_COMMAND", "command is required.");
  }
  const commandId = command.commandId;
  if (typeof commandId !== "string" || commandId.trim() !== commandId
      || commandId.length === 0 || commandId.length > 200) {
    throw new LineTimingCommandServiceError("INVALID_COMMAND", "commandId must be a trimmed string of at most 200 characters.");
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw new LineTimingCommandServiceError("INVALID_COMMAND", "expectedRevision must be a non-negative safe integer.");
  }
  return {
    runId: normalizeUuid(command.runId, "runId"),
    commandId,
    expectedRevision: command.expectedRevision,
    timing: normalizeTiming(command.timing),
  };
}

function normalizeAuth(auth) {
  if (auth?.verified !== true) {
    throw new LineTimingCommandServiceError("UNAUTHENTICATED", "Verified server authentication is required.", 401);
  }
  try {
    return {
      facilityId: normalizeUuid(auth.facilityId, "facilityId"),
      actorId: normalizeUuid(auth.actorId, "actorId"),
    };
  } catch {
    throw new LineTimingCommandServiceError("UNAUTHENTICATED", "Verified facility and actor identity are required.", 401);
  }
}

export function createLineTimingCommandService({ query, authorize }) {
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
        commandType: "line_timing",
      });
      if (authorized !== true) {
        throw new LineTimingCommandServiceError("FORBIDDEN", "You cannot change this run.", 403);
      }

      const canonicalRequest = JSON.stringify({
        facilityId: identity.facilityId,
        actorId: identity.actorId,
        runId: normalizedCommand.runId,
        commandId: normalizedCommand.commandId,
        timing: normalizedCommand.timing,
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
        JSON.stringify(normalizedCommand.timing),
      ]);
      const outcome = result?.rows?.[0]?.result?.outcome;
      if (!["accepted", "conflict", "invalid_transition"].includes(outcome)) {
        throw new LineTimingCommandServiceError(
          "INVALID_STORAGE_RESPONSE",
          "The line timing command service received an invalid database result.",
          502,
        );
      }
      return result.rows[0].result;
    },
  });
}
