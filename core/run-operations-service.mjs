import { createHash } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONS = new Set([
  "start_stop", "end_stop", "add_past_stop", "update_stoppage",
  "delete_stoppage", "set_notes", "set_pause_tunnel",
]);
const SQL = `SELECT v3.apply_run_operation_command(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::jsonb, $8::bigint
) AS result`;
const GET_REASONS_SQL = "SELECT v3.get_stop_reason_settings($1::uuid) AS result";
const SAVE_REASONS_SQL = `SELECT v3.save_stop_reason_settings(
  $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint, $6::jsonb
) AS result`;

export class RunOperationsServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "RunOperationsServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  return new RunOperationsServiceError("INVALID_COMMAND", message, 400);
}

function uuid(value, field, status = 400) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RunOperationsServiceError("INVALID_UUID", `${field} must be a canonical UUID.`, status);
  }
  return value.toLowerCase();
}

function identity(auth) {
  if (auth?.verified !== true) {
    throw new RunOperationsServiceError("UNAUTHENTICATED", "Verified server authentication is required.", 401);
  }
  return {
    facilityId: uuid(auth.facilityId, "facilityId", 401),
    actorId: uuid(auth.actorId, "actorId", 401),
  };
}

function commandId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || value.trim() !== value) {
    throw invalid("commandId must be 1–200 characters with no surrounding whitespace.");
  }
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid("expectedRevision must be a non-negative safe integer.");
  return value;
}

function exactObject(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Command details must be an object.");
  const keys = Object.keys(value).sort();
  const expectedAllowed = [...allowed].sort();
  const expectedRequired = [...required].sort();
  if (keys.some((key) => !expectedAllowed.includes(key))
    || expectedRequired.some((key) => !keys.includes(key))) {
    throw invalid("Command details contain missing or unsupported fields.");
  }
  return value;
}

function text(value, field, maximum, trim = false) {
  if (typeof value !== "string" || value.length > maximum || (trim && value.trim().length > maximum)) {
    throw invalid(`${field} must be text no longer than ${maximum} characters.`);
  }
  return trim ? value.trim() : value;
}

function timestamp(value, field) {
  if (typeof value !== "string") throw invalid(`${field} must be a canonical timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw invalid(`${field} must be a canonical timestamp.`);
  }
  return value;
}

function reasonAndNotes(details) {
  return {
    reason: text(details.reason, "reason", 200, true),
    notes: text(details.notes, "notes", 2000),
  };
}

function normalizeCommand(command) {
  exactObject(command, ["runId", "commandId", "commandType", "expectedRevision", "details"]);
  if (!OPERATIONS.has(command.commandType)) throw invalid("commandType is unsupported.");
  const base = {
    runId: uuid(command.runId, "runId"),
    commandId: commandId(command.commandId),
    commandType: command.commandType,
    expectedRevision: revision(command.expectedRevision),
  };
  const details = command.details;
  switch (command.commandType) {
    case "start_stop":
      exactObject(details, ["reason", "notes"]);
      return { ...base, details: reasonAndNotes(details) };
    case "end_stop":
    case "delete_stoppage":
      exactObject(details, ["stoppageId"]);
      return { ...base, details: { stoppageId: uuid(details.stoppageId, "stoppageId") } };
    case "add_past_stop":
      exactObject(details, ["reason", "notes", "startedAt", "endedAt"]);
      return { ...base, details: {
        ...reasonAndNotes(details),
        startedAt: timestamp(details.startedAt, "startedAt"),
        endedAt: timestamp(details.endedAt, "endedAt"),
      } };
    case "update_stoppage": {
      exactObject(details, ["stoppageId", "reason", "notes", "startedAt", "endedAt"],
        ["stoppageId", "reason", "notes"]);
      if (Object.hasOwn(details, "startedAt") !== Object.hasOwn(details, "endedAt")) {
        throw invalid("Manual stoppage edits require both startedAt and endedAt.");
      }
      return { ...base, details: {
        stoppageId: uuid(details.stoppageId, "stoppageId"),
        ...reasonAndNotes(details),
        ...(Object.hasOwn(details, "startedAt") ? {
          startedAt: timestamp(details.startedAt, "startedAt"),
          endedAt: timestamp(details.endedAt, "endedAt"),
        } : {}),
      } };
    }
    case "set_notes":
      exactObject(details, ["operationalNotes"]);
      return { ...base, details: { operationalNotes: text(details.operationalNotes, "operationalNotes", 4000) } };
    case "set_pause_tunnel":
      exactObject(details, ["stoppageId", "stopTunnel"]);
      if (details.stopTunnel !== false) throw invalid("The pause override can only keep the tunnel running.");
      return { ...base, details: { stoppageId: uuid(details.stoppageId, "stoppageId"), stopTunnel: false } };
    default:
      throw invalid("commandType is unsupported.");
  }
}

function normalizeReasons(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) {
    throw invalid("Provide between 1 and 30 stop reasons.");
  }
  const reasons = value.map((reason) => text(reason, "Stop reason", 80, true));
  if (reasons.some((reason) => reason.length < 1)) throw invalid("Stop reasons cannot be blank.");
  if (new Set(reasons.map((reason) => reason.toLocaleLowerCase("en-US"))).size !== reasons.length) {
    throw invalid("Stop reasons must be unique.");
  }
  return reasons;
}

function validSettings(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Number.isSafeInteger(value.revision) && value.revision >= 0
    && Array.isArray(value.reasons) && value.reasons.length >= 1 && value.reasons.length <= 30
    && value.reasons.every((reason) => typeof reason === "string" && reason.length >= 1 && reason.length <= 80)
    && (value.updatedAt === null || (typeof value.updatedAt === "string"
      && new Date(value.updatedAt).toISOString() === value.updatedAt));
}

function requireSettings(result) {
  const value = result?.rows?.[0]?.result;
  if (!validSettings(value)) {
    throw new RunOperationsServiceError("INVALID_STORAGE_RESPONSE", "Stop reason storage returned invalid data.", 502);
  }
  return value;
}

function requireRunResult(result) {
  const value = result?.rows?.[0]?.result;
  if (!value || !["accepted", "conflict", "invalid_transition"].includes(value.outcome)) {
    throw new RunOperationsServiceError("INVALID_STORAGE_RESPONSE", "Run operation storage returned an invalid result.", 502);
  }
  const run = value.run ?? value.currentRun;
  if (!run || !UUID_PATTERN.test(run.id) || !Number.isSafeInteger(run.revision)
    || typeof run.operationalNotes !== "string" || !Array.isArray(run.stoppages)) {
    throw new RunOperationsServiceError("INVALID_STORAGE_RESPONSE", "Run operation storage returned an incomplete run.", 502);
  }
  return value;
}

function storageError(error) {
  if (error?.code === "P0002") {
    throw new RunOperationsServiceError("NOT_FOUND", "Run not found.", 404);
  }
  if (error?.code === "22023") {
    throw new RunOperationsServiceError("INVALID_COMMAND", "The operation details are invalid or the request ID was reused.", 400);
  }
  throw error;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function createRunOperationsService({ query, authorize }) {
  if (typeof query !== "function") throw new TypeError("A parameterized database query function is required.");
  if (typeof authorize !== "function") throw new TypeError("A server authorization function is required.");

  return Object.freeze({
    async execute({ auth, command }) {
      const principal = identity(auth);
      const normalized = normalizeCommand(command);
      if (await authorize({ auth, action: "run.operations.command", commandType: normalized.commandType }) !== true) {
        throw new RunOperationsServiceError("FORBIDDEN", "You cannot change this run's operational record.", 403);
      }
      const requestHash = hash({ ...principal, ...normalized });
      let result;
      try {
        result = await query(SQL, [
          principal.facilityId, normalized.runId, principal.actorId, normalized.commandId,
          requestHash, normalized.commandType, JSON.stringify(normalized.details), normalized.expectedRevision,
        ]);
      } catch (error) {
        storageError(error);
      }
      return requireRunResult(result);
    },

    async getStopReasons({ auth }) {
      const principal = identity(auth);
      if (await authorize({ auth, action: "run.read" }) !== true) {
        throw new RunOperationsServiceError("FORBIDDEN", "You cannot read stop reasons.", 403);
      }
      return requireSettings(await query(GET_REASONS_SQL, [principal.facilityId]));
    },

    async saveStopReasons({ auth, command }) {
      const principal = identity(auth);
      if (!Array.isArray(auth?.capabilities) || !auth.capabilities.includes("manage-factory-settings")) {
        throw new RunOperationsServiceError("FORBIDDEN", "Manager factory-settings permission is required.", 403);
      }
      exactObject(command, ["commandId", "expectedRevision", "reasons"]);
      const normalized = {
        commandId: commandId(command.commandId),
        expectedRevision: revision(command.expectedRevision),
        reasons: normalizeReasons(command.reasons),
      };
      const requestHash = hash({ ...principal, ...normalized, purpose: "stop-reasons" });
      let result;
      try {
        result = await query(SAVE_REASONS_SQL, [
          principal.facilityId, principal.actorId, normalized.commandId,
          requestHash, normalized.expectedRevision, JSON.stringify(normalized.reasons),
        ]);
      } catch (error) {
        storageError(error);
      }
      const value = result?.rows?.[0]?.result;
      if (!value || !["accepted", "conflict"].includes(value.outcome)
        || !validSettings(value.settings ?? value.currentSettings)) {
        throw new RunOperationsServiceError("INVALID_STORAGE_RESPONSE", "Stop reason storage returned an invalid result.", 502);
      }
      return value;
    },
  });
}
