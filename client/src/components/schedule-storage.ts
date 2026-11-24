import type {
  ProductionSchedule,
  ScheduleCatalog,
  ScheduleCommandRequest,
  ScheduleImportActionRequest,
  ScheduleImportStageRequest,
} from "../api";

const CACHE_PREFIX = "fieldline:v3:schedule-cache:";
const PENDING_PREFIX = "fieldline:v3:schedule-pending:";
const IMPORT_PENDING_PREFIX = "fieldline:v3:schedule-import-pending:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PendingScheduleImportRequest =
  | { kind: "stage"; request: ScheduleImportStageRequest }
  | { kind: "apply" | "undo"; importId: string; request: ScheduleImportActionRequest };

interface ScheduleCache {
  schedule: ProductionSchedule;
  catalog: ScheduleCatalog | null;
  cachedAt: string;
}

function cacheKey(userId: string, date: string): string {
  return `${CACHE_PREFIX}${userId}:${date}`;
}

function pendingKey(userId: string, date: string): string {
  return `${PENDING_PREFIX}${userId}:${date}`;
}

export function readScheduleCache(userId: string, date: string): ScheduleCache | null {
  const key = cacheKey(userId, date);
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<ScheduleCache> | null;
    if (!value || typeof value.cachedAt !== "string" || !Number.isFinite(Date.parse(value.cachedAt))
      || value.schedule?.date !== date || !Array.isArray(value.schedule.runs)
      || !Array.isArray(value.schedule.breaks) || value.schedule.breaks.length !== 3
      || value.schedule.substitutionOverlay?.productionDate !== date
      || !Array.isArray(value.schedule.substitutionOverlay.rules)) {
      return null;
    }
    return value as ScheduleCache;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function writeScheduleCache(
  userId: string,
  schedule: ProductionSchedule,
  catalog: ScheduleCatalog | null,
): string {
  const cachedAt = new Date().toISOString();
  const safeSchedule: ProductionSchedule = {
    ...schedule,
    runs: schedule.runs.map((run) => ({ ...run, notes: "" })),
  };
  localStorage.setItem(cacheKey(userId, schedule.date), JSON.stringify({
    schedule: safeSchedule,
    catalog,
    cachedAt,
  } satisfies ScheduleCache));
  return cachedAt;
}

export function readPendingScheduleCommand(userId: string, date: string): ScheduleCommandRequest | null {
  const key = pendingKey(userId, date);
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Partial<ScheduleCommandRequest> | null;
    if (!value || value.date !== date || typeof value.requestId !== "string"
      || !Number.isSafeInteger(value.expectedRevision) || !value.command) {
      return null;
    }
    return value as ScheduleCommandRequest;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function writePendingScheduleCommand(userId: string, request: ScheduleCommandRequest): void {
  sessionStorage.setItem(pendingKey(userId, request.date), JSON.stringify(request));
}

export function clearPendingScheduleCommand(userId: string, date: string): void {
  sessionStorage.removeItem(pendingKey(userId, date));
}

function validImportAction(value: unknown): value is ScheduleImportActionRequest {
  const request = value as Partial<ScheduleImportActionRequest> | null;
  return objectRecord(request) && typeof request.requestId === "string" && UUID.test(request.requestId)
    && typeof request.date === "string" && Number.isSafeInteger(request.expectedRevision)
    && (request.expectedRevision ?? -1) >= 0
    && Object.keys(request).length === 3;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readPendingScheduleImport(userId: string): PendingScheduleImportRequest | null {
  const key = `${IMPORT_PENDING_PREFIX}${userId}`;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as unknown;
    if (!objectRecord(value)) return null;
    if (value.kind === "stage" && objectRecord(value.request)
      && Object.keys(value).length === 2 && Object.keys(value.request).length === 4
      && typeof value.request.importId === "string" && UUID.test(value.request.importId)
      && typeof value.request.requestId === "string" && UUID.test(value.request.requestId)
      && objectRecord(value.request.source) && typeof value.request.source.sha256 === "string"
      && Array.isArray(value.request.runs) && value.request.runs.length > 0) {
      return value as PendingScheduleImportRequest;
    }
    if ((value.kind === "apply" || value.kind === "undo") && Object.keys(value).length === 3
      && typeof value.importId === "string" && UUID.test(value.importId) && validImportAction(value.request)) {
      return value as PendingScheduleImportRequest;
    }
    return null;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function writePendingScheduleImport(userId: string, pending: PendingScheduleImportRequest): void {
  sessionStorage.setItem(`${IMPORT_PENDING_PREFIX}${userId}`, JSON.stringify(pending));
}

export function clearPendingScheduleImport(userId: string): void {
  sessionStorage.removeItem(`${IMPORT_PENDING_PREFIX}${userId}`);
}
