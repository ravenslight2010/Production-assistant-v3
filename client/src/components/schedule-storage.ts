import type { ProductionSchedule, ScheduleCatalog, ScheduleCommandRequest } from "../api";

const CACHE_PREFIX = "fieldline:v3:schedule-cache:";
const PENDING_PREFIX = "fieldline:v3:schedule-pending:";

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
