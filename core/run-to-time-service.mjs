import { createHash } from "node:crypto";
import { normalizeRunToTimeInput } from "./run-to-time.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_KEYS = ["commandId", "expectedRevision", "runId", "runToTime"];
const SQL = `SELECT v3.apply_run_to_time_command(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::time, $7::bigint
) AS result`;

export class RunToTimeServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "RunToTimeServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalidCommand(message) {
  return new RunToTimeServiceError("INVALID_COMMAND", message, 400);
}

function normalizeUuid(value, fieldName) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidCommand(`${fieldName} must be a canonical UUID.`);
  }
  return value.toLowerCase();
}

function normalizeCommand(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    throw invalidCommand("Command must be an object.");
  }
  const keys = Object.keys(command).sort();
  if (keys.length !== COMMAND_KEYS.length || keys.some((key, index) => key !== COMMAND_KEYS[index])) {
    throw invalidCommand("Command contains missing or unsupported fields.");
  }
  if (typeof command.commandId !== "string" || command.commandId.length < 1
    || command.commandId.length > 200 || command.commandId.trim() !== command.commandId) {
    throw invalidCommand("commandId must be 1–200 characters with no surrounding whitespace.");
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw invalidCommand("expectedRevision must be a non-negative safe integer.");
  }
  const runToTime = normalizeRunToTimeInput(command.runToTime);
  if (runToTime === null) {
    throw invalidCommand("runToTime must be a valid 12-hour or 24-hour time.");
  }
  return {
    runId: normalizeUuid(command.runId, "runId"),
    commandId: command.commandId,
    expectedRevision: command.expectedRevision,
    runToTime,
  };
}

function normalizeAuth(auth) {
  if (auth?.verified !== true) {
    throw new RunToTimeServiceError("UNAUTHENTICATED", "Verified server authentication is required.", 401);
  }
  try {
    return {
      facilityId: normalizeUuid(auth.facilityId, "facilityId"),
      actorId: normalizeUuid(auth.actorId, "actorId"),
    };
  } catch {
    throw new RunToTimeServiceError("UNAUTHENTICATED", "Verified facility and actor identity are required.", 401);
  }
}

export function createRunToTimeService({ query, authorize }) {
  if (typeof query !== "function") throw new TypeError("A parameterized database query function is required.");
  if (typeof authorize !== "function") throw new TypeError("A server authorization function is required.");

  return Object.freeze({
    async execute({ auth, command }) {
      const identity = normalizeAuth(auth);
      const normalized = normalizeCommand(command);
      const authorized = await authorize({
        auth,
        action: "run.lifecycle.command",
        commandType: "run_to_time",
      });
      if (authorized !== true) {
        throw new RunToTimeServiceError("FORBIDDEN", "You cannot change this run.", 403);
      }

      const requestHash = createHash("sha256").update(JSON.stringify({
        facilityId: identity.facilityId,
        actorId: identity.actorId,
        runId: normalized.runId,
        commandId: normalized.commandId,
        commandType: "run_to_time",
        expectedRevision: normalized.expectedRevision,
        runToTime: normalized.runToTime,
      }), "utf8").digest("hex");
      const result = await query(SQL, [
        identity.facilityId,
        normalized.runId,
        identity.actorId,
        normalized.commandId,
        requestHash,
        normalized.runToTime,
        normalized.expectedRevision,
      ]);
      const stored = result?.rows?.[0]?.result;
      if (!stored || !["accepted", "conflict", "invalid_transition"].includes(stored.outcome)) {
        throw new RunToTimeServiceError(
          "INVALID_STORAGE_RESPONSE",
          "The Run to Time service received an invalid database result.",
          502,
        );
      }
      return stored;
    },
  });
}
